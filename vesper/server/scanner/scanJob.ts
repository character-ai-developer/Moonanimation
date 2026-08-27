import { randomInt } from 'node:crypto';
import type { ScanProgress, SearchConfig, SearchResult, SortOption } from '../../shared/types';
import { config } from '../lib/config';
import { log } from '../lib/logger';
import { getAvatarHeadshot } from '../services/robloxThumbnailsService';
import { getAccountBadges } from '../services/robloxBadgesService';
import { getFullCollectibles, getHatCount, ownsVerifiedBadgeAsset } from '../services/robloxInventoryService';
import { getRigType, getUserById } from '../services/robloxUsersService';
import { getSavedIds } from '../services/savedService';
import { classifyNonstopOutput, usernameMatchesMethod, YEAR_ID_RANGES } from './usernameMethods';

const MAX_NONSTOP_NAMES_PER_BUCKET = 5000;

export interface ScanJob {
  id: string;
  config: SearchConfig;
  progress: ScanProgress;
  results: SearchResult[];
  nonstopBuckets: Map<string, Set<string>>;
  controller: AbortController;
  startedAt: number;
  /** Every ID present in any saved category — the desktop tool's skip set. */
  skipIds: Set<number>;
}

const jobs = new Map<string, ScanJob>();
const subscribers = new Map<string, Set<(p: ScanProgress) => void>>();

let jobSeq = 0;

export function getJob(id: string): ScanJob | undefined {
  return jobs.get(id);
}

export function listJobIds(): string[] {
  return [...jobs.keys()];
}

export function subscribeProgress(id: string, fn: (p: ScanProgress) => void): () => void {
  if (!subscribers.has(id)) subscribers.set(id, new Set());
  subscribers.get(id)!.add(fn);
  return () => subscribers.get(id)?.delete(fn);
}

function publish(job: ScanJob): void {
  job.progress.elapsedMs = Date.now() - job.startedAt;
  const snapshot: ScanProgress = {
    ...job.progress,
    nonstopFiles: Object.fromEntries([...job.nonstopBuckets].map(([k, v]) => [k, v.size])),
    lastResult: job.results[job.results.length - 1] ?? null,
  };
  for (const fn of subscribers.get(job.id) ?? []) {
    try {
      fn(snapshot);
    } catch {
      /* ignore dead subscribers */
    }
  }
}

function randomIdForYears(years: string[]): number {
  if (!years.length) {
    const [lo, hi] = YEAR_ID_RANGES['Any year'];
    return randomInt(lo, hi + 1);
  }
  const year = years[randomInt(0, years.length)];
  const range = YEAR_ID_RANGES[year] ?? YEAR_ID_RANGES['Any year'];
  return randomInt(range[0], range[1] + 1);
}

function generateId(job: ScanJob): number {
  const { useIdRange, idMin, idMax, years } = job.config;
  if (useIdRange && idMin != null && idMax != null) return randomInt(idMin, idMax + 1);
  return randomIdForYears(years);
}

export function validateConfig(cfg: SearchConfig): string | null {
  if (cfg.useIdRange) {
    if (cfg.idMin == null || cfg.idMax == null || cfg.idMin <= 0 || cfg.idMax <= 0 || cfg.idMin >= cfg.idMax) {
      return 'Please enter a valid ID range: positive numbers and From ID < To ID.';
    }
  } else if (cfg.method !== 'nonstop') {
    if (!cfg.years.length) return 'Please select at least one year.';
    for (const y of cfg.years) {
      if (!YEAR_ID_RANGES[y]) return `Unknown year selection: ${y}`;
    }
    if (!Number.isInteger(cfg.amount) || cfg.amount <= 0) return 'Amount must be a positive integer.';
  }
  if (
    cfg.usernameMinLen != null &&
    cfg.usernameMaxLen != null &&
    cfg.usernameMinLen > cfg.usernameMaxLen
  ) {
    return 'Minimum username length cannot exceed the maximum.';
  }
  return null;
}

