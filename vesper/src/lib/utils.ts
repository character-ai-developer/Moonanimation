/* Formatting, preferences and export helpers. */

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'Unavailable';
  return n.toLocaleString('en-US');
}

/** RAP is a string upstream because "Unknown" is a legitimate value. */
export function formatRap(rap: string | null | undefined): string {
  if (!rap || rap === 'Unknown') return 'Unknown';
  return rap;
}

export function parseRap(rap: string | null | undefined): number | null {
  if (!rap || rap === 'Unknown') return null;
  const n = Number.parseInt(rap.replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'Unavailable';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return 'Unavailable';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

export function formatClock(ts: number): string {
  const d = new Date(ts);
  return d.toTimeString().slice(0, 8);
}

/** "17 years, 4 months" style age from an ISO date. */
export function accountAge(iso: string | null | undefined): string {
  if (!iso) return 'Unavailable';
  const start = new Date(iso);
  if (Number.isNaN(start.getTime())) return 'Unavailable';
  const now = new Date();

  let years = now.getUTCFullYear() - start.getUTCFullYear();
  let months = now.getUTCMonth() - start.getUTCMonth();
  if (now.getUTCDate() < start.getUTCDate()) months--;
  if (months < 0) {
    years--;
    months += 12;
  }
  if (years <= 0 && months <= 0) return 'Less than a month';
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} ${years === 1 ? 'year' : 'years'}`);
  if (months > 0) parts.push(`${months} ${months === 1 ? 'month' : 'months'}`);
  return parts.join(', ');
}

export function elapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function compactNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/* ------------------------------- preferences ------------------------------ */

export interface Prefs {
  sidebarCollapsed: boolean;
  clayIntensity: number;
  brightness: 'dim' | 'normal' | 'bright';
  motion: 'full' | 'reduced';
  compact: boolean;
  inventoryView: 'grid' | 'compact' | 'table';
  inventoryLimit: number;
}

const PREFS_KEY = 'vesper.prefs.v1';

export const DEFAULT_PREFS: Prefs = {
  sidebarCollapsed: false,
  clayIntensity: 1,
  brightness: 'normal',
  motion: 'full',
  compact: false,
  inventoryView: 'grid',
  inventoryLimit: 100,
};

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    // Never trust stored values blindly — fall back per key.
    return { ...DEFAULT_PREFS, ...sanitisePrefs(parsed) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function sanitisePrefs(p: Partial<Prefs>): Partial<Prefs> {
  const out: Partial<Prefs> = {};
  if (typeof p.sidebarCollapsed === 'boolean') out.sidebarCollapsed = p.sidebarCollapsed;
  if (typeof p.clayIntensity === 'number' && p.clayIntensity >= 0 && p.clayIntensity <= 2)
    out.clayIntensity = p.clayIntensity;
  if (p.brightness === 'dim' || p.brightness === 'normal' || p.brightness === 'bright') out.brightness = p.brightness;
  if (p.motion === 'full' || p.motion === 'reduced') out.motion = p.motion;
  if (typeof p.compact === 'boolean') out.compact = p.compact;
  if (p.inventoryView === 'grid' || p.inventoryView === 'compact' || p.inventoryView === 'table')
    out.inventoryView = p.inventoryView;
  if ([10, 25, 50, 100].includes(p.inventoryLimit as number)) out.inventoryLimit = p.inventoryLimit as number;
  return out;
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode / quota — preferences simply will not persist */
  }
}

/** Applies preference-driven data attributes and CSS tokens to <html>. */
export function applyPrefs(prefs: Prefs): void {
  const root = document.documentElement;
  root.style.setProperty('--clay-scale', String(prefs.clayIntensity));
  root.dataset.brightness = prefs.brightness;
  root.dataset.motion = prefs.motion;
  root.dataset.compact = String(prefs.compact);
}

/* --------------------------------- export --------------------------------- */

function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** RFC-4180-ish CSV escaping. Values are never interpreted as formulas. */
function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  const needsQuotes = /[",\n\r]/.test(s);
  const body = s.replace(/"/g, '""');
  return needsQuotes ? `"${body}"` : body;
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (!rows.length) return '';
  const cols = columns ?? Object.keys(rows[0]);
  const lines = [cols.join(',')];
  for (const row of rows) lines.push(cols.map((c) => csvEscape(row[c])).join(','));
  return lines.join('\r\n');
}

export function exportFile(
  format: 'csv' | 'json' | 'txt',
  name: string,
  rows: Record<string, unknown>[],
  columns?: string[],
): void {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  if (format === 'json') {
    download(`${name}-${stamp}.json`, JSON.stringify(rows, null, 2), 'application/json');
  } else if (format === 'txt') {
    const body = columns
      ? rows.map((r) => columns.map((c) => `${c}=${r[c] ?? ''}`).join('\t')).join('\n')
      : rows.map((r) => Object.values(r).join('\t')).join('\n');
    download(`${name}-${stamp}.txt`, body, 'text/plain');
  } else {
    download(`${name}-${stamp}.csv`, toCsv(rows, columns), 'text/csv');
  }
}

export function downloadText(filename: string, text: string): void {
  download(filename, text, 'text/plain');
}

/* ---------------------------------- misc ---------------------------------- */

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context; fall back for http previews.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function openProfile(userId: number | string): void {
  window.open(`https://www.roblox.com/users/${userId}/profile`, '_blank', 'noopener,noreferrer');
}

export function openCatalog(assetId: number | string): void {
  window.open(`https://www.roblox.com/catalog/${assetId}`, '_blank', 'noopener,noreferrer');
}

export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T & { cancel: () => void } {
  let t: ReturnType<typeof setTimeout> | undefined;
  const wrapped = ((...args: Parameters<T>) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }) as T & { cancel: () => void };
  wrapped.cancel = () => {
    if (t) clearTimeout(t);
  };
  return wrapped;
}
