import re
import sys
import os
import json
import random
import time
import webbrowser
from datetime import datetime
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import deque

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from PIL import Image
from PyQt6 import QtCore, QtGui, QtWidgets

# ----------------- CONFIG / CONSTANTS -----------------

YEAR_ID_RANGES = {
    "Any year": (1, 9000000000),
    "2006": (1, 11386),
    "2007": (11387, 141897),
    "2008": (141898, 1892311),
    "2009": (1892312, 5881290),
    "2010": (5881291, 13901944),
    "2011": (13901945, 22797639),
    "2012": (22797640, 36347234),
    "2013": (36347235, 53530394),
    "2014": (53530395, 75524130),
    "2015": (75524131, 103531549),
    "2016": (103531550, 205441141),
    "2017": (205441142, 478149931),
    "2018": (478149932, 915267179),
    "2019": (915267180, 1390794501),
    "2020": (1390794502, 2259402999),
    "2021": (2259403000, 3193391431),
    "2022": (3193391432, 4195844718),
    "2023": (4195844712, 5402010909),
    "2024": (5402010910, 7794159194),
    "2025": (7794159195, 9000000000),
}

METHODS = [
    "random",
    "numberless",
    "numbers",
    "ends_in_123",
    "ends_in_1_digit",
    "ends_in_2_digits",
    "ends_in_4_digits",
    "year",
    "double",
    "real_name",
    "double_real_name",
    "4digits_real_name",
    "nonstop",
]

SORT_OPTIONS = [
    "None",
    "Username A→Z",
    "Username Z→A",
    "ID low→high",
    "ID high→low",
    "Created oldest→newest",
    "Created newest→oldest",
    "RAP high→low",
    "RAP low→high",
    "Verified Yes first",
    "Verified No first",
    "Banned Yes first",
    "Banned No first",
    "Active Yes first",
    "Active No first",
]

BAN_FILTER_OPTIONS = ["All", "Only not banned", "Only banned"]
VERIFIED_FILTER_OPTIONS = ["All", "Only verified", "Only unverified"]
ACTIVE_FILTER_OPTIONS = ["All", "Only active", "Only inactive"]

TOOL_VERSION = "rFinder v1.0.1"
DISCORD_URL = "https://discord.gg/yRtzFENhbt"

ROBLOX_USER_API = "https://users.roblox.com/v1/users/{user_id}"
ROBLOX_USER_BY_NAME_API = "https://users.roblox.com/v1/usernames/users"
ROBLOX_AVATAR_THUMB_API = (
    "https://thumbnails.roblox.com/v1/users/avatar-headshot"
    "?userIds={user_id}&size=150x150&format=Png&isCircular=false"
)
ROBLOX_INVENTORY_API = (
    "https://inventory.roblox.com/v1/users/{user_id}/items/Asset/{asset_id}"
)
ROBLOX_COLLECTIBLES_API = (
    "https://inventory.roblox.com/v1/users/{user_id}/assets/collectibles"
    "?sortOrder=Asc&limit=100&cursor={cursor}"
)
ROBLOX_BADGES_API = (
    "https://accountinformation.roblox.com/v1/users/{user_id}/roblox-badges"
)

ROBLOX_HATS_INVENTORY_API = (
    "https://inventory.roblox.com/v2/users/{user_id}/inventory/8"
)

USERNAME_TO_ID_API = "https://users.roblox.com/v1/usernames/users"
USER_DETAILS_API = "https://users.roblox.com/v1/users/{user_id}"
BADGES_API = "https://badges.roblox.com/v1/users/{user_id}/badges?sortOrder=Desc&limit=10"
AVATAR_API = "https://avatar.roblox.com/v1/users/{user_id}/avatar"

VERIFIED_BADGE_ASSET_ID = 102611803
ROBLOX_PROFILE_URL = "https://www.roblox.com/users/{user_id}/profile"

DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/129.0 Safari/537.36"
)

BADGE_ICON_URLS = {
    "Combat Initiation": "https://images.rbxcdn.com/8d77254fc1e6d904fd3ded29dfca28cb.png",
    "Warrior": "https://images.rbxcdn.com/0a010c31a8b482731114810590553be3.png",
    "Bloxxer": "https://images.rbxcdn.com/139a7b3acfeb0b881b93a40134766048.png",
    "Official Model Maker": "https://images.rbxcdn.com/45710972c9c8d556805f8bee89389648.png",
    "Bricksmith": "https://images.rbxcdn.com/49f3d30f5c16a1c25ea0f97ea8ef150e.png",
    "Homestead": "https://images.rbxcdn.com/b66bc601e2256546c5dd6188fce7a8d1.png",
    "Inviter": "https://images.rbxcdn.com/01044aca1d917eb20bfbdc5e25af1294.png",
    "Ambassador": "https://images.rbxcdn.com/b853909efc7fdcf590363d01f5894f09.png",
    "Friendship": "https://images.rbxcdn.com/5eb20917cf530583e2641c0e1f7ba95e.png",
    "Veteran": "https://images.rbxcdn.com/b7e6cabb5a1600d813f5843f37181fa3.png",
    "Administrator": "https://static.wikia.nocookie.net/roblox/images/d/d1/Administrator_Badge_2025.png/revision/latest/scale-to-width-down/45?cb=20250508073352",
    "Welcome To The Club": "https://images.rbxcdn.com/6c2a598114231066a386fa716ac099c4.png",
}

BADGE_PIXMAP_CACHE: dict[tuple[str, int], QtGui.QPixmap] = {}

RAP_PRESETS = {
    "Off": None,
    "100+": 100,
    "500+": 500,
    "1k+": 1_000,
    "2.5k+": 2_500,
    "5k+": 5_000,
    "10k+": 10_000,
}

HAT_PRESETS = {
    "Off": None,
    "1+": 1,
    "2+": 2,
    "5+": 5,
    "10+": 10,
}

BADGE_NAMES = list(BADGE_ICON_URLS.keys())
SAVE_FILE_NAME = "rfinder_saved.json"

# Output directory for nonstop method
OUTPUT_DIR = "output"

FIRST_NAME_TOKENS = {
    # Male
    "aaron","abraham","adam","adrian","adriano","albert","alex","alexander","alfie","alfred",
    "alejandro","alonso","anderson","andres","angel","anton","armando","arthur","augusto",
    "austin","alan","barry","ben","benjamin","benny","benito","bradley","brandon","brian","bruce",
    "bruno","caleb","callum","cameron","caio","carlos","cesar","charles","chester","christian",
    "christopher","connor","cristian","daan","damian","daniel","danilo","darwin","danny","davi","david",
    "declan","dennis","dexter","diego","dirk","dominic","donald","douglas","dylan","eddy",
    "eduardo","edmund","edward","elijah","elliot","elliott","emmanuel","enrique","eric",
    "ernesto","esteban","ethan","eugene","evan","everton","fabian","felipe","fernando","filipe",
    "francis","francisco","frederick","freddy","fraser","gabriel","garrett","garry","gareth",
    "george","gonzalo","graham","gregory","grayson","guido","guillermo","guilherme","hamish",
    "harold","harry","harvey","hayden","hector","henrique","henry","howard","hugh","hugo",
    "ignacio","isaac","isaiah","ivan","jack","jackson","jacob","jaime","jamal","james","jared",
    "jason","javier","jelle","jenson","jeremiah","jeremy","jesper","jesus","joao","joaquin",
    "joel","joey","john","johnny","jimmy","johnathan","jonathan","jorge","jordan","jose",
    "jonas","joseph","josh","joshua","juan","julian","julio","justin","kaden","kauan","kees",
    "keith","kenneth","kenny","kevin","kelvin","kieran","kyle","kylan","larry","laurence",
    "lawrence","leandro","leo","leon","leonard","lewis","liam","logan","lorenzo","louis","luca",
    "luis","lucas","luciano","luke","lukey","luan","maarten","malcolm","manuel","marco",
    "marcus","mariano","mark","martin","mateo","mateus","matt","matthew","max","michael",
    "mikey","miguel","mitchell","monty","murilo","nathan","nick","nicholas","nicolas","niall",
    "nigel","noah","oliver","ollie","orlando","oscar","osvaldo","otavio","owen","parker",
    "patrick","paul","pedro","percival","philip","piers","preston","quinton","rafa","rafael",
    "ramon","raul","raymond","reinier","renato","reuben","ricardo","richard","ricky","robert",
    "rodrigo","ronald","ryan","salvador","sam","samuel","santiago","sebastian","sergio","seth",
    "simon","spencer","stanley","stephen","steven","stuart","sven","tanner","thiago","timmy",
    "terry","theodore","thomas","timothy","tobias","tomas","tommy","travis","trevor","tristan",
    "tyler","valentin","vicente","victor","vincent","vinicius","walter","wesley","weslley",
    "wilfred","will","william","wyatt","xander","xavier","zach","zachariah","zachary",

    # Female
    "abigail","adela","adriana","aisling","alejandra","alicia","alexandra","alexis","aline",
    "alyssa","amanda","amber","amelia","amelie","ana","anastasia","andrea","angelica",
    "angelina","ann","anita","anna","annabelle","ariana","ashley","aubrey","audrey","autumn",
    "ava","avery","barbara","baylee","beatrice","beatriz","bella","beth","bethany","bianca",
    "blair","brenda","brianna","bridget","brooke","bruna","camila","camilla","carla","carmen",
    "caroline","carolina","cassandra","catherine","cecilia","charlotte","chloe","claire",
    "clara","clarissa","colette","consuelo","courtney","cressida","daniela","danielle",
    "daphne","delilah","diana","dorothy","eduarda","eleanor","elena","elisa","eliza",
    "elisabeth","elizabeth","ella","elsie","emily","emma","erica","estelle","eva","faith",
    "fatima","felicia","fernanda","fiona","florence","freya","gabriella","genevieve","georgia",
    "giovanna","giselle","gloria","grace","hailey","hannah","harper","heather","helena","holly",
    "imogen","ines","ingrid","irene","isabel","isabella","isadora","isidora","isla","ivy",
    "jasmine","jemima","jennifer","jessica","jill","joanna","jocelyn","josephine","julia",
    "julie","kaitlyn","karina","kate","katherine","katrina","kayla","kaylee","kendall",
    "kendra","kristen","larissa","laura","lauren","leah","leticia","liliana","lillian","linda",
    "lisa","lola","lorena","lorelei","lucia","luciana","lucy","luana","luisa","lydia",
    "madeline","magdalena","madison","magnolia","maisie","maria","marcela","mariana","marie",
    "marissa","margaret","martina","mary","matilda","megan","melanie","melissa","michelle",
    "millie","miranda","monica","monserrat","nadia","naomi","natalia","natalie","nicole","nina",
    "nora","olivia","paige","paloma","paola","patricia","penelope","pilar","priscilla",
    "rachel","rafaela","rebecca","renata","rocio","rosa","rosalie","rosanna","roxanne",
    "sabrina","samantha","sarah","savannah","scarlett","selena","serena","sharon","silvia",
    "sofia","soledad","sophia","stella","stephanie","susan","tamara","tania","taylor","teresa",
    "thais","tiffany","theodora","theresa","valentina","valeria","valerie","vanessa",
    "veronica","victoria","violet","vitoria","wendy","ximena","yasmin","yasmine","yesenia",
    "zoey",

    # Unisex / modern
    "alex","ari","ash","ashton","bailey","billy","blake","bluey","casey","charlie","chris",
    "cris","dakota","dani","devon","drew","eden","eli","ellis","finley","frances","harley",
    "hayden","jamie","jay","jordan","justice","kai","kit","lalo","lennon","logan","marley",
    "micah","morgan","nico","parker","peyton","phoenix","quinn","reese","remington","robin",
    "ross","rory","rowan","riley","rubin","sam","sasha","sawyer","skyler","sterling","sydney",
    "toby","tyler","whitney",
}

# ----------------- LOGGING -----------------

LOG_TYPES = {
    "method": True,
    "filter": True,
    "ratelimit": True,
    "worker": True,
    "lookup": True,
}

def format_log_line(text: str, log_type: str = "worker") -> str:
    return f"[{log_type}] {text}"

# ----------------- UTILS -----------------

def format_number(n: int) -> str:
    return f"{n:,}"

def parse_int_or_none(s: str | None):
    if s is None:
        return None
    s = s.replace(",", "").strip()
    if not s:
        return None
    try:
        return int(s)
    except ValueError:
        return None

def generate_random_id_for_years(years: list[str]) -> int:
    if not years:
        start_id, end_id = YEAR_ID_RANGES["Any year"]
        return random.randint(start_id, end_id)
    year = random.choice(years)
    start_id, end_id = YEAR_ID_RANGES[year]
    return random.randint(start_id, end_id)

def count_trailing_digits(s: str) -> int:
    c = 0
    for ch in reversed(s):
        if ch.isdigit():
            c += 1
        else:
            break
    return c

