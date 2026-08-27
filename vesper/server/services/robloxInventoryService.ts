import type { AssetDetails, CollectibleItem, InventoryPage, InventoryStatus, InventorySummary } from '../../shared/types';
import { assetCache, inventoryCache } from '../lib/cache';
import { config } from '../lib/config';
import { isPrivateOrForbidden, RobloxApiError, robloxRequest } from '../lib/http';
import { log } from '../lib/logger';
import { assetTypeName, getAssetDetailsBatch, warmAssetDetails } from './robloxAssetsService';
import { getAssetThumbnails } from './robloxThumbnailsService';

const LEGACY_COLLECTIBLES = 'https://inventory.roblox.com/v1/users/{id}/assets/collectibles';
const HATS_INVENTORY = 'https://inventory.roblox.com/v2/users/{id}/inventory/8';
const ITEM_OWNERSHIP = 'https://inventory.roblox.com/v1/users/{id}/items/Asset/{assetId}';
const OPEN_CLOUD_INVENTORY = 'https://apis.roblox.com/cloud/v2/users/{id}/inventory-items';

/** Asset the desktop tool used as the "verified" probe. */
export const VERIFIED_BADGE_ASSET_ID = 102611803;

/** Canonical catalog link for an asset. Empty string when the ID is unknown. */
export function itemUrlFor(assetId: number): string {
  return assetId > 0 ? `https://www.roblox.com/catalog/${assetId}` : '';
}

const ALLOWED_LIMITS = [10, 25, 50, 100];

interface LegacyCollectible {
  userAssetId?: number;
  serialNumber?: number | string | null;
  assetId?: number;
  name?: string;
  recentAveragePrice?: number | null;
  originalPrice?: number | null;
  assetStock?: number | null;
  isOnHold?: boolean;
}

interface OpenCloudItem {
  path?: string;
  assetDetails?: {
    assetId?: string;
    inventoryItemAssetType?: string;
    instanceId?: string;
  };
  collectibleDetails?: {
    serialNumber?: string | number | null;
    recentAveragePrice?: number | null;
    originalPrice?: number | null;
    assetStock?: number | null;
  } | null;
}

export interface CollectiblesPageResult {
  items: CollectibleItem[];
  nextCursor: string | null;
  /** Distinguishes "reached the end" from "this page came back empty but more may follow". */
  hasMore: boolean;
  source: 'opencloud' | 'legacy';
  status: InventoryStatus;
  message: string;
}

/**
 * One page of a user's collectibles.
 *
 * Transport order:
 *  1. Open Cloud `inventory-items` when ROBLOX_API_KEY is configured — the
 *     currently documented API, paginated with `pageToken`/`nextPageToken`.
 *  2. The legacy public collectibles endpoint, paginated with
 *     `cursor`/`nextPageCursor`. This is what the desktop tool used and it is
 *     the only source of RAP + serial numbers without a key.
 *
 * A private or unreachable inventory yields status !== 'ok' and an empty list.
 * It is never reported as an empty inventory.
 */
export async function getCollectiblesPage(
  userId: number,
  cursor: string | null,
  limit: number,
  signal?: AbortSignal,
): Promise<CollectiblesPageResult> {
  const pageSize = ALLOWED_LIMITS.includes(limit) ? limit : 100;

  if (config.robloxApiKey) {
    try {
      const openCloud = await getOpenCloudPage(userId, cursor, pageSize, signal);
      if (openCloud) return openCloud;
      log('api', `Open Cloud inventory unavailable for user ${userId}, falling back to legacy transport`, {
        userId,
      });
    } catch (err) {
      if (isPrivateOrForbidden(err)) {
        return {
          items: [],
          nextCursor: null,
          hasMore: false,
          source: 'opencloud',
          status: 'private',
          message: 'Inventory is private or unavailable',
        };
      }
      log('error', `Open Cloud inventory request failed for user ${userId}`, {
        userId,
        detail: (err as Error).message,
      });
    }
  }

  return getLegacyPage(userId, cursor, pageSize, signal);
}

