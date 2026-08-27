/**
 * Input validation / sanitisation helpers.
 * Every value that reaches a route handler passes through one of these so the
 * API never forwards arbitrary user input to Roblox or into a file path.
 */

export class ValidationError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Roblox usernames: 3-20 chars, alphanumerics and single underscores. */
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

export function asUsername(value: unknown, field = 'username'): string {
  if (typeof value !== 'string') throw new ValidationError('Username must be a string', field);
  const trimmed = value.trim();
  if (!USERNAME_RE.test(trimmed)) {
    throw new ValidationError(
      'Username must be 3-20 characters using letters, numbers and underscores',
      field,
    );
  }
  return trimmed;
}

export function asUserId(value: unknown, field = 'id'): number {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0 || n > 9_000_000_000) {
    throw new ValidationError('User ID must be a positive integer', field);
  }
  return n;
}

export function asAssetId(value: unknown, field = 'assetId'): number {
  return asUserId(value, field);
}

export function optionalInt(value: unknown, field: string, min: number, max: number): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number.parseInt(String(value).replace(/,/g, ''), 10);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new ValidationError(`${field} must be an integer`, field);
  if (n < min || n > max) throw new ValidationError(`${field} must be between ${min} and ${max}`, field);
  return n;
}

export function asCursor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (!t || t === 'null') return null;
  if (t.length > 400) throw new ValidationError('Cursor is malformed', 'cursor');
  // cursors are opaque but always url-safe in practice; reject anything exotic
  if (!/^[A-Za-z0-9_.\-]+$/.test(t)) throw new ValidationError('Cursor is malformed', 'cursor');
  return t;
}

export function asLimit(value: unknown, allowed: number[], fallback: number): number {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || !allowed.includes(n)) return fallback;
  return n;
}

/** Length-capped string, control characters stripped. */
export function asText(value: unknown, max: number, field: string): string {
  if (value === undefined || value === null) return '';
  const s = String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  if (s.length > max) throw new ValidationError(`${field} is too long (max ${max})`, field);
  return s;
}

export function asBadgeName(value: unknown, field = 'badge'): string {
  const s = asText(value, 60, field);
  if (!s) throw new ValidationError('Badge name is required', field);
  return s;
}

export function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T, _field?: string): T {
  const s = String(value ?? '');
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

export function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return fallback;
}

export function asStringArray(value: unknown, max = 20, itemMax = 60): string[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max).map((v) => asText(v, itemMax, 'array item')).filter(Boolean);
}
