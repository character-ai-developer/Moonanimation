import fs from 'node:fs';
import path from 'node:path';
import type { SavedAccount, SavedCategory, SavedStore } from '../../shared/types';
import { config } from '../lib/config';
import { log } from '../lib/logger';
import { asText, ValidationError } from '../lib/validate';

/**
 * Persisted saved accounts.
 *
 * The on-disk shape is deliberately identical to the desktop tool's
 * `rfinder_saved.json` ({ categories: { [name]: { accounts: { [id]: {...} } } } })
 * so an existing file can be dropped in unchanged. Extra fields this app adds
 * (displayName, avatarUrl, lastChecked, inventorySummary, savedAt) are optional
 * on read, so both directions stay compatible.
 */

let store: SavedStore = { categories: {} };
let loaded = false;

function ensureDefault(): void {
  if (!store.categories || typeof store.categories !== 'object') store.categories = {};
  if (Object.keys(store.categories).length === 0) {
    store.categories['Default'] = { name: 'Default', accounts: {} };
  }
}

export function loadStore(): SavedStore {
  if (loaded) return store;
  loaded = true;
  try {
    if (fs.existsSync(config.savedFile)) {
      const raw = JSON.parse(fs.readFileSync(config.savedFile, 'utf-8'));
      store = sanitizeStore(raw);
      log('system', `Loaded saved accounts from ${config.savedFile}`);
    }
  } catch (err) {
    log('error', `Failed to read saved accounts file, starting empty`, { detail: (err as Error).message });
    store = { categories: {} };
  }
  ensureDefault();
  return store;
}

function persist(): void {
  try {
    fs.mkdirSync(path.dirname(config.savedFile), { recursive: true });
    fs.writeFileSync(config.savedFile, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    log('error', 'Failed to write saved accounts file', { detail: (err as Error).message });
  }
}

const YESNO = new Set(['Yes', 'No', 'Unknown', '']);

function safeStr(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max);
}

function safeStrArray(v: unknown, max = 40): string[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, max).map((x) => safeStr(x, 60)).filter(Boolean);
}

/** Coerce arbitrary JSON into the saved-account shape. Never trusts the input. */
export function sanitizeAccount(input: unknown, fallbackId: string): SavedAccount | null {
  if (!input || typeof input !== 'object') return null;
  const a = input as Record<string, unknown>;
  const id = safeStr(a.id ?? fallbackId, 20).trim();
  if (!/^\d{1,20}$/.test(id)) return null;

  const verified = YESNO.has(safeStr(a.verified, 8)) ? safeStr(a.verified, 8) : '';
  const banned = YESNO.has(safeStr(a.banned, 8)) ? safeStr(a.banned, 8) : '';
  const active = YESNO.has(safeStr(a.active, 8)) ? safeStr(a.active, 8) : '';

  const inv = a.inventorySummary as Record<string, unknown> | undefined;
  const invStatuses = ['ok', 'private', 'unavailable', 'error'] as const;
  type InvStatus = (typeof invStatuses)[number];
  const invStatus: InvStatus | null =
    inv && typeof inv === 'object' && invStatuses.includes(inv.status as InvStatus)
      ? (inv.status as InvStatus)
      : null;

  return {
    id,
    username: safeStr(a.username, 20),
    displayName: safeStr(a.displayName, 50),
    created: safeStr(a.created, 32),
    rap: safeStr(a.rap, 32),
    verified,
    banned,
    active,
    hats: safeStr(a.hats, 16),
    badges: safeStrArray(a.badges),
    note: safeStr(a.note, 4000),
    avatarUrl: typeof a.avatarUrl === 'string' && /^https:\/\/[a-z0-9.\-]+\//i.test(a.avatarUrl) ? a.avatarUrl.slice(0, 500) : null,
    lastChecked: typeof a.lastChecked === 'string' ? a.lastChecked.slice(0, 40) : null,
    inventorySummary:
      invStatus && inv
        ? {
            status: invStatus,
            itemCount: typeof inv.itemCount === 'number' ? inv.itemCount : null,
            totalRap: typeof inv.totalRap === 'number' ? inv.totalRap : null,
          }
        : null,
    savedAt: typeof a.savedAt === 'string' ? a.savedAt.slice(0, 40) : new Date().toISOString(),
  };
}