def username_matches_method(username: str, method: str) -> tuple[bool, str]:
    uname = username
    lower = uname.lower()

    if method == "random":
        return True, "method=random (no filtering)"

    if method == "numberless":
        if not any(ch.isdigit() for ch in uname):
            return True, "no digits in username"
        return False, "contains digits while method=numberless"

    if method == "numbers":
        if any(ch.isdigit() for ch in uname):
            return True, "contains at least one digit"
        return False, "has no digits while method=numbers"

    if method == "ends_in_123":
        if uname.endswith("123"):
            return True, "username ends with '123'"
        return False, "does not end with '123'"

    def ends_in_exact_n_digits(n: int) -> bool:
        if len(uname) < n:
            return False
        tail = uname[-n:]
        if not all(ch.isdigit() for ch in tail):
            return False
        if len(uname) > n and uname[-n - 1].isdigit():
            return False
        return True

    if method == "ends_in_1_digit":
        if ends_in_exact_n_digits(1):
            return True, "ends in exactly 1 digit"
        return False, "does not end in exactly 1 digit"

    if method == "ends_in_2_digits":
        if ends_in_exact_n_digits(2):
            return True, "ends in exactly 2 digits"
        return False, "does not end in exactly 2 digits"

    if method == "ends_in_4_digits":
        if ends_in_exact_n_digits(4):
            return True, "ends in exactly 4 digits"
        return False, "does not end in exactly 4 digits"

    if method == "4digits_real_name":
        # must end with exactly 4 digits
        trailing_digits = count_trailing_digits(lower)
        if trailing_digits != 4:
            return False, (
                f"has {trailing_digits} trailing digits "
                f"(need exactly 4) for 4digits_real_name"
            )

        # split name and digits
        name_part = lower[:-4]

        # name must be letters only
        if not name_part.isalpha():
            return False, "name part contains non-letter characters"

        # name must match a real name exactly
        if name_part not in FIRST_NAME_TOKENS:
            return False, f"'{name_part}' is not a real name token"

        return True, f"real name '{name_part}' + 4 digits"


    if method == "year":
        if len(uname) < 4 or not uname[-4:].isdigit():
            return False, "does not end with 4 digits"

        if len(uname) > 4 and uname[-5].isdigit():
            return False, "ends with more than 4 digits"

        year = int(uname[-4:])
        if 1970 <= year <= 2017:
            return True, f"ends with valid year {year}"
        return False, f"ends with year {year} outside 1980–2025"


    if method == "double":
        if not uname or not uname[-1].isdigit():
            return False, "username must end with digits"

        digits_len = count_trailing_digits(uname)
        if digits_len < 1:
            return False, "username must end with digits"

        core = uname[:-digits_len]  

        letter_repeat = re.search(r'([A-Za-z]{3,})\1', core)
        if letter_repeat:
            chunk = letter_repeat.group(1)
            return True, f"contains repeated word '{chunk}' and ends with digits"

        digit_repeat = re.search(r'(\d{2})\1', core)
        if digit_repeat:
            chunk = digit_repeat.group(1)
            return True, f"contains repeated 2-digit number '{chunk}' and ends with digits"

        return False, "no repeated 2-digit or 3+ letter chunk found before ending digits"

    if method == "double_real_name":
        # allow optional trailing digits (e.g. bennybenny55)
        i = len(lower)
        while i > 0 and lower[i - 1].isdigit():
            i -= 1
        base = lower[:i]

        letters_only = "".join(ch for ch in base if ch.isalpha())
        if not letters_only:
            return False, "no letters in username for double_real_name"

        for name in FIRST_NAME_TOKENS:
            if letters_only == name + name:
                return True, f"doubled real name '{name}'"

        return False, "not a doubled real name"


    if method == "real_name":
        if lower.endswith("123"):
            ending_type = "123"
        else:
            trailing_digits = count_trailing_digits(lower)
            if trailing_digits < 2 or trailing_digits > 4:
                return False, (
                    f"has {trailing_digits} trailing digits at end "
                    f"(need 2–4 digits or '123') for real_name"
                )
            ending_type = f"{trailing_digits}_digits"

        letters_only = "".join(ch for ch in lower if ch.isalpha())
        if not letters_only:
            return False, "no letters in username for real_name"

        all_hits: list[tuple[str, int, int]] = []
        for name in FIRST_NAME_TOKENS:
            start = 0
            while True:
                idx = letters_only.find(name, start)
                if idx == -1:
                    break
                end = idx + len(name)
                all_hits.append((name, idx, end))
                start = idx + 1

        if not all_hits:
            return False, "no real-name token found for real_name"

        all_hits.sort(key=lambda t: (t[2] - t[1]), reverse=True)
        n = len(letters_only)
        covered = [False] * n
        contributing_tokens: set[str] = set()

        for name, start, end in all_hits:
            new_cov = any(not covered[i] for i in range(start, end))
            if not new_cov:
                continue
            for i in range(start, min(end, n)):
                covered[i] = True
            contributing_tokens.add(name)

        if not contributing_tokens:
            return False, "no real-name token contributed coverage for real_name"

        extra_letters = sum(1 for i in range(n) if not covered[i])
        if extra_letters < 1:
            return False, (
                f"letters-only='{letters_only}', tokens={sorted(contributing_tokens)}, "
                f"extra_letters={extra_letters} (<1), ending={ending_type}"
            )

        return True, (
            f"letters-only='{letters_only}', tokens={sorted(contributing_tokens)}, "
            f"extra_letters={extra_letters} (>=1), ending={ending_type}"
        )


    if method == "nonstop":
        return True, "nonstop scanning (inactive only, output to files)"

    return True, "fallback: unknown method, treated as match"

