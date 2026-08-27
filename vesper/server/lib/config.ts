import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function str(name: string, fallback = ''): string {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? fallback : raw.trim();
}

/**
 * Everything tunable about the app lives here.
 * The API key is only ever read on the server — it is never serialised into a
 * response body, and `publicSettings()` deliberately omits it.
 */
export const config = {
  port: int('PORT', 8787),
  host: str('HOST', '0.0.0.0'),

  /** Open Cloud API key. Optional: without it the legacy public endpoints are used. */
  robloxApiKey: str('ROBLOX_API_KEY'),

  /** Comma separated origins allowed to call /api. "*" keeps dev frictionless. */
  corsOrigins: str('CORS_ORIGINS', '*'),

  requestTimeoutMs: int('ROBLOX_TIMEOUT_MS', 8000),
  maxConcurrency: int('ROBLOX_MAX_CONCURRENCY', 4),
  // Default spacing between requests to the SAME host (per-host overrides live
  // in lib/http). 150ms measured clean on users/thumbnails/accountinformation/
  // inventory; sensitive hosts get their own override.
  minRequestSpacingMs: int('ROBLOX_MIN_SPACING_MS', 150),
  // Cap for the exponential 429 backoff; the base is 500ms and doubles per
  // consecutive 429 from that host.
  backoffMs: int('ROBLOX_BACKOFF_MS', 30000),
  /** How long a host that keeps 429-ing fails fast (circuit breaker). */
  breakerMs: int('ROBLOX_BREAKER_MS', 20000),
  maxRetries: int('ROBLOX_MAX_RETRIES', 2),
  /** Assembled-profile cache — repeat lookups answer from memory. */
  profileCacheTtlMs: int('PROFILE_CACHE_TTL_MS', 2 * 60 * 1000),

  /** Hard ceiling on attempts per scan job — the desktop tool used 500k / unbounded. */
  maxScanAttempts: int('SCAN_MAX_ATTEMPTS', 20000),
  maxScanResults: int('SCAN_MAX_RESULTS', 2000),

  cacheTtlMs: int('CACHE_TTL_MS', 5 * 60 * 1000),
  assetCacheTtlMs: int('ASSET_CACHE_TTL_MS', 60 * 60 * 1000),

  redisUrl: str('REDIS_URL'),

  /** Persisted saved-accounts file, mirroring the desktop tool's rfinder_saved.json */
  savedFile: str('SAVED_FILE', path.resolve(__dirname, '../../data/saved.json')),

  /** Dev-only fabricated data. Off unless explicitly enabled. */
  mockMode: bool('VESPER_MOCK_MODE', false),

  userAgent: str(
    'ROBLOX_USER_AGENT',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
  ),
} as const;

export const isMockMode = () => config.mockMode;

/** Shape returned by GET /api/settings — must never contain secrets. */
export function publicSettings() {
  return {
    openCloudConfigured: config.robloxApiKey.length > 0,
    corsOrigins: config.corsOrigins,
    requestTimeoutMs: config.requestTimeoutMs,
    maxConcurrency: config.maxConcurrency,
    minRequestSpacingMs: config.minRequestSpacingMs,
    backoffMs: config.backoffMs,
    breakerMs: config.breakerMs,
    profileCacheTtlMs: config.profileCacheTtlMs,
    maxScanAttempts: config.maxScanAttempts,
    maxScanResults: config.maxScanResults,
    cacheTtlMs: config.cacheTtlMs,
    assetCacheTtlMs: config.assetCacheTtlMs,
    redisConfigured: config.redisUrl.length > 0,
    mockMode: config.mockMode,
  };
}