/**
 * One scan attempt — the web equivalent of GenerateWorker._single_attempt.
 * Returns null when the candidate is rejected, with the rejection logged under
 * the same category the desktop tool used.
 */
async function singleAttempt(job: ScanJob, attemptIdx: number, seenIds: Set<number>): Promise<SearchResult | null> {
  const { config: cfg, controller } = job;
  if (controller.signal.aborted) return null;

  const uid = generateId(job);
  if (seenIds.has(uid)) return null;
  seenIds.add(uid);

  if (cfg.skipSaved && job.skipIds.has(uid)) {
    log('filter', `[${attemptIdx}] ${uid} skipped (in saved IDs skip set)`, { jobId: job.id, userId: uid });
    return null;
  }

  const { user, error } = await getUserById(uid, controller.signal);
  if (controller.signal.aborted) return null;
  if (!user) {
    if (error?.kind === 'rate_limited') job.progress.rateLimitHits++;
    return null;
  }

  const username = user.name || '';
  const { matches, reason } = usernameMatchesMethod(username, cfg.method);
  if (!matches) {
    log(
      'method',
      `[${attemptIdx}] ${uid}: '${username}' filtered by method (${cfg.method}) - reason: ${reason}`,
      { jobId: job.id, userId: uid },
    );
    return null;
  }

  const [plaidHat, rigType, collectibles, hats, badges] = await Promise.all([
    ownsVerifiedBadgeAsset(uid, controller.signal),
    getRigType(uid, controller.signal),
    getFullCollectibles(uid, controller.signal),
    cfg.hatMin != null ? getHatCount(uid, controller.signal) : Promise.resolve(null),
    cfg.requiredBadges.length ? getAccountBadges(uid, controller.signal) : Promise.resolve([]),
  ]);
  if (controller.signal.aborted) return null;

  const banned = user.isBanned ? 'Yes' : 'No';
  const verified = plaidHat === true ? 'Yes' : 'No';
  const displayName = user.displayName || '';
  const hasDistinctDisplayName = Boolean(displayName.trim()) && displayName !== username;
  const createdYear = user.created ? new Date(user.created).getUTCFullYear() : null;
  const oldPublicInventorySignal =
    createdYear !== null && createdYear <= 2014 && collectibles.status !== 'ok' && collectibles.items.length === 0;

  // Activity heuristic — same rules as the desktop tool, scan defaults to "No".
  const reasons: string[] = [];
  let active: 'Yes' | 'No' | null = null;
  if (plaidHat === true) {
    active = 'Yes';
    reasons.push('has_plaid_hat=True');
  }
  if (hasDistinctDisplayName) {
    active = 'Yes';
    reasons.push('has_distinct_display_name=True');
  }
  if (oldPublicInventorySignal) {
    active = 'Yes';
    reasons.push('old_public_inventory_signal=True (<=2014, inventory private now)');
  }
  if (rigType === 'R6') {
    active = 'Yes';
    reasons.push('is_r15=False (R6)');
  }
  if (active === null) {
    if (plaidHat === false) reasons.push('has_plaid_hat=False (no plaid-hat signal)');
    if (rigType === 'R15') {
      active = 'No';
      reasons.push('is_r15=True (R15) and no positive signals');
    }
  }
  if (active === null) {
    active = 'No';
    reasons.push('no decisive signals -> default unactive');
  }
  const activeFlag: 'Yes' | 'No' = active;

  log(
    'worker',
    `[${attemptIdx}] active-eval uid=${uid} is_r15=${rigType === 'R15'}, has_plaid_hat=${plaidHat}, ` +
      `username='${username}', display_name='${displayName}', ` +
      `has_distinct_display_name=${hasDistinctDisplayName}, year=${createdYear}, ` +
      `old_public_inventory_signal=${oldPublicInventorySignal} -> active=${activeFlag} (${reasons.join(', ')})`,
    { jobId: job.id, userId: uid },
  );

  // Nonstop only keeps inactive accounts, exactly as the desktop tool forced.
  if (cfg.method === 'nonstop' && activeFlag !== 'No') return null;

  const hatCount = cfg.hatMin != null ? hats : await getHatCount(uid, controller.signal);
  const robloxBadges = cfg.requiredBadges.length ? badges : await getAccountBadges(uid, controller.signal);

  // ---- advanced filters (mirrors _passes_advanced_filters) ----
  const rapStr = collectibles.rap;
  const u = username;
  if (cfg.usernameMinLen != null && u.length < cfg.usernameMinLen) return reject(job, attemptIdx, uid, username, rapStr, verified, banned, activeFlag, hatCount, robloxBadges);
  if (cfg.usernameMaxLen != null && u.length > cfg.usernameMaxLen) return reject(job, attemptIdx, uid, username, rapStr, verified, banned, activeFlag, hatCount, robloxBadges);

  if (rapStr === 'Unknown') {
    if (!cfg.includeUnknownRap) return reject(job, attemptIdx, uid, username, rapStr, verified, banned, activeFlag, hatCount, robloxBadges);
  } else if (cfg.rapMin != null) {
    const rapValue = Number.parseInt(rapStr.replace(/,/g, ''), 10);
    if (Number.isFinite(rapValue) && rapValue < cfg.rapMin) {
      return reject(job, attemptIdx, uid, username, rapStr, verified, banned, activeFlag, hatCount, robloxBadges);
    }
  }

  if (cfg.hatMin != null) {
    if (hatCount === null || hatCount < cfg.hatMin) {
      return reject(job, attemptIdx, uid, username, rapStr, verified, banned, activeFlag, hatCount, robloxBadges);
    }
  }

  if (cfg.banFilter === 'Only not banned' && banned === 'Yes') return reject(job, attemptIdx, uid, username, rapStr, verified, banned, activeFlag, hatCount, robloxBadges);
  if (cfg.banFilter === 'Only banned' && banned !== 'Yes') return reject(job, attemptIdx, uid, username, rapStr, verified, banned, activeFlag, hatCount, robloxBadges);

  if (cfg.verifiedFilter === 'Only verified' && verified !== 'Yes') return reject(job, attemptIdx, uid, username, rapStr, verified, banned, activeFlag, hatCount, robloxBadges);
  if (cfg.verifiedFilter === 'Only unverified' && verified === 'Yes') return reject(job, attemptIdx, uid, username, rapStr, verified, banned, activeFlag, hatCount, robloxBadges);

  if (cfg.activeFilter === 'Only active' && activeFlag !== 'Yes') return reject(job, attemptIdx, uid, username, rapStr, verified, banned, activeFlag, hatCount, robloxBadges);
  if (cfg.activeFilter === 'Only inactive' && activeFlag !== 'No') return reject(job, attemptIdx, uid, username, rapStr, verified, banned, activeFlag, hatCount, robloxBadges);

  if (cfg.requiredBadges.length) {
    const owned = new Set(robloxBadges.map((b) => b.name));
    if (!cfg.requiredBadges.every((b) => owned.has(b))) {
      return reject(job, attemptIdx, uid, username, rapStr, verified, banned, activeFlag, hatCount, robloxBadges);
    }
  }

  const avatarUrl = await getAvatarHeadshot(uid, controller.signal);

  const reasonSuffix = cfg.method !== 'random' && cfg.method !== 'nonstop' ? ` method_reason=${reason}` : '';
  log(
    'worker',
    `[${attemptIdx}] FOUND ${uid} ${username} created=${user.created?.slice(0, 10) ?? ''} ` +
      `RAP=${rapStr} badges=${robloxBadges.length} verified=${verified} banned=${banned} ` +
      `active=${activeFlag} hats=${hatCount ?? 'Unknown'}${reasonSuffix}`,
    { jobId: job.id, userId: uid },
  );

  let outputFile: string | null = null;
  if (cfg.method === 'nonstop') {
    outputFile = classifyNonstopOutput(username);
    if (outputFile) {
      if (!job.nonstopBuckets.has(outputFile)) job.nonstopBuckets.set(outputFile, new Set());
      const bucket = job.nonstopBuckets.get(outputFile)!;
      if (bucket.size < MAX_NONSTOP_NAMES_PER_BUCKET) bucket.add(username);
    }
  }

  return {
    username,
    id: String(uid),
    created: user.created ? new Date(user.created).toISOString().slice(0, 10) : '',
    rap: rapStr,
    rapValue: collectibles.rapValue,
    roblox_badges: robloxBadges,
    verified,
    banned,
    active: activeFlag,
    hats: hatCount === null ? 'Unknown' : String(hatCount),
    hatCount,
    avatarUrl,
    activeReasons: reasons,
    outputFile,
  };
}