function sanitizeStore(raw: unknown): SavedStore {
  const out: SavedStore = { categories: {} };
  const cats = (raw as Record<string, unknown> | null)?.categories;
  if (!cats || typeof cats !== 'object') return out;

  for (const [catName, catValue] of Object.entries(cats as Record<string, unknown>)) {
    const name = catName.slice(0, 60);
    if (!name.trim()) continue;
    const accounts: Record<string, SavedAccount> = {};
    const rawAccounts = (catValue as Record<string, unknown> | null)?.accounts;
    if (rawAccounts && typeof rawAccounts === 'object') {
      for (const [id, acc] of Object.entries(rawAccounts as Record<string, unknown>)) {
        const clean = sanitizeAccount(acc, id);
        if (clean) accounts[clean.id] = clean;
      }
    }
    out.categories[name] = { name, accounts };
  }
  return out;
}

/* ---------------------------------- reads --------------------------------- */

export function getStore(): SavedStore {
  return loadStore();
}

export function getCategory(name: string): SavedCategory | null {
  return loadStore().categories[name] ?? null;
}

export function listCategories(): { name: string; count: number; withNotes: number }[] {
  const s = loadStore();
  return Object.values(s.categories).map((c) => ({
    name: c.name,
    count: Object.keys(c.accounts).length,
    withNotes: Object.values(c.accounts).filter((a) => a.note.trim().length > 0).length,
  }));
}

/** Every saved ID across all categories — the Account Finder skip set. */
export function getSavedIds(): Set<number> {
  const ids = new Set<number>();
  for (const cat of Object.values(loadStore().categories)) {
    for (const id of Object.keys(cat.accounts)) {
      const n = Number.parseInt(id, 10);
      if (Number.isFinite(n)) ids.add(n);
    }
  }
  return ids;
}

export function savedIdCategoryIndex(): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const cat of Object.values(loadStore().categories)) {
    for (const id of Object.keys(cat.accounts)) {
      const list = index.get(id) ?? [];
      list.push(cat.name);
      index.set(id, list);
    }
  }
  return index;
}

/* --------------------------------- writes --------------------------------- */

export function createCategory(name: string): SavedCategory {
  const clean = asText(name, 60, 'category').trim();
  if (!clean) throw new ValidationError('Category name is required', 'name');
  const s = loadStore();
  if (s.categories[clean]) throw new ValidationError(`Category '${clean}' already exists`, 'name');
  s.categories[clean] = { name: clean, accounts: {} };
  persist();
  log('system', `Category created: ${clean}`);
  return s.categories[clean];
}

export function renameCategory(oldName: string, newName: string): void {
  const target = asText(newName, 60, 'category').trim();
  if (!target) throw new ValidationError('Category name is required', 'name');
  const s = loadStore();
  if (!s.categories[oldName]) throw new ValidationError(`Category '${oldName}' does not exist`, 'name');
  if (s.categories[target]) throw new ValidationError(`Category '${target}' already exists`, 'name');

  const rebuilt: Record<string, SavedCategory> = {};
  for (const [key, value] of Object.entries(s.categories)) {
    if (key === oldName) rebuilt[target] = { name: target, accounts: value.accounts };
    else rebuilt[key] = value;
  }
  s.categories = rebuilt;
  persist();
  log('system', `Category renamed: ${oldName} -> ${target}`);
}

export function deleteCategory(name: string): void {
  const s = loadStore();
  if (!s.categories[name]) throw new ValidationError(`Category '${name}' does not exist`, 'name');
  delete s.categories[name];
  ensureDefault();
  persist();
  log('system', `Category deleted: ${name}`);
}

export interface SaveAccountInput {
  id: string;
  username: string;
  displayName?: string;
  created?: string;
  rap?: string;
  verified?: string;
  banned?: string;
  active?: string;
  hats?: string;
  badges?: string[];
  note?: string;
  avatarUrl?: string | null;
  lastChecked?: string | null;
  inventorySummary?: SavedAccount['inventorySummary'];
}

