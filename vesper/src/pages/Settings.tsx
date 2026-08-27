import {
  AlertTriangle,
  Check,
  Database,
  Download,
  Gauge,
  Plug,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { usePrefs } from '../App';
import {
  ClayButton,
  ClayCard,
  ClayToggle,
  Modal,
  Segmented,
  useToast,
} from '../components/clay';
import { api, ApiError, type CacheStat, type RateLimitInfo } from '../lib/api';
import { downloadText, formatNumber } from '../lib/utils';
import type { ApiStatus } from '../../shared/types';

export default function Settings() {
  const { prefs, set, reset } = usePrefs();
  const { toast } = useToast();

  const [info, setInfo] = useState<{ settings: Record<string, unknown>; cache: Record<string, CacheStat>; rateLimit: RateLimitInfo } | null>(null);
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    api.settings
      .get()
      .then((r) => setInfo({ settings: r.settings, cache: r.cache, rateLimit: r.rateLimit }))
      .catch(() => setInfo(null));
  };

  useEffect(load, []);

  const runTest = async () => {
    setTesting(true);
    try {
      const r = await api.settings.test();
      setStatus(r.status);
      load();
      toast(`Connection ${r.status.health}`, r.status.health === 'connected' ? 'ok' : 'info');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Connection test failed', 'bad');
    } finally {
      setTesting(false);
    }
  };

  const endpoints = status?.endpoints ?? [];
  const settings = info?.settings ?? {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ============================== API ================================= */}
      <ClayCard>
        <div className="row" style={{ gap: 9, marginBottom: 4 }}>
          <Plug style={{ width: 17, height: 17, color: 'var(--accent-soft)' }} aria-hidden />
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>API</h3>
        </div>
        <p className="tiny muted" style={{ marginTop: 0, marginBottom: 16, lineHeight: 1.65 }}>
          The API key is configured server-side only, through the <span className="mono">ROBLOX_API_KEY</span> environment
          variable. It is never sent to the browser and never appears in this page or in any response body.
        </p>

        <div className="meta-grid" style={{ marginBottom: 16 }}>
          <Cell k="Open Cloud key" v={settings.openCloudConfigured ? 'Configured' : 'Not configured'} />
          <Cell k="Inventory source" v={settings.openCloudConfigured ? 'Open Cloud (with legacy RAP overlay)' : 'Legacy public endpoint'} />
          <Cell k="Request timeout" v={`${formatNumber(Number(settings.requestTimeoutMs ?? 0))} ms`} />
          <Cell k="Max concurrency" v={String(settings.maxConcurrency ?? '—')} />
          <Cell k="Min spacing" v={`${formatNumber(Number(settings.minRequestSpacingMs ?? 0))} ms`} />
          <Cell k="Backoff window" v={`${formatNumber(Number(settings.backoffMs ?? 0))} ms`} />
          <Cell k="Scan attempt ceiling" v={formatNumber(Number(settings.maxScanAttempts ?? 0))} />
          <Cell k="Result ceiling" v={formatNumber(Number(settings.maxScanResults ?? 0))} />
          <Cell k="Redis" v={settings.redisConfigured ? 'Configured' : 'In-memory cache'} />
          <Cell k="Mock mode" v={settings.mockMode ? 'ENABLED' : 'Off'} />
        </div>

        {Boolean(settings.mockMode) && (
          <div
            className="row"
            style={{
              gap: 10,
              padding: 12,
              borderRadius: 'var(--r-md)',
              background: 'rgba(251,191,119,0.1)',
              boxShadow: 'var(--sh-in)',
              marginBottom: 16,
            }}
          >
            <AlertTriangle style={{ width: 17, height: 17, color: 'var(--warn)', flex: 'none' }} aria-hidden />
            <div className="tiny" style={{ color: 'var(--warn)', lineHeight: 1.6 }}>
              Mock mode is enabled — profile lookups return clearly labelled fabricated data instead of calling Roblox.
              This is a development fallback and must stay off in production.
            </div>
            <div className="spacer" />
            <ClayButton
              size="sm"
              onClick={async () => {
                await api.settings.mock(false);
                load();
                toast('Mock mode disabled', 'ok');
              }}
            >
              Disable
            </ClayButton>
          </div>
        )}

        <div className="row row--wrap" style={{ gap: 8, marginBottom: endpoints.length ? 16 : 0 }}>
          <ClayButton icon={RefreshCw} loading={testing} onClick={() => void runTest()}>
            Test connection
          </ClayButton>
          <ClayButton
            icon={Trash2}
            onClick={async () => {
              try {
                await api.settings.clearCache();
                load();
                toast('Server caches cleared', 'ok');
              } catch {
                toast('Could not clear caches', 'bad');
              }
            }}
          >
            Clear server cache
          </ClayButton>
        </div>

        {endpoints.length > 0 && (
          <div className="table-wrap" style={{ boxShadow: 'none' }}>
            <table className="clay-table">
              <thead>
                <tr>
                  <th>Endpoint</th>
                  <th style={{ width: 110 }}>State</th>
                  <th style={{ width: 90 }}>Status</th>
                  <th style={{ width: 110 }}>Latency</th>
                </tr>
              </thead>
              <tbody>
                {endpoints.map((e) => (
                  <tr key={e.name} style={{ cursor: 'default' }}>
                    <td className="mono">{e.name}</td>
                    <td>
                      {e.ok ? (
                        <span className="pill pill--yes">
                          <Check aria-hidden />
                          Reachable
                        </span>
                      ) : (
                        <span className="pill pill--bad">
                          <X aria-hidden />
                          Failing
                        </span>
                      )}
                    </td>
                    <td className="num">{e.status ?? '—'}</td>
                    <td className="num">{e.latencyMs !== null ? `${e.latencyMs} ms` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ClayCard>

      {/* =========================== performance ============================ */}
      <ClayCard>
        <div className="row" style={{ gap: 9, marginBottom: 14 }}>
          <Gauge style={{ width: 17, height: 17, color: 'var(--accent-soft)' }} aria-hidden />
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Performance</h3>
        </div>

        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
          <div className="field">
            <span className="field__label">Inventory page size</span>
            <Segmented
              label="Inventory page size"
              value={String(prefs.inventoryLimit)}
              onChange={(v) => set('inventoryLimit', Number(v) as 10 | 25 | 50 | 100)}
              options={[
                { value: '10', label: '10' },
                { value: '25', label: '25' },
                { value: '50', label: '50' },
                { value: '100', label: '100' },
              ]}
            />
            <span className="tiny muted">Smaller pages load faster; the viewer keeps paging automatically.</span>
          </div>

        </div>

        {info?.cache && (
          <>
            <div className="section-title" style={{ marginTop: 20 }}>
              Server cache
            </div>
            <div className="table-wrap" style={{ boxShadow: 'none' }}>
              <table className="clay-table">
                <thead>
                  <tr>
                    <th>Cache</th>
                    <th style={{ width: 100 }}>Entries</th>
                    <th style={{ width: 100 }}>Hits</th>
                    <th style={{ width: 100 }}>Misses</th>
                    <th style={{ width: 110 }}>Hit rate</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(info.cache).map(([name, c]) => {
                    const total = c.hits + c.misses;
                    const rate = total ? Math.round((c.hits / total) * 100) : 0;
                    return (
                      <tr key={name} style={{ cursor: 'default' }}>
                        <td className="mono">{name.replace('Cache', '')}</td>
                        <td className="num">{c.entries}</td>
                        <td className="num">{c.hits}</td>
                        <td className="num">{c.misses}</td>
                        <td className="num">{total ? `${rate}%` : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {info.rateLimit && (
              <div className="row row--wrap" style={{ gap: 8, marginTop: 12 }}>
                <span className="pill pill--no">Outbound requests: {formatNumber(info.rateLimit.totalRequests)}</span>
                <span className={`pill ${info.rateLimit.hits ? 'pill--bad' : 'pill--no'}`}>
                  Rate-limit events: {info.rateLimit.hits}
                </span>
                {info.rateLimit.backoffUntil && info.rateLimit.backoffUntil > Date.now() && (
                  <span className="pill pill--warn">
                    Backing off {Math.ceil((info.rateLimit.backoffUntil - Date.now()) / 1000)}s
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </ClayCard>

      {/* =========================== appearance ============================= */}
      <ClayCard>
        <div className="row" style={{ gap: 9, marginBottom: 14 }}>
          <Gauge style={{ width: 17, height: 17, color: 'var(--accent-soft)' }} aria-hidden />
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Appearance</h3>
        </div>

        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 18 }}>
          <div className="field">
            <span className="field__label">Clay intensity — {prefs.clayIntensity.toFixed(2)}×</span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={prefs.clayIntensity}
              onChange={(e) => set('clayIntensity', Number(e.target.value))}
              aria-label="Clay intensity"
              style={{ width: '100%', accentColor: 'var(--accent)' }}
            />
            <span className="tiny muted">Scales every depth shadow in the interface. 0 flattens the surfaces.</span>
          </div>

          <div className="field">
            <span className="field__label">Theme brightness</span>
            <Segmented
              label="Theme brightness"
              value={prefs.brightness}
              onChange={(v) => set('brightness', v as 'dim' | 'normal' | 'bright')}
              options={[
                { value: 'dim', label: 'Dim' },
                { value: 'normal', label: 'Normal' },
                { value: 'bright', label: 'Bright' },
              ]}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <ClayToggle
              label="Reduce motion"
              checked={prefs.motion === 'reduced'}
              onChange={(v) => set('motion', v ? 'reduced' : 'full')}
            />
            <ClayToggle label="Compact layout" checked={prefs.compact} onChange={(v) => set('compact', v)} />
            <ClayToggle
              label="Collapse sidebar"
              checked={prefs.sidebarCollapsed}
              onChange={(v) => set('sidebarCollapsed', v)}
            />
          </div>
        </div>

        <ClayButton size="sm" style={{ marginTop: 16 }} onClick={reset}>
          Reset appearance to defaults
        </ClayButton>
      </ClayCard>

      {/* ============================== data ================================ */}
      <ClayCard>
        <div className="row" style={{ gap: 9, marginBottom: 14 }}>
          <Database style={{ width: 17, height: 17, color: 'var(--accent-soft)' }} aria-hidden />
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Data</h3>
        </div>

        <div className="row row--wrap" style={{ gap: 8 }}>
          <ClayButton
            icon={Download}
            onClick={async () => {
              try {
                const res = await api.saved.all();
                downloadText('vesper_saved.json', JSON.stringify(res.store, null, 2));
                toast('Saved accounts exported', 'ok');
              } catch {
                toast('Export failed', 'bad');
              }
            }}
          >
            Export saved accounts
          </ClayButton>
          <ClayButton icon={Upload} onClick={() => setImportOpen(true)}>
            Import saved accounts
          </ClayButton>
          <ClayButton variant="danger" icon={Trash2} onClick={() => setClearOpen(true)}>
            Clear local data
          </ClayButton>
        </div>

        <p className="tiny muted" style={{ marginTop: 14, lineHeight: 1.65 }}>
          Saved accounts are persisted server-side as JSON in the same shape the desktop tool used, so an existing
          <span className="mono"> rfinder_saved.json</span> can be imported directly. Credentials, cookies and passwords
          are never stored anywhere.
        </p>
      </ClayCard>

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} fileRef={fileRef} />

      <Modal
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        title="Clear local data?"
        icon={Trash2}
        footer={
          <>
            <div className="spacer" />
            <ClayButton size="sm" onClick={() => setClearOpen(false)}>
              Cancel
            </ClayButton>
            <ClayButton
              size="sm"
              variant="danger"
              onClick={async () => {
                try {
                  await api.saved.reset();
                  localStorage.removeItem('vesper.prefs.v1');
                  setClearOpen(false);
                  toast('Local data cleared', 'ok');
                  window.location.reload();
                } catch {
                  toast('Could not clear data', 'bad');
                }
              }}
            >
              Clear everything
            </ClayButton>
          </>
        }
      >
        This deletes every saved category and account on the server, plus your stored appearance preferences. Export
        first if you want a copy.
      </Modal>
    </div>
  );
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div className="meta-cell">
      <span className="meta-cell__k">{k}</span>
      <span className="meta-cell__v" style={{ fontSize: 13 }} title={v}>
        {v}
      </span>
    </div>
  );
}

function ImportModal({
  open,
  onClose,
  fileRef,
}: {
  open: boolean;
  onClose: () => void;
  fileRef: React.RefObject<HTMLInputElement>;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const parsed: unknown = JSON.parse(text);
      const res = await api.saved.import(parsed, mode);
      toast(
        `Imported ${res.report.accounts} account(s)` + (res.report.skipped ? ` · ${res.report.skipped} skipped as invalid` : ''),
        res.report.skipped ? 'info' : 'ok',
      );
      setText('');
      onClose();
      window.location.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That is not valid JSON', 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import saved accounts"
      icon={Upload}
      wide
      footer={
        <>
          <div className="spacer" />
          <ClayButton size="sm" onClick={onClose}>
            Cancel
          </ClayButton>
          <ClayButton size="sm" variant="primary" loading={busy} disabled={!text.trim()} onClick={() => void submit()}>
            Import
          </ClayButton>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="field">
          <span className="field__label">Mode</span>
          <Segmented
            label="Import mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'merge', label: 'Merge into existing' },
              { value: 'replace', label: 'Replace everything' },
            ]}
          />
        </div>

        <div className="row row--wrap" style={{ gap: 8 }}>
          <ClayButton size="sm" icon={Upload} onClick={() => fileRef.current?.click()}>
            Choose file
          </ClayButton>
          <span className="tiny muted">Or paste the JSON below.</span>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setText(await f.text());
              e.target.value = '';
            }}
          />
        </div>

        <textarea
          className="textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='{ "categories": { "Default": { "accounts": { ... } } } }'
          style={{ minHeight: 210, fontFamily: 'var(--mono)', fontSize: 12 }}
          aria-label="Saved accounts JSON"
        />

        <div className="tiny muted" style={{ lineHeight: 1.6 }}>
          Every record is validated and sanitised on the server before it is stored. IDs must be numeric, names are
          length-capped, and anything that does not fit the saved-account shape is skipped rather than trusted.
        </div>
      </div>
    </Modal>
  );
}