function reject(
  job: ScanJob,
  attemptIdx: number,
  uid: number,
  username: string,
  rap: string,
  verified: string,
  banned: string,
  active: string,
  hatCount: number | null,
  badges: { name: string }[],
): null {
  log(
    'filter',
    `[${attemptIdx}] ${uid}: '${username}' filtered by advanced (rap=${rap}, verified=${verified}, ` +
      `banned=${banned}, active=${active}, hat_count=${hatCount}, badges=[${badges.map((b) => b.name).join(', ')}])`,
    { jobId: job.id, userId: uid },
  );
  return null;
}

export async function startScan(cfg: SearchConfig): Promise<ScanJob> {
  const id = `job_${Date.now()}_${++jobSeq}`;
  const job: ScanJob = {
    id,
    config: cfg,
    controller: new AbortController(),
    startedAt: Date.now(),
    results: [],
    nonstopBuckets: new Map(),
    skipIds: cfg.skipSaved ? getSavedIds() : new Set<number>(),
    progress: {
      jobId: id,
      phase: 'running',
      scanned: 0,
      found: 0,
      rejected: 0,
      errors: 0,
      requests: 0,
      target: cfg.method === 'nonstop' ? null : cfg.amount,
      method: cfg.method,
      years: cfg.years,
      idRange: cfg.useIdRange && cfg.idMin != null && cfg.idMax != null ? { min: cfg.idMin, max: cfg.idMax } : null,
      startedAt: Date.now(),
      elapsedMs: 0,
      backoffUntil: null,
      rateLimitHits: 0,
      activeWorkers: 0,
      concurrency: cfg.concurrency,
      nonstopFiles: {},
      lastResult: null,
    },
  };

  jobs.set(id, job);

  log(
    'worker',
    `Start: years=[${cfg.years.join(', ')}], method=${cfg.method}, target=${cfg.method === 'nonstop' ? 'unlimited' : cfg.amount}, ` +
      `rap_min=${cfg.rapMin}, use_id_range=${cfg.useIdRange}, id_min=${cfg.idMin}, id_max=${cfg.idMax}, ` +
      `active_filter=${cfg.activeFilter}, required_badges=[${cfg.requiredBadges.join(', ')}], ` +
      `skip_ids_count=${job.skipIds.size}, hat_min=${cfg.hatMin}, concurrency=${cfg.concurrency}`,
    { jobId: id },
  );

  publish(job);
  void runJob(job);
  return job;
}

