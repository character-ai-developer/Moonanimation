import { Router } from 'express';
import { asText, ValidationError } from '../lib/validate';
import {
  createCategory,
  deleteCategory,
  exportStore,
  getCategory,
  getStore,
  importStore,
  listCategories,
  removeFromCategory,
  renameCategory,
  resetStore,
  saveAccounts,
  savedIdCategoryIndex,
  updateAccount,
  updateNote,
  type SaveAccountInput,
} from '../services/savedService';

export const savedRouter = Router();

/** GET /api/saved — the whole store plus a per-category rollup. */
savedRouter.get('/', (_req, res) => {
  res.json({ ok: true, categories: listCategories(), store: getStore(), index: Object.fromEntries(savedIdCategoryIndex()) });
});

/** GET /api/saved/export — the raw JSON document, for download. */
savedRouter.get('/export', (_req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="vesper_saved.json"');
  res.json(exportStore());
});

/** POST /api/saved/import — validated merge or replace. */
savedRouter.post('/import', (req, res, next) => {
  try {
    const mode = req.body?.mode === 'replace' ? 'replace' : 'merge';
    const payload = req.body?.data ?? req.body;
    const report = importStore(payload, mode);
    res.json({ ok: true, report });
  } catch (err) {
    next(err);
  }
});

/** GET /api/saved/category/:name */
savedRouter.get('/category/:name', (req, res) => {
  const cat = getCategory(req.params.name);
  if (!cat) return res.status(404).json({ ok: false, error: `Category '${req.params.name}' not found` });
  res.json({ ok: true, category: cat });
});

/** POST /api/saved/category — create. */
savedRouter.post('/category', (req, res, next) => {
  try {
    const name = asText(req.body?.name, 60, 'name').trim();
    const category = createCategory(name);
    res.status(201).json({ ok: true, category });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/saved/category/:name — rename. */
savedRouter.put('/category/:name', (req, res, next) => {
  try {
    renameCategory(req.params.name, String(req.body?.newName ?? ''));
    res.json({ ok: true, categories: listCategories() });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/saved/category/:name */
savedRouter.delete('/category/:name', (req, res, next) => {
  try {
    deleteCategory(req.params.name);
    res.json({ ok: true, categories: listCategories() });
  } catch (err) {
    next(err);
  }
});

/** POST /api/saved/:category/accounts — save or update accounts. */
savedRouter.post('/:category/accounts', (req, res, next) => {
  try {
    const raw = req.body?.accounts;
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new ValidationError('accounts must be a non-empty array', 'accounts');
    }
    const accounts: SaveAccountInput[] = raw.slice(0, 500).map((a: Record<string, unknown>) => ({
      id: String(a?.id ?? ''),
      username: String(a?.username ?? ''),
      displayName: a?.displayName != null ? String(a.displayName) : undefined,
      created: a?.created != null ? String(a.created) : undefined,
      rap: a?.rap != null ? String(a.rap) : undefined,
      verified: a?.verified != null ? String(a.verified) : undefined,
      banned: a?.banned != null ? String(a.banned) : undefined,
      active: a?.active != null ? String(a.active) : undefined,
      hats: a?.hats != null ? String(a.hats) : undefined,
      badges: Array.isArray(a?.badges) ? (a.badges as string[]) : undefined,
      note: a?.note != null ? String(a.note) : undefined,
      avatarUrl: typeof a?.avatarUrl === 'string' ? a.avatarUrl : null,
      lastChecked: typeof a?.lastChecked === 'string' ? a.lastChecked : null,
      inventorySummary: (a?.inventorySummary as SaveAccountInput['inventorySummary']) ?? null,
    }));
    const result = saveAccounts(req.params.category, accounts);
    res.status(201).json({ ok: true, ...result, categories: listCategories() });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/saved/:category/accounts/:id/note */
savedRouter.put('/:category/accounts/:id/note', (req, res) => {
  const ok = updateNote(req.params.category, req.params.id, String(req.body?.note ?? ''));
  if (!ok) return res.status(404).json({ ok: false, error: 'Saved account not found' });
  res.json({ ok: true });
});

/** PUT /api/saved/:category/accounts/:id — refresh metadata. */
savedRouter.put('/:category/accounts/:id', (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ok = updateAccount(req.params.category, req.params.id, {
      username: body.username != null ? String(body.username) : undefined,
      displayName: body.displayName != null ? String(body.displayName) : undefined,
      created: body.created != null ? String(body.created) : undefined,
      rap: body.rap != null ? String(body.rap) : undefined,
      verified: body.verified != null ? String(body.verified) : undefined,
      banned: body.banned != null ? String(body.banned) : undefined,
      active: body.active != null ? String(body.active) : undefined,
      hats: body.hats != null ? String(body.hats) : undefined,
      badges: Array.isArray(body.badges) ? (body.badges as string[]) : undefined,
      avatarUrl: typeof body.avatarUrl === 'string' ? body.avatarUrl : null,
      lastChecked: typeof body.lastChecked === 'string' ? body.lastChecked : null,
      inventorySummary: (body.inventorySummary as SaveAccountInput['inventorySummary']) ?? undefined,
    });
    if (!ok) return res.status(404).json({ ok: false, error: 'Saved account not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/saved/:category/accounts/:id */
savedRouter.delete('/:category/accounts/:id', (req, res) => {
  const ok = removeFromCategory(req.params.category, req.params.id);
  if (!ok) return res.status(404).json({ ok: false, error: 'Saved account not found' });
  res.json({ ok: true, categories: listCategories() });
});

/** DELETE /api/saved — wipe local saved data. */
savedRouter.delete('/', (_req, res) => {
  resetStore();
  res.json({ ok: true, categories: listCategories() });
});
