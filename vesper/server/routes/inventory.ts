import { Router } from 'express';
import { asAssetId, asCursor, asLimit, asUserId } from '../lib/validate';
import { cachedAssetDetails, getAssetDetails, warmAssetDetails } from '../services/robloxAssetsService';
import { getInventoryPage, ownsVerifiedBadgeAsset, VERIFIED_BADGE_ASSET_ID } from '../services/robloxInventoryService';
import { getAssetThumbnails } from '../services/robloxThumbnailsService';

export const inventoryRouter = Router();

/**
 * GET /api/users/:id/inventory?cursor=&limit=
 *
 * One page of collectibles, enriched with asset metadata and thumbnails.
 * `summary.status` tells the client whether the data is real: when it is not
 * 'ok', itemCount/totalRap are null and the UI must show the message rather
 * than a zero.
 */
inventoryRouter.get('/users/:id/inventory', async (req, res, next) => {
  try {
    const id = asUserId(req.params.id);
    const cursor = asCursor(req.query.cursor);
    const limit = asLimit(req.query.limit, [10, 25, 50, 100], 100);
    const page = await getInventoryPage(id, cursor, limit);
    res.json({ ok: true, ...page });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/users/:id/collectibles?cursor=&limit=
 *
 * Alias kept for API-surface parity with the documented route list. Same
 * handler as /inventory — there is one implementation, not two.
 */
inventoryRouter.get('/users/:id/collectibles', async (req, res, next) => {
  try {
    const id = asUserId(req.params.id);
    const cursor = asCursor(req.query.cursor);
    const limit = asLimit(req.query.limit, [10, 25, 50, 100], 100);
    const page = await getInventoryPage(id, cursor, limit);
    res.json({ ok: true, ...page });
  } catch (err) {
    next(err);
  }
});

/** GET /api/users/:id/verified — ownership of the verified badge asset. */
inventoryRouter.get('/users/:id/verified', async (req, res, next) => {
  try {
    const id = asUserId(req.params.id);
    const owns = await ownsVerifiedBadgeAsset(id);
    res.json({ ok: true, verified: owns === true, known: owns !== null, assetId: VERIFIED_BADGE_ASSET_ID });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/inventory/enrich — { assetIds: number[] }
 *
 * Returns whatever asset metadata is already cached for the given ids and
 * queues the rest for background warming. The inventory grid polls this while
 * any item still shows `detailsDegraded`, so Limited/Limited-U tags and full
 * metadata stream in without ever blocking the page load.
 */
inventoryRouter.post('/inventory/enrich', (req, res) => {
  const raw: unknown[] = Array.isArray(req.body?.assetIds) ? (req.body.assetIds as unknown[]) : [];
  const ids: number[] = raw
    .slice(0, 200)
    .map((v: unknown) => Number(v))
    .filter((n: number) => Number.isInteger(n) && n > 0);
  if (!ids.length) return res.status(400).json({ ok: false, error: 'assetIds is required' });

  const { details, missing } = cachedAssetDetails([...new Set(ids)]);
  if (missing.length) warmAssetDetails(missing);
  res.json({ ok: true, details, warming: missing.length });
});

/** GET /api/assets/:id — catalog metadata for one asset. */
inventoryRouter.get('/assets/:id', async (req, res, next) => {
  try {
    const id = asAssetId(req.params.id);
    const details = await getAssetDetails(id);
    if (!details) return res.status(404).json({ ok: false, error: 'Asset details are unavailable' });
    const thumbs = await getAssetThumbnails([id], '420x420');
    res.json({ ok: true, asset: { ...details, thumbnailUrl: thumbs[id] ?? details.thumbnailUrl } });
  } catch (err) {
    next(err);
  }
});

/** GET /api/thumbnails/assets?assetIds=1,2,3&size=150x150 */
inventoryRouter.get('/thumbnails/assets', async (req, res, next) => {
  try {
    const raw = String(req.query.assetIds ?? '');
    const ids = raw
      .split(',')
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0)
      .slice(0, 100);
    if (!ids.length) return res.status(400).json({ ok: false, error: 'assetIds is required' });

    const sizeRaw = String(req.query.size ?? '150x150');
    const size = (['150x150', '250x250', '420x420'] as const).includes(sizeRaw as '150x150')
      ? (sizeRaw as '150x150' | '250x250' | '420x420')
      : '150x150';

    const thumbs = await getAssetThumbnails(ids, size);
    res.json({ ok: true, thumbnails: thumbs });
  } catch (err) {
    next(err);
  }
});