/**
 * Save (or update) accounts into a category.
 * Existing notes are preserved when the incoming record has none, matching the
 * desktop tool's `note: category_obj.get(uid, {}).get("note", "")`.
 */
export function saveAccounts(category: string, accounts: SaveAccountInput[]): { saved: number; category: string } {
  const catName = asText(category, 60, 'category').trim();
  if (!catName) throw new ValidationError('Category is required', 'category');
  if (!accounts.length) throw new ValidationError('No accounts to save', 'accounts');

  const s = loadStore();
  if (!s.categories[catName]) s.categories[catName] = { name: catName, accounts: {} };
  const bucket = s.categories[catName].accounts;

  let saved = 0;
  for (const input of accounts) {
    const clean = sanitizeAccount(input, String(input.id));
    if (!clean) continue;
    const existing = bucket[clean.id];
    if (existing && existing.note.trim() && !clean.note.trim()) clean.note = existing.note;
    bucket[clean.id] = clean;
    saved++;
  }

  persist();
  log('system', `Saved ${saved} account(s) to category '${catName}'`);
  return { saved, category: catName };
}

export function removeFromCategory(category: string, id: string): boolean {
  const s = loadStore();
  const cat = s.categories[category];
  if (!cat || !cat.accounts[id]) return false;
  delete cat.accounts[id];
  persist();
  log('system', `Removed account ${id} from category '${category}'`);
  return true;
}

export function updateNote(category: string, id: string, note: string): boolean {
  const s = loadStore();
  const cat = s.categories[category];
  if (!cat || !cat.accounts[id]) return false;
  cat.accounts[id].note = asText(note, 4000, 'note');
  persist();
  return true;
}

export function updateAccount(category: string, id: string, patch: Partial<SaveAccountInput>): boolean {
  const s = loadStore();
  const cat = s.categories[category];
  if (!cat || !cat.accounts[id]) return false;
  const merged = sanitizeAccount({ ...cat.accounts[id], ...patch }, id);
  if (!merged) return false;
  cat.accounts[id] = merged;
  persist();
  return true;
}

/* ------------------------------ import/export ----------------------------- */

export function exportStore(): SavedStore {
  return JSON.parse(JSON.stringify(loadStore()));
}

export interface ImportReport {
  categories: number;
  accounts: number;
  skipped: number;
  errors: string[];
}

/** Validated import. Anything that does not conform is skipped, not trusted. */
export function importStore(raw: unknown, mode: 'merge' | 'replace' = 'merge'): ImportReport {
  if (!raw || typeof raw !== 'object') throw new ValidationError('Import file must be a JSON object', 'file');
  const incoming = sanitizeStore(raw);
  const report: ImportReport = { categories: 0, accounts: 0, skipped: 0, errors: [] };

  const rawCats = (raw as Record<string, unknown>).categories as Record<string, unknown>;
  let expectedAccounts = 0;
  for (const cat of Object.values(rawCats ?? {})) {
    const accs = (cat as Record<string, unknown> | null)?.accounts;
    if (accs && typeof accs === 'object') expectedAccounts += Object.keys(accs).length;
  }

  if (mode === 'replace') store = { categories: {} };
  const s = loadStore();

  for (const [name, cat] of Object.entries(incoming.categories)) {
    if (!s.categories[name]) s.categories[name] = { name, accounts: {} };
    report.categories++;
    for (const [id, acc] of Object.entries(cat.accounts)) {
      s.categories[name].accounts[id] = acc;
      report.accounts++;
    }
  }

  report.skipped = Math.max(0, expectedAccounts - report.accounts);
  ensureDefault();
  persist();
  log('system', `Imported ${report.accounts} account(s) across ${report.categories} categor(y/ies)`);
  return report;
}

export function resetStore(): void {
  store = { categories: {} };
  loaded = true;
  ensureDefault();
  persist();
  log('system', 'Local saved data cleared');
}
