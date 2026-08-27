import { config } from './config';
import { log } from './logger';

/** Normalised, safe-to-serialise upstream failure. Never leaks stack traces. */
export class RobloxApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly kind: ErrorKind,
    readonly url: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'RobloxApiError';
  }
}

export type ErrorKind =
  | 'not_found'
  | 'unauthorized'
  | 'forbidden'
  | 'bad_request'
  | 'rate_limited'
  | 'server_error'
  | 'timeout'
  | 'network'
  | 'parse'
  | 'permission';

export function classifyStatus(status: number): ErrorKind {
  if (status === 404) return 'not_found';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rate_limited';
  if (status >= 400 && status < 500) return 'bad_request';
  if (status >= 500) return 'server_error';
  return 'bad_request';
}

/** User-facing copy per error kind. Technical detail stays in the Logs page. */
export const FRIENDLY: Record<ErrorKind, string> = {
  not_found: 'User not found',
  unauthorized: 'This data requires an API key that is not configured',
  forbidden: 'This data is private or unavailable',
  bad_request: 'The request was rejected by the Roblox API',
  rate_limited: 'Roblox API is currently rate limited',
  server_error: 'Roblox API is temporarily unavailable',
  timeout: 'The request timed out',
  network: 'Connection failed',
  parse: 'The Roblox API returned an unreadable response',
  permission: 'API permission failure',
};

/* --------------------------- shared rate limiter --------------------------- */

/**
 * One gate per upstream host, shared by every outbound Roblox request.
 *
 * Why per-host instead of the desktop tool's single shared mutex: the hosts
 * limit independently. A burst of 429s from economy.roblox.com must pause
 * economy traffic only — under a global gate it also stalled users, thumbnails
 * and inventory requests, turning one misbehaving host into an app-wide stall
 * (this was the dominant cause of slow lookups / inventory loads).
 *
 * Each host keeps:
 *  - `nextSlot`      strictly-spaced start times (same trick as before: the
 *                    read-modify-write is atomic because nothing awaits in it)
 *  - `backoffUntil`  exponential pause after 429s, doubling with the streak
 *  - `openUntil`     circuit breaker: after several consecutive 429s the host
 *                    fails fast (no network) until the breaker expires, then a
 *                    single half-open probe decides whether it recovers
 *
 * There is deliberately NO timeout on the spacing wait. Cancellation is the
 * caller's AbortSignal instead.
 */

/** Per-host minimum request spacing; hosts not listed use config.minRequestSpacingMs. */
const HOST_SPACING_OVERRIDES: Record<string, number> = {
  'economy.roblox.com': 300,
  'avatar.roblox.com': 500,
  'apis.roblox.com': 300,
  'inventory.roblox.com': 150,
  'users.roblox.com': 100,
  'thumbnails.roblox.com': 120,
  'accountinformation.roblox.com': 120,
};

/** Consecutive 429s before the circuit for a host opens. */
const BREAKER_THRESHOLD = 3;

class HostGate {
  nextSlot = 0;
  backoffUntil: number | null = null;
  /** Consecutive 429s — drives the exponential curve. Reset by any success. */
  streak = 0;
  /** Consecutive 429s — drives the breaker. Reset by any success. */
  consecutive429 = 0;
  openUntil: number | null = null;
}

class RateGate {
  private hosts = new Map<string, HostGate>();
  hits = 0;
  total = 0;

  private hostOf(url: string): { name: string; g: HostGate } {
    let name: string;
    try {
      name = new URL(url).hostname;
    } catch {
      name = 'unknown';
    }
    let g = this.hosts.get(name);
    if (!g) {
      g = new HostGate();
      this.hosts.set(name, g);
    }
    return { name, g };
  }

  /** True while the circuit for this URL's host is open (fails fast). */
  isOpen(url: string): boolean {
    const { g } = this.hostOf(url);
    if (g.openUntil === null) return false;
    if (Date.now() < g.openUntil) return true;
    // Expired: allow a single half-open probe.
    g.openUntil = null;
    g.consecutive429 = 0;
    return false;
  }

  async acquire(url: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new RobloxApiError('Aborted', null, 'network', '');
    if (this.isOpen(url)) {
      throw new RobloxApiError(FRIENDLY.rate_limited, 429, 'rate_limited', url, 'circuit open');
    }

    const { name, g } = this.hostOf(url);
    const now = Date.now();
    const floor = Math.max(g.nextSlot, g.backoffUntil ?? 0, now);
    g.nextSlot = floor + (HOST_SPACING_OVERRIDES[name] ?? config.minRequestSpacingMs);

    const delay = floor - now;
    if (delay > 0) await sleep(delay, signal);
  }

  /**
   * Exponential backoff, per host.
   *
   * These endpoints burst-limit (a handful of rapid requests can each draw a
   * 429) yet recover within a second or two, so the pause starts small (0.5s)
   * and doubles with each consecutive 429, capping at the configured window;
   * any success resets the streak. After BREAKER_THRESHOLD consecutive 429s
   * the circuit opens and callers fail fast instead of burning retries.
   */
  backoff(url: string): void {
    this.hits++;
    const { name, g } = this.hostOf(url);
    const ms = Math.min(config.backoffMs, 500 * 2 ** g.streak);
    g.streak++;
    g.consecutive429++;
    const until = Date.now() + ms;
    if (g.backoffUntil === null || until > g.backoffUntil) g.backoffUntil = until;

    if (g.consecutive429 >= BREAKER_THRESHOLD) {
      g.openUntil = Date.now() + config.breakerMs;
      log('ratelimit', `Circuit open for ${name} for ${(config.breakerMs / 1000).toFixed(0)}s (${g.consecutive429} consecutive 429s)`, {
        status: 429,
      });
    } else {
      log('ratelimit', `${name}: rate-limit suspected (streak ${g.streak}), backing off for ${(ms / 1000).toFixed(1)}s`, {
        status: 429,
      });
    }
  }

