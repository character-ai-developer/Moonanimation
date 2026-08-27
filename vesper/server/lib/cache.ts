import { config } from './config';

interface Entry<T> {
  value: T;
  expires: number;
}

export interface CacheLike {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttlMs?: number): void;
  del(key: string): void;
  clear(): void;
  size(): number;
  stats(): { hits: number; misses: number; entries: number };
}

/**
 * Bounded in-memory TTL cache with LRU-ish eviction.
 *
 * Deliberately written against the `CacheLike` interface so a Redis adapter can
 * be dropped in (config.redisUrl) without touching any service code.
 */
export class MemoryCache implements CacheLike {
  private store = new Map<string, Entry<unknown>>();
  private hits = 0;
  private misses = 0;

  constructor(private readonly maxEntries = 5000) {}

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (entry.expires < Date.now()) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    // refresh recency for LRU ordering
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number = config.cacheTtlMs): void {
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expires: Date.now() + ttlMs });
  }

  del(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }

  size(): number {
    return this.store.size;
  }

  stats() {
    return { hits: this.hits, misses: this.misses, entries: this.store.size };
  }
}

export const profileCache = new MemoryCache(4000);
export const usernameCache = new MemoryCache(8000);
export const badgeCache = new MemoryCache(2000);
export const inventoryCache = new MemoryCache(1500);
export const assetCache = new MemoryCache(6000);
export const thumbnailCache = new MemoryCache(8000);

export const caches = { profileCache, usernameCache, badgeCache, inventoryCache, assetCache, thumbnailCache };

export function clearAllCaches() {
  for (const c of Object.values(caches)) c.clear();
}

export function cacheStats() {
  return Object.fromEntries(Object.entries(caches).map(([k, c]) => [k, c.stats()]));
}
