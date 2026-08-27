import {
  AlertTriangle,
  Award,
  ChevronDown,
  ChevronUp,
  Coins,
  Copy,
  Download,
  ExternalLink,
  Filter,
  Hash,
  Loader2,
  Package,
  Play,
  Save,
  Search,
  ShieldCheck,
  Square,
  UserPlus,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CollectibleItem, ScanProgress, SearchResult, SortOption } from '../../shared/types';
import { useSaved } from '../App';
import { BadgeIcon } from '../components/ProfileView';
import {
  ClayButton,
  ClayCard,
  ClayCheckbox,
  ClayInput,
  ClaySelect,
  EmptyState,
  IconButton,
  Modal,
  SkeletonRows,
  StatusPill,
  useToast,
} from '../components/clay';
import { api, ApiError, subscribeSse, type SearchMeta } from '../lib/api';
import { copyText, elapsed, exportFile, formatNumber, openProfile } from '../lib/utils';

const METHOD_LABELS: Record<string, string> = {
  random: 'Random',
  numberless: 'Numberless',
  numbers: 'Numbers',
  ends_in_123: 'Ends in 123',
  ends_in_1_digit: 'Ends in 1 digit',
  ends_in_2_digits: 'Ends in 2 digits',
  ends_in_4_digits: 'Ends in 4 digits',
  year: 'Year',
  double: 'Double',
  real_name: 'Real Name',
  double_real_name: 'Double Real Name',
  '4digits_real_name': '4 Digits + Real Name',
  nonstop: 'Nonstop',
};

const METHOD_HINTS: Record<string, string> = {
  random: 'No username filtering — every reachable account in range is kept.',
  numberless: 'Usernames containing no digits at all.',
  numbers: 'Usernames containing at least one digit.',
  ends_in_123: 'Usernames ending in the literal string 123.',
  ends_in_1_digit: 'Usernames ending in exactly one digit.',
  ends_in_2_digits: 'Usernames ending in exactly two digits.',
  ends_in_4_digits: 'Usernames ending in exactly four digits.',
  year: 'Ends in four digits reading as a year between 1970 and 2017.',
  double: 'A repeated 3+ letter chunk or repeated 2-digit pair, then digits.',
  real_name: 'Letters fully covered by real-name tokens, with at least one spare letter.',
  double_real_name: 'A real name repeated twice, optional trailing digits.',
  '4digits_real_name': 'A real name followed by exactly four digits.',
  nonstop: 'Runs until stopped. Forces the Active filter to Only inactive and classifies results into downloadable files.',
};