/**
 * Bounded-concurrency worker pool.
 * The desktop tool kept a fixed number of futures in flight and refilled as
 * they completed; this does the same with async workers, and every worker
 * shares the single rate gate in lib/http.
 */
async function runJob(job: ScanJob): Promise<void> {
  const { config: cfg, controller } = job;
  const seenIds = new Set<number>();
  const maxAttempts = cfg.method === 'nonstop' ? Number.MAX_SAFE_INTEGER : config.maxScanAttempts;
  const maxResults = cfg.method === 'nonstop' ? config.maxScanResults : Math.min(cfg.amount, config.maxScanResults);
  const concurrency = Math.max(1, Math.min(cfg.concurrency, config.maxConcurrency));

  let attempts = 0;
  let nextAttempt = 0;
  let publishTick = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (controller.signal.aborted) return;
      if (attempts >= maxAttempts) return;
      if (job.results.length >= maxResults) return;

      const idx = ++nextAttempt;
      attempts++;
      job.progress.activeWorkers++;

      try {
        const result = await singleAttempt(job, idx, seenIds);
        job.progress.scanned++;
        if (result) {
          job.results.push(result);
          job.progress.found++;
        } else {
          job.progress.rejected++;
        }
      } catch (err) {
        job.progress.errors++;
        log('worker', `[${idx}] error: ${(err as Error).message}`, { jobId: job.id });
      } finally {
        job.progress.activeWorkers--;
      }

      job.progress.requests++;
      if (++publishTick % 3 === 0 || job.results.length >= maxResults) publish(job);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));

  job.progress.phase = controller.signal.aborted ? 'done' : 'done';
  job.progress.activeWorkers = 0;
  job.progress.elapsedMs = Date.now() - job.startedAt;
  publish(job);
  log('worker', `Finished. Found ${job.progress.found} accounts.`, { jobId: job.id });
}