def parse_created_date(created_iso: str | None) -> str:
    if not created_iso:
        return ""
    try:
        dt = datetime.fromisoformat(created_iso.replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d")
    except Exception:
        return created_iso

def _new_session(no_retries: bool = True) -> requests.Session:
    s = requests.Session()
    if no_retries:
        adapter = HTTPAdapter(
            max_retries=Retry(
                total=0,
                connect=0,
                read=0,
                redirect=0,
                status_forcelist=[],
                allowed_methods=False,
            )
        )
        s.mount("http://", adapter)
        s.mount("https://", adapter)
    return s

def get_roblox_user(user_id: int, session: requests.Session, timeout: float = 5.0):
    url = ROBLOX_USER_API.format(user_id=user_id)
    headers = {"User-Agent": DEFAULT_UA}
    try:
        r = session.get(url, timeout=timeout, headers=headers)
    except requests.RequestException:
        return None, None
    if r.status_code == 429:
        return None, 429
    if r.status_code != 200:
        return None, r.status_code
    data = r.json()
    return {
        "id": data.get("id"),
        "name": data.get("name"),
        "displayName": data.get("displayName"),
        "created": data.get("created"),
        "description": data.get("description"),
        "isBanned": data.get("isBanned"),
    }, 200

def get_user_id_by_username(username: str, session: requests.Session, timeout: float = 5.0):
    payload = {"usernames": [username], "excludeBannedUsers": False}
    headers = {"User-Agent": DEFAULT_UA}
    try:
        r = session.post(ROBLOX_USER_BY_NAME_API, json=payload, timeout=timeout, headers=headers)
    except requests.RequestException:
        return None
    if r.status_code != 200:
        return None
    data = r.json()
    if not data.get("data"):
        return None
    entry = data["data"][0]
    return entry.get("id")

def is_user_verified(user_id: int, session: requests.Session, timeout: float = 5.0) -> bool:
    url = ROBLOX_INVENTORY_API.format(user_id=user_id, asset_id=VERIFIED_BADGE_ASSET_ID)
    headers = {"User-Agent": DEFAULT_UA}
    try:
        r = session.get(url, timeout=timeout, headers=headers)
    except requests.RequestException:
        return False
    if r.status_code != 200:
        return False
    data = r.json()
    return len(data.get("data", [])) > 0

def get_avatar_is_r15(user_id: int, session: requests.Session, timeout: float = 5.0) -> bool | None:
    url = AVATAR_API.format(user_id=user_id)
    headers = {"User-Agent": DEFAULT_UA}
    try:
        r = session.get(url, timeout=timeout, headers=headers)
    except requests.RequestException:
        return None
    if r.status_code != 200:
        return None
    try:
        data = r.json()
    except Exception:
        return None
    rig_raw = data.get("playerAvatarType")
    if rig_raw is None:
        rig_raw = data.get("rigType")
    if not rig_raw:
        return None
    rig_type = str(rig_raw).strip().upper()
    if rig_type == "R15":
        return True
    if rig_type == "R6":
        return False
    return None

def get_user_has_plaid_hat(user_id: int, session: requests.Session, timeout: float = 5.0) -> bool | None:
    url = ROBLOX_INVENTORY_API.format(user_id=user_id, asset_id=VERIFIED_BADGE_ASSET_ID)
    headers = {"User-Agent": DEFAULT_UA}
    try:
        r = session.get(url, timeout=timeout, headers=headers)
    except requests.RequestException:
        return None
    if r.status_code != 200:
        return None
    try:
        data = r.json()
    except Exception:
        return None
    return len(data.get("data", [])) > 0

def get_avatar_image(user_id: int, session: requests.Session, timeout: float = 5.0):
    url = ROBLOX_AVATAR_THUMB_API.format(user_id=user_id)
    headers = {"User-Agent": DEFAULT_UA}
    try:
        r = session.get(url, timeout=timeout, headers=headers)
    except requests.RequestException:
        return None
    if r.status_code != 200:
        return None
    data = r.json()
    if not data.get("data"):
        return None
    img_url = data["data"][0].get("imageUrl")
    if not img_url:
        return None
    try:
        img_resp = session.get(img_url, timeout=timeout, headers=headers)
        if img_resp.status_code != 200:
            return None
        img = Image.open(BytesIO(img_resp.content))
        return img
    except Exception:
        return None

def get_user_rap_and_items(
    user_id: int, session: requests.Session, timeout: float = 5.0
) -> tuple[str, list]:
    total_value = 0
    cursor = ""
    headers = {"User-Agent": DEFAULT_UA}
    all_items: list[dict] = []

    while True:
        try:
            url = ROBLOX_COLLECTIBLES_API.format(user_id=user_id, cursor=cursor or "")
            r = session.get(url, timeout=timeout, headers=headers)
        except requests.RequestException:
            return "Unknown", []

        if r.status_code in (401, 403):
            return "Unknown", []

        if r.status_code != 200:
            return "Unknown", []

        data = r.json()
        for item in data.get("data", []):
            rap_raw = item.get("recentAveragePrice")
            rap_val = None
            try:
                rap_val = int(rap_raw) if rap_raw is not None else None
            except Exception:
                rap_val = None

            if rap_val is not None:
                total_value += rap_val

            all_items.append(
                {
                    "name": item.get("name") or "",
                    "assetId": item.get("assetId"),
                    "rap": rap_val,
                }
            )

        next_cursor = data.get("nextPageCursor")
        if not next_cursor or next_cursor == "null":
            break
        cursor = next_cursor

    return format_number(total_value), all_items

def get_user_rap(user_id: int, session: requests.Session, timeout: float = 5.0) -> str:
    total, _ = get_user_rap_and_items(user_id, session, timeout)
    return total

def get_roblox_badges(session: requests.Session, user_id: int) -> list[dict]:
    try:
        headers = {"User-Agent": DEFAULT_UA}
        resp = session.get(
            ROBLOX_BADGES_API.format(user_id=user_id),
            headers=headers,
            timeout=5,
        )
        if resp.status_code == 401:
            return []
        if resp.status_code != 200:
            return []
        data = resp.json()
        badges = []
        for item in data:
            name = item.get("name")
            if not name or name not in BADGE_ICON_URLS:
                continue
            badges.append({"name": name})
        return badges
    except Exception as e:
        print(f"Error retrieving badges for {user_id}: {e}")
        return []

def get_user_hat_count(user_id: int, session: requests.Session, timeout: float = 5.0) -> int | None:
    url = ROBLOX_HATS_INVENTORY_API.format(user_id=user_id)
    headers = {"User-Agent": DEFAULT_UA}
    cursor = ""
    total = 0

    while True:
        params: dict[str, str | int] = {
            "limit": 100,
            "sortOrder": "Desc",
        }
        if cursor:
            params["cursor"] = cursor

        try:
            r = session.get(url, params=params, headers=headers, timeout=timeout)
        except requests.RequestException:
            return None

        if r.status_code == 429:
            return None
        if r.status_code != 200:
            return None

        try:
            data = r.json()
        except Exception:
            return None

        items = data.get("data", [])
        total += len(items)

        cursor = data.get("nextPageCursor")
        if not cursor:
            break

    return total

# ----------------- NONSTOP OUTPUT CLASSIFICATION -----------------

def _ends_in_exact_n_digits(uname: str, n: int) -> bool:
    if len(uname) < n:
        return False
    tail = uname[-n:]
    if not all(ch.isdigit() for ch in tail):
        return False
    if len(uname) > n and uname[-n - 1].isdigit():
        return False
    return True

def classify_nonstop_output(username: str) -> str | None:
    uname = username

    # Real-name only
    if username_matches_method(uname, "real_name")[0]:
        return "real_name.txt"

    # Double usernames
    if username_matches_method(uname, "double")[0]:
        return "double.txt"

    # Ends-in-digits (1–4)
    for n in (4, 3, 2, 1):
        if _ends_in_exact_n_digits(uname, n):
            return f"ends_in_{n}_digit.txt"

    # Numberless
    if not any(ch.isdigit() for ch in uname):
        return "numberless.txt"

    # EVERYTHING ELSE → ignored
    return None


# ----------------- BADGE LOADER -----------------

class BadgeLoader(QtCore.QThread):
    badge_pixmap_ready = QtCore.pyqtSignal(str, int, QtGui.QPixmap)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._queue = deque()
        self._lock = QtCore.QMutex()
        self._stop = False

    def request_badge(self, name: str, size: int):
        key = (name, size)
        if key in BADGE_PIXMAP_CACHE:
            self.badge_pixmap_ready.emit(name, size, BADGE_PIXMAP_CACHE[key])
            return
        with QtCore.QMutexLocker(self._lock):
            self._queue.append((name, size))

    def stop(self):
        self._stop = True

    def run(self):
        while not self._stop:
            with QtCore.QMutexLocker(self._lock):
                job = self._queue.popleft() if self._queue else None
            if not job:
                self.msleep(25)
                continue

            name, size = job
            key = (name, size)
            if key in BADGE_PIXMAP_CACHE:
                self.badge_pixmap_ready.emit(name, size, BADGE_PIXMAP_CACHE[key])
                continue

            url = BADGE_ICON_URLS.get(name)
            if not url:
                continue

            try:
                resp = requests.get(url, timeout=5, headers={"User-Agent": DEFAULT_UA})
                if resp.status_code != 200:
                    continue
                img = QtGui.QImage.fromData(resp.content)
                pix = QtGui.QPixmap.fromImage(img).scaled(
                    size,
                    size,
                    QtCore.Qt.AspectRatioMode.KeepAspectRatio,
                    QtCore.Qt.TransformationMode.SmoothTransformation,
                )
                BADGE_PIXMAP_CACHE[key] = pix
                self.badge_pixmap_ready.emit(name, size, pix)
            except Exception:
                continue

# ----------------- WORKERS -----------------

class GenerateWorker(QtCore.QThread):
    row_found = QtCore.pyqtSignal(dict)
    progress = QtCore.pyqtSignal(int, int)
    log_msg = QtCore.pyqtSignal(str)
    finished_gen = QtCore.pyqtSignal(int)

    def __init__(
        self,
        years: list[str],
        method: str,
        amount: int,
        *,
        rap_min_preset: int | None = None,
        include_unknown_rap: bool = True,
        ban_filter: str = "All",
        verified_filter: str = "All",
        active_filter: str = "All",
        hat_min_preset: int | None = None,
        username_min_len: int | None = None,
        username_max_len: int | None = None,
        use_id_range: bool = False,
        id_min: int | None = None,
        id_max: int | None = None,
        required_badges: list[str] | None = None,
        skip_ids: set[int] | None = None,
        parent=None,
        max_workers: int = 4,
        max_total_attempts: int = 500000,
    ):
        super().__init__(parent)
        self.years = years[:] or ["Any year"]
        self.method = method
        self.amount = amount
        self.max_workers = max_workers
        # For nonstop: effectively unlimited attempts
        self.max_total_attempts = max_total_attempts if method != "nonstop" else 10_000_000_000
        self._stop = False
        self.session = _new_session()

        self.rap_min_preset = rap_min_preset
        self.include_unknown_rap = include_unknown_rap
        self.ban_filter = ban_filter
        self.verified_filter = verified_filter
        self.active_filter = active_filter
        self.hat_min_preset = hat_min_preset
        self.username_min_len = username_min_len
        self.username_max_len = username_max_len

        self.use_id_range = use_id_range
        self.id_min = id_min
        self.id_max = id_max

        self.required_badges = set(required_badges or [])
        self.skip_ids = set(skip_ids or [])

        self._rate_limit_lock = QtCore.QMutex()
        self._next_allowed_time = time.time() + 0.5


        # Nonstop output state
        self.nonstop_unique_written: dict[str, set[str]] = {}
        if self.method == "nonstop":
            self._init_output_directory()

    def _init_output_directory(self):
        base = os.path.dirname(os.path.abspath(__file__))
        out_path = os.path.join(base, OUTPUT_DIR)
        try:
            os.makedirs(out_path, exist_ok=True)
        except Exception as e:
            self.log_msg.emit(format_log_line(f"Failed to create output dir: {e}", "worker"))
        # we lazily create files upon first write; track seen names per file
        self.log_msg.emit(format_log_line(f"Nonstop output directory ready: {out_path}", "worker"))

    def _append_output_username(self, filename: str, username: str):
        base = os.path.dirname(os.path.abspath(__file__))
        path = os.path.join(base, OUTPUT_DIR, filename)
        # Deduplicate per file
        if filename not in self.nonstop_unique_written:
            self.nonstop_unique_written[filename] = set()
        if username in self.nonstop_unique_written[filename]:
            return
        self.nonstop_unique_written[filename].add(username)
        try:
            with open(path, "a", encoding="utf-8") as f:
                f.write(username + "\n")
        except Exception as e:
            self.log_msg.emit(format_log_line(f"Failed writing to {filename}: {e}", "worker"))

    def stop(self):
        self._stop = True

    def _wait_if_rate_limited(self):
        with QtCore.QMutexLocker(self._rate_limit_lock):
            now = time.time()
            if now < self._next_allowed_time:
                delay = self._next_allowed_time - now
            else:
                delay = 0.0
        if delay > 0:
            end = time.time() + delay
            while time.time() < end:
                if self._stop:
                    return
                time.sleep(0.05)

    def _trigger_backoff(self, seconds: float = 30.0):
        with QtCore.QMutexLocker(self._rate_limit_lock):
            new_until = time.time() + seconds
            if new_until > self._next_allowed_time:
                self._next_allowed_time = new_until
        self.log_msg.emit(format_log_line(
            f"Rate-limit suspected, backing off for {seconds:.1f}s",
            "ratelimit",
        ))

    def _passes_advanced_filters(
        self,
        username: str,
        rap_str: str,
        banned_flag: str,
        verified_flag: str,
        active_flag: str,
        hat_count: int | None,
        roblox_badges: list[dict],
        uid: int,
    ) -> bool:
        u = username or ""

        if uid in self.skip_ids:
            return False

        if self.username_min_len is not None and len(u) < self.username_min_len:
            return False
        if self.username_max_len is not None and len(u) > self.username_max_len:
            return False

        if rap_str == "Unknown":
            if not self.include_unknown_rap:
                return False
        else:
            rap_value = parse_int_or_none(rap_str)
            if rap_value is not None and self.rap_min_preset is not None:
                if rap_value < self.rap_min_preset:
                    return False

        if self.hat_min_preset is not None:
            if hat_count is None:
                return False
            if hat_count < self.hat_min_preset:
                return False

        if self.ban_filter == "Only not banned" and banned_flag == "Yes":
            return False
        if self.ban_filter == "Only banned" and banned_flag != "Yes":
            return False

        if self.verified_filter == "Only verified" and verified_flag != "Yes":
            return False
        if self.verified_filter == "Only unverified" and verified_flag == "Yes":
            return False

        if self.active_filter == "Only active" and active_flag != "Yes":
            return False
        if self.active_filter == "Only inactive" and active_flag != "No":
            return False

        if self.required_badges:
            user_badge_names = {b.get("name") for b in roblox_badges if b.get("name")}
            if not self.required_badges.issubset(user_badge_names):
                return False

        return True

    def _try_get_user(self, uid: int):
        if self._stop:
            return None
        self._wait_if_rate_limited()
        if self._stop:
            return None
        user, status = get_roblox_user(uid, self.session)
        if status == 429:
            self._trigger_backoff(30.0)
            return None
        if status and status >= 500:
            self._trigger_backoff(30.0)
            return None
        return user

    def _generate_random_id(self) -> int:
        if self.use_id_range and self.id_min is not None and self.id_max is not None:
            return random.randint(self.id_min, self.id_max)
        return generate_random_id_for_years(self.years)

    def _single_attempt(self, attempt_idx: int, seen_ids: set[int]) -> dict | None:
        if self._stop:
            return None

        uid = self._generate_random_id()
        if self._stop:
            return None

        if uid in seen_ids:
            return None
        seen_ids.add(uid)

        if uid in self.skip_ids:
            self.log_msg.emit(format_log_line(
                f"[{attempt_idx}] {uid} skipped (in saved IDs skip set)",
                "filter",
            ))
            return None

        user = self._try_get_user(uid)
        if self._stop or not user:
            return None

        username = user.get("name") or ""
        matches, reason = username_matches_method(username, self.method)
        if not matches:
            self.log_msg.emit(format_log_line(
                f"[{attempt_idx}] {uid}: '{username}' filtered by method "
                f"({self.method}) – reason: {reason}",
                "method",
            ))
            return None

        banned_flag = "Yes" if user.get("isBanned", False) else "No"
        verified_flag = "Yes" if is_user_verified(uid, self.session) else "No"

        created_raw = user.get("created")
        created_str = parse_created_date(created_raw)
        year_int = None
        try:
            if created_raw:
                dt = datetime.fromisoformat(created_raw.replace("Z", "+00:00"))
                year_int = dt.year
        except Exception:
            year_int = None

        display_name = user.get("displayName") or ""
        has_distinct_display_name = (
            bool(display_name.strip())
            and display_name != username
        )

        is_r15 = get_avatar_is_r15(uid, self.session)
        has_plaid_hat = get_user_has_plaid_hat(uid, self.session)

        rap_str, rap_items = get_user_rap_and_items(uid, self.session)
        if rap_str is None:
            rap_str = "Unknown"

        if year_int is not None and year_int <= 2014:
            inv_private = (rap_str == "Unknown") and (not rap_items or len(rap_items) == 0)
            old_public_inventory_signal = inv_private
        else:
            old_public_inventory_signal = False

        reasons: list[str] = []
        active_flag: str | None = None

        if has_plaid_hat is True:
            active_flag = "Yes"
            reasons.append("has_plaid_hat=True")

        if has_distinct_display_name:
            active_flag = "Yes"
            reasons.append("has_distinct_display_name=True")

        if old_public_inventory_signal:
            active_flag = "Yes"
            reasons.append("old_public_inventory_signal=True (<=2014, inventory private now)")

        if is_r15 is False:
            active_flag = "Yes"
            reasons.append("is_r15=False (R6)")

        if active_flag is None:
            if has_plaid_hat is False:
                reasons.append("has_plaid_hat=False (no plaid-hat signal)")
            if is_r15 is True:
                active_flag = "No"
                reasons.append("is_r15=True (R15) and no positive signals")

        if active_flag is None:
            active_flag = "No"
            reasons.append("no decisive signals -> default unactive")

        active_reason = ", ".join(reasons) if reasons else "no signals"

        self.log_msg.emit(format_log_line(
            f"[{attempt_idx}] active-eval uid={uid} "
            f"is_r15={is_r15}, has_plaid_hat={has_plaid_hat}, "
            f"username='{username}', display_name='{display_name}', "
            f"has_distinct_display_name={has_distinct_display_name}, "
            f"year={year_int}, old_public_inventory_signal={old_public_inventory_signal} "
            f"-> active={active_flag} ({active_reason})",
            "worker",
        ))

        # Nonstop requires inactive accounts only
        if self.method == "nonstop" and active_flag != "No":
            return None

        hat_count = get_user_hat_count(uid, self.session)
        self.log_msg.emit(format_log_line(
            f"[{attempt_idx}] hat-eval uid={uid} hat_count={hat_count}",
            "worker",
        ))

        roblox_badges = get_roblox_badges(self.session, uid)

        if not self._passes_advanced_filters(
            username, rap_str, banned_flag, verified_flag, active_flag, hat_count, roblox_badges, uid
        ):
            self.log_msg.emit(format_log_line(
                f"[{attempt_idx}] {uid}: '{username}' filtered by advanced "
                f"(rap={rap_str}, verified={verified_flag}, "
                f"banned={banned_flag}, active={active_flag}, "
                f"hat_count={hat_count}, "
                f"badges={[b.get('name') for b in roblox_badges]})",
                "filter",
            ))
            return None

        reason_suffix = ""
        if self.method not in ("random", "nonstop"):
            reason_suffix = f" method_reason={reason}"

        self.log_msg.emit(format_log_line(
            f"[{attempt_idx}] FOUND {uid} {username} created={created_str} "
            f"RAP={rap_str} badges={len(roblox_badges)} "
            f"verified={verified_flag} banned={banned_flag} active={active_flag} "
            f"hats={hat_count}{reason_suffix}",
            "worker",
        ))

        # Nonstop output append
        if self.method == "nonstop":
            outfile = classify_nonstop_output(username)
            if outfile is not None:
                self._append_output_username(outfile, username)
    


        return {
            "username": username,
            "id": str(uid),
            "created": created_str,
            "rap": rap_str,
            "roblox_badges": roblox_badges,
            "verified": verified_flag,
            "banned": banned_flag,
            "active": active_flag,
            "hats": str(hat_count) if hat_count is not None else "Unknown",
        }

    def run(self):
        seen_ids: set[int] = set()
        found_count = 0
        attempt_counter = 0

        self.log_msg.emit(format_log_line(
            f"Start: years={self.years}, method={self.method}, target={self.amount}, "
            f"rap_min_preset={self.rap_min_preset}, use_id_range={self.use_id_range}, "
            f"id_min={self.id_min}, id_max={self.id_max}, active_filter={self.active_filter}, "
            f"required_badges={list(self.required_badges)}, "
            f"skip_ids_count={len(self.skip_ids)}, "
            f"hat_min_preset={self.hat_min_preset}",
            "worker",
        ))

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures: dict = {}

            while (not self._stop) and len(futures) < self.max_workers and attempt_counter < self.max_total_attempts:
                attempt_counter += 1
                fut = executor.submit(self._single_attempt, attempt_counter, seen_ids)
                futures[fut] = attempt_counter

            while not self._stop and (self.method == "nonstop" or found_count < self.amount) and futures:
                for fut in as_completed(list(futures.keys())):
                    if self._stop:
                        break
                    attempt_idx = futures.pop(fut)
                    try:
                        result = fut.result()
                    except Exception as e:
                        self.log_msg.emit(format_log_line(
                            f"[{attempt_idx}] error: {e}",
                            "worker",
                        ))
                        result = None

                    if self._stop:
                        break

                    if result:
                        found_count += 1
                        self.row_found.emit(result)
                        if self.method != "nonstop":
                            self.progress.emit(found_count, self.amount)
                        # For non-nonstop: stop after reaching amount
                        if self.method != "nonstop" and found_count >= self.amount:
                            break

                    if (
                        not self._stop
                        and (self.method == "nonstop" or found_count < self.amount)
                        and attempt_counter < self.max_total_attempts
                    ):
                        attempt_counter += 1
                        fut2 = executor.submit(self._single_attempt, attempt_counter, seen_ids)
                        futures[fut2] = attempt_counter

                if self._stop:
                    break

                if attempt_counter >= self.max_total_attempts and not futures:
                    self.log_msg.emit(format_log_line("Reached max attempts.", "worker"))
                    break

        self.finished_gen.emit(found_count)

class LookupWorker(QtCore.QThread):
    lookup_done = QtCore.pyqtSignal(dict)
    log_msg = QtCore.pyqtSignal(str)

    def __init__(self, username: str, parent=None):
        super().__init__(parent)
        self.username = username
        self.session = _new_session()

    def run(self):
        self.log_msg.emit(format_log_line(f"Lookup for '{self.username}'", "lookup"))
        user_id = get_user_id_by_username(self.username, self.session)
        if not user_id:
            self.lookup_done.emit(
                {"ok": False, "error": f"No user found with name '{self.username}'"}
            )
            return

        user, status = get_roblox_user(user_id, self.session)
        if not user:
            self.lookup_done.emit({"ok": False, "error": "Failed to fetch user details."})
            return

        username = user.get("name") or ""
        banned_flag = "Yes" if user.get("isBanned", False) else "No"
        verified_flag = "Yes" if is_user_verified(user_id, self.session) else "No"
        created_raw = user.get("created")
        created_str = parse_created_date(created_raw)

        year_int = None
        try:
            if created_raw:
                dt = datetime.fromisoformat(created_raw.replace("Z", "+00:00"))
                year_int = dt.year
        except Exception:
            year_int = None

        avatar_img = get_avatar_image(user_id, self.session)

        rap_str, items = get_user_rap_and_items(user_id, self.session)
        if rap_str is None:
            rap_str = "Unknown"

        if year_int is not None and year_int <= 2014:
            inv_private = (rap_str == "Unknown") and (not items or len(items) == 0)
            old_public_inventory_signal = inv_private
        else:
            old_public_inventory_signal = False

        display_name = user.get("displayName") or ""
        has_distinct_display_name = (
            bool(display_name.strip())
            and display_name != username
        )
        is_r15 = get_avatar_is_r15(user_id, self.session)
        has_plaid_hat = get_user_has_plaid_hat(user_id, self.session)

        reasons: list[str] = []
        active_flag: str | None = None

        if has_plaid_hat is True:
            active_flag = "Yes"
            reasons.append("has_plaid_hat=True")

        if has_distinct_display_name:
            active_flag = "Yes"
            reasons.append("has_distinct_display_name=True")

        if old_public_inventory_signal:
            active_flag = "Yes"
            reasons.append("old_public_inventory_signal=True (<=2014, inventory private now)")

        if is_r15 is False:
            active_flag = "Yes"
            reasons.append("is_r15=False (R6)")

        if active_flag is None:
            if has_plaid_hat is False:
                reasons.append("has_plaid_hat=False (no plaid-hat signal)")
            if is_r15 is True:
                active_flag = "No"
                reasons.append("is_r15=True (R15) and no positive signals")

        if active_flag is None:
            active_flag = "Yes"
            reasons.append("no decisive signals -> default active")

        active_reason = ", ".join(reasons) if reasons else "no signals"

        self.log_msg.emit(format_log_line(
            f"Lookup active-eval user_id={user_id} "
            f"is_r15={is_r15}, has_plaid_hat={has_plaid_hat}, "
            f"username='{username}', display_name='{display_name}', "
            f"has_distinct_display_name={has_distinct_display_name}, "
            f"year={year_int}, old_public_inventory_signal={old_public_inventory_signal} "
            f"-> active={active_flag} ({active_reason})",
            "lookup",
        ))

        hat_count = get_user_hat_count(user_id, self.session)
        self.log_msg.emit(format_log_line(
            f"Lookup hat-eval user_id={user_id} hat_count={hat_count}",
            "lookup",
        ))

        roblox_badges = get_roblox_badges(self.session, user_id)

        self.log_msg.emit(format_log_line(
            f"Lookup OK {user_id} {username} created={created_str} RAP={rap_str} "
            f"badges={len(roblox_badges)} verified={verified_flag} "
            f"banned={banned_flag} active={active_flag} hats={hat_count}",
            "lookup",
        ))

        self.lookup_done.emit(
            {
                "ok": True,
                "error": "",
                "user_id": user_id,
                "username": username or "-",
                "displayName": display_name or "-",
                "created": created_str or "-",
                "banned": banned_flag,
                "verified": verified_flag,
                "active": active_flag,
                "rap": rap_str,
                "rap_items": items,
                "roblox_badges": roblox_badges,
                "avatar": avatar_img,
                "hat_count": hat_count,
            }
        )

# ----------------- FRAMELESS WINDOW -----------------

class FramelessWindow(QtWidgets.QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowFlags(
            QtCore.Qt.WindowType.FramelessWindowHint
            | QtCore.Qt.WindowType.Window
            | QtCore.Qt.WindowType.WindowSystemMenuHint
        )
        self.setAttribute(QtCore.Qt.WidgetAttribute.WA_TranslucentBackground, False)

        self.title_bar_height = 32
        self._dragging = False
        self._drag_pos = QtCore.QPoint()

    def mousePressEvent(self, event: QtGui.QMouseEvent):
        if event.button() == QtCore.Qt.MouseButton.LeftButton:
            if event.position().y() <= self.title_bar_height:
                self._dragging = True
                self._drag_pos = (
                    event.globalPosition().toPoint() - self.frameGeometry().topLeft()
                )
                event.accept()
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event: QtGui.QMouseEvent):
        if self._dragging and event.buttons() & QtCore.Qt.MouseButton.LeftButton:
            self.move(event.globalPosition().toPoint() - self._drag_pos)
            event.accept()
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event: QtGui.QMouseEvent):
        self._dragging = False
        super().mouseReleaseEvent(event)

