import { Router } from 'express';
import { cacheStats, clearAllCaches } from '../lib/cache';
import { config, publicSettings } from '../lib/config';
import { gate } from '../lib/http';
import { logStore } from '../lib/logger';
import { asBoolean } from '../lib/validate';
import { getApiStatus } from '../services/apiStatusService';

export const systemRouter = Router();

/** GET /api/status — the header connection indicator. */
systemRouter.get('/status', async (_req, res, next) => {
  try {
    res.json({ ok: true, status: await getApiStatus() });
  } catch (err) {
    next(err);
  }
});

/** GET /api/settings — non-secret configuration only. */
systemRouter.get('/settings', (_req, res) => {
  res.json({
    ok: true,
    settings: publicSettings(),
    cache: cacheStats(),
    rateLimit: { hits: gate.hits, backoffUntil: gate.backoffUntil, totalRequests: gate.total },
  });
});

/** POST /api/settings/test — connection test against the Roblox endpoints. */
systemRouter.post('/settings/test', async (_req, res, next) => {
  try {
    const status = await getApiStatus();
    res.json({ ok: true, status });
  } catch (err) {
    next(err);
  }
});

/** POST /api/settings/cache/clear */
systemRouter.post('/settings/cache/clear', (_req, res) => {
  clearAllCaches();
  logStore.push('system', 'Server caches cleared');
  res.json({ ok: true, cache: cacheStats() });
});

/** POST /api/settings/mock — toggle the isolated dev mock mode at runtime. */
systemRouter.post('/settings/mock', (req, res) => {
  const enabled = asBoolean(req.body?.enabled);
  (config as { mockMode: boolean }).mockMode = enabled;
  logStore.push('system', `Mock mode ${enabled ? 'ENABLED' : 'disabled'}`);
  res.json({ ok: true, mockMode: enabled });
});
