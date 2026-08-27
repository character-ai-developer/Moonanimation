import type {
  ApiStatus,
  AssetDetails,
  InventoryPage,
  RobloxBadge,
  SavedStore,
  ScanProgress,
  SearchConfig,
  SearchResult,
  SortOption,
  UserProfile,
} from '../../shared/types';

/**
 * Single client for the whole app. Every component talks to the backend
 * through this module — no component ever calls fetch or touches a Roblox URL.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly kind?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface Envelope {
  ok?: boolean;
  error?: string;
  kind?: string;
  [k: string]: unknown;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError('Connection failed', null);
  }

  const text = await res.text();
  let body: Envelope = {};
  try {
    body = text ? (JSON.parse(text) as Envelope) : {};
  } catch {
    if (!res.ok) throw new ApiError('The server returned an unreadable response', res.status);
  }

  if (!res.ok) {
    throw new ApiError(body.error || `Request failed (${res.status})`, res.status, body.kind);
  }
  return body as T;
}

const get = <T,>(p: string, signal?: AbortSignal) => request<T>(p, { signal });
const post = <T,>(p: string, body?: unknown, signal?: AbortSignal) =>
  request<T>(p, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body), signal });
const put = <T,>(p: string, body?: unknown) => request<T>(p, { method: 'PUT', body: JSON.stringify(body ?? {}) });
const del = <T,>(p: string) => request<T>(p, { method: 'DELETE' });

/* --------------------------------- users ---------------------------------- */

export interface ProfileResponse {
  ok: boolean;
  profile?: UserProfile;
  error?: string;
}

