# Vesper — Roblox Account Intelligence

A modern web rebuild of the desktop tool `pg (2).py` ("rFinder"). Same behaviour,
new identity: a claymorphism dashboard over an animated pixel-art backdrop, with a
proper backend proxy, a real collectible-inventory inspector, and streaming scan
progress.

Everything here reads **public** Roblox data through a server-side proxy. There is
no login, no cookies, no credential handling anywhere in the codebase.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

`npm run dev` starts Vite **and** mounts the Express API into the same process and
port, so the browser only ever uses relative `/api` URLs. No CORS setup, and the
same Express app runs standalone for production:

```bash
npm run build        # typecheck + production bundle into dist/
npm run server       # production: serves the API *and* the built UI, one process (PORT, default 8787)
npm test             # differential tests against the original Python
npm run typecheck    # both tsconfigs
```

Copy `.env.example` to `.env` to tune anything. Everything has a working default.

---

## Hosting it free, forever

Every permanent free host needs a (free) account — there is no anonymous
permanent hosting, and free `.com` domains do not exist. The best free
combination for a short, permanent link is:

- **Host: [Render](https://render.com) free plan** — runs the full Node app
  (the scanner needs a real process, not serverless). The repo ships a
  `render.yaml` blueprint, so the service link becomes
  **`https://vesper.onrender.com`**.
- **Shorter alias (optional): [is-a.dev](https://is-a.dev)** — free forever
  developer subdomain, e.g. **`vesper.is-a.dev`**, pointed at the Render URL.

### Steps (≈5 minutes)

1. Create a free GitHub account → new **public** repo named `vesper`
   → upload this folder (GitHub's web UI accepts drag-and-drop).
2. Create a free Render account (sign in with GitHub) →
   **New → Blueprint** → pick the repo → Render reads `render.yaml` →
   **Apply**. First build takes ~2 minutes; the app is then live at
   `https://vesper.onrender.com` (set the service name to `vesper` if free).
3. Optional short link: fork <https://github.com/is-a-dev/register>, add
   `domains/vesper.json` with a CNAME to `vesper.onrender.com`, open the PR.
   When merged, `https://vesper.is-a.dev` is yours forever.

Free-plan note: Render sleeps the service after ~15 idle minutes; the first
request after a sleep takes ~30–50s to wake. It stays deployed forever.

Prefer zero clicks? Paste a GitHub personal-access token + a Render API key
into your agent session and it can push the repo and create the service for
you.

---

## Roblox API credentials

**Optional.** Create a key at <https://create.roblox.com/dashboard/credentials> with
the *Inventory read* scope, then set it:

```bash
ROBLOX_API_KEY=your_key_here
```

| Configured | Inventory source |
|---|---|
| **Yes** | `GET apis.roblox.com/cloud/v2/users/{id}/inventory-items` — the documented Open Cloud endpoint, paginated with `pageToken` / `nextPageToken`, filtered with `onlyCollectibles=true;inventoryItemAssetTypes=*`. RAP and serial numbers are overlaid from the legacy endpoint. |
| **No** | `GET inventory.roblox.com/v1/users/{id}/assets/collectibles` — the public endpoint the desktop tool used, paginated with `cursor` / `nextPageCursor`. It is also the only unauthenticated source of RAP, serials, original price and stock. |

The key is read **only** in `server/lib/config.ts`, sent only as an `x-api-key`
header, and deliberately excluded from `GET /api/settings`. It never reaches the
browser bundle.

Without a key the app is fully functional — you lose nothing except the wider
(non-collectible) inventory listing.

---

## Architecture

```
React (Vite, TypeScript)  ──relative /api──▶  Express  ──▶  Roblox APIs
      src/                                    server/
```

No component calls `fetch` or a Roblox URL directly. Everything goes through
`src/lib/api.ts`, which is the only client.

**Backend services** (one concern each, nothing scattered):

| Module | Responsibility |
|---|---|
| `robloxUsersService` | profile by ID, username→ID, rig type |
| `robloxInventoryService` | collectibles (both transports), hat count, verified-badge ownership, RAP aggregation, pagination, enrichment, statistics |
| `robloxBadgesService` | account badges + icon resolution |
| `robloxThumbnailsService` | avatar headshots and asset thumbnails, batched to 100 per call |
| `robloxAssetsService` | catalog metadata (creator, asset type, limited flags, resale price) |
| `accountEvaluation` | the activity heuristic and full profile assembly |
| `apiStatusService` | endpoint health for the header indicator |
| `savedService` | persisted categories, accounts, notes, import/export |

**Cross-cutting:** `lib/http.ts` (the only code that talks to Roblox — timeout,
retry, rate-limit detection, error classification), `lib/cache.ts` (bounded TTL/LRU,
Redis-swappable behind `CacheLike`), `lib/logger.ts` (ring buffer + SSE),
`lib/validate.ts` (every input sanitised before use).

---

## What was preserved from the original

The port is faithful rather than approximate. `server/scanner/first_name_tokens.json`
(562 tokens) and `year_id_ranges.json` (21 buckets) were **extracted programmatically**
from `pg (2).py`, not retyped.

Preserved: all 13 username methods and their exact matching rules, all 15 sort modes,
RAP/hat presets, username-length bounds, verified/banned/active filters, badge
requirements, the saved-ID skip set, category create/rename/delete, notes,
nonstop classification into `real_name.txt` / `double.txt` / `ends_in_N_digit.txt` /
`numberless.txt`, shared rate-limit backoff, and the `rfinder_saved.json` on-disk
shape (an existing file imports unchanged).

`npm test` proves the port rather than asserting it: it runs the **original Python
functions** over a 261-name corpus and compares all **3,393 verdicts** plus the 261
nonstop classifications against the TypeScript. Zero mismatches.

### Deliberate, documented deviations

1. **`year` method range message.** The source accepts 1970–2017 but its rejection
   text claimed "outside 1980–2025". The numeric range is preserved exactly; only the
   message was corrected to match the code.
2. **2022/2023 ID overlap.** In `pg (2).py` the 2022 bucket ends at `4195844718` while
   2023 begins at `4195844712` — 7 IDs belong to both years. Reproduced verbatim and
   pinned by a test so any change is intentional.
3. **Scan attempt ceiling.** The desktop tool allowed 500,000 attempts (effectively
   unbounded for nonstop). Defaults are now `SCAN_MAX_ATTEMPTS=20000` and
   `SCAN_MAX_RESULTS=2000`. See the note on scanning below.
4. **Rate-limit backoff.** The source paused *every* worker for a flat 30s window
   on any 429. The web app rate-limits **per host** instead: a pause starts at
   0.5s and doubles per consecutive 429 from that host (capped by
   `ROBLOX_BACKOFF_MS`), any success resets it, and a host that keeps 429-ing
   trips a circuit breaker and fails fast. One misbehaving host can no longer
   stall lookups, inventory loads or scans. A transient 5xx pauses 3s without
   escalating the streak.
5. **Badge filtering.** The source discarded any badge outside its 12-icon map. Every
   badge the API returns is now kept; unmapped ones get a generated SVG mark.
6. **`verified` / `plaid hat`.** The source called the *same* endpoint (asset
   `102611803`) for both signals. They are one request, done once.

---

## Scanning, and why it is capped

The Account Finder enumerates random user IDs to find accounts matching a pattern.
That is inherently load-generating against someone else's infrastructure and is
**against Roblox's Terms of Service**. It is included because it is the source
application's core function, but the defaults are deliberately conservative: bounded
attempts, bounded results, capped concurrency, enforced per-host minimum spacing,
and per-host rate gates with a circuit breaker that pause only traffic to the
host that is actually limiting.

Treat it as a demonstration of the ported logic. If you run it, keep the volume low.

The `active` field is a **heuristic** inferred from public signals (verified-badge
ownership, distinct display name, old-account-with-private-inventory, R6 vs R15 rig).
It is not a fact reported by Roblox, and the UI labels it as such and lists the exact
reasons. The source's quirk where an undecided verdict defaults to `"No"` in the
scanner but `"Yes"` in lookup is preserved as a `defaultActive` parameter.

---

## Inventory: never a fabricated zero

`summary.status` distinguishes a readable inventory from an unreadable one:

- `ok` — real data; totals are summed only from items the API actually returned
- `private` — 401/403; the UI shows **"Inventory Private / Unavailable"**
- `unavailable` / `error` — rate limited or failed

When the status is not `ok`, `itemCount` and `totalRap` are `null` and the UI refuses
to render `0`. Any field that could not be read renders **Unavailable**. Cursor
pagination is real: Open Cloud uses `pageToken`/`nextPageToken` (and follows the
documented rule that a non-empty token with an empty array is *not* the end), legacy
uses `cursor`/`nextPageCursor`. Pages stream in via infinite scroll.

---

## API surface

```
GET    /api/health
GET    /api/status                       endpoint health for the header
GET    /api/settings                     config (secrets excluded) + cache + rate-limit
POST   /api/settings/test                connection test
POST   /api/settings/cache/clear
POST   /api/settings/mock                dev-only mock toggle

GET    /api/users/:username              full profile by name
GET    /api/users/id/:id                 full profile by ID
GET    /api/users/resolve/:username      username -> id
GET    /api/users/:id/avatar
GET    /api/users/:id/badges
POST   /api/users/avatars                batch headshots
GET    /api/users/meta/badges            badge filter options

GET    /api/users/:id/inventory?cursor&limit
GET    /api/users/:id/collectibles       alias of the above
GET    /api/users/:id/verified
GET    /api/assets/:id
GET    /api/thumbnails/assets?assetIds=&size=

GET    /api/search/meta
POST   /api/search/start                 -> jobId
POST   /api/search/stop
GET    /api/search/:jobId?sort=
GET    /api/search/:jobId/stream         SSE progress
GET    /api/search/:jobId/nonstop        classified buckets
GET    /api/search/:jobId/nonstop/:file  one bucket as .txt

GET    /api/saved
GET    /api/saved/export
POST   /api/saved/import                 validated merge|replace
GET    /api/saved/category/:name
POST   /api/saved/category
PUT    /api/saved/category/:name
DELETE /api/saved/category/:name
POST   /api/saved/:category/accounts
PUT    /api/saved/:category/accounts/:id
PUT    /api/saved/:category/accounts/:id/note
DELETE /api/saved/:category/accounts/:id

GET    /api/logs?types=&search=&limit=
GET    /api/logs/stream                  SSE tail
GET    /api/logs/export?format=txt|json
DELETE /api/logs
```

Errors are always `{ ok: false, error: "..." }` with a user-facing message. Stack
traces and upstream response bodies stay in the server console log, never to the client.

---

## Security

Per-IP token-bucket throttling on `/api`; server-side validation and sanitisation of
every input; request timeouts; retries with backoff; CORS allowlist via
`CORS_ORIGINS`; conservative security headers; no stack traces in responses; import
JSON validated field-by-field and anything non-conforming skipped rather than
trusted; no secrets, cookies, passwords or credentials anywhere. This is a lookup
tool — there is no login page and nothing that could harvest one.

---

## Accessibility & motion

Keyboard operable, visible focus rings, ARIA labels and roles on the nav, tabs,
modals, drawers, progress bar and live regions. Status is never conveyed by colour
alone — every pill pairs a colour with an icon and a text label.

`prefers-reduced-motion` is honoured automatically and can be overridden in Settings.
With reduced motion the pixel background draws a single static frame and starts no
animation loop.

---

## Layout

```
server/          Express app, services, scanner, routes
  lib/           http (rate gate), cache, config, logger, validate
  services/      roblox* + accountEvaluation + apiStatus + saved
  scanner/       usernameMethods, scanJob, extracted JSON data
  app.ts         Express factory (used by dev and prod)
  vitePlugin.ts  mounts app.ts into the Vite dev server
  standalone.ts  production entry point
shared/types.ts  the wire format, shared by both sides
src/
  components/    clay primitives, AppShell, Inventory, ProfileView
  pages/         Dashboard, Finder, Lookup, Saved, Settings
  lib/           api client, formatting, preferences, export
tests/           differential tests against the original Python
data/            saved.json (created at runtime)
```

Branding, UI, illustration and iconography are original. Icons are Lucide. No Roblox
logos are used as this app's identity.
