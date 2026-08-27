/**
 * Shared data model — used by both the Express backend and the React frontend.
 * These interfaces are the single source of truth for the wire format.
 */

export type YesNo = 'Yes' | 'No';
export type TriState = 'Yes' | 'No' | 'Unknown';

/** Raw Roblox user record, as returned by users.roblox.com/v1/users/:id */
export interface User {
  id: number;
  name: string;
  displayName: string;
  created: string | null;
  description: string;
  isBanned: boolean;
}

/** The evaluated account record produced by a lookup or a scan attempt. */
export interface UserProfile {
  id: number;
  username: string;
  displayName: string;
  /** ISO date string from Roblox, when available */
  created: string | null;
  /** YYYY-MM-DD rendering of `created` */
  createdDate: string;
  createdYear: number | null;
  description: string;
  banned: YesNo;
  verified: YesNo;
  /** Heuristic-derived activity signal — see server/services/accountEvaluation.ts */
  active: TriState;
  activeReasons: string[];
  /** Formatted RAP total, or the literal string "Unknown" when the API refused */
  rap: string;
  rapValue: number | null;
  hats: string;
  hatCount: number | null;
  rigType: 'R6' | 'R15' | null;
  avatarUrl: string | null;
  badges: RobloxBadge[];
  inventoryStatus: InventoryStatus;
  profileUrl: string;
  /** Timestamp (ms) this profile was assembled */
  fetchedAt: number;
  /** Which upstream endpoints failed while building this profile */
  degraded: string[];
}

export interface RobloxBadge {
  id: number | null;
  name: string;
  description: string | null;
  /** Stable icon URL resolved server-side; falls back to a bundled SVG mark */
  iconUrl: string | null;
  awardedDate: string | null;
}

export type InventoryStatus = 'ok' | 'private' | 'unavailable' | 'error';

export interface InventorySummary {
  status: InventoryStatus;
  /** Human-readable explanation shown verbatim in the UI — never a fabricated 0 */
  message: string;
  itemCount: number | null;
  totalRap: number | null;
  averageRap: number | null;
  highest: { name: string; rap: number; assetId: number } | null;
  lowest: { name: string; rap: number; assetId: number } | null;
  limitedCount: number | null;
  limitedUniqueCount: number | null;
  /** Which transport produced this page set */
  source: 'opencloud' | 'legacy' | 'none';
}

export interface CollectibleItem {
  /** Present on the legacy transport */
  userAssetId: string | null;
  assetId: number;
  name: string;
  rap: number | null;
  serialNumber: string | null;
  originalPrice: number | null;
  assetStock: number | null;
  isOnHold: boolean | null;
  collectibleItemId: string | null;
  /** Populated from the asset-details endpoint; null when that call failed */
  creator: { id: number | null; name: string | null; type: string | null } | null;
  assetTypeId: number | null;
  assetTypeName: string | null;
  isLimited: boolean | null;
  isLimitedUnique: boolean | null;
  /** Lowest current resale price, when the collectible details expose it */
  lowestResalePrice: number | null;
  totalQuantity: number | null;
  sales: number | null;
  created: string | null;
  thumbnailUrl: string | null;
  itemUrl: string;
  /** Asset-details lookup failed — card renders "Unavailable" rather than a guess */
  detailsDegraded: boolean;
}

export interface InventoryPage {
  items: CollectibleItem[];
  nextCursor: string | null;
  hasMore: boolean;
  summary: InventorySummary;
  /** Total items observed across every page fetched for this job so far */
  seenTotal: number;
}

export interface AssetDetails {
  assetId: number;
  name: string | null;
  description: string | null;
  assetTypeId: number | null;
  assetTypeName: string | null;
  creator: { id: number | null; name: string | null; type: string | null; hasVerifiedBadge: boolean | null } | null;
  created: string | null;
  updated: string | null;
  priceInRobux: number | null;
  isLimited: boolean | null;
  isLimitedUnique: boolean | null;
  productType: string | null;
  collectibleItemId: string | null;
  lowestResalePrice: number | null;
  totalQuantity: number | null;
  sales: number | null;
  thumbnailUrl: string | null;
}

/* ---------------------------------- saved --------------------------------- */