export function stopScan(id: string): boolean {
  const job = jobs.get(id);
  if (!job) return false;
  if (job.progress.phase !== 'running') return false;
  job.progress.phase = 'stopping';
  publish(job);
  job.controller.abort();
  log('worker', 'Stop requested...', { jobId: id });
  job.progress.phase = 'done';
  publish(job);
  return true;
}

export function snapshot(job: ScanJob): ScanProgress {
  return {
    ...job.progress,
    elapsedMs: Date.now() - job.startedAt,
    nonstopFiles: Object.fromEntries([...job.nonstopBuckets].map(([k, v]) => [k, v.size])),
    lastResult: job.results[job.results.length - 1] ?? null,
  };
}

export function nonstopBucket(job: ScanJob, file: string): string[] {
  return [...(job.nonstopBuckets.get(file) ?? [])];
}

export function nonstopFileNames(job: ScanJob): string[] {
  return [...job.nonstopBuckets.keys()];
}

/* --------------------------------- sorting -------------------------------- */

function rapKey(r: SearchResult): number {
  if (r.rap === 'Unknown') return -1;
  const v = Number.parseInt(r.rap.replace(/,/g, ''), 10);
  return Number.isFinite(v) ? v : -1;
}

/** Mirrors the desktop tool's _apply_sort modes exactly. */
export function sortResults(results: SearchResult[], mode: SortOption): SearchResult[] {
  const out = [...results];
  const cmp: Record<string, (a: SearchResult, b: SearchResult) => number> = {
    'Username A→Z': (a, b) => a.username.toLowerCase().localeCompare(b.username.toLowerCase()),
    'Username Z→A': (a, b) => b.username.toLowerCase().localeCompare(a.username.toLowerCase()),
    'ID low→high': (a, b) => Number(a.id) - Number(b.id),
    'ID high→low': (a, b) => Number(b.id) - Number(a.id),
    'Created oldest→newest': (a, b) => (a.created || '').localeCompare(b.created || ''),
    'Created newest→oldest': (a, b) => (b.created || '').localeCompare(a.created || ''),
    'RAP high→low': (a, b) => rapKey(b) - rapKey(a),
    'RAP low→high': (a, b) => rapKey(a) - rapKey(b),
    'Verified Yes first': (a, b) => (a.verified === 'Yes' ? 0 : 1) - (b.verified === 'Yes' ? 0 : 1),
    'Verified No first': (a, b) => (a.verified === 'No' ? 0 : 1) - (b.verified === 'No' ? 0 : 1),
    'Banned Yes first': (a, b) => (a.banned === 'Yes' ? 0 : 1) - (b.banned === 'Yes' ? 0 : 1),
    'Banned No first': (a, b) => (a.banned === 'No' ? 0 : 1) - (b.banned === 'No' ? 0 : 1),
    'Active Yes first': (a, b) => (a.active === 'Yes' ? 0 : 1) - (b.active === 'Yes' ? 0 : 1),
    'Active No first': (a, b) => (a.active === 'No' ? 0 : 1) - (b.active === 'No' ? 0 : 1),
  };
  const fn = cmp[mode];
  if (!fn) return out;
  out.sort(fn);
  return out;
}
