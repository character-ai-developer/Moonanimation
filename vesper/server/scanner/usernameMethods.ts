import type { SearchMethod } from '../../shared/types';
import firstNameTokensRaw from './first_name_tokens.json' with { type: 'json' };
import yearRangesRaw from './year_id_ranges.json' with { type: 'json' };

/**
 * Port of the desktop tool's username heuristics.
 *
 * Behaviour is matched line-for-line against `username_matches_method` in
 * pg (2).py, including the coverage algorithm used by `real_name`. One source
 * discrepancy is corrected here and documented in README.md: the `year` method
 * accepts 1970-2017 but its rejection message claimed 1980-2025. The numeric
 * range is preserved exactly; only the message text was made accurate.
 */

export const FIRST_NAME_TOKENS: Set<string> = new Set(firstNameTokensRaw as string[]);

export const YEAR_ID_RANGES: Record<string, [number, number]> = Object.fromEntries(
  (yearRangesRaw as [string, number, number][]).map(([label, lo, hi]) => [label, [lo, hi] as [number, number]]),
);

export const YEAR_OPTIONS: string[] = (yearRangesRaw as [string, number, number][]).map(([label]) => label);

export const RAP_PRESETS: Record<string, number | null> = {
  Off: null,
  '100+': 100,
  '500+': 500,
  '1k+': 1_000,
  '2.5k+': 2_500,
  '5k+': 5_000,
  '10k+': 10_000,
};

export const HAT_PRESETS: Record<string, number | null> = {
  Off: null,
  '1+': 1,
  '2+': 2,
  '5+': 5,
  '10+': 10,
};

export function countTrailingDigits(s: string): number {
  let c = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i] >= '0' && s[i] <= '9') c++;
    else break;
  }
  return c;
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

/** Python's str.isalpha() is unicode-aware; mirror that. */
function isAlpha(s: string): boolean {
  return s.length > 0 && /^\p{L}+$/u.test(s);
}

function endsInExactNDigits(uname: string, n: number): boolean {
  if (uname.length < n) return false;
  const tail = uname.slice(-n);
  if (![...tail].every(isDigit)) return false;
  if (uname.length > n && isDigit(uname[uname.length - n - 1])) return false;
  return true;
}

export interface MethodMatch {
  matches: boolean;
  reason: string;
}

