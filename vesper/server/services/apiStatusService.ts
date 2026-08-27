import type { ApiHealth, ApiStatus } from '../../shared/types';
import { config } from '../lib/config';
import { gate, robloxRequest } from '../lib/http';
import { log } from '../lib/logger';

interface Probe {
  name: string;
  url?: string;
  auth?: boolean;
}

const OPEN_CLOUD_PROBE = 'https://apis.roblox.com/cloud/v2/users/1/inventory-items?maxPageSize=10';

const PROBES: Probe[] = [
  { name: 'users.roblox.com', url: 'https://users.roblox.com/v1/users/1' },
  {
    name: 'thumbnails.roblox.com',
    url: 'https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=1&size=48x48&format=Png&isCircular=false',
  },
  { name: 'accountinformation.roblox.com', url: 'https://accountinformation.roblox.com/v1/users/1/roblox-badges' },
  { name: 'inventory.roblox.com', url: 'https://inventory.roblox.com/v1/users/1/assets/collectibles?limit=10' },
  { name: 'economy.roblox.com', url: 'https://economy.roblox.com/v2/assets/1082932/details' },
];

/**
 * Liveness snapshot for the header indicator.
 *
 * `health` degrades rather than flipping to offline on a single failure:
 *   - every probe ok            -> connected
 *   - upstream returned 429     -> ratelimited
 *   - some probes failing       -> degraded
 *   - every probe failing       -> offline
 */
export async function getApiStatus(): Promise<ApiStatus> {
  gate.tick();

  interface ProbeResult {
    name: string;
    ok: boolean;
    status: number | null;
    latencyMs: number;
  }

  const results: ProbeResult[] = [];
  let okCount = 0;
  let rateLimited = false;

  const probe = async (name: string, url: string, auth = false): Promise<ProbeResult> => {
    const started = Date.now();
    try {
      await robloxRequest<unknown>(url, { auth, tag: 'status', skipGate: true, timeoutMs: 6000 });
      return { name, ok: true, status: 200, latencyMs: Date.now() - started };
    } catch (err) {
      const e = err as { status?: number | null; kind?: string };
      if (e?.kind === 'rate_limited') rateLimited = true;
      return { name, ok: false, status: e?.status ?? null, latencyMs: Date.now() - started };
    }
  };

  const batch: Promise<ProbeResult>[] = PROBES.filter((p) => p.url).map((p) => probe(p.name, p.url as string));

  // The Open Cloud inventory endpoint is only probed when a key exists.
  if (config.robloxApiKey) {
    batch.push(probe('apis.roblox.com (Open Cloud)', OPEN_CLOUD_PROBE, true));
  }

  results.push(...(await Promise.all(batch)));

  const endpoints: ApiStatus['endpoints'] = [];
  for (const r of results) {
    if (r.ok) okCount++;
    endpoints.push({ name: r.name, ok: r.ok, status: r.status, latencyMs: r.latencyMs });
  }

  const total = results.length;
  const latencies = results.filter((r) => r.ok).map((r) => r.latencyMs);
  const latencyMs = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;

  let health: ApiHealth;
  if (okCount === 0) health = 'offline';
  else if (rateLimited || gate.backoffUntil !== null) health = 'ratelimited';
  else if (okCount < total) health = 'degraded';
  else health = 'connected';

  const status: ApiStatus = {
    health,
    checkedAt: Date.now(),
    latencyMs,
    openCloudConfigured: config.robloxApiKey.length > 0,
    endpoints,
    rateLimitHits: gate.hits,
    backoffUntil: gate.backoffUntil,
  };

  log('api', `API status probe: ${health} (${okCount}/${total} endpoints reachable, avg ${latencyMs ?? '-'}ms)`);
  return status;
}
