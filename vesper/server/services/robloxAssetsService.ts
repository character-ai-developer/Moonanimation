import type { AssetDetails } from '../../shared/types';
import { assetCache } from '../lib/cache';
import { config } from '../lib/config';
import { robloxRequest } from '../lib/http';
import { log } from '../lib/logger';

const DETAILS_API = 'https://economy.roblox.com/v2/assets/{id}/details';

/** Roblox assetTypeId -> human label (subset covering collectibles). */
export const ASSET_TYPE_NAMES: Record<number, string> = {
  1: 'Image',
  2: 'T-Shirt',
  3: 'Audio',
  4: 'Mesh',
  5: 'Lua',
  6: 'HTML',
  7: 'Text',
  8: 'Hat',
  9: 'Place',
  10: 'Model',
  11: 'Shirt',
  12: 'Pants',
  13: 'Decal',
  16: 'Avatar',
  17: 'Head',
  18: 'Face',
  19: 'Gear',
  21: 'Badge',
  22: 'Animation',
  24: 'Torso',
  25: 'Right Arm',
  26: 'Left Arm',
  27: 'Left Leg',
  28: 'Right Leg',
  29: 'Package',
  30: 'Game Pass',
  31: 'Accessory',
  32: 'Animation Clip',
  34: 'Emote Animation',
  38: 'Climb Animation',
  39: 'Death Animation',
  40: 'Fall Animation',
  41: 'Idle Animation',
  42: 'Jump Animation',
  43: 'Run Animation',
  44: 'Swim Animation',
  45: 'Walk Animation',
  46: 'Pose Animation',
  47: 'Ear Accessory',
  48: 'Eye Accessory',
  49: 'Face Accessory',
  50: 'Front Accessory',
  51: 'Back Accessory',
  52: 'Shoulder Accessory',
  53: 'Waist Accessory',
  54: 'Neck Accessory',
  55: 'Hair Accessory',
  56: 'Accessory Bundle',
  57: 'Facial Animation',
  58: 'Hair Accessory',
  59: 'Eyelash Accessory',
  60: 'Mood Animation',
  61: 'Dynamic Head',
  62: 'Bundle',
  63: 'Hidden',
  64: 'Animation Bundle',
  65: 'Community',
  66: 'Video',
  67: 'Shirt',
  68: 'T-Shirt',
  69: 'Pants',
  70: 'Mesh Part',
  71: 'Accessory',
  72: 'Video',
  73: 'T-Shirt Accessory',
  74: 'Shirt Accessory',
  75: 'Pants Accessory',
  76: 'Jacket Accessory',
  77: 'Sweater Accessory',
  78: 'Shorts Accessory',
  79: 'Left Shoe Accessory',
  80: 'Right Shoe Accessory',
  81: 'Dress Skirt Accessory',
  82: 'Font Family',
  83: 'Eyebrow Accessory',
  84: 'Eyelash Accessory',
  85: 'Mood Animation',
  86: 'Dynamic Head Accessory',
  87: 'Face',
  88: 'Head',
  89: 'Atmosphere',
  90: 'Cloud',
  91: 'Material Pack',
  92: 'Mesh Part',
  93: 'Immersive Ad',
  94: 'Voice',
  95: 'Video',
  96: 'Animation',
};

export function assetTypeName(id: number | null): string | null {
  if (id === null) return null;
  return ASSET_TYPE_NAMES[id] ?? `Type ${id}`;
}

interface RawDetails {
  AssetId?: number;
  Name?: string;
  Description?: string;
  AssetTypeId?: number;
  Creator?: { Id?: number; Name?: string; CreatorType?: string; HasVerifiedBadge?: boolean };
  Created?: string;
  Updated?: string;
  PriceInRobux?: number | null;
  IsLimited?: boolean;
  IsLimitedUnique?: boolean;
  ProductType?: string;
  CollectibleItemId?: string | null;
  Sales?: number | null;
  CollectiblesItemDetails?: {
    CollectibleLowestResalePrice?: number | null;
    TotalQuantity?: number | null;
  } | null;
}

/**
 * Public catalog metadata for one asset. Cached aggressively — asset facts
 * change rarely, so this uses the long-lived asset TTL.
 */