# ----------------- MAIN WINDOW (UI) -----------------

class MainWindow(FramelessWindow):
    def __init__(self):
        super().__init__()

        self.resize(1300, 720)
        self.setWindowTitle("rFinder")

        self.setStyleSheet(self._qss())

        self.saved_data: dict = {"categories": {}}
        self.current_category: str | None = None
        self._load_saved_data()

        container = QtWidgets.QWidget()
        self.setCentralWidget(container)
        root = QtWidgets.QVBoxLayout(container)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        self.title_bar = QtWidgets.QFrame()
        self.title_bar.setObjectName("titleBar")
        self.title_bar.setFixedHeight(self.title_bar_height)
        tb_layout = QtWidgets.QHBoxLayout(self.title_bar)
        tb_layout.setContentsMargins(10, 4, 10, 4)
        tb_layout.setSpacing(8)

        self.title_icon = QtWidgets.QLabel("rFinder")
        self.title_icon.setObjectName("titleText")
        tb_layout.addWidget(self.title_icon)
        tb_layout.addStretch(1)

        self.min_btn = QtWidgets.QPushButton("—")
        self.min_btn.setObjectName("titleButton")
        self.min_btn.setFixedWidth(30)
        self.close_btn = QtWidgets.QPushButton("✕")
        self.close_btn.setObjectName("closeButton")
        self.close_btn.setFixedWidth(30)

        tb_layout.addWidget(self.min_btn)
        tb_layout.addWidget(self.close_btn)

        self.min_btn.clicked.connect(self.showMinimized)
        self.close_btn.clicked.connect(self.close)

        root.addWidget(self.title_bar)

        content = QtWidgets.QWidget()
        root.addWidget(content, 1)

        content_layout = QtWidgets.QHBoxLayout(content)
        content_layout.setContentsMargins(0, 0, 0, 0)
        content_layout.setSpacing(0)

        self.sidebar = QtWidgets.QFrame()
        self.sidebar.setObjectName("sidebar")
        self.sidebar.setFixedWidth(190)
        side_layout = QtWidgets.QVBoxLayout(self.sidebar)
        side_layout.setContentsMargins(18, 10, 12, 10)
        side_layout.setSpacing(6)

        logo = QtWidgets.QLabel("rFinder")
        logo.setObjectName("logoLabel")
        side_layout.addWidget(logo)
        side_layout.addSpacing(10)

        accounts_label = QtWidgets.QLabel("Accounts")
        accounts_label.setObjectName("navSectionLabel")
        side_layout.addWidget(accounts_label)

        lookup_label = QtWidgets.QLabel("Lookup")
        lookup_label.setObjectName("navSectionLabel")
        side_layout.addWidget(lookup_label)

        saved_label = QtWidgets.QLabel("Saved")
        saved_label.setObjectName("navSectionLabel")
        side_layout.addWidget(saved_label)

        side_layout.addStretch(1)

        version_label = QtWidgets.QLabel(TOOL_VERSION)
        version_label.setObjectName("versionLabel")
        side_layout.addWidget(version_label)

        self.discord_label = QtWidgets.QLabel("Discord: .gg/yRtzFENhbt")
        self.discord_label.setObjectName("discordLabel")
        self.discord_label.setCursor(
            QtGui.QCursor(QtCore.Qt.CursorShape.PointingHandCursor)
        )
        self.discord_label.mousePressEvent = self._open_discord
        side_layout.addWidget(self.discord_label)

        self.main_frame = QtWidgets.QFrame()
        self.main_frame.setObjectName("mainFrame")
        main_layout = QtWidgets.QVBoxLayout(self.main_frame)
        main_layout.setContentsMargins(16, 12, 16, 12)
        main_layout.setSpacing(8)

        header_title = QtWidgets.QLabel("Account Finder")
        header_title.setObjectName("headerTitle")
        header_sub = QtWidgets.QLabel(
            "Find Roblox accounts by ID range & username pattern, with advanced filters."
        )
        header_sub.setObjectName("headerSub")

        main_layout.addWidget(header_title)
        main_layout.addWidget(header_sub)

        self.tabs = QtWidgets.QTabWidget()
        self.tabs.setObjectName("tabs")
        main_layout.addWidget(self.tabs, 1)

        self.tab_generate = QtWidgets.QWidget()
        self.tabs.addTab(self.tab_generate, "Account Finder")

        self.tab_lookup = QtWidgets.QWidget()
        self.tabs.addTab(self.tab_lookup, "User Lookup")

        self.tab_saved = QtWidgets.QWidget()
        self.tabs.addTab(self.tab_saved, "Saved")

        self.tab_log = QtWidgets.QWidget()
        self.tabs.addTab(self.tab_log, "Log")

        content_layout.addWidget(self.sidebar)
        content_layout.addWidget(self.main_frame, 1)

        self._build_generate_tab()
        self._build_lookup_tab()
        self._build_saved_tab()
        self._build_log_tab()

        self.gen_worker: GenerateWorker | None = None
        self.lookup_worker: LookupWorker | None = None
        self.current_lookup_rap_items: list[dict] = []
        self.current_lookup_badges: list[dict] = []

        self.badge_loader = BadgeLoader(self)
        self.badge_loader.badge_pixmap_ready.connect(self._badge_pixmap_ready)
        self.badge_loader.start()

        self._log_entries: list[tuple[str, str]] = []

    def _save_file_path(self) -> str:
        base = os.path.dirname(os.path.abspath(__file__))
        return os.path.join(base, SAVE_FILE_NAME)

    def _load_saved_data(self):
        path = self._save_file_path()
        if not os.path.exists(path):
            self.saved_data = {"categories": {}}
            self.current_category = None
            return
        try:
            with open(path, "r", encoding="utf-8") as f:
                self.saved_data = json.load(f)
        except Exception:
            self.saved_data = {"categories": {}}
        if "categories" not in self.saved_data:
            self.saved_data["categories"] = {}
        if not self.saved_data["categories"]:
            self.saved_data["categories"]["Default"] = {"accounts": {}}
        if self.current_category not in self.saved_data["categories"]:
            self.current_category = next(iter(self.saved_data["categories"].keys()))

    def _persist_saved_data(self):
        path = self._save_file_path()
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(self.saved_data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print("Failed to save data:", e)

    def _qss(self) -> str:
        return """
        QWidget {
            background-color: #0b0b0c;
            color: #f5f5f5;
            font-family: "Segoe UI", sans-serif;
            font-size: 10pt;
        }
        #titleBar {
            background-color: #050505;
        }
        #titleText {
            font-size: 11pt;
            font-weight: 600;
        }
        QPushButton#titleButton {
            background: transparent;
            border: 0;
            color: #f5f5f5;
        }
        QPushButton#titleButton:hover {
            background: #202024;
        }
        QPushButton#closeButton {
            background: transparent;
            border: 0;
            color: #f5f5f5;
        }
        QPushButton#closeButton:hover {
            background: #d32f2f;
        }
        #sidebar {
            background-color: #080808;
        }
        #mainFrame {
            background-color: #0b0b0c;
        }
        #logoLabel {
            font-size: 16pt;
            font-weight: 700;
        }
        #navSectionLabel {
            color: #9e9e9e;
            font-size: 9pt;
        }
        #versionLabel {
            color: #555555;
            font-size: 8pt;
        }
        #discordLabel {
            color: #6aa9ff;
            font-size: 8pt;
        }
        #discordLabel:hover {
            color: #90c5ff;
        }
        #headerTitle {
            font-size: 16pt;
            font-weight: 700;
        }
        #headerSub {
            color: #9e9e9e;
            font-size: 9pt;
        }
        QTabWidget::pane {
            border: 0px;
            background: #0b0b0c;
        }
        QTabBar::tab {
            background: #141417;
            color: #9e9e9e;
            padding: 6px 16px;
            border-top-left-radius: 4px;
            border-top-right-radius: 4px;
            margin-right: 2px;
        }
        QTabBar::tab:selected {
            background: #1b1b1f;
            color: #f5f5f5;
        }
        QLabel[role="muted"] {
            color: #9e9e9e;
            font-size: 9pt;
        }
        QComboBox, QLineEdit, QListWidget {
            background: #111113;
            border: 1px solid #202024;
            padding: 2px 6px;
            border-radius: 3px;
        }
        QPushButton {
            border-radius: 4px;
            padding: 6px 14px;
            border: 1px solid transparent;
            background: #141417;
        }
        QPushButton:hover {
            background: #202024;
        }
        QPushButton#startButton {
            background: #e53935;
            color: white;
        }
        QPushButton#startButton:hover {
            background: #ff5252;
        }
        QProgressBar {
            border: 0px;
            background: #141417;
            border-radius: 2px;
            height: 6px;
        }
        QProgressBar::chunk {
            background: #e53935;
            border-radius: 2px;
        }
        QTableView, QTableWidget {
            background: #121214;
            alternate-background-color: #101012;
            gridline-color: #202024;
            border: 1px solid #202024;
            selection-background-color: #263238;
            selection-color: #ffffff;
        }
        QHeaderView::section {
            background: #18181b;
            color: #d0d0d0;
            padding: 4px 6px;
            border: 0px;
            border-right: 1px solid #202024;
            font-size: 9pt;
        }
        QTextEdit {
            background: #101010;
            border: 1px solid #202024;
        }
        QScrollBar:vertical {
            width: 0px;
            background: transparent;
        }
        QScrollBar::handle:vertical,
        QScrollBar::add-line:vertical,
        QScrollBar::sub-line:vertical {
            height: 0px;
            border: 0px;
            background: transparent;
        }
        QScrollBar:horizontal {
            height: 0px;
            background: transparent;
        }
        QScrollBar::handle:horizontal,
        QScrollBar::add-line:horizontal,
        QScrollBar::sub-line:horizontal {
            width: 0px;
            border: 0px;
            background: transparent;
        }
        QTableWidget::indicator:unchecked,
        QCheckBox::indicator:unchecked {
            width: 14px;
            height: 14px;
            border: 1px solid #303030;
            background-color: #18181b;
        }
        QTableWidget::indicator:checked,
        QCheckBox::indicator:checked {
            width: 14px;
            height: 14px;
            border: 1px solid #f44336;
            background-color: #26262b;
        }
        QTableWidget::indicator:unchecked:hover,
        QCheckBox::indicator:unchecked:hover {
            border-color: #5a5a5a;
            background-color: #1f1f23;
        }
        QTableWidget::indicator:checked:hover,
        QCheckBox::indicator:checked:hover {
            border-color: #ff7961;
            background-color: #2e2e33;
        }
        """

    def _open_discord(self, event):
        webbrowser.open(DISCORD_URL)

    def _build_generate_tab(self):
        w = self.tab_generate
        layout = QtWidgets.QVBoxLayout(w)
        layout.setContentsMargins(0, 6, 0, 0)
        layout.setSpacing(6)

        row1 = QtWidgets.QHBoxLayout()
        row1.setSpacing(10)

        lbl_year = QtWidgets.QLabel("Year(s):")
        lbl_year.setProperty("role", "muted")

        self.btn_years = QtWidgets.QToolButton()
        self.btn_years.setText("Any year")
        self.btn_years.setPopupMode(QtWidgets.QToolButton.ToolButtonPopupMode.InstantPopup)

        self.menu_years = QtWidgets.QMenu(self.btn_years)
        self.year_actions: list[QtGui.QAction] = []
        for year_name in YEAR_ID_RANGES.keys():
            act = QtGui.QAction(year_name, self.menu_years)
            act.setCheckable(True)
            self.menu_years.addAction(act)
            self.year_actions.append(act)

        for a in self.year_actions:
            a.setChecked(a.text() == "Any year")

        self.btn_years.setMenu(self.menu_years)

        self.chk_year_multi = QtWidgets.QCheckBox("Multi")
        self.chk_year_multi.setChecked(False)

        self.menu_years.triggered.connect(self._on_year_triggered)
        self._update_year_button_text()

        lbl_method = QtWidgets.QLabel("Method:")
        lbl_method.setProperty("role", "muted")
        self.btn_method = QtWidgets.QToolButton()
        self.btn_method.setPopupMode(QtWidgets.QToolButton.ToolButtonPopupMode.InstantPopup)
        self.menu_method = QtWidgets.QMenu(self.btn_method)
        self.method_actions: list[QtGui.QAction] = []
        for name in METHODS:
            act = QtGui.QAction(name, self.menu_method)
            act.setCheckable(True)
            self.menu_method.addAction(act)
            self.method_actions.append(act)
        self.method_actions[0].setChecked(True)
        self.btn_method.setText("random")

        def on_method_triggered(act: QtGui.QAction):
            for a in self.method_actions:
                a.setChecked(a is act)
            self.btn_method.setText(act.text())
            # Nonstop UI behavior
            if act.text() == "nonstop":
                self.txt_amount.setEnabled(False)
                self.txt_amount.setText("∞")
                # Force inactive only (grayed)
                self.btn_active_filter.setText("Only inactive")
                for a in self.active_actions:
                    a.setChecked(a.text() == "Only inactive")
                self.btn_active_filter.setEnabled(False)
                self.progress.setValue(0)
            else:
                self.txt_amount.setEnabled(True)
                if self.txt_amount.text() == "∞":
                    self.txt_amount.setText("10")
                self.btn_active_filter.setEnabled(True)

        self.menu_method.triggered.connect(on_method_triggered)
        self.btn_method.setMenu(self.menu_method)

        lbl_amount = QtWidgets.QLabel("Amount:")
        lbl_amount.setProperty("role", "muted")
        self.txt_amount = QtWidgets.QLineEdit("10")
        self.txt_amount.setFixedWidth(70)

        lbl_sort = QtWidgets.QLabel("Sort:")
        lbl_sort.setProperty("role", "muted")
        self.btn_sort = QtWidgets.QToolButton()
        self.btn_sort.setPopupMode(QtWidgets.QToolButton.ToolButtonPopupMode.InstantPopup)
        self.menu_sort = QtWidgets.QMenu(self.btn_sort)
        self.sort_actions: list[QtGui.QAction] = []
        for name in SORT_OPTIONS:
            act = QtGui.QAction(name, self.menu_sort)
            act.setCheckable(True)
            self.menu_sort.addAction(act)
            self.sort_actions.append(act)
        self.sort_actions[0].setChecked(True)
        self.btn_sort.setText("None")

        def on_sort_triggered(act: QtGui.QAction):
            for a in self.sort_actions:
                a.setChecked(a is act)
            self.btn_sort.setText(act.text())

        self.menu_sort.triggered.connect(on_sort_triggered)
        self.btn_sort.setMenu(self.menu_sort)

        self.btn_apply_sort = QtWidgets.QPushButton("Apply")
        self.btn_apply_sort.setFixedWidth(70)

        self.btn_start = QtWidgets.QPushButton("Start")
        self.btn_start.setObjectName("startButton")
        self.btn_stop = QtWidgets.QPushButton("Stop")
        self.btn_stop.setEnabled(False)

        self.btn_toggle_advanced = QtWidgets.QToolButton()
        self.btn_toggle_advanced.setText("More ▸")
        self.btn_toggle_advanced.setCheckable(True)
        self.btn_toggle_advanced.setChecked(False)

        row1.addWidget(lbl_year)
        row1.addWidget(self.btn_years)
        row1.addWidget(self.chk_year_multi)
        row1.addSpacing(8)
        row1.addWidget(lbl_method)
        row1.addWidget(self.btn_method)
        row1.addSpacing(16)
        row1.addWidget(lbl_amount)
        row1.addWidget(self.txt_amount)
        row1.addSpacing(16)
        row1.addWidget(lbl_sort)
        row1.addWidget(self.btn_sort)
        row1.addWidget(self.btn_apply_sort)
        row1.addStretch(1)
        row1.addWidget(self.btn_start)
        row1.addWidget(self.btn_stop)
        row1.addSpacing(8)
        row1.addWidget(self.btn_toggle_advanced)

        layout.addLayout(row1)

        self.advanced_container = QtWidgets.QWidget()
        adv_layout = QtWidgets.QVBoxLayout(self.advanced_container)
        adv_layout.setContentsMargins(0, 0, 0, 0)
        adv_layout.setSpacing(4)

        row_rap = QtWidgets.QHBoxLayout()
        row_rap.setSpacing(10)

        self.chk_enable_rap_preset = QtWidgets.QCheckBox("RAP filter:")
        self.chk_enable_rap_preset.setChecked(False)

        self.btn_rap_preset = QtWidgets.QToolButton()
        self.btn_rap_preset.setPopupMode(QtWidgets.QToolButton.ToolButtonPopupMode.InstantPopup)
        self.menu_rap_preset = QtWidgets.QMenu(self.btn_rap_preset)
        self.rap_preset_actions: list[QtGui.QAction] = []
        for name in RAP_PRESETS.keys():
            act = QtGui.QAction(name, self.menu_rap_preset)
            act.setCheckable(True)
            self.menu_rap_preset.addAction(act)
            self.rap_preset_actions.append(act)
        self.rap_preset_actions[0].setChecked(True)
        self.btn_rap_preset.setText("Off")
        self.btn_rap_preset.setEnabled(False)

        def on_rap_preset_triggered(act: QtGui.QAction):
            for a in self.rap_preset_actions:
                a.setChecked(a is act)
            self.btn_rap_preset.setText(act.text())

        self.menu_rap_preset.triggered.connect(on_rap_preset_triggered)
        self.btn_rap_preset.setMenu(self.menu_rap_preset)

        def on_rap_enable_toggled(checked: bool):
            self.btn_rap_preset.setEnabled(checked)

        self.chk_enable_rap_preset.toggled.connect(on_rap_enable_toggled)

        self.chk_enable_unknown_rap = QtWidgets.QCheckBox("Include Unknown RAP")
        self.chk_enable_unknown_rap.setChecked(True)

        row_rap.addWidget(self.chk_enable_rap_preset)
        row_rap.addWidget(self.btn_rap_preset)
        row_rap.addSpacing(20)
        row_rap.addWidget(self.chk_enable_unknown_rap)

        self.chk_use_id_range = QtWidgets.QCheckBox("Use ID range:")
        self.txt_id_min = QtWidgets.QLineEdit()
        self.txt_id_min.setFixedWidth(110)
        self.txt_id_max = QtWidgets.QLineEdit()
        self.txt_id_max.setFixedWidth(110)
        self.txt_id_min.setPlaceholderText("From ID")
        self.txt_id_max.setPlaceholderText("To ID")

        row_rap.addSpacing(20)
        row_rap.addWidget(self.chk_use_id_range)
        row_rap.addWidget(self.txt_id_min)
        row_rap.addWidget(self.txt_id_max)

        row_rap.addStretch(1)
        adv_layout.addLayout(row_rap)

        self.txt_id_min.setEnabled(False)
        self.txt_id_max.setEnabled(False)

        def on_use_id_range_toggled(checked: bool):
            self.txt_id_min.setEnabled(checked)
            self.txt_id_max.setEnabled(checked)
            self.btn_years.setEnabled(not checked)
            self.chk_year_multi.setEnabled(not checked)

        self.chk_use_id_range.toggled.connect(on_use_id_range_toggled)

        row_hats = QtWidgets.QHBoxLayout()
        row_hats.setSpacing(10)

        self.chk_enable_hat_preset = QtWidgets.QCheckBox("Hat count filter:")
        self.chk_enable_hat_preset.setChecked(False)

        self.btn_hat_preset = QtWidgets.QToolButton()
        self.btn_hat_preset.setPopupMode(QtWidgets.QToolButton.ToolButtonPopupMode.InstantPopup)
        self.menu_hat_preset = QtWidgets.QMenu(self.btn_hat_preset)
        self.hat_preset_actions: list[QtGui.QAction] = []
        for name in HAT_PRESETS.keys():
            act = QtGui.QAction(name, self.menu_hat_preset)
            act.setCheckable(True)
            self.menu_hat_preset.addAction(act)
            self.hat_preset_actions.append(act)
        self.hat_preset_actions[0].setChecked(True)
        self.btn_hat_preset.setText("Off")
        self.btn_hat_preset.setEnabled(False)

        def on_hat_preset_triggered(act: QtGui.QAction):
            for a in self.hat_preset_actions:
                a.setChecked(a is act)
            self.btn_hat_preset.setText(act.text())

        self.menu_hat_preset.triggered.connect(on_hat_preset_triggered)
        self.btn_hat_preset.setMenu(self.menu_hat_preset)

        def on_hat_enable_toggled(checked: bool):
            self.btn_hat_preset.setEnabled(checked)

        self.chk_enable_hat_preset.toggled.connect(on_hat_enable_toggled)

        row_hats.addWidget(self.chk_enable_hat_preset)
        row_hats.addWidget(self.btn_hat_preset)
        row_hats.addStretch(1)

        adv_layout.addLayout(row_hats)

        row_flags = QtWidgets.QHBoxLayout()
        row_flags.setSpacing(10)

        lbl_ban_filter = QtWidgets.QLabel("Ban filter:")
        lbl_ban_filter.setProperty("role", "muted")
        self.btn_ban_filter = QtWidgets.QToolButton()
        self.btn_ban_filter.setPopupMode(QtWidgets.QToolButton.ToolButtonPopupMode.InstantPopup)
        self.menu_ban_filter = QtWidgets.QMenu(self.btn_ban_filter)
        self.ban_actions: list[QtGui.QAction] = []
        for name in BAN_FILTER_OPTIONS:
            act = QtGui.QAction(name, self.menu_ban_filter)
            act.setCheckable(True)
            self.menu_ban_filter.addAction(act)
            self.ban_actions.append(act)
        self.ban_actions[0].setChecked(True)
        self.btn_ban_filter.setText("All")

        def on_ban_triggered(act: QtGui.QAction):
            for a in self.ban_actions:
                a.setChecked(a is act)
            self.btn_ban_filter.setText(act.text())

        self.menu_ban_filter.triggered.connect(on_ban_triggered)
        self.btn_ban_filter.setMenu(self.btn_ban_filter.menu())

        lbl_verified_filter = QtWidgets.QLabel("Verified filter:")
        lbl_verified_filter.setProperty("role", "muted")
        self.btn_verified_filter = QtWidgets.QToolButton()
        self.btn_verified_filter.setPopupMode(
            QtWidgets.QToolButton.ToolButtonPopupMode.InstantPopup
        )
        self.menu_verified_filter = QtWidgets.QMenu(self.btn_verified_filter)
        self.verified_actions: list[QtGui.QAction] = []
        for name in VERIFIED_FILTER_OPTIONS:
            act = QtGui.QAction(name, self.menu_verified_filter)
            act.setCheckable(True)
            self.menu_verified_filter.addAction(act)
            self.verified_actions.append(act)
        self.verified_actions[0].setChecked(True)
        self.btn_verified_filter.setText("All")

        def on_verified_triggered(act: QtGui.QAction):
            for a in self.verified_actions:
                a.setChecked(a is act)
            self.btn_verified_filter.setText(act.text())

        self.menu_verified_filter.triggered.connect(on_verified_triggered)
        self.btn_verified_filter.setMenu(self.menu_verified_filter)

        lbl_active_filter = QtWidgets.QLabel("Active filter:")
        lbl_active_filter.setProperty("role", "muted")
        self.btn_active_filter = QtWidgets.QToolButton()
        self.btn_active_filter.setPopupMode(
            QtWidgets.QToolButton.ToolButtonPopupMode.InstantPopup
        )
        self.menu_active_filter = QtWidgets.QMenu(self.btn_active_filter)
        self.active_actions: list[QtGui.QAction] = []
        for name in ACTIVE_FILTER_OPTIONS:
            act = QtGui.QAction(name, self.menu_active_filter)
            act.setCheckable(True)
            self.menu_active_filter.addAction(act)
            self.active_actions.append(act)
        self.active_actions[0].setChecked(True)
        self.btn_active_filter.setText("All")

        def on_active_triggered(act: QtGui.QAction):
            for a in self.active_actions:
                a.setChecked(a is act)
            self.btn_active_filter.setText(act.text())

        self.menu_active_filter.triggered.connect(on_active_triggered)
        self.btn_active_filter.setMenu(self.menu_active_filter)

        row_flags.addWidget(lbl_ban_filter)
        row_flags.addWidget(self.btn_ban_filter)
        row_flags.addSpacing(10)
        row_flags.addWidget(lbl_verified_filter)
        row_flags.addWidget(self.btn_verified_filter)
        row_flags.addSpacing(10)
        row_flags.addWidget(lbl_active_filter)
        row_flags.addWidget(self.btn_active_filter)
        row_flags.addStretch(1)
        adv_layout.addLayout(row_flags)

        row_len = QtWidgets.QHBoxLayout()
        row_len.setSpacing(10)

        lbl_min_len = QtWidgets.QLabel("Username len ≥")
        lbl_min_len.setProperty("role", "muted")
        self.txt_min_len = QtWidgets.QLineEdit()
        self.txt_min_len.setFixedWidth(60)

        lbl_max_len = QtWidgets.QLabel("≤")
        lbl_max_len.setProperty("role", "muted")
        self.txt_max_len = QtWidgets.QLineEdit()
        self.txt_max_len.setFixedWidth(60)

        row_len.addWidget(lbl_min_len)
        row_len.addWidget(self.txt_min_len)
        row_len.addWidget(lbl_max_len)
        row_len.addWidget(self.txt_max_len)
        row_len.addStretch(1)
        adv_layout.addLayout(row_len)

        row_badges = QtWidgets.QHBoxLayout()
        row_badges.setSpacing(10)

        self.chk_enable_badge_filter = QtWidgets.QCheckBox("Require badges:")
        self.chk_enable_badge_filter.setChecked(False)

        self.btn_badge_filter = QtWidgets.QToolButton()
        self.btn_badge_filter.setText("None selected")
        self.btn_badge_filter.setPopupMode(QtWidgets.QToolButton.ToolButtonPopupMode.InstantPopup)

        self.menu_badge_filter = QtWidgets.QMenu(self.btn_badge_filter)
        self.badge_filter_actions: list[QtGui.QAction] = []
        for badge_name in BADGE_NAMES:
            act = QtGui.QAction(badge_name, self.menu_badge_filter)
            act.setCheckable(True)
            self.menu_badge_filter.addAction(act)
            self.badge_filter_actions.append(act)

        def update_badge_button_text():
            selected = [a.text() for a in self.badge_filter_actions if a.isChecked()]
            if not selected:
                self.btn_badge_filter.setText("None selected")
            elif len(selected) == 1:
                self.btn_badge_filter.setText(selected[0])
            else:
                self.btn_badge_filter.setText(f"{len(selected)} badges")

        self.menu_badge_filter.triggered.connect(lambda _: update_badge_button_text())
        self.btn_badge_filter.setMenu(self.menu_badge_filter)
        self.btn_badge_filter.setEnabled(False)

        def on_badge_filter_toggled(checked: bool):
            self.btn_badge_filter.setEnabled(checked)
        self.chk_enable_badge_filter.toggled.connect(on_badge_filter_toggled)

        row_badges.addWidget(self.chk_enable_badge_filter)
        row_badges.addWidget(self.btn_badge_filter)

        self.chk_skip_saved = QtWidgets.QCheckBox("Skip saved accounts (all categories)")
        self.chk_skip_saved.setChecked(True)
        row_badges.addSpacing(20)
        row_badges.addWidget(self.chk_skip_saved)

        row_badges.addStretch(1)
        adv_layout.addLayout(row_badges)

        self.advanced_container.setVisible(False)
        layout.addWidget(self.advanced_container)

        self.progress = QtWidgets.QProgressBar()
        self.progress.setRange(0, 1000)
        self.progress.setValue(0)
        layout.addWidget(self.progress)

        self.table = QtWidgets.QTableWidget(0, 11)
        self.table.setHorizontalHeaderLabels(
            ["#", "Username", "ID", "Created (Y-M-D)", "RAP",
             "Badges", "Verified", "Banned", "Active", "Hats", "Save"]
        )
        self.table.setSelectionBehavior(
            QtWidgets.QAbstractItemView.SelectionBehavior.SelectRows
        )
        self.table.setSelectionMode(
            QtWidgets.QAbstractItemView.SelectionMode.SingleSelection
        )
        self.table.setAlternatingRowColors(True)
        self.table.verticalHeader().setVisible(False)
        header = self.table.horizontalHeader()
        header.setDefaultAlignment(
            QtCore.Qt.AlignmentFlag.AlignLeft
            | QtCore.Qt.AlignmentFlag.AlignVCenter
        )
        header.setStretchLastSection(True)

        header.resizeSection(0, 40)
        header.resizeSection(1, 150)
        header.resizeSection(2, 120)
        header.resizeSection(3, 130)
        header.resizeSection(4, 110)
        header.resizeSection(5, 140)
        header.resizeSection(6, 80)
        header.resizeSection(7, 80)
        header.resizeSection(8, 80)
        header.resizeSection(9, 80)

        layout.addWidget(self.table, 1)

        self.progress_anim = QtCore.QPropertyAnimation(self.progress, b"windowOpacity")
        self.progress_anim.setDuration(150)
        self.progress_anim.setStartValue(0.6)
        self.progress_anim.setEndValue(1.0)

        save_row = QtWidgets.QHBoxLayout()
        save_row.setSpacing(8)
        self.btn_save_selected = QtWidgets.QPushButton("Save checked to category…")
        self.btn_select_all = QtWidgets.QPushButton("Select all")
        self.btn_clear_select = QtWidgets.QPushButton("Clear")
        save_row.addWidget(self.btn_save_selected)
        save_row.addWidget(self.btn_select_all)
        save_row.addWidget(self.btn_clear_select)
        save_row.addStretch(1)
        layout.addLayout(save_row)

        self.table.doubleClicked.connect(self._open_selected_profile)
        self.btn_start.clicked.connect(self._start_generate)
        self.btn_stop.clicked.connect(self._stop_generate)
        self.btn_apply_sort.clicked.connect(self._apply_sort)
        self.btn_toggle_advanced.toggled.connect(self._toggle_advanced)
        self.btn_save_selected.clicked.connect(self._save_selected_results)
        self.btn_select_all.clicked.connect(self._select_all_rows)
        self.btn_clear_select.clicked.connect(self._clear_all_rows)

    def _all_saved_ids(self) -> set[int]:
        ids: set[int] = set()
        for cat in self.saved_data.get("categories", {}).values():
            for uid_str in cat.get("accounts", {}).keys():
                try:
                    ids.add(int(uid_str))
                except ValueError:
                    continue
        return ids

    def _on_year_triggered(self, act: QtGui.QAction):
        multi = self.chk_year_multi.isChecked()
        if not multi:
            for a in self.year_actions:
                a.setChecked(a is act)
        self._update_year_button_text()

    def _update_year_button_text(self):
        selected = [a.text() for a in self.year_actions if a.isChecked()]
        if not selected:
            self.btn_years.setText("None")
        elif len(selected) == 1:
            self.btn_years.setText(selected[0])
        else:
            self.btn_years.setText(f"{len(selected)} years")

    def _toggle_advanced(self, checked: bool):
        self.advanced_container.setVisible(checked)
        self.btn_toggle_advanced.setText("Less ▾" if checked else "More ▸")

    def _start_generate(self):
        if self.gen_worker and self.gen_worker.isRunning():
            return

        method = self.btn_method.text()
        use_id_range = self.chk_use_id_range.isChecked()
        id_min = parse_int_or_none(self.txt_id_min.text())
        id_max = parse_int_or_none(self.txt_id_max.text())
        selected_years: list[str]

        if use_id_range:
            if id_min is None or id_max is None or id_min <= 0 or id_max <= 0 or id_min >= id_max:
                QtWidgets.QMessageBox.warning(
                    self,
                    "Invalid ID range",
                    "Please enter a valid ID range: positive numbers and From ID < To ID.",
                )
                return
            selected_years = []
        else:
            selected_years = [a.text() for a in self.year_actions if a.isChecked()]
            if "Any year" in selected_years and len(selected_years) > 1:
                selected_years = ["Any year"]
            if not selected_years and method != "nonstop":
                QtWidgets.QMessageBox.warning(
                    self, "Year required", "Please select at least one year."
                )
                return

        if method == "nonstop":
            amount = 1  # ignored
        else:
            try:
                amount = int(self.txt_amount.text())
                if amount <= 0:
                    raise ValueError
            except ValueError:
                QtWidgets.QMessageBox.warning(
                    self, "Invalid amount", "Amount must be a positive integer."
                )


                return

        rap_min_preset = None
        if self.chk_enable_rap_preset.isChecked():
            rap_min_preset = RAP_PRESETS.get(self.btn_rap_preset.text(), None)

        hat_min_preset = None
        if self.chk_enable_hat_preset.isChecked():
            hat_min_preset = HAT_PRESETS.get(self.btn_hat_preset.text(), None)

        include_unknown = self.chk_enable_unknown_rap.isChecked()
        ban_filter = self.btn_ban_filter.text()
        verified_filter = self.btn_verified_filter.text()

        # Force inactive filter for nonstop
        if method == "nonstop":
            active_filter = "Only inactive"
        else:
            active_filter = self.btn_active_filter.text()

        username_min_len = parse_int_or_none(self.txt_min_len.text())
        username_max_len = parse_int_or_none(self.txt_max_len.text())

        required_badges: list[str] = []
        if self.chk_enable_badge_filter.isChecked():
            required_badges = [
                a.text() for a in self.badge_filter_actions if a.isChecked()
            ]

        skip_ids: set[int] = set()
        if self.chk_skip_saved.isChecked():
            skip_ids = self._all_saved_ids()

        self.table.setRowCount(0)
        self._log_entries.clear()
        self.log_edit.clear()
        self.progress.setValue(0)

        self.btn_start.setText("Scanning…" if method != "nonstop" else "Nonstop…")
        self.btn_start.setEnabled(False)
        self.btn_stop.setEnabled(True)

        self.gen_worker = GenerateWorker(
            selected_years,
            method,
            amount,
            rap_min_preset=rap_min_preset,
            include_unknown_rap=include_unknown,
            ban_filter=ban_filter,
            verified_filter=verified_filter,
            active_filter=active_filter,
            hat_min_preset=hat_min_preset,
            username_min_len=username_min_len,
            username_max_len=username_max_len,
            use_id_range=use_id_range,
            id_min=id_min,
            id_max=id_max,
            max_workers=4,
            required_badges=required_badges,
            skip_ids=skip_ids,
        )
        self.gen_worker.row_found.connect(self._add_row)
        self.gen_worker.progress.connect(self._update_progress)
        self.gen_worker.log_msg.connect(self._append_log)
        self.gen_worker.finished_gen.connect(self._gen_finished)
        self.gen_worker.start()

    def _stop_generate(self):
        if self.gen_worker and self.gen_worker.isRunning():
            self.gen_worker.stop()
            self._append_log(format_log_line("Stop requested…", "worker"))

    def _renumber_rows(self):
        for row in range(self.table.rowCount()):
            item = QtWidgets.QTableWidgetItem(str(row + 1))
            item.setTextAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)
            item.setFlags(
                QtCore.Qt.ItemFlag.ItemIsSelectable |
                QtCore.Qt.ItemFlag.ItemIsEnabled
            )
            self.table.setItem(row, 0, item)

    def _add_row(self, data: dict):
        row = self.table.rowCount()
        self.table.insertRow(row)

        idx_item = QtWidgets.QTableWidgetItem(str(row + 1))
        idx_item.setTextAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)
        idx_item.setFlags(
            QtCore.Qt.ItemFlag.ItemIsSelectable |
            QtCore.Qt.ItemFlag.ItemIsEnabled
        )
        self.table.setItem(row, 0, idx_item)

        for col, key in enumerate(["username", "id", "created", "rap"], start=1):
            item = QtWidgets.QTableWidgetItem(data.get(key, ""))
            item.setTextAlignment(
                QtCore.Qt.AlignmentFlag.AlignLeft
                | QtCore.Qt.AlignmentFlag.AlignVCenter
            )
            item.setFlags(
                QtCore.Qt.ItemFlag.ItemIsSelectable |
                QtCore.Qt.ItemFlag.ItemIsEnabled
            )
            self.table.setItem(row, col, item)

        badges_widget = QtWidgets.QWidget()
        badges_layout = QtWidgets.QHBoxLayout(badges_widget)
        badges_layout.setContentsMargins(4, 0, 0, 0)
        badges_layout.setSpacing(2)

        for badge in data.get("roblox_badges", []):
            name = badge.get("name")
            lbl = QtWidgets.QLabel()
            lbl.setObjectName(f"badge_{name}_16")
            lbl.setFixedSize(16, 16)
            lbl.setToolTip(name or "")
            pix = BADGE_PIXMAP_CACHE.get((name, 16))
            if pix is not None:
                lbl.setPixmap(pix)
            else:
                self.badge_loader.request_badge(name, 16)
            badges_layout.addWidget(lbl)

        badges_layout.addStretch(1)
        self.table.setCellWidget(row, 5, badges_widget)

        for col, key in enumerate(["verified", "banned", "active"], start=6):
            item = QtWidgets.QTableWidgetItem(data.get(key, ""))
            item.setTextAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)
            item.setFlags(
                QtCore.Qt.ItemFlag.ItemIsSelectable |
                QtCore.Qt.ItemFlag.ItemIsEnabled
            )
            self.table.setItem(row, col, item)

        hats_item = QtWidgets.QTableWidgetItem(data.get("hats", ""))
        hats_item.setTextAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)
        hats_item.setFlags(
            QtCore.Qt.ItemFlag.ItemIsSelectable |
            QtCore.Qt.ItemFlag.ItemIsEnabled
        )
        self.table.setItem(row, 9, hats_item)

        select_item = QtWidgets.QTableWidgetItem()
        select_item.setFlags(
            QtCore.Qt.ItemFlag.ItemIsUserCheckable |
            QtCore.Qt.ItemFlag.ItemIsEnabled
        )
        select_item.setCheckState(QtCore.Qt.CheckState.Unchecked)
        select_item.setTextAlignment(
            QtCore.Qt.AlignmentFlag.AlignCenter |
            QtCore.Qt.AlignmentFlag.AlignVCenter
        )
        self.table.setItem(row, 10, select_item)

    def _update_progress(self, current: int, total: int):
        # Keep progress static for nonstop
        if self.btn_method.text() == "nonstop":
            self.progress.setValue(0)
            return
        if total <= 0:
            self.progress.setValue(0)
            return
        val = int(1000 * current / total)
        self.progress.setValue(val)
        self.progress_anim.stop()
        self.progress_anim.start()

    def _gen_finished(self, count: int):
        self.btn_start.setEnabled(True)
        self.btn_start.setText("Start")
        self.btn_stop.setEnabled(False)
        self._append_log(format_log_line(f"Finished. Found {count} accounts.", "worker"))
        self._renumber_rows()

    def _open_selected_profile(self):
        row = self.table.currentRow()
        if row < 0:
            return
        item_id = self.table.item(row, 2)
        if not item_id:
            return
        uid = item_id.text()
        if not uid:
            return
        url = ROBLOX_PROFILE_URL.format(user_id=uid)
        webbrowser.open(url)

    def _current_sort_mode(self) -> str:
        return self.btn_sort.text()

    def _apply_sort(self):
        mode = self._current_sort_mode()
        if mode == "None" or self.table.rowCount() <= 1:
            self._renumber_rows()
            return

        rows = []
        for r in range(self.table.rowCount()):
            row_obj = {
                "username": self.table.item(r, 1).text() if self.table.item(r, 1) else "",
                "id": self.table.item(r, 2).text() if self.table.item(r, 2) else "",
                "created": self.table.item(r, 3).text() if self.table.item(r, 3) else "",
                "rap": self.table.item(r, 4).text() if self.table.item(r, 4) else "",
                "verified": self.table.item(r, 6).text() if self.table.item(r, 6) else "",
                "banned": self.table.item(r, 7).text() if self.table.item(r, 7) else "",
                "active": self.table.item(r, 8).text() if self.table.item(r, 8) else "",
                "hats": self.table.item(r, 9).text() if self.table.item(r, 9) else "",
                "badges": [],
            }
            cell = self.table.cellWidget(r, 5)
            if cell:
                layout = cell.layout()
                if layout:
                    for i in range(layout.count()):
                        w = layout.itemAt(i).widget()
                        if isinstance(w, QtWidgets.QLabel):
                            obj = w.objectName()
                            if obj.startswith("badge_") and obj.endswith("_16"):
                                name = obj[6:-3]
                                row_obj["badges"].append(name)
            rows.append(row_obj)

        def key_username(row): return row["username"].lower()
        def key_id(row): return parse_int_or_none(row["id"]) or 0
        def key_created(row): return row["created"] or ""
        def key_rap(row):
            txt = row["rap"]
            if txt == "Unknown":
                return -1
            v = parse_int_or_none(txt)
            return v if v is not None else -1
        def key_verified_yes_first(row): return 0 if row["verified"] == "Yes" else 1
        def key_verified_no_first(row): return 0 if row["verified"] == "No" else 1
        def key_banned_yes_first(row): return 0 if row["banned"] == "Yes" else 1
        def key_banned_no_first(row): return 0 if row["banned"] == "No" else 1
        def key_active_yes_first(row): return 0 if row["active"] == "Yes" else 1
        def key_active_no_first(row): return 0 if row["active"] == "No" else 1

        reverse = False
        key_func = None

        if mode == "Username A→Z":
            key_func = key_username
        elif mode == "Username Z→A":
            key_func = key_username
            reverse = True
        elif mode == "ID low→high":
            key_func = key_id
        elif mode == "ID high→low":
            key_func = key_id
            reverse = True
        elif mode == "Created oldest→newest":
            key_func = key_created
        elif mode == "Created newest→oldest":
            key_func = key_created
            reverse = True
        elif mode == "RAP high→low":
            key_func = key_rap
            reverse = True
        elif mode == "RAP low→high":
            key_func = key_rap
        elif mode == "Verified Yes first":
            key_func = key_verified_yes_first
        elif mode == "Verified No first":
            key_func = key_verified_no_first
        elif mode == "Banned Yes first":
            key_func = key_banned_yes_first
        elif mode == "Banned No first":
            key_func = key_banned_no_first
        elif mode == "Active Yes first":
            key_func = key_active_yes_first
        elif mode == "Active No first":
            key_func = key_active_no_first

        if key_func is None:
            self._renumber_rows()
            return

        rows.sort(key=key_func, reverse=reverse)

        self.table.setRowCount(0)
        for idx, row in enumerate(rows):
            self.table.insertRow(idx)

            idx_item = QtWidgets.QTableWidgetItem(str(idx + 1))
            idx_item.setTextAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)
            idx_item.setFlags(
                QtCore.Qt.ItemFlag.ItemIsSelectable |
                QtCore.Qt.ItemFlag.ItemIsEnabled
            )
            self.table.setItem(idx, 0, idx_item)

            for col, key in enumerate(["username", "id", "created", "rap"], start=1):
                item = QtWidgets.QTableWidgetItem(row[key])
                item.setTextAlignment(
                    QtCore.Qt.AlignmentFlag.AlignLeft
                    | QtCore.Qt.AlignmentFlag.AlignVCenter
                )
                item.setFlags(
                    QtCore.Qt.ItemFlag.ItemIsSelectable |
                    QtCore.Qt.ItemFlag.ItemIsEnabled
                )
                self.table.setItem(idx, col, item)

            badges_widget = QtWidgets.QWidget()
            badges_layout = QtWidgets.QHBoxLayout(badges_widget)
            badges_layout.setContentsMargins(4, 0, 0, 0)
            badges_layout.setSpacing(2)
            for name in row["badges"]:
                lbl = QtWidgets.QLabel()
                lbl.setObjectName(f"badge_{name}_16")
                lbl.setFixedSize(16, 16)
                lbl.setToolTip(name or "")
                pix = BADGE_PIXMAP_CACHE.get((name, 16))
                if pix is not None:
                    lbl.setPixmap(pix)
                else:
                    self.badge_loader.request_badge(name, 16)
                badges_layout.addWidget(lbl)
            badges_layout.addStretch(1)
            self.table.setCellWidget(idx, 5, badges_widget)

            for col, key in enumerate(["verified", "banned", "active"], start=6):
                item = QtWidgets.QTableWidgetItem(row[key])
                item.setTextAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)
                item.setFlags(
                    QtCore.Qt.ItemFlag.ItemIsSelectable |
                    QtCore.Qt.ItemFlag.ItemIsEnabled
                )
                self.table.setItem(idx, col, item)

            hats_item = QtWidgets.QTableWidgetItem(row["hats"])
            hats_item.setTextAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)
            hats_item.setFlags(
                QtCore.Qt.ItemFlag.ItemIsSelectable |
                QtCore.Qt.ItemFlag.ItemIsEnabled
            )
            self.table.setItem(idx, 9, hats_item)

            select_item = QtWidgets.QTableWidgetItem()
            select_item.setFlags(
                QtCore.Qt.ItemFlag.ItemIsUserCheckable |
                QtCore.Qt.ItemFlag.ItemIsEnabled
            )
            select_item.setCheckState(QtCore.Qt.CheckState.Unchecked)
            select_item.setTextAlignment(
                QtCore.Qt.AlignmentFlag.AlignCenter |
                QtCore.Qt.AlignmentFlag.AlignVCenter
            )
            self.table.setItem(idx, 10, select_item)

    def _select_all_rows(self):
        for r in range(self.table.rowCount()):
            item = self.table.item(r, 10)
            if item:
                item.setCheckState(QtCore.Qt.CheckState.Checked)

    def _clear_all_rows(self):
        for r in range(self.table.rowCount()):
            item = self.table.item(r, 10)
            if item:
                item.setCheckState(QtCore.Qt.CheckState.Unchecked)

    def _save_selected_results(self):
        checked_rows = []
        for r in range(self.table.rowCount()):
            item = self.table.item(r, 10)
            if item and item.checkState() == QtCore.Qt.CheckState.Checked:
                checked_rows.append(r)

        if not checked_rows:
            QtWidgets.QMessageBox.information(
                self, "Save selected", "No rows are checked in the Save column."
            )
            return

        categories = list(self.saved_data.get("categories", {}).keys())
        if not categories:
            categories = ["Default"]
            self.saved_data["categories"]["Default"] = {"accounts": {}}

        cat, ok = QtWidgets.QInputDialog.getItem(
            self,
            "Save to category",
            "Choose category (or type new name):",
            categories,
            editable=True,
        )
        if not ok or not cat.strip():
            return
        cat = cat.strip()
        if cat not in self.saved_data["categories"]:
            self.saved_data["categories"][cat] = {"accounts": {}}
        self.current_category = cat

        category_obj = self.saved_data["categories"][cat]["accounts"]

        for r in checked_rows:
            uid_item = self.table.item(r, 2)
            if not uid_item:
                continue
            uid = uid_item.text().strip()
            if not uid:
                continue
            username = self.table.item(r, 1).text() if self.table.item(r, 1) else ""
            created = self.table.item(r, 3).text() if self.table.item(r, 3) else ""
            rap = self.table.item(r, 4).text() if self.table.item(r, 4) else ""
            verified = self.table.item(r, 6).text() if self.table.item(r, 6) else ""
            banned = self.table.item(r, 7).text() if self.table.item(r, 7) else ""
            active = self.table.item(r, 8).text() if self.table.item(r, 8) else ""
            hats = self.table.item(r, 9).text() if self.table.item(r, 9) else ""

            badge_names: list[str] = []
            cell = self.table.cellWidget(r, 5)
            if cell:
                lay = cell.layout()
                if lay:
                    for i in range(lay.count()):
                        w = lay.itemAt(i).widget()
                        if isinstance(w, QtWidgets.QLabel):
                            obj = w.objectName()
                            if obj.startswith("badge_") and obj.endswith("_16"):
                                name = obj[6:-3]
                                badge_names.append(name)

            category_obj[uid] = {
                "id": uid,
                "username": username,
                "created": created,
                "rap": rap,
                "verified": verified,
                "banned": banned,
                "active": active,
                "hats": hats,
                "badges": badge_names,
                "note": category_obj.get(uid, {}).get("note", ""),
            }

        self._persist_saved_data()
        self._refresh_saved_ui()
        QtWidgets.QMessageBox.information(
            self, "Saved", f"Saved {len(checked_rows)} account(s) to category '{cat}'."
        )

    def _build_saved_tab(self):
        w = self.tab_saved
        layout = QtWidgets.QHBoxLayout(w)
        layout.setContentsMargins(0, 6, 0, 0)
        layout.setSpacing(10)

        left = QtWidgets.QVBoxLayout()
        lbl_cat = QtWidgets.QLabel("Categories")
        lbl_cat.setProperty("role", "muted")
        left.addWidget(lbl_cat)

        self.list_categories = QtWidgets.QListWidget()
        self.list_categories.setSelectionMode(
            QtWidgets.QAbstractItemView.SelectionMode.SingleSelection
        )
        left.addWidget(self.list_categories, 1)

        btn_row = QtWidgets.QHBoxLayout()
        self.btn_add_category = QtWidgets.QPushButton("Add")
        self.btn_rename_category = QtWidgets.QPushButton("Rename")
        self.btn_delete_category = QtWidgets.QPushButton("Delete")
        btn_row.addWidget(self.btn_add_category)
        btn_row.addWidget(self.btn_rename_category)
        btn_row.addWidget(self.btn_delete_category)
        left.addLayout(btn_row)

        layout.addLayout(left, 0)

        right = QtWidgets.QVBoxLayout()

        self.saved_table = QtWidgets.QTableWidget(0, 10)
        self.saved_table.setHorizontalHeaderLabels(
            ["Note?", "#", "Username", "ID", "Created", "RAP", "Verified", "Banned", "Active", "Hats"]
        )
        self.saved_table.setSelectionBehavior(
            QtWidgets.QAbstractItemView.SelectionBehavior.SelectRows
        )
        self.saved_table.setSelectionMode(
            QtWidgets.QAbstractItemView.SelectionMode.SingleSelection
        )
        self.saved_table.setAlternatingRowColors(True)
        self.saved_table.verticalHeader().setVisible(False)
        header = self.saved_table.horizontalHeader()
        header.setStretchLastSection(True)
        header.resizeSection(0, 70)
        header.resizeSection(1, 40)
        right.addWidget(self.saved_table, 1)

        notes_info = QtWidgets.QLabel(
            "Double-click a row to view/edit its note. Right-click for more actions."
        )
        notes_info.setProperty("role", "muted")
        right.addWidget(notes_info)

        notes_btn_row = QtWidgets.QHBoxLayout()
        self.btn_remove_from_cat = QtWidgets.QPushButton("Remove from category")
        notes_btn_row.addWidget(self.btn_remove_from_cat)
        notes_btn_row.addStretch(1)
        right.addLayout(notes_btn_row)

        layout.addLayout(right, 1)

        self.btn_add_category.clicked.connect(self._add_category)
        self.btn_rename_category.clicked.connect(self._rename_category)
        self.btn_delete_category.clicked.connect(self._delete_category)
        self.list_categories.currentItemChanged.connect(self._on_category_changed)
        self.saved_table.currentCellChanged.connect(self._on_saved_row_changed)
        self.btn_remove_from_cat.clicked.connect(self._remove_selected_from_category)
        self.saved_table.itemDoubleClicked.connect(self._open_note_dialog_for_row)

        self._refresh_saved_ui()

    def _refresh_saved_ui(self):
        self.list_categories.blockSignals(True)
        self.list_categories.clear()
        for name in self.saved_data.get("categories", {}).keys():
            self.list_categories.addItem(name)
        self.list_categories.blockSignals(False)

        if not self.saved_data["categories"]:
            self.current_category = None
            self.saved_table.setRowCount(0)
            return

        if self.current_category not in self.saved_data["categories"]:
            self.current_category = next(iter(self.saved_data["categories"].keys()))

        items = self.list_categories.findItems(
            self.current_category, QtCore.Qt.MatchFlag.MatchExactly
        )
        if items:
            self.list_categories.setCurrentItem(items[0])

        self._reload_saved_table()

    def _reload_saved_table(self):
        self.saved_table.blockSignals(True)
        self.saved_table.setRowCount(0)

        if not self.current_category:
            self.saved_table.blockSignals(False)
            return

        cat_obj = self.saved_data["categories"].get(self.current_category, {}).get("accounts", {})

        rows_data = []
        for uid, acc in cat_obj.items():
            rows_data.append(
                {
                    "uid": uid,
                    "username": acc.get("username", ""),
                    "id": acc.get("id", ""),
                    "created": acc.get("created", ""),
                    "rap": acc.get("rap", ""),
                    "verified": acc.get("verified", ""),
                    "banned": acc.get("banned", ""),
                    "active": acc.get("active", ""),
                    "hats": acc.get("hats", ""),
                    "note": acc.get("note", ""),
                }
            )

        def key_id(row): return parse_int_or_none(row["id"]) or 0
        rows_data.sort(key=key_id)

        for idx, acc in enumerate(rows_data):
            row = self.saved_table.rowCount()
            self.saved_table.insertRow(row)

            note_text = "Yes" if acc["note"].strip() else "No"
            note_item = QtWidgets.QTableWidgetItem(note_text)
            note_item.setTextAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)
            note_item.setFlags(
                QtCore.Qt.ItemFlag.ItemIsSelectable |
                QtCore.Qt.ItemFlag.ItemIsEnabled
            )
            self.saved_table.setItem(row, 0, note_item)

            idx_item = QtWidgets.QTableWidgetItem(str(idx + 1))
            idx_item.setTextAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)
            idx_item.setFlags(
                QtCore.Qt.ItemFlag.ItemIsSelectable |
                QtCore.Qt.ItemFlag.ItemIsEnabled
            )
            self.saved_table.setItem(row, 1, idx_item)

            for col, key in enumerate(
                ["username", "id", "created", "rap", "verified", "banned", "active", "hats"],
                start=2,
            ):
                item = QtWidgets.QTableWidgetItem(acc.get(key, ""))
                item.setTextAlignment(
                    QtCore.Qt.AlignmentFlag.AlignLeft
                    | QtCore.Qt.AlignmentFlag.AlignVCenter
                )
                self.saved_table.setItem(row, col, item)

        self.saved_table.blockSignals(False)

    def _add_category(self):
        name, ok = QtWidgets.QInputDialog.getText(
            self, "Add category", "Category name:"
        )
        if not ok or not name.strip():
            return
        name = name.strip()
        if name in self.saved_data["categories"]:
            QtWidgets.QMessageBox.warning(
                self, "Add category", "Category with that name already exists."
            )
            return
        self.saved_data["categories"][name] = {"accounts": {}}
        self.current_category = name
        self._persist_saved_data()
        self._refresh_saved_ui()

    def _rename_category(self):
        if not self.current_category:
            return
        new_name, ok = QtWidgets.QInputDialog.getText(
            self, "Rename category", "New name:", text=self.current_category
        )
        if not ok or not new_name.strip():
            return
        new_name = new_name.strip()
        if new_name == self.current_category:
            return
        if new_name in self.saved_data["categories"]:
            QtWidgets.QMessageBox.warning(
                self, "Rename category", "Category with that name already exists."
            )
            return
        self.saved_data["categories"][new_name] = self.saved_data["categories"].pop(
            self.current_category
        )
        self.current_category = new_name
        self._persist_saved_data()
        self._refresh_saved_ui()

    def _delete_category(self):
        if not self.current_category:
            return
        if len(self.saved_data["categories"]) == 1:
            QtWidgets.QMessageBox.warning(
                self,
                "Delete category",
                "At least one category must exist.",
            )
            return
        reply = QtWidgets.QMessageBox.question(
            self,
            "Delete category",
            f"Delete category '{self.current_category}' and all its accounts?",
        )
        if reply != QtWidgets.QMessageBox.StandardButton.Yes:
            return
        self.saved_data["categories"].pop(self.current_category, None)
        self.current_category = None
        self._persist_saved_data()
        self._refresh_saved_ui()

    def _on_category_changed(self, current: QtWidgets.QListWidgetItem, previous):
        if current is None:
            return
        self.current_category = current.text()
        self._reload_saved_table()

    def _on_saved_row_changed(self, current_row, current_col, prev_row, prev_col):
        pass

    def _uids_for_rows(self, rows: list[int]) -> list[str]:
        uids: list[str] = []
        for r in rows:
            uid_item = self.saved_table.item(r, 3)
            if uid_item:
                uid = uid_item.text().strip()
                if uid:
                    uids.append(uid)
        return uids

    def _open_note_dialog_for_row(self, item: QtWidgets.QTableWidgetItem):
        row = item.row()
        self._open_note_dialog_for_rows([row])

    def _open_note_dialog_for_rows(self, rows: list[int]):
        if not self.current_category or not rows:
            return

        cat_obj = self.saved_data["categories"].get(self.current_category, {}).get("accounts", {})
        uids = self._uids_for_rows(rows)
        if not uids:
            return

        base_note = cat_obj.get(uids[0], {}).get("note", "")

        dlg = QtWidgets.QDialog(self)
        dlg.setWindowTitle("Account notes")
        dlg.resize(420, 260)
        layout = QtWidgets.QVBoxLayout(dlg)
        layout.setContentsMargins(8, 8, 8, 8)
        layout.setSpacing(6)

        if len(uids) == 1:
            title = QtWidgets.QLabel(f"Editing note for ID {uids[0]}")
        else:
            title = QtWidgets.QLabel(f"Editing note for {len(uids)} accounts")
        title.setProperty("role", "muted")
        layout.addWidget(title)

        text = QtWidgets.QTextEdit()
        text.setPlainText(base_note)
        layout.addWidget(text, 1)

        btn_row = QtWidgets.QHBoxLayout()
        btn_save = QtWidgets.QPushButton("Save")
        btn_cancel = QtWidgets.QPushButton("Cancel")
        btn_row.addStretch(1)
        btn_row.addWidget(btn_cancel)
        btn_row.addWidget(btn_save)
        layout.addLayout(btn_row)

        def on_save():
            new_note = text.toPlainText()
            for uid in uids:
                if uid in cat_obj:
                    cat_obj[uid]["note"] = new_note
            self._persist_saved_data()
            self._reload_saved_table()
            dlg.accept()

        btn_save.clicked.connect(on_save)
        btn_cancel.clicked.connect(dlg.reject)

        dlg.exec()

    def _remove_selected_from_category(self):
        if not self.current_category:
            return

        cat_obj = self.saved_data["categories"].get(self.current_category, {}).get("accounts", {})
        row = self.saved_table.currentRow()
        if row < 0:
            return
        uid_item = self.saved_table.item(row, 3)
        if not uid_item:
            return
        uid = uid_item.text().strip()
        if not uid or uid not in cat_obj:
            return

        del cat_obj[uid]
        self._persist_saved_data()
        self._reload_saved_table()

    def _build_log_tab(self):
        w = self.tab_log
        layout = QtWidgets.QVBoxLayout(w)
        layout.setContentsMargins(0, 6, 0, 0)
        layout.setSpacing(6)

        lbl = QtWidgets.QLabel("Log output:")
        layout.addWidget(lbl)

        filter_row = QtWidgets.QHBoxLayout()
        filter_row.setSpacing(8)
        self.log_filter_checkboxes = {}

        def add_filter(name: str, label: str):
            cb = QtWidgets.QCheckBox(label)
            cb.setChecked(True)
            self.log_filter_checkboxes[name] = cb
            cb.toggled.connect(self._refresh_log_view)
            filter_row.addWidget(cb)

        add_filter("method", "Method")
        add_filter("filter", "Advanced filters")
        add_filter("ratelimit", "Rate limit")
        add_filter("worker", "Worker")
        add_filter("lookup", "Lookup")

        filter_row.addStretch(1)
        layout.addLayout(filter_row)

        self.log_edit = QtWidgets.QTextEdit()
        self.log_edit.setReadOnly(True)
        layout.addWidget(self.log_edit, 1)

    def _append_log(self, text: str):
        log_type = "worker"
        if text.startswith("[") and "]" in text:
            end = text.find("]")
            candidate = text[1:end]
            if candidate in LOG_TYPES:
                log_type = candidate

        self._log_entries.append((log_type, text))

        if log_type in self.log_filter_checkboxes:
            if not self.log_filter_checkboxes[log_type].isChecked():
                return
        elif not LOG_TYPES.get(log_type, True):
            return

        self.log_edit.append(text)

    def _refresh_log_view(self):
        self.log_edit.blockSignals(True)
        self.log_edit.clear()
        for log_type, text in self._log_entries:
            if log_type in self.log_filter_checkboxes:
                if not self.log_filter_checkboxes[log_type].isChecked():
                    continue
            elif not LOG_TYPES.get(log_type, True):
                continue
            self.log_edit.append(text)
        self.log_edit.blockSignals(False)

    def _badge_pixmap_ready(self, name: str, size: int, pix: QtGui.QPixmap):
        for row in range(self.table.rowCount()):
            cell = self.table.cellWidget(row, 5)
            if not cell:
                continue
            layout = cell.layout()
            if not layout:
                continue
            for i in range(layout.count()):
                w = layout.itemAt(i).widget()
                if isinstance(w, QtWidgets.QLabel) and w.objectName() == f"badge_{name}_{size}":
                    w.setPixmap(pix)
        if hasattr(self, "badges_icon_layout"):
            for i in range(self.badges_icon_layout.count()):
                w = self.badges_icon_layout.itemAt(i).widget()
                if isinstance(w, QtWidgets.QLabel) and w.objectName() == f"badge_{name}_{size}":
                    w.setPixmap(pix)

    def _build_lookup_tab(self):
        w = self.tab_lookup
        layout = QtWidgets.QHBoxLayout(w)
        layout.setContentsMargins(0, 6, 0, 0)
        layout.setSpacing(16)

        left = QtWidgets.QVBoxLayout()
        right = QtWidgets.QVBoxLayout()

        self.avatar_label = QtWidgets.QLabel("No avatar")
        self.avatar_label.setAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)
        self.avatar_label.setFixedSize(160, 160)
        self.avatar_effect = QtWidgets.QGraphicsOpacityEffect()
        self.avatar_label.setGraphicsEffect(self.avatar_effect)
        left.addWidget(self.avatar_label)
        left.addSpacing(8)

        lbl = QtWidgets.QLabel("Username lookup")
        left.addWidget(lbl)
        self.lookup_edit = QtWidgets.QLineEdit()
        left.addWidget(self.lookup_edit)
        self.lookup_btn = QtWidgets.QPushButton("Lookup")
        self.lookup_btn.setObjectName("startButton")
        left.addWidget(self.lookup_btn)
        left.addStretch(1)

        title = QtWidgets.QLabel("Account details")
        title.setObjectName("headerTitle")
        right.addWidget(title)

        grid = QtWidgets.QGridLayout()
        grid.setHorizontalSpacing(12)
        grid.setVerticalSpacing(4)

        def add_row(r, label, attr_name):
            lab = QtWidgets.QLabel(label)
            lab.setProperty("role", "muted")
            val = QtWidgets.QLabel("-")
            setattr(self, attr_name, val)
            grid.addWidget(lab, r, 0)
            grid.addWidget(val, r, 1)

        add_row(0, "Username:", "lbl_lookup_username")
        add_row(1, "ID:", "lbl_lookup_id")
        add_row(2, "Display name:", "lbl_lookup_display")
        add_row(3, "Created:", "lbl_lookup_created")
        add_row(4, "RAP:", "lbl_lookup_rap")
        add_row(5, "Verified (asset 102611803):", "lbl_lookup_verified")
        add_row(6, "Banned:", "lbl_lookup_banned")
        add_row(7, "Active:", "lbl_lookup_active")
        add_row(8, "Hats:", "lbl_lookup_hats")

        badges_label = QtWidgets.QLabel("Badges:")
        badges_label.setProperty("role", "muted")

        badges_container = QtWidgets.QWidget()
        self.badges_icon_layout = QtWidgets.QHBoxLayout(badges_container)
        self.badges_icon_layout.setContentsMargins(4, 0, 0, 0)
        self.badges_icon_layout.setSpacing(4)
        self.badges_effect = QtWidgets.QGraphicsOpacityEffect()
        badges_container.setGraphicsEffect(self.badges_effect)

        grid.addWidget(badges_label, 9, 0, alignment=QtCore.Qt.AlignmentFlag.AlignTop)
        grid.addWidget(
            badges_container, 9, 1, alignment=QtCore.Qt.AlignmentFlag.AlignLeft
        )

        right.addLayout(grid)
        right.addSpacing(8)

        self.btn_open_profile = QtWidgets.QPushButton("Open Roblox Profile")
        self.btn_open_profile.setEnabled(False)
        right.addWidget(self.btn_open_profile)

        self.btn_show_rap_items = QtWidgets.QPushButton("Show RAP items ▸")
        self.btn_show_rap_items.setEnabled(False)
        right.addWidget(self.btn_show_rap_items)

        right.addStretch(1)

        layout.addLayout(left, 0)
        layout.addLayout(right, 1)

        self.lookup_btn.clicked.connect(self._start_lookup)
        self.btn_open_profile.clicked.connect(self._open_lookup_profile)
        self.btn_show_rap_items.clicked.connect(self._show_rap_items_dialog)

    def _start_lookup(self):
        if self.lookup_worker and self.lookup_worker.isRunning():
            return

        username = self.lookup_edit.text().strip()
        if not username:
            QtWidgets.QMessageBox.warning(
                self, "Input required", "Please enter a username."
            )
            return

        self.btn_open_profile.setEnabled(False)
        self.btn_show_rap_items.setEnabled(False)
        self.current_lookup_rap_items = []
        self.current_lookup_badges = []
        self._clear_badge_icons()

        self.lookup_btn.setText("Loading…")
        self.lookup_btn.setEnabled(False)

        self.avatar_effect.setOpacity(0.3)
        self.badges_effect.setOpacity(0.0)

        self._append_log(format_log_line(f"Lookup requested for '{username}'", "lookup"))

        self.lookup_worker = LookupWorker(username)
        self.lookup_worker.lookup_done.connect(self._lookup_done)
        self.lookup_worker.log_msg.connect(self._append_log)
        self.lookup_worker.start()

    def _lookup_done(self, payload: dict):
        self.lookup_btn.setText("Lookup")
        self.lookup_btn.setEnabled(True)

        if not payload.get("ok"):
            QtWidgets.QMessageBox.information(
                self, "Lookup", payload.get("error", "Unknown error.")
            )
            return

        self.lbl_lookup_username.setText(payload["username"])
        self.lbl_lookup_id.setText(str(payload["user_id"]))
        self.lbl_lookup_display.setText(payload.get("displayName", "-"))
        self.lbl_lookup_created.setText(payload.get("created", "-"))
        self.lbl_lookup_rap.setText(payload.get("rap", "-"))
        self.lbl_lookup_verified.setText(payload.get("verified", "-"))
        self.lbl_lookup_banned.setText(payload.get("banned", "-"))
        self.lbl_lookup_active.setText(payload.get("active", "-"))

        hat_count = payload.get("hat_count", None)
        if hat_count is None:
            self.lbl_lookup_hats.setText("Unknown")
        else:
            self.lbl_lookup_hats.setText(str(hat_count))

        self.btn_open_profile.setEnabled(True)

        self.current_lookup_rap_items = payload.get("rap_items", []) or []
        self.btn_show_rap_items.setEnabled(len(self.current_lookup_rap_items) > 0)

        self.current_lookup_badges = payload.get("roblox_badges", []) or []
        self._populate_badge_icons(self.current_lookup_badges)

        avatar_img: Image.Image | None = payload.get("avatar")
        if avatar_img:
            avatar_img = avatar_img.resize(
                (150, 150), Image.Resampling.LANCZOS
            )
            data = BytesIO()
            avatar_img.save(data, format="PNG")
            qimg = QtGui.QImage.fromData(data.getvalue(), "PNG")
            pix = QtGui.QPixmap.fromImage(qimg)
            self.avatar_label.setPixmap(pix)
        else:
            self.avatar_label.setPixmap(QtGui.QPixmap())
            self.avatar_label.setText("No avatar")

        self._animate_opacity(self.avatar_effect, 0.3, 1.0)
        self._animate_opacity(self.badges_effect, 0.0, 1.0)

    def _animate_opacity(self, effect: QtWidgets.QGraphicsOpacityEffect, start: float, end: float):
        anim = QtCore.QPropertyAnimation(effect, b"opacity")
        anim.setDuration(220)
        anim.setStartValue(start)
        anim.setEndValue(end)
        anim.setEasingCurve(QtCore.QEasingCurve.Type.InOutQuad)
        effect._anim = anim
        anim.start(QtCore.QAbstractAnimation.DeletionPolicy.DeleteWhenStopped)

    def _clear_badge_icons(self):
        if not hasattr(self, "badges_icon_layout"):
            return
        while self.badges_icon_layout.count():
            item = self.badges_icon_layout.takeAt(0)
            w = item.widget()
            if w is not None:
                w.deleteLater()

    def _populate_badge_icons(self, badges: list[dict]):
        self._clear_badge_icons()
        for badge in badges:
            name = badge.get("name")
            lbl = QtWidgets.QLabel()
            lbl.setObjectName(f"badge_{name}_32")
            lbl.setFixedSize(32, 32)
            lbl.setToolTip(name or "")
            pix = BADGE_PIXMAP_CACHE.get((name, 32))
            if pix is not None:
                lbl.setPixmap(pix)
            else:
                self.badge_loader.request_badge(name, 32)
            self.badges_icon_layout.addWidget(lbl)

    def _show_rap_items_dialog(self):
        if not self.current_lookup_rap_items:
            QtWidgets.QMessageBox.information(
                self, "RAP items", "No RAP items or inventory is private/unknown."
            )
            return

        dlg = QtWidgets.QDialog(self)
        dlg.setWindowTitle("RAP items")
        dlg.resize(500, 400)
        layout = QtWidgets.QVBoxLayout(dlg)
        layout.setContentsMargins(8, 8, 8, 8)
        layout.setSpacing(6)

        lbl = QtWidgets.QLabel("Limited / collectible items used for RAP:")
        layout.addWidget(lbl)

        table = QtWidgets.QTableWidget(0, 3)
        table.setHorizontalHeaderLabels(["Name", "Asset ID", "RAP"])
        table.verticalHeader().setVisible(False)
        table.setSelectionBehavior(QtWidgets.QAbstractItemView.SelectionBehavior.SelectRows)
        table.setAlternatingRowColors(True)
        header = table.horizontalHeader()
        header.setStretchLastSection(True)
        header.resizeSection(0, 250)
        header.resizeSection(1, 100)
        header.resizeSection(2, 100)

        for item in self.current_lookup_rap_items:
            row = table.rowCount()
            table.insertRow(row)
            name_item = QtWidgets.QTableWidgetItem(item.get("name", ""))
            asset_id = str(item.get("assetId") or "")
            rap_val = item.get("rap")
            rap_text = format_number(rap_val) if rap_val is not None else "Unknown"

            table.setItem(row, 0, name_item)
            table.setItem(row, 1, QtWidgets.QTableWidgetItem(asset_id))
            rap_item = QtWidgets.QTableWidgetItem(rap_text)
            rap_item.setTextAlignment(
                QtCore.Qt.AlignmentFlag.AlignRight | QtCore.Qt.AlignmentFlag.AlignVCenter
            )
            table.setItem(row, 2, rap_item)

        layout.addWidget(table, 1)

        btn_close = QtWidgets.QPushButton("Close")
        btn_close.clicked.connect(dlg.accept)
        btn_row = QtWidgets.QHBoxLayout()
        btn_row.addStretch(1)
        btn_row.addWidget(btn_close)
        layout.addLayout(btn_row)

        dlg.exec()

    def _open_lookup_profile(self):
        uid = self.lbl_lookup_id.text()
        if not uid or uid == "-":
            return
        url = ROBLOX_PROFILE_URL.format(user_id=uid)
        webbrowser.open(url)

# ---------- main ----------

def main():
    app = QtWidgets.QApplication(sys.argv)
    win = MainWindow()
    win.show()
    sys.exit(app.exec())

if __name__ == "__main__":
    main()
