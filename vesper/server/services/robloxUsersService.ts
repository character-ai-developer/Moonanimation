import type { User } from '../../shared/types';
import { profileCache, usernameCache } from '../lib/cache';
import { config } from '../lib/config';
import { RobloxApiError } from '../lib/http';
import { robloxRequest } from '../lib/http';
import { log } from '../lib/logger';

const USER_API = 'https://users.roblox.com/v1/users/{id}';
const USERNAME_API = 'https://users.roblox.com/v1/usernames/users';
const AVATAR_API = 'https://avatar.roblox.com/v1/users/{id}/avatar';

interface RawUser {
  id?: number;
  name?: string;
  displayName?: string;
  created?: string;
  description?: string;
  isBanned?: boolean;
}

export interface RobloxUserResult {
  user: User | null;
  status: number | null;
  error: RobloxApiError | null;
}

/** GET /v1/users/:id — the desktop tool treated 429 and 5xx as "back off and skip". */
export async function getUserById(userId: number, signal?: AbortSignal): Promise<RobloxUserResult> {
  const cacheKey = `user:${userId}`;
  const cached = profileCache.get<User>(cacheKey);
  if (cached) return { user: cached, status: 200, error: null };

  try {
    const data = await robloxRequest<RawUser>(USER_API.replace('{id}', String(userId)), {
      signal,
      tag: 'users',
    });
    if (!data || typeof data.id !== 'number') {
      return { user: null, status: 404, error: new RobloxApiError('User not found', 404, 'not_found', '') };
    }
    const user: User = {
      id: data.id,
      name: data.name ?? '',
      displayName: data.displayName ?? '',
      created: data.created ?? null,
      description: typeof data.description === 'string' ? data.description : '',
      isBanned: Boolean(data.isBanned),
    };
    profileCache.set(cacheKey, user);
    usernameCache.set(`uname:${user.name.toLowerCase()}`, user.id, config.assetCacheTtlMs);
    return { user, status: 200, error: null };
  } catch (err) {
    const e = err instanceof RobloxApiError ? err : new RobloxApiError('Connection failed', null, 'network', '');
    return { user: null, status: e.status, error: e };
  }
}

/** POST /v1/usernames/users — resolves a username to an ID. */
export async function getUserIdByUsername(username: string, signal?: AbortSignal): Promise<number | null> {
  const cacheKey = `uname:${username.toLowerCase()}`;
  const cached = usernameCache.get<number>(cacheKey);
  if (cached) return cached;

  const data = await robloxRequest<{ data?: { id?: number; name?: string }[] }>(USERNAME_API, {
    method: 'POST',
    body: { usernames: [username], excludeBannedUsers: false },
    signal,
    tag: 'users',
  });

  const entry = data?.data?.[0];
  const id = entry?.id;
  if (typeof id !== 'number') return null;
  usernameCache.set(cacheKey, id, config.assetCacheTtlMs);
  return id;
}

/** avatar.roblox.com rig lookup. null means "could not determine". */
export async function getRigType(userId: number, signal?: AbortSignal): Promise<'R6' | 'R15' | null> {
  const cacheKey = `rig:${userId}`;
  const cached = profileCache.get<'R6' | 'R15' | null>(cacheKey);
  if (cached !== undefined) return cached;

  try {
    // avatar.roblox.com burst-limits hard from some networks; one retry only —
    // the per-host circuit breaker then fails it fast and the profile simply
    // reports the rig as Unavailable instead of stalling the whole lookup.
    const data = await robloxRequest<{ playerAvatarType?: string; rigType?: string }>(
      AVATAR_API.replace('{id}', String(userId)),
      { signal, tag: 'avatar', maxRetries: 1 },
    );
    const raw = (data?.playerAvatarType ?? data?.rigType ?? '').toString().trim().toUpperCase();
    const rig: 'R6' | 'R15' | null = raw === 'R15' ? 'R15' : raw === 'R6' ? 'R6' : null;
    profileCache.set(cacheKey, rig);
    return rig;
  } catch {
    // Short negative cache: do not re-hammer a limited host on every lookup.
    profileCache.set(cacheKey, null, 60_000);
    return null;
  }
}

/** Lightweight reachability probe used by the API status indicator. */
export async function probeUsersApi(): Promise<{ ok: boolean; status: number | null; latencyMs: number }> {
  const started = Date.now();
  try {
    const data = await robloxRequest<RawUser>(USER_API.replace('{id}', '1'), { tag: 'probe', skipGate: true });
    return { ok: typeof data?.id === 'number', status: 200, latencyMs: Date.now() - started };
  } catch (err) {
    const e = err instanceof RobloxApiError ? err : null;
    log('api', 'users.roblox.com probe failed', { status: e?.status ?? null, detail: e?.message });
    return { ok: false, status: e?.status ?? null, latencyMs: Date.now() - started };
  }
}
