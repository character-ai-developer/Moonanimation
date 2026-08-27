import {
  Activity,
  ArrowRight,
  Bookmark,
  Compass,
  Database,
  Moon,
  Search,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { useApiStatus, useSaved } from '../App';
import { ClayCard, CountUp, EmptyState } from '../components/clay';
import { compactNumber, elapsed, formatNumber } from '../lib/utils';

export default function Dashboard() {
  const { status, loading } = useApiStatus();
  const { store, loading: savedLoading } = useSaved();

  const categories = store ? Object.values(store.categories) : [];
  const totalSaved = categories.reduce((n, c) => n + Object.keys(c.accounts).length, 0);
  const withNotes = categories.reduce(
    (n, c) => n + Object.values(c.accounts).filter((a) => a.note.trim()).length,
    0,
  );

  // Highest-RAP saved accounts across every category.
  const top = categories
    .flatMap((c) => Object.values(c.accounts))
    .map((a) => ({ ...a, rapNum: Number.parseInt((a.rap || '').replace(/,/g, ''), 10) }))
    .filter((a) => Number.isFinite(a.rapNum))
    .sort((a, b) => b.rapNum - a.rapNum)
    .slice(0, 6);

  const okEndpoints = status?.endpoints.filter((e) => e.ok).length ?? 0;
  const allEndpoints = status?.endpoints.length ?? 0;

  const cards = [
    {
      to: '#/finder',
      icon: Compass,
      title: 'Account Finder',
      text: 'Scan by username pattern, year or explicit ID range, with RAP, hat, badge and status filters.',
    },
    {
      to: '#/lookup',
      icon: Search,
      title: 'User Lookup',
      text: 'Inspect a single account, its badges and its full collectible inventory.',
    },
    {
      to: '#/saved',
      icon: Bookmark,
      title: 'Saved',
      text: 'Categories, notes and persistent records, stored as JSON on the server.',
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ---- hero ---- */}
      <ClayCard accent>
        <div className="row row--wrap" style={{ gap: 18, alignItems: 'flex-start' }}>
          <div className="brand__mark" style={{ width: 52, height: 52, borderRadius: 16 }} aria-hidden>
            <Moon strokeWidth={2.2} style={{ width: 26, height: 26 }} />
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em' }}>Vesper</h1>
            <p className="muted" style={{ margin: '6px 0 0', maxWidth: 720, lineHeight: 1.65, fontSize: 13.5 }}>
              A Roblox account intelligence workspace. Everything here reads public Roblox endpoints through a backend
              proxy — no signing in, no cookies, no credentials, ever.
            </p>
          </div>
        </div>
      </ClayCard>

      {/* ---- stats ---- */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
        <ClayCard lift>
          <div className="row" style={{ gap: 9, marginBottom: 10 }}>
            <Server style={{ width: 16, height: 16, color: 'var(--accent-soft)' }} aria-hidden />
            <span className="stat__label">Connection</span>
          </div>
          <div className="stat__value">
            {loading ? '…' : status ? `${okEndpoints}/${allEndpoints}` : '0/0'}
          </div>
          <div className="tiny muted" style={{ marginTop: 4 }}>
            {status
              ? `${status.health} · ${status.latencyMs !== null ? `${status.latencyMs}ms avg` : 'no latency data'}`
              : loading
                ? 'Checking endpoints…'
                : 'Backend unreachable'}
          </div>
        </ClayCard>

        <ClayCard lift>
          <div className="row" style={{ gap: 9, marginBottom: 10 }}>
            <Bookmark style={{ width: 16, height: 16, color: 'var(--accent-soft)' }} aria-hidden />
            <span className="stat__label">Saved accounts</span>
          </div>
          <div className="stat__value">
            {savedLoading ? '…' : <CountUp value={totalSaved} />}
          </div>
          <div className="tiny muted" style={{ marginTop: 4 }}>
            across {categories.length} categor{categories.length === 1 ? 'y' : 'ies'} · {withNotes} with notes
          </div>
        </ClayCard>

        <ClayCard lift>
          <div className="row" style={{ gap: 9, marginBottom: 10 }}>
            <Activity style={{ width: 16, height: 16, color: 'var(--accent-soft)' }} aria-hidden />
            <span className="stat__label">Rate-limit events</span>
          </div>
          <div className="stat__value">
            <CountUp value={status?.rateLimitHits ?? 0} />
          </div>
          <div className="tiny muted" style={{ marginTop: 4 }}>
            {status?.backoffUntil && status.backoffUntil > Date.now()
              ? `Backing off ${Math.ceil((status.backoffUntil - Date.now()) / 1000)}s`
              : 'No active backoff'}
          </div>
        </ClayCard>

      </div>

      {/* ---- shortcuts ---- */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))' }}>
        {cards.map((c) => (
          <a key={c.to} href={c.to} style={{ textDecoration: 'none', color: 'inherit' }}>
            <ClayCard lift style={{ height: '100%' }}>
              <div className="row row--between" style={{ marginBottom: 10 }}>
                <c.icon style={{ width: 19, height: 19, color: 'var(--accent-soft)' }} aria-hidden />
                <ArrowRight style={{ width: 15, height: 15, color: 'var(--text-3)' }} aria-hidden />
              </div>
              <div style={{ fontWeight: 700, marginBottom: 5 }}>{c.title}</div>
              <div className="tiny muted" style={{ lineHeight: 1.6 }}>
                {c.text}
              </div>
            </ClayCard>
          </a>
        ))}
      </div>

      {/* ---- saved highlights + endpoint health ---- */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', alignItems: 'start' }}>
        <ClayCard>
          <div className="row" style={{ gap: 9, marginBottom: 12 }}>
            <Database style={{ width: 16, height: 16, color: 'var(--accent-soft)' }} aria-hidden />
            <span className="section-title" style={{ margin: 0 }}>
              Highest-RAP saved accounts
            </span>
          </div>
          {top.length === 0 ? (
            <EmptyState
              title="Nothing saved yet"
              text="Save accounts from the Finder or Lookup and the highest-RAP ones will be listed here."
              art="info"
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {top.map((a) => (
                <div
                  key={`${a.id}-${a.username}`}
                  className="row row--between"
                  style={{ padding: '9px 12px', borderRadius: 'var(--r-md)', boxShadow: 'var(--sh-in)' }}
                >
                  <span className="row" style={{ gap: 9, minWidth: 0 }}>
                    <span className="uname__av">
                      {a.avatarUrl ? <img src={a.avatarUrl} alt="" /> : <Bookmark aria-hidden />}
                    </span>
                    <span className="truncate" style={{ fontWeight: 600, maxWidth: 150 }}>
                      {a.username}
                    </span>
                  </span>
                  <span className="mono" style={{ color: 'var(--accent-soft)', fontWeight: 700 }}>
                    {formatNumber(a.rapNum)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </ClayCard>

        <ClayCard>
          <div className="row" style={{ gap: 9, marginBottom: 12 }}>
            <ShieldCheck style={{ width: 16, height: 16, color: 'var(--accent-soft)' }} aria-hidden />
            <span className="section-title" style={{ margin: 0 }}>
              Endpoint health
            </span>
          </div>
          {!status ? (
            <div className="tiny muted">{loading ? 'Probing Roblox endpoints…' : 'Backend unreachable.'}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {status.endpoints.map((e) => (
                <div
                  key={e.name}
                  className="row row--between"
                  style={{ padding: '9px 12px', borderRadius: 'var(--r-md)', boxShadow: 'var(--sh-in)' }}
                >
                  <span className="mono tiny truncate" style={{ maxWidth: 220 }}>
                    {e.name}
                  </span>
                  <span className="row" style={{ gap: 8 }}>
                    <span className="tiny muted mono">
                      {e.latencyMs !== null ? `${e.latencyMs}ms` : '—'}
                    </span>
                    <span className={`pill ${e.ok ? 'pill--yes' : 'pill--bad'}`}>{e.ok ? 'OK' : 'Fail'}</span>
                  </span>
                </div>
              ))}
              <div className="tiny muted" style={{ marginTop: 6 }}>
                {status.openCloudConfigured
                  ? 'Open Cloud key configured — inventory reads use the documented inventory-items endpoint.'
                  : 'No Open Cloud key — inventory reads use the legacy public collectibles endpoint, which is also the only source of RAP and serial numbers.'}
              </div>
              <div className="tiny muted">Last checked {elapsed(Date.now() - status.checkedAt)} ago.</div>
              <div className="tiny muted">
                Cached public metadata: {compactNumber(status.rateLimitHits)} rate-limit events since start.
              </div>
            </div>
          )}
        </ClayCard>
      </div>
    </div>
  );
}