export default function Finder() {
  const { toast } = useToast();
  const { store, refresh: refreshSaved } = useSaved();

  const [meta, setMeta] = useState<SearchMeta | null>(null);
  const [badgeNames, setBadgeNames] = useState<string[]>([]);

  /* ---- form ---- */
  const [years, setYears] = useState<string[]>(['Any year']);
  const [method, setMethod] = useState<string>('numberless');
  const [amount, setAmount] = useState('10');
  const [useIdRange, setUseIdRange] = useState(false);
  const [idMin, setIdMin] = useState('');
  const [idMax, setIdMax] = useState('');

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [rapPreset, setRapPreset] = useState<string>('Off');
  const [includeUnknownRap, setIncludeUnknownRap] = useState(true);
  const [hatPreset, setHatPreset] = useState<string>('Off');
  const [minLen, setMinLen] = useState('');
  const [maxLen, setMaxLen] = useState('');
  const [banFilter, setBanFilter] = useState('All');
  const [verifiedFilter, setVerifiedFilter] = useState('All');
  const [activeFilter, setActiveFilter] = useState('All');
  const [badgeFilterOn, setBadgeFilterOn] = useState(false);
  const [requiredBadges, setRequiredBadges] = useState<string[]>([]);
  const [skipSaved, setSkipSaved] = useState(false);
  const [concurrency, setConcurrency] = useState('2');

  /* ---- run state ---- */
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [sort, setSort] = useState<SortOption>('None');
  const [running, setRunning] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  const [avatars, setAvatars] = useState<Record<string, string | null>>({});

  /* ---- per-row limited items (lazy) ---- */
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rowInv, setRowInv] = useState<
    Record<string, { items: CollectibleItem[]; total: number; rap: number | null } | 'loading' | 'unreadable'>
  >({});

  const toggleExpand = useCallback((r: SearchResult) => {
    setExpanded((prev) => (prev === r.id ? null : r.id));
    setRowInv((prev) => {
      if (prev[r.id]) return prev;
      void api.inventory
        .page(r.id, null, 100)
        .then((page) => {
          if (page.summary.status !== 'ok') {
            setRowInv((p) => ({ ...p, [r.id]: 'unreadable' }));
            return;
          }
          const items = [...page.items].sort((a, b) => (b.rap ?? -1) - (a.rap ?? -1));
          setRowInv((p) => ({
            ...p,
            [r.id]: { items, total: page.summary.itemCount ?? items.length, rap: page.summary.totalRap },
          }));
        })
        .catch(() => setRowInv((p) => ({ ...p, [r.id]: 'unreadable' })));
      return { ...prev, [r.id]: 'loading' };
    });
  }, []);

  const sse = useRef<{ close: () => void } | null>(null);

  const isNonstop = method === 'nonstop';

  /* ---- metadata ---- */
  useEffect(() => {
    api.meta
      .search()
      .then(setMeta)
      .catch(() => setMeta(null));
    api.meta
      .badges()
      .then((r) => setBadgeNames(r.badges))
      .catch(() => setBadgeNames([]));
  }, []);

  /* ---- live progress over SSE ---- */
  useEffect(() => {
    if (!jobId) return;
    const handle = subscribeSse(`/search/${jobId}/stream`, {
      progress: (data) => setProgress(data as ScanProgress),
      complete: () => {
        setRunning(false);
        void pull(jobId);
      },
    });
    sse.current = handle;
    return () => handle.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  /** Pull the accumulated results (the SSE stream carries progress only). */
  const pull = useCallback(async (id: string, sortMode: SortOption = 'None') => {
    try {
      const res = await api.search.get(id, sortMode);
      setResults(res.results);
      setProgress(res.progress);
    } catch {
      /* progress keeps arriving over SSE even if a poll fails */
    }
  }, []);

  // Re-pull when the sort mode changes so ordering matches the server.
  useEffect(() => {
    if (jobId && results.length) void pull(jobId, sort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort]);

  // Refresh avatars for newly arrived rows.
  useEffect(() => {
    const missing = results.map((r) => r.id).filter((id) => !(id in avatars));
    if (!missing.length) return;
    const ac = new AbortController();
    api.user
      .avatars(missing.slice(0, 100), ac.signal)
      .then((r) => setAvatars((prev) => ({ ...prev, ...r.avatars })))
      .catch(() => undefined);
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);

  const start = async () => {
    setFormError(null);
    setResults([]);
    setChecked(new Set());
    setProgress(null);

    const rapValue = meta?.rapPresets.find((p) => p.label === rapPreset)?.value ?? null;
    const hatValue = meta?.hatPresets.find((p) => p.label === hatPreset)?.value ?? null;

    try {
      const res = await api.search.start({
        years: useIdRange ? [] : years,
        method: method as never,
        amount: Number.parseInt(amount, 10) || 1,
        rapMin: rapValue,
        includeUnknownRap,
        banFilter: banFilter as never,
        verifiedFilter: verifiedFilter as never,
        activeFilter: isNonstop ? 'Only inactive' : (activeFilter as never),
        hatMin: hatValue,
        usernameMinLen: minLen ? Number.parseInt(minLen, 10) : null,
        usernameMaxLen: maxLen ? Number.parseInt(maxLen, 10) : null,
        useIdRange,
        idMin: idMin ? Number.parseInt(idMin, 10) : null,
        idMax: idMax ? Number.parseInt(idMax, 10) : null,
        requiredBadges: badgeFilterOn ? requiredBadges : [],
        skipSaved,
        concurrency: Number.parseInt(concurrency, 10) || 2,
      });
      setJobId(res.jobId);
      setProgress(res.progress);
      setRunning(true);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not start the scan');
    }
  };

  const stop = async () => {
    if (!jobId) return;
    setRunning(false);
    try {
      await api.search.stop(jobId);
    } catch {
      /* the stream will report the final state either way */
    }
    void pull(jobId, sort);
  };

  const filtered = useMemo(() => {
    if (!query.trim()) return results;
    const q = query.trim().toLowerCase();
    return results.filter((r) => r.username.toLowerCase().includes(q) || r.id.includes(q));
  }, [results, query]);

  const allChecked = filtered.length > 0 && filtered.every((r) => checked.has(r.id));
  const savedCount = store ? Object.values(store.categories).reduce((n, c) => n + Object.keys(c.accounts).length, 0) : 0;

  const pct =
    progress && progress.target && progress.target > 0
      ? Math.min(100, Math.round((progress.found / progress.target) * 100))
      : null;

  const successRate =
    progress && progress.scanned > 0 ? ((progress.found / progress.scanned) * 100).toFixed(2) : '0.00';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ============================ search panel ============================ */}
      <ClayCard>
        <div className="row row--between" style={{ marginBottom: 14 }}>
          <div className="section-title" style={{ margin: 0 }}>
            Search configuration
          </div>
          <ClayButton size="sm" icon={Filter} onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? 'Less' : 'More'}
          </ClayButton>
        </div>

        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
          <ClaySelect
            label="Method"
            value={method}
            options={Object.entries(METHOD_LABELS).map(([value, label]) => ({ value, label }))}
            onChange={setMethod}
          />
          <ClayInput
            label="Amount"
            type="number"
            min={1}
            value={amount}
            disabled={isNonstop}
            onChange={(e) => setAmount(e.target.value)}
            hint={isNonstop ? 'Unlimited in Nonstop mode' : 'How many matches to collect'}
          />
          <ClayInput
            label="Concurrency"
            type="number"
            min={1}
            max={meta?.maxConcurrency ?? 4}
            value={concurrency}
            onChange={(e) => setConcurrency(e.target.value)}
            hint={`Max ${meta?.maxConcurrency ?? 4} workers`}
          />
          <div className="field">
            <span className="field__label">ID range mode</span>
            <ClayCheckbox
              label={useIdRange ? 'Scan an explicit ID range' : 'Scan by selected years'}
              checked={useIdRange}
              onChange={setUseIdRange}
            />
          </div>
        </div>

        {!useIdRange ? (
          <div style={{ marginTop: 16 }}>
            <div className="row row--between" style={{ marginBottom: 8 }}>
              <span className="field__label">Year</span>
              <div className="row" style={{ gap: 6 }}>
                <button type="button" className="chip" onClick={() => setYears(['Any year'])}>
                  Any year
                </button>
                <button type="button" className="chip" onClick={() => setYears([])}>
                  Clear
                </button>
              </div>
            </div>
            <div className="chip-grid">
              {(meta?.years ?? ['Any year'])
                .filter((y) => y !== 'Any year')
                .map((y) => (
                  <button
                    key={y}
                    type="button"
                    className="chip"
                    aria-pressed={years.includes(y)}
                    onClick={() =>
                      setYears((prev) => {
                        const next = prev.includes(y) ? prev.filter((x) => x !== y) : [...prev.filter((x) => x !== 'Any year'), y];
                        return next;
                      })
                    }
                  >
                    {y}
                  </button>
                ))}
            </div>
            <div className="tiny muted" style={{ marginTop: 8 }}>
              {years.length === 0
                ? 'No year selected.'
                : years.includes('Any year')
                  ? 'Any year selected — the full ID space 1 to 9,000,000,000.'
                  : `${years.length} year${years.length === 1 ? '' : 's'} selected.`}
            </div>
          </div>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 16 }}>
            <ClayInput label="Start ID" type="number" min={1} value={idMin} onChange={(e) => setIdMin(e.target.value)} />
            <ClayInput label="End ID" type="number" min={1} value={idMax} onChange={(e) => setIdMax(e.target.value)} />
          </div>
        )}

        <div className="tiny muted" style={{ marginTop: 12, lineHeight: 1.6 }}>
          {METHOD_HINTS[method]}
        </div>

        {/* ---- advanced ---- */}
        {showAdvanced && (
          <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
            <div className="adv-group">
              <div className="adv-group__head">
                <Coins aria-hidden />
                Value
              </div>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
                <ClaySelect
                  label="RAP"
                  value={rapPreset}
                  options={(meta?.rapPresets ?? []).map((p) => ({ value: p.label, label: p.label }))}
                  onChange={setRapPreset}
                />
                <ClaySelect
                  label="Hats"
                  value={hatPreset}
                  options={(meta?.hatPresets ?? []).map((p) => ({ value: p.label, label: p.label }))}
                  onChange={setHatPreset}
                />
                <ClayInput label="Min username length" type="number" min={3} max={20} value={minLen} onChange={(e) => setMinLen(e.target.value)} />
                <ClayInput label="Max username length" type="number" min={3} max={20} value={maxLen} onChange={(e) => setMaxLen(e.target.value)} />
              </div>
              <div style={{ marginTop: 12 }}>
                <ClayCheckbox label="Include accounts with unknown RAP" checked={includeUnknownRap} onChange={setIncludeUnknownRap} />
              </div>
            </div>

            <div className="adv-group">
              <div className="adv-group__head">
                <ShieldCheck aria-hidden />
                Account status
              </div>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
                <ClaySelect label="Verified" value={verifiedFilter} options={meta?.verifiedFilters ?? ['All']} onChange={setVerifiedFilter} />
                <ClaySelect label="Banned" value={banFilter} options={meta?.banFilters ?? ['All']} onChange={setBanFilter} />
                <ClaySelect
                  label="Active"
                  value={isNonstop ? 'Only inactive' : activeFilter}
                  options={meta?.activeFilters ?? ['All']}
                  onChange={setActiveFilter}
                  disabled={isNonstop}
                />
              </div>
              {isNonstop && (
                <div className="tiny" style={{ color: 'var(--warn)', marginTop: 10 }}>
                  Nonstop mode forces the Active filter to “Only inactive” and it cannot be changed, matching the
                  original tool.
                </div>
              )}
            </div>

            <div className="adv-group">
              <div className="adv-group__head">
                <Award aria-hidden />
                Badges &amp; exclusions
              </div>
              <ClayCheckbox label="Require badges" checked={badgeFilterOn} onChange={setBadgeFilterOn} />
              {badgeFilterOn && (
                <div className="chip-grid" style={{ marginTop: 10 }}>
                  {badgeNames.map((b) => (
                    <button
                      key={b}
                      type="button"
                      className="chip"
                      aria-pressed={requiredBadges.includes(b)}
                      onClick={() =>
                        setRequiredBadges((prev) => (prev.includes(b) ? prev.filter((x) => x !== b) : [...prev, b]))
                      }
                    >
                      <span className="row" style={{ gap: 6, alignItems: 'center' }}>
                        <BadgeIcon badge={b} size={14} />
                        {b}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {badgeFilterOn && requiredBadges.length > 0 && (
                <div className="tiny muted" style={{ marginTop: 8 }}>
                  All {requiredBadges.length} selected badge{requiredBadges.length === 1 ? '' : 's'} must be present.
                </div>
              )}
              <div style={{ marginTop: 12 }}>
                <ClayCheckbox
                  label={`Skip saved accounts (${savedCount} saved)`}
                  checked={skipSaved}
                  onChange={setSkipSaved}
                  title="Every ID stored in any saved category is excluded from the scan"
                />
              </div>
            </div>
          </div>
        )}

        {formError && (
          <div className="row" style={{ gap: 9, marginTop: 14, color: 'var(--bad)' }}>
            <AlertTriangle style={{ width: 15, height: 15, flex: 'none' }} aria-hidden />
            <span className="tiny">{formError}</span>
          </div>
        )}

        <div className="row row--wrap" style={{ gap: 10, marginTop: 18 }}>
          <ClayButton variant="primary" icon={Play} onClick={() => void start()} disabled={running}>
            {running ? (isNonstop ? 'Nonstop…' : 'Scanning…') : 'Start scan'}
          </ClayButton>
          <ClayButton icon={Square} onClick={() => void stop()} disabled={!running}>
            Stop
          </ClayButton>
          <div className="spacer" />
          <ClayButton
            icon={Download}
            disabled={!results.length}
            onClick={() =>
              exportFile(
                'csv',
                'vesper-scan',
                filtered.map((r) => ({
                  username: r.username,
                  id: r.id,
                  created: r.created,
                  rap: r.rap,
                  verified: r.verified,
                  banned: r.banned,
                  active: r.active,
                  hats: r.hats,
                  badges: r.roblox_badges.map((b) => b.name).join('; '),
                })),
              )
            }
          >
            Export results
          </ClayButton>
        </div>
      </ClayCard>

      {/* ============================ progress =============================== */}
      {progress && (
        <ClayCard accent>
          <div className="row row--between" style={{ marginBottom: 12 }}>
            <div className="row" style={{ gap: 9 }}>
              <span
                className="pill"
                style={{
                  background: running ? 'rgba(74,222,155,0.16)' : 'rgba(168,173,198,0.14)',
                  color: running ? 'var(--ok)' : 'var(--text-2)',
                }}
              >
                {running ? 'Running' : 'Stopped'}
              </span>
              <span className="tiny muted">{METHOD_LABELS[progress.method] ?? progress.method}</span>
            </div>
            <span className="tiny muted mono">{elapsed(progress.elapsedMs)}</span>
          </div>

          {pct !== null && (
            <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className="progress__fill" style={{ width: `${pct}%` }} />
            </div>
          )}

          <div className="meta-grid" style={{ marginTop: 14 }}>
            <MiniStat k="Scanned" v={progress.scanned.toLocaleString('en-US')} />
            <MiniStat k="Found" v={progress.found.toLocaleString('en-US')} />
            <MiniStat k="Rejected" v={progress.rejected.toLocaleString('en-US')} />
            <MiniStat k="Success rate" v={`${successRate}%`} />
            <MiniStat k="Requests" v={progress.requests.toLocaleString('en-US')} />
            <MiniStat k="Workers" v={`${progress.activeWorkers}/${progress.concurrency}`} />
            <MiniStat k="Rate-limit hits" v={String(progress.rateLimitHits)} />
            <MiniStat
              k="Target"
              v={progress.target === null ? 'Unlimited' : progress.target.toLocaleString('en-US')}
            />
          </div>

          <div className="row row--wrap" style={{ gap: 8, marginTop: 12 }}>
            <span className="pill pill--no">
              {progress.idRange
                ? `ID ${progress.idRange.min.toLocaleString('en-US')} – ${progress.idRange.max.toLocaleString('en-US')}`
                : progress.years.length
                  ? progress.years.join(', ')
                  : 'Any year'}
            </span>
            {progress.backoffUntil && progress.backoffUntil > Date.now() && (
              <span className="pill pill--bad">
                <AlertTriangle aria-hidden />
                Backing off {Math.ceil((progress.backoffUntil - Date.now()) / 1000)}s
              </span>
            )}
            {isNonstop &&
              Object.entries(progress.nonstopFiles).map(([file, count]) => (
                <span key={file} className="pill pill--info">
                  {file}: {count}
                </span>
              ))}
          </div>

          {isNonstop && Object.keys(progress.nonstopFiles).length > 0 && jobId && (
            <div className="row row--wrap" style={{ gap: 8, marginTop: 12 }}>
              <span className="tiny muted">Download classified buckets:</span>
              {Object.keys(progress.nonstopFiles).map((file) => (
                <a
                  key={file}
                  className="btn btn--sm btn--ghost"
                  href={`/api/search/${jobId}/nonstop/${encodeURIComponent(file)}`}
                  download
                >
                  <Download aria-hidden />
                  {file}
                </a>
              ))}
            </div>
          )}
        </ClayCard>
      )}

      {/* ============================ results ================================ */}
      <ClayCard>
        <div className="row row--wrap row--between" style={{ gap: 10, marginBottom: 12 }}>
          <div className="row row--wrap" style={{ gap: 8 }}>
            <ClayInput
              icon={Search}
              placeholder="Filter results"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Filter results"
              className="grow-sm"
            />
            <ClaySelect value={sort} options={(meta?.sortOptions ?? ['None']) as SortOption[]} onChange={setSort} />
          </div>
          <div className="row row--wrap" style={{ gap: 8 }}>
            <ClayButton size="sm" onClick={() => setChecked(new Set(filtered.map((r) => r.id)))}>
              Select all
            </ClayButton>
            <ClayButton size="sm" onClick={() => setChecked(new Set())}>
              Clear
            </ClayButton>
            <ClayButton size="sm" variant="primary" icon={Save} disabled={!checked.size} onClick={() => setSaveOpen(true)}>
              Save {checked.size ? `(${checked.size})` : ''}
            </ClayButton>
          </div>
        </div>

        <div className="table-wrap" style={{ boxShadow: 'none' }}>
          <div className="table-scroll">
            <table className="clay-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>
                    <input
                      type="checkbox"
                      aria-label="Select all rows"
                      checked={allChecked}
                      onChange={(e) => setChecked(e.target.checked ? new Set(filtered.map((r) => r.id)) : new Set())}
                    />
                  </th>
                  <th className="idx">#</th>
                  <th>Username</th>
                  <th>ID</th>
                  <th>Created</th>
                  <th>RAP</th>
                  <th>Badges</th>
                  <th>Verified</th>
                  <th>Banned</th>
                  <th>Active</th>
                  <th>Hats</th>
                  <th style={{ width: 140 }}>Actions</th>
                </tr>
              </thead>
              {running && results.length === 0 ? (
                <SkeletonRows rows={7} cols={12} />
              ) : (
                <tbody>
                  {filtered.map((r, i) => (
                    <Fragment key={r.id}>
                    <tr
                      data-selected={checked.has(r.id)}
                      onClick={() =>
                        setChecked((prev) => {
                          const next = new Set(prev);
                          if (next.has(r.id)) next.delete(r.id);
                          else next.add(r.id);
                          return next;
                        })
                      }
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${r.username}`}
                          checked={checked.has(r.id)}
                          onChange={() =>
                            setChecked((prev) => {
                              const next = new Set(prev);
                              if (next.has(r.id)) next.delete(r.id);
                              else next.add(r.id);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td className="idx">{i + 1}</td>
                      <td>
                        <span className="uname">
                          <span className="uname__av">
                            {avatars[r.id] ? <img src={avatars[r.id] as string} alt="" /> : <Hash aria-hidden />}
                          </span>
                          <span className="truncate" style={{ maxWidth: 170 }}>
                            {r.username}
                          </span>
                        </span>
                      </td>
                      <td className="num">{r.id}</td>
                      <td className="num">{r.created || '—'}</td>
                      <td className="num" style={{ color: 'var(--accent-soft)', fontWeight: 700 }}>
                        {r.rap}
                      </td>
                      <td>
                        <span className="row" style={{ gap: 3 }}>
                          {r.roblox_badges.length ? (
                            r.roblox_badges.map((b) => (
                              <span key={b.name} className="badge-chip" title={b.name}>
                                <BadgeIcon badge={b} size={20} />
                              </span>
                            ))
                          ) : (
                            <span className="tiny muted">—</span>
                          )}
                        </span>
                      </td>
                      <td>
                        <StatusPill value={r.verified} />
                      </td>
                      <td>
                        <StatusPill value={r.banned} kind="banned" />
                      </td>
                      <td>
                        <StatusPill value={r.active} kind="active" />
                      </td>
                      <td className="num">{r.hats}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <span className="row-actions" style={{ opacity: 1 }}>
                          <IconButton
                            label="Open Roblox profile"
                            icon={ExternalLink}
                            size="sm"
                            onClick={() => openProfile(r.id)}
                          />
                          <IconButton
                            label="Copy username"
                            icon={Copy}
                            size="sm"
                            onClick={async () => {
                              const ok = await copyText(r.username);
                              toast(ok ? 'Username copied' : 'Copy failed', ok ? 'ok' : 'bad');
                            }}
                          />
                          <IconButton
                            label="Quick inspect"
                            icon={UserPlus}
                            size="sm"
                            onClick={() => window.open(`#/lookup?q=${encodeURIComponent(r.username)}`, '_self')}
                          />
                          <IconButton
                            label={expanded === r.id ? 'Hide limited items' : 'Show limited items'}
                            icon={expanded === r.id ? ChevronUp : ChevronDown}
                            size="sm"
                            onClick={() => toggleExpand(r)}
                          />
                        </span>
                      </td>
                    </tr>
                    {expanded === r.id && (
                      <tr className="expand-row">
                        <td colSpan={12}>
                          <LimitedStrip state={rowInv[r.id]} username={r.username} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))}
                </tbody>
              )}
            </table>
          </div>

          {!running && filtered.length === 0 && (
            <EmptyState
              title={results.length ? 'No results match your filter' : 'No results yet'}
              text={
                results.length
                  ? 'Adjust the filter box above to see other rows from this scan.'
                  : 'Configure the search and press Start. Matches stream in here as they are found.'
              }
              art={results.length ? 'search' : 'info'}
            />
          )}
        </div>
      </ClayCard>

      <SaveResultsModal
        open={saveOpen}
        results={results.filter((r) => checked.has(r.id))}
        onClose={() => setSaveOpen(false)}
        onSaved={() => {
          setSaveOpen(false);
          refreshSaved();
          toast('Accounts saved', 'ok');
        }}
      />
    </div>
  );
}

/** Lazy limited-items strip shown under an expanded results row. */
function LimitedStrip({
  state,
  username,
}: {
  state: { items: CollectibleItem[]; total: number; rap: number | null } | 'loading' | 'unreadable' | undefined;
  username: string;
}) {
  if (!state || state === 'loading') {
    return (
      <div className="expand-inner">
        <div className="row" style={{ gap: 9, color: 'var(--text-2)' }}>
          <Loader2 className="spin" style={{ width: 15, height: 15 }} aria-hidden />
          <span className="tiny">Loading limited items…</span>
        </div>
      </div>
    );
  }
  if (state === 'unreadable') {
    return (
      <div className="expand-inner">
        <div className="tiny muted">
          Inventory is private or unavailable for this account — its items cannot be listed.
        </div>
      </div>
    );
  }
  const top = state.items.slice(0, 10);
  return (
    <div className="expand-inner">
      <div className="row row--wrap row--between" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 9 }}>
          <Package style={{ width: 15, height: 15, color: 'var(--accent-soft)' }} aria-hidden />
          <span className="tiny" style={{ fontWeight: 700 }}>
            Limited items — {username}
          </span>
          <span className="tiny muted">
            {formatNumber(state.total)} items · page RAP {state.rap === null ? 'Unavailable' : formatNumber(state.rap)}
          </span>
        </div>
        <a className="btn btn--sm btn--ghost" href={`#/lookup?q=${encodeURIComponent(username)}&tab=inventory`}>
          <ExternalLink style={{ width: 13, height: 13 }} aria-hidden />
          Open full inventory
        </a>
      </div>
      {top.length === 0 ? (
        <div className="tiny muted">No collectibles on the first page of this inventory.</div>
      ) : (
        <div className="expand-strip">
          {top.map((it) => (
            <div className="expand-item" key={`${it.assetId}-${it.userAssetId ?? ''}`}>
              {it.thumbnailUrl ? (
                <img src={it.thumbnailUrl} alt="" loading="lazy" />
              ) : (
                <Package style={{ width: 20, height: 20, color: 'var(--text-3)' }} aria-hidden />
              )}
              <div style={{ minWidth: 0 }}>
                <div className="expand-item__name">{it.name || 'Unnamed item'}</div>
                <div className="expand-item__rap">{it.rap === null ? '—' : formatNumber(it.rap)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniStat({ k, v }: { k: string; v: string }) {
  return (
    <div className="meta-cell">
      <span className="meta-cell__k">{k}</span>
      <span className="meta-cell__v mono" style={{ fontSize: 15 }}>
        {v}
      </span>
    </div>
  );
}

function SaveResultsModal({
  open,
  results,
  onClose,
  onSaved,
}: {
  open: boolean;
  results: SearchResult[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { store } = useSaved();
  const { toast } = useToast();
  const categories = store ? Object.keys(store.categories) : ['Default'];
  const [category, setCategory] = useState(categories[0] ?? 'Default');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const res = await api.saved.save(
        category,
        results.map((r) => ({
          id: r.id,
          username: r.username,
          created: r.created,
          rap: r.rap,
          verified: r.verified,
          banned: r.banned,
          active: r.active,
          hats: r.hats,
          badges: r.roblox_badges.map((b) => b.name),
          avatarUrl: r.avatarUrl,
          lastChecked: new Date().toISOString(),
        })),
      );
      toast(`Saved ${res.saved} account(s) to ${category}`, 'ok');
      onSaved();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Save failed', 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Save ${results.length} account${results.length === 1 ? '' : 's'}`}
      icon={Save}
      footer={
        <>
          <div className="spacer" />
          <ClayButton size="sm" onClick={onClose}>
            Cancel
          </ClayButton>
          <ClayButton size="sm" variant="primary" loading={busy} onClick={() => void save()}>
            Save
          </ClayButton>
        </>
      }
    >
      <ClaySelect label="Category" value={category} options={categories} onChange={setCategory} />
      <div className="tiny muted" style={{ marginTop: 12, lineHeight: 1.6 }}>
        Existing notes on these accounts are preserved. Saving again updates the record rather than duplicating it.
      </div>
    </Modal>
  );
}