export const api = {
  user: {
    byName: (username: string, signal?: AbortSignal) =>
      get<ProfileResponse>(`/users/${encodeURIComponent(username)}`, signal),
    byId: (id: number | string, signal?: AbortSignal) => get<ProfileResponse>(`/users/id/${id}`, signal),
    /** Accepts either a username or a numeric ID, matching the lookup box. */
    lookup: (query: string, signal?: AbortSignal) =>
      /^\d+$/.test(query.trim()) ? api.user.byId(query.trim(), signal) : api.user.byName(query.trim(), signal),
    avatar: (id: number | string, signal?: AbortSignal) =>
      get<{ ok: boolean; imageUrl?: string }>(`/users/${id}/avatar`, signal),
    avatars: (ids: (number | string)[], signal?: AbortSignal) =>
      post<{ ok: boolean; avatars: Record<string, string | null> }>('/users/avatars', { userIds: ids }, signal),
    badges: (id: number | string, signal?: AbortSignal) =>
      get<{ ok: boolean; badges: RobloxBadge[] }>(`/users/${id}/badges`, signal),
  },

  meta: {
    badges: () => get<{ ok: boolean; badges: string[]; iconMap: Record<string, string> }>('/users/meta/badges'),
    search: () => get<SearchMeta>('/search/meta'),
  },

  inventory: {
    page: (id: number | string, cursor: string | null, limit: number, signal?: AbortSignal) =>
      get<InventoryPage & { ok: boolean }>(
        `/users/${id}/inventory?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        signal,
      ),
    verified: (id: number | string, signal?: AbortSignal) =>
      get<{ ok: boolean; verified: boolean; known: boolean }>(`/users/${id}/verified`, signal),
    /** Cached asset metadata + background warming for the rest. */
    enrich: (assetIds: number[], signal?: AbortSignal) =>
      post<{ ok: boolean; details: Record<number, AssetDetails>; warming: number }>('/inventory/enrich', { assetIds }, signal),
  },

  asset: (id: number | string, signal?: AbortSignal) =>
    get<{ ok: boolean; asset: AssetDetails }>(`/assets/${id}`, signal),

  thumbnails: (assetIds: number[], size = '150x150', signal?: AbortSignal) =>
    get<{ ok: boolean; thumbnails: Record<string, string | null> }>(
      `/thumbnails/assets?assetIds=${assetIds.join(',')}&size=${size}`,
      signal,
    ),

  search: {
    start: (cfg: Partial<SearchConfig>) => post<{ ok: boolean; jobId: string; progress: ScanProgress }>('/search/start', cfg),
    stop: (jobId: string) => post<{ ok: boolean; progress: ScanProgress }>('/search/stop', { jobId }),
    get: (jobId: string, sort: SortOption = 'None', signal?: AbortSignal) =>
      get<{ ok: boolean; progress: ScanProgress; results: SearchResult[] }>(
        `/search/${jobId}?sort=${encodeURIComponent(sort)}`,
        signal,
      ),
    nonstop: (jobId: string, signal?: AbortSignal) =>
      get<{ ok: boolean; files: string[]; buckets: Record<string, string[]> }>(`/search/${jobId}/nonstop`, signal),
  },

  saved: {
    all: (signal?: AbortSignal) =>
      get<{ ok: boolean; store: SavedStore; categories: CategorySummary[]; index: Record<string, string[]> }>(
        '/saved',
        signal,
      ),
    createCategory: (name: string) => post<{ ok: boolean }>('/saved/category', { name }),
    renameCategory: (name: string, newName: string) => put<{ ok: boolean }>(`/saved/category/${encodeURIComponent(name)}`, { newName }),
    deleteCategory: (name: string) => del<{ ok: boolean }>(`/saved/category/${encodeURIComponent(name)}`),
    save: (category: string, accounts: unknown[]) =>
      post<{ ok: boolean; saved: number }>(`/saved/${encodeURIComponent(category)}/accounts`, { accounts }),
    remove: (category: string, id: string) =>
      del<{ ok: boolean }>(`/saved/${encodeURIComponent(category)}/accounts/${id}`),
    note: (category: string, id: string, note: string) =>
      put<{ ok: boolean }>(`/saved/${encodeURIComponent(category)}/accounts/${id}/note`, { note }),
    update: (category: string, id: string, patch: Record<string, unknown>) =>
      put<{ ok: boolean }>(`/saved/${encodeURIComponent(category)}/accounts/${id}`, patch),
    import: (data: unknown, mode: 'merge' | 'replace') =>
      post<{ ok: boolean; report: ImportReport }>('/saved/import', { data, mode }),
    reset: () => del<{ ok: boolean }>('/saved'),
  },

  status: (signal?: AbortSignal) => get<{ ok: boolean; status: ApiStatus }>('/status', signal),

  settings: {
    get: (signal?: AbortSignal) =>
      get<{ ok: boolean; settings: Record<string, unknown>; cache: Record<string, CacheStat>; rateLimit: RateLimitInfo }>(
        '/settings',
        signal,
      ),
    test: () => post<{ ok: boolean; status: ApiStatus }>('/settings/test'),
    clearCache: () => post<{ ok: boolean }>('/settings/cache/clear'),
    mock: (enabled: boolean) => post<{ ok: boolean; mockMode: boolean }>('/settings/mock', { enabled }),
  },
};

export interface CategorySummary {
  name: string;
  count: number;
  withNotes: number;
}
export interface ImportReport {
  categories: number;
  accounts: number;
  skipped: number;
  errors: string[];
}
export interface CacheStat {
  hits: number;
  misses: number;
  entries: number;
}
export interface RateLimitInfo {
  hits: number;
  backoffUntil: number | null;
  totalRequests: number;
}
export interface SearchMeta {
  ok: boolean;
  methods: string[];
  years: string[];
  sortOptions: SortOption[];
  maxConcurrency: number;
  maxScanAttempts: number;
  maxScanResults: number;
  banFilters: string[];
  verifiedFilters: string[];
  activeFilters: string[];
  rapPresets: { label: string; value: number | null }[];
  hatPresets: { label: string; value: number | null }[];
}

/* ----------------------------------- SSE ---------------------------------- */

export interface SseHandle {
  close: () => void;
}

/**
 * Server-Sent Events helper with automatic reconnect on unexpected close.
 * Used for both scan progress and the live log tail.
 */
export function subscribeSse(
  path: string,
  handlers: Record<string, (data: unknown) => void>,
  onStateChange?: (state: 'connecting' | 'open' | 'closed') => void,
): SseHandle {
  const source = new EventSource(`/api${path}`);
  let closed = false;

  onStateChange?.('connecting');
  source.onopen = () => onStateChange?.('open');
  source.onerror = () => {
    if (!closed) onStateChange?.('closed');
  };

  for (const [event, fn] of Object.entries(handlers)) {
    source.addEventListener(event, (e: MessageEvent) => {
      try {
        fn(JSON.parse(e.data));
      } catch {
        /* ignore a malformed frame rather than killing the stream */
      }
    });
  }

  return {
    close: () => {
      closed = true;
      source.close();
      onStateChange?.('closed');
    },
  };
}