async function getOpenCloudPage(
  userId: number,
  cursor: string | null,
  limit: number,
  signal?: AbortSignal,
): Promise<CollectiblesPageResult | null> {
  const params = new URLSearchParams({
    filter: 'onlyCollectibles=true;inventoryItemAssetTypes=*',
    maxPageSize: String(limit),
  });
  if (cursor) params.set('pageToken', cursor);

  let data: { inventoryItems?: OpenCloudItem[]; nextPageToken?: string };
  try {
    data = await robloxRequest(OPEN_CLOUD_INVENTORY.replace('{id}', String(userId)) + `?${params}`, {
      auth: true,
      signal,
      tag: 'opencloud-inventory',
    });
  } catch (err) {
    // 404 on this endpoint means the scope/feature is not enabled for the key.
    if (err instanceof RobloxApiError && err.kind === 'not_found') return null;
    throw err;
  }

  const rawItems = Array.isArray(data?.inventoryItems) ? data.inventoryItems : [];

  // The Open Cloud listing carries no RAP. Overlay legacy collectible data for
  // the same asset IDs so RAP / serial / original price are real, not invented.
  const legacyByAssetId = await buildLegacyRapIndex(userId, signal);

  const items: CollectibleItem[] = rawItems.map((raw) => {
    const assetId = Number.parseInt(raw.assetDetails?.assetId ?? '', 10);
    const legacy = Number.isFinite(assetId) ? legacyByAssetId.get(assetId) : undefined;
    return {
      userAssetId: raw.assetDetails?.instanceId ?? (legacy?.userAssetId ?? null),
      assetId: Number.isFinite(assetId) ? assetId : 0,
      name: legacy?.name ?? '',
      rap: legacy?.rap ?? raw.collectibleDetails?.recentAveragePrice ?? null,
      serialNumber:
        raw.collectibleDetails?.serialNumber != null
          ? String(raw.collectibleDetails.serialNumber)
          : (legacy?.serialNumber ?? null),
      originalPrice: legacy?.originalPrice ?? raw.collectibleDetails?.originalPrice ?? null,
      assetStock: legacy?.assetStock ?? raw.collectibleDetails?.assetStock ?? null,
      isOnHold: legacy?.isOnHold ?? null,
      collectibleItemId: null,
      creator: null,
      assetTypeId: null,
      assetTypeName: raw.assetDetails?.inventoryItemAssetType ?? null,
      isLimited: null,
      isLimitedUnique: null,
      lowestResalePrice: null,
      totalQuantity: null,
      sales: null,
      created: null,
      thumbnailUrl: null,
      itemUrl: itemUrlFor(Number.isFinite(assetId) ? assetId : 0),
      detailsDegraded: true,
    };
  });

  const token = data?.nextPageToken ?? '';
  // Documented best practice: a non-empty token with an empty array is not the end.
  const hasMore = Boolean(token) && rawItems.length > 0;

  return {
    items,
    nextCursor: hasMore ? token : null,
    hasMore,
    source: 'opencloud',
    status: 'ok',
    message: '',
  };
}

