import type { RobloxBadge } from '../../shared/types';
import { badgeCache } from '../lib/cache';
import { config } from '../lib/config';
import { robloxRequest } from '../lib/http';
import { log } from '../lib/logger';

const ACCOUNT_BADGES_API = 'https://accountinformation.roblox.com/v1/users/{id}/roblox-badges';

/**
 * Icon map carried over from the desktop tool. Roblox exposes no public icon
 * endpoint for *account* badges (the badges.roblox.com namespace is for
 * experience badges), so these CDN URLs remain the only stable source.
 * Any badge not listed here renders a generated SVG mark instead of nothing.
 */
export const BADGE_ICON_URLS: Record<string, string> = {
  'Combat Initiation': 'https://images.rbxcdn.com/8d77254fc1e6d904fd3ded29dfca28cb.png',
  Warrior: 'https://images.rbxcdn.com/0a010c31a8b482731114810590553be3.png',
  Bloxxer: 'https://images.rbxcdn.com/139a7b3acfeb0b881b93a40134766048.png',
  'Official Model Maker': 'https://images.rbxcdn.com/45710972c9c8d556805f8bee89389648.png',
  Bricksmith: 'https://images.rbxcdn.com/49f3d30f5c16a1c25ea0f97ea8ef150e.png',
  Homestead: 'https://images.rbxcdn.com/b66bc601e2256546c5dd6188fce7a8d1.png',
  Inviter: 'https://images.rbxcdn.com/01044aca1d917eb20bfbdc5e25af1294.png',
  Ambassador: 'https://images.rbxcdn.com/b853909efc7fdcf590363d01f5894f09.png',
  Friendship: 'https://images.rbxcdn.com/5eb20917cf530583e2641c0e1f7ba95e.png',
  Veteran: 'https://images.rbxcdn.com/b7e6cabb5a1600d813f5843f37181fa3.png',
  Administrator:
    'https://static.wikia.nocookie.net/roblox/images/d/d1/Administrator_Badge_2025.png/revision/latest/scale-to-width-down/45?cb=20250508073352',
  'Welcome To The Club': 'https://images.rbxcdn.com/6c2a598114231066a386fa716ac099c4.png',
};

export const BADGE_NAMES = Object.keys(BADGE_ICON_URLS);

interface RawAccountBadge {
  id?: number;
  name?: string;
  description?: string;
}

/**
 * GET /v1/users/:id/roblox-badges
 *
 * The desktop tool discarded any badge outside its 12-icon map. Here every
 * badge the API returns is kept, and unmapped ones simply get iconUrl: null so
 * the client can draw its generated mark.
 */
export async function getAccountBadges(userId: number, signal?: AbortSignal): Promise<RobloxBadge[]> {
  const cacheKey = `badges:${userId}`;
  const cached = badgeCache.get<RobloxBadge[]>(cacheKey);
  if (cached) return cached;

  try {
    const data = await robloxRequest<RawAccountBadge[]>(ACCOUNT_BADGES_API.replace('{id}', String(userId)), {
      signal,
      tag: 'badges',
    });
    if (!Array.isArray(data)) return [];

    const badges: RobloxBadge[] = data
      .filter((b) => typeof b?.name === 'string' && b.name.length > 0)
      .map((b) => ({
        id: typeof b.id === 'number' ? b.id : null,
        name: b.name as string,
        description: typeof b.description === 'string' ? b.description : null,
        iconUrl: BADGE_ICON_URLS[b.name as string] ?? null,
        // accountinformation does not report award dates for account badges
        awardedDate: null,
      }));

    badgeCache.set(cacheKey, badges, config.assetCacheTtlMs);
    return badges;
  } catch (err) {
    const e = err as Error;
    log('error', `Unable to retrieve badge data for user ${userId}`, { userId, detail: e.message });
    return [];
  }
}
