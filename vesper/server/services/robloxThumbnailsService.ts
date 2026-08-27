import { thumbnailCache } from '../lib/cache';
import { config } from '../lib/config';
import { robloxRequest } from '../lib/http';

const AVATAR_HEADSHOT =
  'https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds={ids}&size={size}&format=Png&isCircular=false';
const ASSET_THUMB = 'https://thumbnails.roblox.com/v1/assets?assetIds={ids}&size={size}&format=Png&isCircular=false';

interface ThumbResponse {
  data?: { targetId: number; state: string; imageUrl?: string }[];
}

/** Avatar headshot for one or many users. Missing/pending entries map to null. */
export async function getAvatarHeadshots(
  userIds: number[],
  size: '48x48' | '60x60' | '150x150' | '352x352' = '150x150',
  signal?: AbortSignal,
): Promise<Record<number, string | null>> {
  const ids = [...new Set(userIds)].filter((n) => Number.isFinite(n) && n > 0).slice(0, 100);
  const out: Record<number, string | null> = {};
  const missing: number[] = [];

  for (const id of ids) {
    const cached = thumbnailCache.get<string | null>(`av:${id}:${size}`);
    if (cached !== undefined) out[id] = cached;
    else missing.push(id);
  }
  if (!missing.length) return out;

  try {
    const data = await robloxRequest<ThumbResponse>(
      AVATAR_HEADSHOT.replace('{ids}', missing.join(',')).replace('{size}', size),
      { signal, tag: 'thumbnails' },
    );
    for (const id of missing) out[id] = null;
    for (const entry of data?.data ?? []) {
      const url = entry.state === 'Completed' && entry.imageUrl ? entry.imageUrl : null;
      out[entry.targetId] = url;
      thumbnailCache.set(`av:${entry.targetId}:${size}`, url, config.assetCacheTtlMs);
    }
  } catch {
    for (const id of missing) out[id] ??= null;
  }
  return out;
}

export async function getAvatarHeadshot(userId: number, signal?: AbortSignal): Promise<string | null> {
  const map = await getAvatarHeadshots([userId], '150x150', signal);
  return map[userId] ?? null;
}

/**
 * Asset thumbnails, batched.
 * Roblox accepts up to 100 assetIds per call, so callers can request a whole
 * inventory page in one round trip.
 */
export async function getAssetThumbnails(
  assetIds: number[],
  size: '150x150' | '250x250' | '420x420' = '150x150',
  signal?: AbortSignal,
): Promise<Record<number, string | null>> {
  const ids = [...new Set(assetIds)].filter((n) => Number.isFinite(n) && n > 0);
  const out: Record<number, string | null> = {};
  const missing: number[] = [];

  for (const id of ids) {
    const cached = thumbnailCache.get<string | null>(`asset:${id}:${size}`);
    if (cached !== undefined) out[id] = cached;
    else missing.push(id);
  }

  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100);
    for (const id of batch) out[id] = null;
    try {
      const data = await robloxRequest<ThumbResponse>(
        ASSET_THUMB.replace('{ids}', batch.join(',')).replace('{size}', size),
        { signal, tag: 'thumbnails' },
      );
      for (const entry of data?.data ?? []) {
        const url = entry.state === 'Completed' && entry.imageUrl ? entry.imageUrl : null;
        out[entry.targetId] = url;
        thumbnailCache.set(`asset:${entry.targetId}:${size}`, url, config.assetCacheTtlMs);
      }
    } catch {
      /* leave nulls — the UI renders its own fallback with a retry action */
    }
  }
  return out;
}