export async function getAssetDetails(assetId: number, signal?: AbortSignal): Promise<AssetDetails | null> {
  const cacheKey = `asset:${assetId}`;
  const cached = assetCache.get<AssetDetails>(cacheKey);
  if (cached) return cached;

  try {
    const d = await robloxRequest<RawDetails>(DETAILS_API.replace('{id}', String(assetId)), {
      signal,
      tag: 'assets',
    });
    if (!d || typeof d.AssetId !== 'number') return null;

    const details: AssetDetails = {
      assetId: d.AssetId,
      name: d.Name ?? null,
      description: d.Description ?? null,
      assetTypeId: d.AssetTypeId ?? null,
      assetTypeName: assetTypeName(d.AssetTypeId ?? null),
      creator: d.Creator
        ? {
            id: d.Creator.Id ?? null,
            name: d.Creator.Name ?? null,
            type: d.Creator.CreatorType ?? null,
            hasVerifiedBadge: d.Creator.HasVerifiedBadge ?? null,
          }
        : null,
      created: d.Created ?? null,
      updated: d.Updated ?? null,
      priceInRobux: d.PriceInRobux ?? null,
      isLimited: d.IsLimited ?? null,
      isLimitedUnique: d.IsLimitedUnique ?? null,
      productType: d.ProductType ?? null,
      collectibleItemId: d.CollectibleItemId ?? null,
      lowestResalePrice: d.CollectiblesItemDetails?.CollectibleLowestResalePrice ?? null,
      totalQuantity: d.CollectiblesItemDetails?.TotalQuantity ?? null,
      sales: d.Sales ?? null,
      thumbnailUrl: null,
    };
    assetCache.set(cacheKey, details, config.assetCacheTtlMs);
    return details;
  } catch (err) {
    log('error', `Asset details unavailable for ${assetId}`, { detail: (err as Error).message });
    return null;
  }
}

/* ---------------------- background detail warming ---------------------- */

/**
 * The economy endpoint has no batch form, so fetching metadata for a full
 * inventory page means one request per asset. Doing that in the request path
 * made the inventory grid wait for ~100 rate-limited calls. Instead the page
 * returns immediately with whatever is cached and this queue fetches the rest
 * in the background at the gate's pace; the client polls the enrich endpoint
 * and watches the details fill in.
 */
const warmQueue: number[] = [];
const warming = new Set<number>();
const failedAt = new Map<number, number>();
let draining = false;

const FAILURE_COOLDOWN_MS = 30_000;

async function drainWarmQueue(): Promise<void> {
  while (warmQueue.length) {
    const id = warmQueue.shift()!;
    const d = await getAssetDetails(id); // never throws; null on failure
    if (d) failedAt.delete(id);
    else failedAt.set(id, Date.now());
    warming.delete(id);
  }
  draining = false;
}

/** Queue uncached asset ids for background fetching. Never throws. */
export function warmAssetDetails(assetIds: number[]): void {
  const now = Date.now();
  for (const id of assetIds) {
    if (!Number.isFinite(id) || id <= 0) continue;
    if (assetCache.get<AssetDetails>(`asset:${id}`)) continue;
    if (warming.has(id)) continue;
    const failed = failedAt.get(id);
    if (failed !== undefined && now - failed < FAILURE_COOLDOWN_MS) continue;
    warming.add(id);
    warmQueue.push(id);
  }
  if (!draining && warmQueue.length) {
    draining = true;
    void drainWarmQueue();
  }
}

/** Cached metadata only — used by the enrich endpoint. Also reports misses. */
export function cachedAssetDetails(
  assetIds: number[],
): { details: Record<number, AssetDetails>; missing: number[] } {
  const details: Record<number, AssetDetails> = {};
  const missing: number[] = [];
  for (const id of assetIds) {
    const d = assetCache.get<AssetDetails>(`asset:${id}`);
    if (d) details[id] = d;
    else missing.push(id);
  }
  return { details, missing };
}

/** Many assets at once, preserving order. Failures become null entries. */
export async function getAssetDetailsBatch(assetIds: number[], signal?: AbortSignal): Promise<(AssetDetails | null)[]> {
  const results: (AssetDetails | null)[] = new Array(assetIds.length).fill(null);
  const pending: { index: number; id: number }[] = [];

  for (let i = 0; i < assetIds.length; i++) {
    const cached = assetCache.get<AssetDetails>(`asset:${assetIds[i]}`);
    if (cached) results[i] = cached;
    else pending.push({ index: i, id: assetIds[i] });
  }

  // The economy endpoint has no batch form and 429s under bursts, so in-flight
  // work is kept low; the shared rate gate supplies the actual pacing.
  const CONCURRENCY = 3;
  let cursor = 0;
  async function worker() {
    while (cursor < pending.length) {
      const job = pending[cursor++];
      if (signal?.aborted) return;
      results[job.index] = await getAssetDetails(job.id, signal);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));
  return results;
}