async function getLegacyPage(
  userId: number,
  cursor: string | null,
  limit: number,
  signal?: AbortSignal,
): Promise<CollectiblesPageResult> {
  const params = new URLSearchParams({ sortOrder: 'Asc', limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  const url = `${LEGACY_COLLECTIBLES.replace('{id}', String(userId))}?${params}`;

  // Collectible listings change slowly; caching whole pages keeps re-opens,
  // polling refreshes and RAP walks cheap.
  const pageCacheKey = `legacypage:${userId}:${cursor ?? ''}:${limit}`;
  const cachedPage = inventoryCache.get<CollectiblesPageResult>(pageCacheKey);
  if (cachedPage) return cachedPage;

  let data: { data?: LegacyCollectible[]; nextPageCursor?: string | null };
  try {
    data = await robloxRequest(url, { signal, tag: 'collectibles' });
  } catch (err) {
    if (isPrivateOrForbidden(err)) {
      return finish({
        items: [],
        nextCursor: null,
        hasMore: false,
        source: 'legacy',
        status: 'private',
        message: 'Inventory is private or unavailable',
      });
    }
    const e = err instanceof RobloxApiError ? err : null;
    log('error', `Collectibles request failed for user ${userId}`, {
      userId,
      status: e?.status ?? null,
      detail: e?.message,
    });
    // Transient failures are NOT cached so the next call retries upstream.
    return {
      items: [],
      nextCursor: null,
      hasMore: false,
      source: 'legacy',
      status: e?.kind === 'rate_limited' ? 'unavailable' : 'error',
      message:
        e?.kind === 'rate_limited'
          ? 'Roblox API is currently rate limited'
          : 'Unable to retrieve inventory data',
    };
  }

  function finish(result: CollectiblesPageResult): CollectiblesPageResult {
    inventoryCache.set(pageCacheKey, result, config.cacheTtlMs);
    return result;
  }

  const rawItems = Array.isArray(data?.data) ? data.data : [];
  const items: CollectibleItem[] = rawItems.map((raw) => ({
    userAssetId: raw.userAssetId != null ? String(raw.userAssetId) : null,
    assetId: typeof raw.assetId === 'number' ? raw.assetId : 0,
    name: raw.name ?? '',
    rap: typeof raw.recentAveragePrice === 'number' ? raw.recentAveragePrice : null,
    serialNumber: raw.serialNumber != null ? String(raw.serialNumber) : null,
    originalPrice: typeof raw.originalPrice === 'number' ? raw.originalPrice : null,
    assetStock: typeof raw.assetStock === 'number' ? raw.assetStock : null,
    isOnHold: typeof raw.isOnHold === 'boolean' ? raw.isOnHold : null,
    collectibleItemId: null,
    creator: null,
    assetTypeId: null,
    assetTypeName: null,
    isLimited: null,
    isLimitedUnique: null,
    lowestResalePrice: null,
    totalQuantity: null,
    sales: null,
    created: null,
    thumbnailUrl: null,
    itemUrl: itemUrlFor(typeof raw.assetId === 'number' ? raw.assetId : 0),
    detailsDegraded: true,
  }));

  const next = data?.nextPageCursor;
  const nextCursor = next && next !== 'null' ? next : null;

  return finish({
    items,
    nextCursor,
    hasMore: Boolean(nextCursor),
    source: 'legacy',
    status: 'ok',
    message: '',
  });
}

/**
 * RAP / serial index for a user, built from the legacy collectibles listing.
 * Used to enrich Open Cloud results. Returns an empty map rather than throwing
 * so an unavailable legacy endpoint degrades to "Unavailable" fields.
 */
async function buildLegacyRapIndex(
  userId: number,
  signal?: AbortSignal,
): Promise<Map<number, { name: string; rap: number | null; serialNumber: string | null; originalPrice: number | null; assetStock: number | null; isOnHold: boolean | null; userAssetId: string | null }>> {
  const index = new Map<number, { name: string; rap: number | null; serialNumber: string | null; originalPrice: number | null; assetStock: number | null; isOnHold: boolean | null; userAssetId: string | null }>();
  const { items } = await getLegacyPage(userId, null, 100, signal);
  for (const item of items) {
    if (item.assetId) {
      index.set(item.assetId, {
        name: item.name,
        rap: item.rap,
        serialNumber: item.serialNumber,
        originalPrice: item.originalPrice,
        assetStock: item.assetStock,
        isOnHold: item.isOnHold,
        userAssetId: item.userAssetId,
      });
    }
  }
  return index;
}

/**
 * Enrich one page with asset metadata + thumbnails.
 * Every failure leaves the field null so the UI prints "Unavailable" instead of
 * a fabricated value.
 */
export async function enrichItems(items: CollectibleItem[], signal?: AbortSignal): Promise<CollectibleItem[]> {
  if (!items.length) return items;

  const assetIds = items.map((i) => i.assetId).filter((id) => Number.isFinite(id) && id > 0);
  const [details, thumbs] = await Promise.all([
    getAssetDetailsBatch([...new Set(assetIds)], signal),
    getAssetThumbnails([...new Set(assetIds)], '150x150', signal),
  ]);

  const detailByAssetId = new Map<number, (typeof details)[number]>();
  details.forEach((d) => {
    if (d) detailByAssetId.set(d.assetId, d);
  });

  return items.map((item) => {
    const d = detailByAssetId.get(item.assetId);
    return {
      ...item,
      name: item.name || d?.name || '',
      creator: d?.creator ?? item.creator,
      assetTypeId: d?.assetTypeId ?? item.assetTypeId,
      assetTypeName: d?.assetTypeName ?? (item.assetTypeId ? assetTypeName(item.assetTypeId) : item.assetTypeName),
      isLimited: d?.isLimited ?? item.isLimited,
      isLimitedUnique: d?.isLimitedUnique ?? item.isLimitedUnique,
      collectibleItemId: d?.collectibleItemId ?? item.collectibleItemId,
      lowestResalePrice: d?.lowestResalePrice ?? item.lowestResalePrice,
      totalQuantity: d?.totalQuantity ?? item.totalQuantity,
      sales: d?.sales ?? item.sales,
      created: d?.created ?? item.created,
      originalPrice: item.originalPrice ?? d?.priceInRobux ?? null,
      thumbnailUrl: thumbs[item.assetId] ?? null,
      detailsDegraded: !d,
    };
  });
}

/** Statistics derived strictly from items actually returned. Nulls mean unknown. */
export function summarise(items: CollectibleItem[], status: InventoryStatus, message: string, source: 'opencloud' | 'legacy' | 'none'): InventorySummary {
  if (status !== 'ok') {
    return {
      status,
      message: message || 'Inventory is private or unavailable',
      itemCount: null,
      totalRap: null,
      averageRap: null,
      highest: null,
      lowest: null,
      limitedCount: null,
      limitedUniqueCount: null,
      source,
    };
  }

  const withRap = items.filter((i) => typeof i.rap === 'number');
  const totalRap = withRap.reduce((sum, i) => sum + (i.rap ?? 0), 0);
  let highest: InventorySummary['highest'] = null;
  let lowest: InventorySummary['lowest'] = null;
  for (const i of withRap) {
    const rap = i.rap ?? 0;
    if (!highest || rap > highest.rap) highest = { name: i.name, rap, assetId: i.assetId };
    if (!lowest || rap < lowest.rap) lowest = { name: i.name, rap, assetId: i.assetId };
  }

  return {
    status: 'ok',
    message: '',
    itemCount: items.length,
    totalRap: totalRap,
    averageRap: withRap.length ? Math.round(totalRap / withRap.length) : null,
    highest,
    lowest,
    limitedCount: items.filter((i) => i.isLimited === true).length,
    limitedUniqueCount: items.filter((i) => i.isLimitedUnique === true).length,
    source,
  };
}

/**
 * Full collectible walk — mirrors the desktop tool's RAP aggregation.
 * Returns the literal string "Unknown" when the inventory cannot be read, which
 * the UI must render as unavailable rather than as zero.
 */
export async function getFullCollectibles(
  userId: number,
  signal?: AbortSignal,
  maxPages = 50,
): Promise<{ rap: string; rapValue: number | null; items: { name: string; assetId: number; rap: number | null }[]; status: InventoryStatus }> {
  const cacheKey = `collectibles:${userId}`;
  const cached = inventoryCache.get<{ rap: string; rapValue: number | null; items: { name: string; assetId: number; rap: number | null }[]; status: InventoryStatus }>(cacheKey);
  if (cached) return cached;

  const items: { name: string; assetId: number; rap: number | null }[] = [];
  let cursor: string | null = null;
  let total = 0;
  let status: InventoryStatus = 'ok';
  let pages = 0;

  for (;;) {
    if (signal?.aborted) break;
    const page = await getLegacyPage(userId, cursor, 100, signal);
    if (page.status !== 'ok') {
      status = page.status;
      break;
    }
    for (const item of page.items) {
      if (typeof item.rap === 'number') total += item.rap;
      items.push({ name: item.name, assetId: item.assetId, rap: item.rap });
    }
    pages++;
    cursor = page.nextCursor;
    if (!cursor || pages >= maxPages) break;
  }

  if (status !== 'ok') {
    return { rap: 'Unknown', rapValue: null, items: [], status };
  }

  const result = {
    rap: total.toLocaleString('en-US'),
    rapValue: total,
    items,
    status: 'ok' as InventoryStatus,
  };
  inventoryCache.set(cacheKey, result, config.cacheTtlMs);
  return result;
}

/**
 * Hat count via the v2 inventory endpoint (asset type 8).
 * null means "unknown" — the desktop tool rendered that as "Unknown", never 0.
 */
export async function getHatCount(userId: number, signal?: AbortSignal, maxPages = 30): Promise<number | null> {
  const cacheKey = `hats:${userId}`;
  const cached = inventoryCache.get<number | null>(cacheKey);
  if (cached !== undefined) return cached;

  let cursor: string | null = null;
  let total = 0;
  let pages = 0;

  for (;;) {
    if (signal?.aborted) return null;
    const params = new URLSearchParams({ limit: '100', sortOrder: 'Desc' });
    if (cursor) params.set('cursor', cursor);

    let data: { data?: unknown[]; nextPageCursor?: string | null };
    try {
      data = await robloxRequest(`${HATS_INVENTORY.replace('{id}', String(userId))}?${params}`, {
        signal,
        tag: 'hats',
      });
    } catch {
      return null;
    }

    const batch = Array.isArray(data?.data) ? data.data : [];
    total += batch.length;
    pages++;
    cursor = data?.nextPageCursor ?? null;
    if (!cursor || pages >= maxPages) break;
  }

  inventoryCache.set(cacheKey, total, config.cacheTtlMs);
  return total;
}

/**
 * Ownership probe for the "Verified, Bonafide, Plaidafied" asset.
 * The desktop tool used this single endpoint for both its verified flag and its
 * "plaid hat" activity signal — they are the same request, so we do it once.
 */
export async function ownsVerifiedBadgeAsset(userId: number, signal?: AbortSignal): Promise<boolean | null> {
  const cacheKey = `verified:${userId}`;
  const cached = inventoryCache.get<boolean | null>(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const data = await robloxRequest<{ data?: unknown[] }>(
      ITEM_OWNERSHIP.replace('{id}', String(userId)).replace('{assetId}', String(VERIFIED_BADGE_ASSET_ID)),
      { signal, tag: 'ownership' },
    );
    const owns = Array.isArray(data?.data) && data.data.length > 0;
    inventoryCache.set(cacheKey, owns, config.cacheTtlMs);
    return owns;
  } catch {
    return null;
  }
}

/** Merge whatever asset metadata is already cached; never wait on economy. */
function mergeCachedDetails(item: CollectibleItem, thumb: string | null): CollectibleItem {
  const d = item.assetId > 0 ? assetCache.get<AssetDetails>(`asset:${item.assetId}`) : undefined;
  return {
    ...item,
    name: item.name || d?.name || '',
    creator: d?.creator ?? item.creator,
    assetTypeId: d?.assetTypeId ?? item.assetTypeId,
    assetTypeName: d?.assetTypeName ?? (item.assetTypeId ? assetTypeName(item.assetTypeId) : item.assetTypeName),
    isLimited: d?.isLimited ?? item.isLimited,
    isLimitedUnique: d?.isLimitedUnique ?? item.isLimitedUnique,
    collectibleItemId: d?.collectibleItemId ?? item.collectibleItemId,
    lowestResalePrice: d?.lowestResalePrice ?? item.lowestResalePrice,
    totalQuantity: d?.totalQuantity ?? item.totalQuantity,
    sales: d?.sales ?? item.sales,
    created: d?.created ?? item.created,
    originalPrice: item.originalPrice ?? d?.priceInRobux ?? null,
    thumbnailUrl: item.thumbnailUrl ?? thumb,
    detailsDegraded: !d,
  };
}

/**
 * Paginated inventory page — the shape the inventory viewer consumes.
 *
 * Fast path: the legacy listing (cached) plus one batched thumbnail request and
 * whatever asset metadata is already cached. Missing metadata is queued for
 * background warming and arrives via the enrich endpoint, so the grid paints
 * in one round-trip instead of waiting on ~100 rate-limited economy calls.
 */
export async function getInventoryPage(
  userId: number,
  cursor: string | null,
  limit: number,
  signal?: AbortSignal,
): Promise<InventoryPage> {
  const page = await getCollectiblesPage(userId, cursor, limit, signal);
  if (page.status !== 'ok') {
    return {
      items: page.items,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      seenTotal: page.items.length,
      summary: summarise(page.items, page.status, page.message, 'none'),
    };
  }

  const ids = [...new Set(page.items.map((i) => i.assetId).filter((id) => Number.isFinite(id) && id > 0))];
  let thumbs: Record<string, string | null> = {};
  try {
    thumbs = await getAssetThumbnails(ids, '150x150', signal);
  } catch {
    thumbs = {};
  }

  const items = page.items.map((item) => mergeCachedDetails(item, thumbs[item.assetId] ?? null));
  const missing = ids.filter((id) => !assetCache.get<AssetDetails>(`asset:${id}`));
  if (missing.length) warmAssetDetails(missing);

  return {
    items,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
    seenTotal: items.length,
    summary: summarise(items, page.status, page.message, page.source),
  };
}