export function usernameMatchesMethod(username: string, method: SearchMethod | string): MethodMatch {
  const uname = username;
  const lower = uname.toLowerCase();

  if (method === 'random') return { matches: true, reason: 'method=random (no filtering)' };

  if (method === 'numberless') {
    if (![...uname].some(isDigit)) return { matches: true, reason: 'no digits in username' };
    return { matches: false, reason: 'contains digits while method=numberless' };
  }

  if (method === 'numbers') {
    if ([...uname].some(isDigit)) return { matches: true, reason: 'contains at least one digit' };
    return { matches: false, reason: 'has no digits while method=numbers' };
  }

  if (method === 'ends_in_123') {
    if (uname.endsWith('123')) return { matches: true, reason: "username ends with '123'" };
    return { matches: false, reason: "does not end with '123'" };
  }

  if (method === 'ends_in_1_digit') {
    return endsInExactNDigits(uname, 1)
      ? { matches: true, reason: 'ends in exactly 1 digit' }
      : { matches: false, reason: 'does not end in exactly 1 digit' };
  }

  if (method === 'ends_in_2_digits') {
    return endsInExactNDigits(uname, 2)
      ? { matches: true, reason: 'ends in exactly 2 digits' }
      : { matches: false, reason: 'does not end in exactly 2 digits' };
  }

  if (method === 'ends_in_4_digits') {
    return endsInExactNDigits(uname, 4)
      ? { matches: true, reason: 'ends in exactly 4 digits' }
      : { matches: false, reason: 'does not end in exactly 4 digits' };
  }

  if (method === '4digits_real_name') {
    const trailing = countTrailingDigits(lower);
    if (trailing !== 4) {
      return { matches: false, reason: `has ${trailing} trailing digits (need exactly 4) for 4digits_real_name` };
    }
    const namePart = lower.slice(0, -4);
    if (!isAlpha(namePart)) return { matches: false, reason: 'name part contains non-letter characters' };
    if (!FIRST_NAME_TOKENS.has(namePart)) {
      return { matches: false, reason: `'${namePart}' is not a real name token` };
    }
    return { matches: true, reason: `real name '${namePart}' + 4 digits` };
  }

  if (method === 'year') {
    if (uname.length < 4 || ![...uname.slice(-4)].every(isDigit)) {
      return { matches: false, reason: 'does not end with 4 digits' };
    }
    if (uname.length > 4 && isDigit(uname[uname.length - 5])) {
      return { matches: false, reason: 'ends with more than 4 digits' };
    }
    const year = Number.parseInt(uname.slice(-4), 10);
    if (year >= 1970 && year <= 2017) return { matches: true, reason: `ends with valid year ${year}` };
    return { matches: false, reason: `ends with year ${year} outside 1970-2017` };
  }

  if (method === 'double') {
    if (!uname || !isDigit(uname[uname.length - 1])) {
      return { matches: false, reason: 'username must end with digits' };
    }
    const digitsLen = countTrailingDigits(uname);
    if (digitsLen < 1) return { matches: false, reason: 'username must end with digits' };
    const core = uname.slice(0, uname.length - digitsLen);

    const letterRepeat = /([A-Za-z]{3,})\1/.exec(core);
    if (letterRepeat) {
      return { matches: true, reason: `contains repeated word '${letterRepeat[1]}' and ends with digits` };
    }
    const digitRepeat = /(\d{2})\1/.exec(core);
    if (digitRepeat) {
      return { matches: true, reason: `contains repeated 2-digit number '${digitRepeat[1]}' and ends with digits` };
    }
    return { matches: false, reason: 'no repeated 2-digit or 3+ letter chunk found before ending digits' };
  }

  if (method === 'double_real_name') {
    let i = lower.length;
    while (i > 0 && isDigit(lower[i - 1])) i--;
    const base = lower.slice(0, i);
    const lettersOnly = [...base].filter((ch) => /^\p{L}$/u.test(ch)).join('');
    if (!lettersOnly) return { matches: false, reason: 'no letters in username for double_real_name' };

    for (const name of FIRST_NAME_TOKENS) {
      if (lettersOnly === name + name) return { matches: true, reason: `doubled real name '${name}'` };
    }
    return { matches: false, reason: 'not a doubled real name' };
  }

  if (method === 'real_name') {
    let endingType: string;
    if (lower.endsWith('123')) {
      endingType = '123';
    } else {
      const trailing = countTrailingDigits(lower);
      if (trailing < 2 || trailing > 4) {
        return {
          matches: false,
          reason: `has ${trailing} trailing digits at end (need 2-4 digits or '123') for real_name`,
        };
      }
      endingType = `${trailing}_digits`;
    }

    const lettersOnly = [...lower].filter((ch) => /^\p{L}$/u.test(ch)).join('');
    if (!lettersOnly) return { matches: false, reason: 'no letters in username for real_name' };

    const allHits: { name: string; start: number; end: number }[] = [];
    for (const name of FIRST_NAME_TOKENS) {
      let start = 0;
      for (;;) {
        const idx = lettersOnly.indexOf(name, start);
        if (idx === -1) break;
        allHits.push({ name, start: idx, end: idx + name.length });
        start = idx + 1;
      }
    }
    if (!allHits.length) return { matches: false, reason: 'no real-name token found for real_name' };

    // Longest tokens first, greedy coverage — identical to the Python sort.
    allHits.sort((a, b) => b.end - b.start - (a.end - a.start));
    const n = lettersOnly.length;
    const covered = new Array<boolean>(n).fill(false);
    const contributing = new Set<string>();

    for (const hit of allHits) {
      let newCov = false;
      for (let k = hit.start; k < hit.end && k < n; k++) {
        if (!covered[k]) newCov = true;
      }
      if (!newCov) continue;
      for (let k = hit.start; k < Math.min(hit.end, n); k++) covered[k] = true;
      contributing.add(hit.name);
    }

    if (!contributing.size) {
      return { matches: false, reason: 'no real-name token contributed coverage for real_name' };
    }

    let extraLetters = 0;
    for (let k = 0; k < n; k++) if (!covered[k]) extraLetters++;

    const tokensLabel = [...contributing].sort();
    if (extraLetters < 1) {
      return {
        matches: false,
        reason: `letters-only='${lettersOnly}', tokens=[${tokensLabel.join(', ')}], extra_letters=${extraLetters} (<1), ending=${endingType}`,
      };
    }
    return {
      matches: true,
      reason: `letters-only='${lettersOnly}', tokens=[${tokensLabel.join(', ')}], extra_letters=${extraLetters} (>=1), ending=${endingType}`,
    };
  }

  if (method === 'nonstop') {
    return { matches: true, reason: 'nonstop scanning (inactive only, output to files)' };
  }

  return { matches: true, reason: 'fallback: unknown method, treated as match' };
}

/** Nonstop output classification — decides which .txt bucket a username lands in. */
export function classifyNonstopOutput(username: string): string | null {
  if (usernameMatchesMethod(username, 'real_name').matches) return 'real_name.txt';
  if (usernameMatchesMethod(username, 'double').matches) return 'double.txt';
  for (const n of [4, 3, 2, 1]) {
    if (endsInExactNDigits(username, n)) return `ends_in_${n}_digit.txt`;
  }
  if (![...username].some(isDigit)) return 'numberless.txt';
  return null;
}