  /** Fixed short pause (e.g. after a 5xx) that does not touch the streak. */
  pause(url: string, ms: number): void {
    const { g } = this.hostOf(url);
    const until = Date.now() + ms;
    if (g.backoffUntil === null || until > g.backoffUntil) g.backoffUntil = until;
  }

  /** A successful upstream response resets the backoff streak for that host. */
  success(url: string): void {
    const { g } = this.hostOf(url);
    g.streak = 0;
    g.consecutive429 = 0;
    if (g.backoffUntil !== null && Date.now() >= g.backoffUntil) g.backoffUntil = null;
  }

  /** Clears expired backoffs so the UI does not report a stale limit. */
  tick(): void {
    const now = Date.now();
    for (const g of this.hosts.values()) {
      if (g.backoffUntil !== null && now >= g.backoffUntil) {
        g.backoffUntil = null;
        g.streak = 0;
      }
    }
  }

  /** Latest pause/expiry across all hosts — what the status surfaces report. */
  get backoffUntil(): number | null {
    let max: number | null = null;
    for (const g of this.hosts.values()) {
      for (const v of [g.backoffUntil, g.openUntil]) {
        if (v !== null && (max === null || v > max)) max = v;
      }
    }
    return max;
  }

  count() {
    this.total++;
  }
}

export const gate = new RateGate();

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(t);
      reject(new RobloxApiError('Aborted', null, 'network', ''));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface RobloxRequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  /** Open Cloud endpoints need the API key; public ones must not send it. */
  auth?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Skip the rate gate for cheap local-only calls. Defaults to false. */
  skipGate?: boolean;
  /** Label used in logs */
  tag?: string;
  /** Override the retry budget (cheap probes use fewer retries). */
  maxRetries?: number;
}

/**
 * The only place in the codebase that talks to Roblox.
 * Handles timeout, retries with jittered exponential backoff, rate-limit
 * detection and error classification.
 */
export async function robloxRequest<T>(url: string, opts: RobloxRequestOptions = {}): Promise<T> {
  const {
    method = 'GET',
    body,
    auth = false,
    signal,
    timeoutMs = config.requestTimeoutMs,
    tag = 'api',
    maxRetries = config.maxRetries,
  } = opts;

  if (auth && !config.robloxApiKey) {
    throw new RobloxApiError(FRIENDLY.unauthorized, 401, 'unauthorized', url);
  }

  let attempt = 0;
  for (;;) {
    if (!opts.skipGate) await gate.acquire(url, signal);
    gate.count();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const headers: Record<string, string> = {
        'User-Agent': config.userAgent,
        Accept: 'application/json',
      };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (auth) headers['x-api-key'] = config.robloxApiKey;

      const started = Date.now();
      const res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const latency = Date.now() - started;

      if (res.status === 429) {
        gate.backoff(url); // exponential per host, escalates with the streak
        log('ratelimit', `${tag} ${method} ${safeUrl(url)} -> 429`, { status: 429, detail: `latency=${latency}ms` });
        if (attempt++ < maxRetries) continue;
        throw new RobloxApiError(FRIENDLY.rate_limited, 429, 'rate_limited', url);
      }

      if (res.status >= 500) {
        // A transient upstream 5xx is not the same signal as a 429: pause briefly
        // without escalating the rate-limit streak.
        gate.pause(url, 3000);
        log('api', `${tag} ${method} ${safeUrl(url)} -> ${res.status}`, { status: res.status });
        if (attempt++ < maxRetries) continue;
        throw new RobloxApiError(FRIENDLY.server_error, res.status, 'server_error', url);
      }

      if (res.status >= 400) {
        const kind = classifyStatus(res.status);
        const text = await safeText(res);
        log('api', `${tag} ${method} ${safeUrl(url)} -> ${res.status}`, { status: res.status, detail: text.slice(0, 300) });
        throw new RobloxApiError(FRIENDLY[kind], res.status, kind, url, text.slice(0, 300));
      }

      gate.success(url);
      const text = await res.text();
      try {
        return (text ? JSON.parse(text) : {}) as T;
      } catch {
        throw new RobloxApiError(FRIENDLY.parse, res.status, 'parse', url);
      }
    } catch (err) {
      if (err instanceof RobloxApiError) throw err;
      const e = err as Error;
      if (signal?.aborted) throw new RobloxApiError('Aborted', null, 'network', url);
      if (e.name === 'AbortError') {
        if (attempt++ < maxRetries) continue;
        throw new RobloxApiError(FRIENDLY.timeout, null, 'timeout', url);
      }
      if (attempt++ < maxRetries) continue;
      log('error', `${tag} ${method} ${safeUrl(url)} failed: ${e.message}`, { detail: e.stack?.split('\n')[0] });
      throw new RobloxApiError(FRIENDLY.network, null, 'network', url, e.message);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function safeUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname + u.pathname;
  } catch {
    return url;
  }
}

/** True when an error means "the data exists but we may not see it". */
export function isPrivateOrForbidden(err: unknown): boolean {
  return err instanceof RobloxApiError && (err.kind === 'forbidden' || err.kind === 'unauthorized');
}
