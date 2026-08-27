import { Router } from 'express';
import { SEARCH_METHODS, SORT_OPTIONS } from '../../shared/types';
import type { SearchConfig, SearchMethod, SortOption } from '../../shared/types';
import { config } from '../lib/config';
import { log } from '../lib/logger';
import { asBoolean, asEnum, asStringArray, ValidationError } from '../lib/validate';
import { getJob, listJobIds, nonstopBucket, nonstopFileNames, snapshot, sortResults, startScan, stopScan, subscribeProgress, validateConfig } from '../scanner/scanJob';
import { YEAR_OPTIONS } from '../scanner/usernameMethods';

export const searchRouter = Router();

/** GET /api/search/meta — the option lists the UI needs to build its form. */
searchRouter.get('/meta', (_req, res) => {
  res.json({
    ok: true,
    methods: SEARCH_METHODS,
    years: YEAR_OPTIONS,
    sortOptions: SORT_OPTIONS,
    maxConcurrency: config.maxConcurrency,
    maxScanAttempts: config.maxScanAttempts,
    maxScanResults: config.maxScanResults,
    banFilters: ['All', 'Only not banned', 'Only banned'],
    verifiedFilters: ['All', 'Only verified', 'Only unverified'],
    activeFilters: ['All', 'Only active', 'Only inactive'],
    rapPresets: [
      { label: 'Off', value: null },
      { label: '100+', value: 100 },
      { label: '500+', value: 500 },
      { label: '1K+', value: 1000 },
      { label: '2.5K+', value: 2500 },
      { label: '5K+', value: 5000 },
      { label: '10K+', value: 10000 },
    ],
    hatPresets: [
      { label: 'Off', value: null },
      { label: '1+', value: 1 },
      { label: '2+', value: 2 },
      { label: '5+', value: 5 },
      { label: '10+', value: 10 },
    ],
  });
});

function parseNullableInt(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number.parseInt(String(v).replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function parseConfig(body: Record<string, unknown>): SearchConfig {
  const method = asEnum(body.method, SEARCH_METHODS, 'random', 'method') as SearchMethod;

  // The desktop tool forces "Only inactive" for nonstop and ignores the amount.
  const forcedInactive = method === 'nonstop';

  const yearsRaw = Array.isArray(body.years) ? body.years : [];
  let years = yearsRaw.map((y) => String(y)).filter((y) => YEAR_OPTIONS.includes(y));
  if (years.includes('Any year') && years.length > 1) years = ['Any year'];

  const useIdRange = asBoolean(body.useIdRange);

  return {
    years,
    method,
    amount: forcedInactive ? 1 : Math.max(1, parseNullableInt(body.amount) ?? 10),
    rapMin: parseNullableInt(body.rapMin),
    includeUnknownRap: asBoolean(body.includeUnknownRap, true),
    banFilter: asEnum(body.banFilter, ['All', 'Only not banned', 'Only banned'] as const, 'All', 'banFilter'),
    verifiedFilter: asEnum(body.verifiedFilter, ['All', 'Only verified', 'Only unverified'] as const, 'All', 'verifiedFilter'),
    activeFilter: forcedInactive
      ? 'Only inactive'
      : asEnum(body.activeFilter, ['All', 'Only active', 'Only inactive'] as const, 'All', 'activeFilter'),
    hatMin: parseNullableInt(body.hatMin),
    usernameMinLen: parseNullableInt(body.usernameMinLen),
    usernameMaxLen: parseNullableInt(body.usernameMaxLen),
    useIdRange,
    idMin: parseNullableInt(body.idMin),
    idMax: parseNullableInt(body.idMax),
    requiredBadges: asStringArray(body.requiredBadges, 20, 60),
    skipSaved: asBoolean(body.skipSaved),
    concurrency: Math.max(1, Math.min(parseNullableInt(body.concurrency) ?? 2, config.maxConcurrency)),
  };
}

/** POST /api/search/start — validate, then launch a background scan job. */
searchRouter.post('/start', async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      throw new ValidationError('A search configuration is required', 'config');
    }
    const cfg = parseConfig(req.body as Record<string, unknown>);
    const problem = validateConfig(cfg);
    if (problem) return res.status(400).json({ ok: false, error: problem });

    const job = await startScan(cfg);
    log('system', `Scan job ${job.id} started (method=${cfg.method})`, { jobId: job.id });
    res.status(202).json({ ok: true, jobId: job.id, progress: snapshot(job), config: cfg });
  } catch (err) {
    next(err);
  }
});

/** POST /api/search/stop */
searchRouter.post('/stop', (req, res) => {
  const jobId = String(req.body?.jobId ?? '');
  const job = getJob(jobId);
  if (!job) return res.status(404).json({ ok: false, error: 'Scan job not found' });
  stopScan(jobId);
  res.json({ ok: true, progress: snapshot(job) });
});

/** GET /api/search/jobs — recent job ids. */
searchRouter.get('/jobs', (_req, res) => {
  res.json({ ok: true, jobIds: listJobIds() });
});

/** GET /api/search/:jobId — snapshot plus accumulated results. */
searchRouter.get('/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ ok: false, error: 'Scan job not found' });

  const sort = asEnum(req.query.sort, SORT_OPTIONS, 'None', 'sort') as SortOption;
  const results = sort === 'None' ? job.results : sortResults(job.results, sort);

  res.json({ ok: true, progress: snapshot(job), results });
});

/**
 * GET /api/search/:jobId/stream — Server-Sent Events.
 *
 * Progress is pushed on every change plus a heartbeat, so the UI stays live
 * without polling. The desktop tool emitted signals from its QThread; this is
 * the web equivalent.
 */
searchRouter.get('/:jobId/stream', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ ok: false, error: 'Scan job not found' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 2000\n\n`);

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send('progress', snapshot(job));

  const unsubscribe = subscribeProgress(job.id, (p) => {
    send('progress', p);
    if (p.phase === 'done' || p.phase === 'error') {
      send('complete', { jobId: job.id, found: p.found, scanned: p.scanned });
    }
  });

  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

/** GET /api/search/:jobId/nonstop — the classified username buckets. */
searchRouter.get('/:jobId/nonstop', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ ok: false, error: 'Scan job not found' });
  const files = nonstopFileNames(job);
  const buckets: Record<string, string[]> = {};
  for (const f of files) buckets[f] = nonstopBucket(job, f);
  res.json({ ok: true, files, buckets });
});

/** GET /api/search/:jobId/nonstop/:file — one bucket as downloadable text. */
searchRouter.get('/:jobId/nonstop/:file', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ ok: false, error: 'Scan job not found' });

  // Only names we ourselves generated are valid here — no path traversal.
  const file = String(req.params.file);
  if (!nonstopFileNames(job).includes(file)) {
    return res.status(404).json({ ok: false, error: 'Unknown output file' });
  }
  const text = nonstopBucket(job, file).join('\n');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
  res.send(text);
});