export interface SavedAccount {
  id: string;
  username: string;
  displayName: string;
  created: string;
  rap: string;
  verified: string;
  banned: string;
  active: string;
  hats: string;
  badges: string[];
  note: string;
  avatarUrl: string | null;
  lastChecked: string | null;
  inventorySummary: { status: InventoryStatus; itemCount: number | null; totalRap: number | null } | null;
  savedAt: string;
}

export interface SavedCategory {
  name: string;
  accounts: Record<string, SavedAccount>;
}

export interface SavedStore {
  categories: Record<string, SavedCategory>;
}

/* --------------------------------- scanning ------------------------------- */

export const SEARCH_METHODS = [
  'random',
  'numberless',
  'numbers',
  'ends_in_123',
  'ends_in_1_digit',
  'ends_in_2_digits',
  'ends_in_4_digits',
  'year',
  'double',
  'real_name',
  'double_real_name',
  '4digits_real_name',
  'nonstop',
] as const;
export type SearchMethod = (typeof SEARCH_METHODS)[number];

export const SORT_OPTIONS = [
  'None',
  'Username A→Z',
  'Username Z→A',
  'ID low→high',
  'ID high→low',
  'Created oldest→newest',
  'Created newest→oldest',
  'RAP high→low',
  'RAP low→high',
  'Verified Yes first',
  'Verified No first',
  'Banned Yes first',
  'Banned No first',
  'Active Yes first',
  'Active No first',
] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

export type BanFilter = 'All' | 'Only not banned' | 'Only banned';
export type VerifiedFilter = 'All' | 'Only verified' | 'Only unverified';
export type ActiveFilter = 'All' | 'Only active' | 'Only inactive';

export interface SearchConfig {
  years: string[];
  method: SearchMethod;
  amount: number;
  rapMin: number | null;
  includeUnknownRap: boolean;
  banFilter: BanFilter;
  verifiedFilter: VerifiedFilter;
  activeFilter: ActiveFilter;
  hatMin: number | null;
  usernameMinLen: number | null;
  usernameMaxLen: number | null;
  useIdRange: boolean;
  idMin: number | null;
  idMax: number | null;
  requiredBadges: string[];
  skipSaved: boolean;
  concurrency: number;
}

export interface SearchResult {
  username: string;
  id: string;
  created: string;
  rap: string;
  rapValue: number | null;
  roblox_badges: RobloxBadge[];
  verified: YesNo;
  banned: YesNo;
  active: TriState;
  hats: string;
  hatCount: number | null;
  avatarUrl: string | null;
  activeReasons: string[];
  /** Nonstop output classification, when the method is nonstop */
  outputFile: string | null;
}

export type ScanPhase = 'idle' | 'running' | 'stopping' | 'done' | 'error';

export interface ScanProgress {
  jobId: string;
  phase: ScanPhase;
  scanned: number;
  found: number;
  rejected: number;
  errors: number;
  requests: number;
  target: number | null;
  method: SearchMethod;
  years: string[];
  idRange: { min: number; max: number } | null;
  startedAt: number;
  elapsedMs: number;
  /** Wall-clock ms the rate limiter is currently holding workers for */
  backoffUntil: number | null;
  rateLimitHits: number;
  activeWorkers: number;
  concurrency: number;
  nonstopFiles: Record<string, number>;
  lastResult: SearchResult | null;
}

/* ---------------------------------- logs ---------------------------------- */

export type LogType = 'method' | 'filter' | 'ratelimit' | 'worker' | 'lookup' | 'api' | 'error' | 'system';

export interface LogEntry {
  id: string;
  ts: number;
  type: LogType;
  message: string;
  jobId: string | null;
  userId: number | null;
  status: number | null;
  detail: string | null;
}

/* --------------------------------- status --------------------------------- */

export type ApiHealth = 'connected' | 'degraded' | 'ratelimited' | 'offline';

export interface ApiStatus {
  health: ApiHealth;
  checkedAt: number;
  latencyMs: number | null;
  openCloudConfigured: boolean;
  endpoints: { name: string; ok: boolean; status: number | null; latencyMs: number | null }[];
  rateLimitHits: number;
  backoffUntil: number | null;
}
