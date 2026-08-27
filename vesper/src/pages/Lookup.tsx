import { AlertTriangle, Search, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useSaved } from '../App';
import ProfileView, { ProfileSkeleton, type ProfileTab } from '../components/ProfileView';
import { ClayButton, ClayCard, ClayInput, EmptyState, Modal, ClaySelect, useToast } from '../components/clay';
import { api, ApiError } from '../lib/api';
import type { UserProfile } from '../../shared/types';

const TABS: ProfileTab[] = ['overview', 'inventory', 'badges', 'metadata', 'notes'];

export default function Lookup() {
  const { toast } = useToast();
  const { store, index, refresh } = useSaved();
  const location = useLocation();

  const [query, setQuery] = useState('');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<UserProfile[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [tab, setTab] = useState<ProfileTab>('overview');

  const controller = useRef<AbortController | null>(null);

  // Deep links: #/lookup?q=name&tab=inventory (used by the Finder).
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const q = params.get('q') ?? '';
    const t = params.get('tab') as ProfileTab | null;
    if (t && TABS.includes(t)) setTab(t);
    if (q) {
      setQuery(q);
      void run(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  const run = useCallback(
    async (value: string) => {
      const q = value.trim();
      if (!q) {
        setError('Enter a username or user ID to look up.');
        return;
      }
      if (q.length > 40) {
        setError('That query is too long.');
        return;
      }

      controller.current?.abort();
      const ac = new AbortController();
      controller.current = ac;

      setLoading(true);
      setError(null);
      try {
        const res = await api.user.lookup(q, ac.signal);
        if (ac.signal.aborted) return;
        if (!res.profile) {
          setProfile(null);
          setError(res.error ?? 'User not found');
          return;
        }
        setProfile(res.profile);
        setHistory((h) => [res.profile as UserProfile, ...h.filter((p) => p.id !== res.profile!.id)].slice(0, 8));
      } catch (err) {
        if (ac.signal.aborted) return;
        setProfile(null);
        setError(err instanceof ApiError ? err.message : 'Connection failed');
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    },
    [],
  );

  const categories = store ? Object.keys(store.categories) : [];
  const savedIn = profile ? (index[String(profile.id)] ?? []) : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ClayCard>
        <form
          className="row row--wrap"
          style={{ gap: 10 }}
          onSubmit={(e) => {
            e.preventDefault();
            void run(query);
          }}
        >
          <ClayInput
            className="grow"
            icon={Search}
            placeholder="Username or user ID — press Enter to search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Username or user ID"
            autoComplete="off"
            spellCheck={false}
          />
          <ClayButton type="submit" variant="primary" icon={Search} loading={loading}>
            {loading ? 'Looking up…' : 'Lookup'}
          </ClayButton>
        </form>

        {history.length > 0 && (
          <div className="row row--wrap" style={{ gap: 6, marginTop: 12 }}>
            <span className="tiny muted">Recent:</span>
            {history.map((h) => (
              <button key={h.id} type="button" className="chip" onClick={() => { setQuery(h.username); void run(h.username); }}>
                {h.username}
              </button>
            ))}
          </div>
        )}
      </ClayCard>

      {error && (
        <ClayCard sunken>
          <div className="row" style={{ gap: 10 }}>
            <AlertTriangle style={{ width: 18, height: 18, color: 'var(--bad)', flex: 'none' }} aria-hidden />
            <div style={{ flex: 1 }}>{error}</div>
            <ClayButton size="sm" onClick={() => void run(query)}>
              Try again
            </ClayButton>
          </div>
        </ClayCard>
      )}

      {loading && <ProfileSkeleton />}

      {!loading && !profile && !error && (
        <ClayCard pad={false}>
          <EmptyState
            title="Look up any Roblox account"
            text="Enter a username or a numeric user ID. Vesper assembles the profile, its badges and its full collectible inventory from public Roblox endpoints — nothing here requires signing in anywhere."
            art="search"
          />
        </ClayCard>
      )}

      {!loading && profile && (
        <ProfileView
          profile={profile}
          initialTab={tab}
          onSave={() => setSaveOpen(true)}
          onRefresh={() => void run(profile.username)}
          refreshing={loading}
        />
      )}

      <SaveModal
        open={saveOpen}
        profile={profile}
        categories={categories}
        existing={savedIn}
        onClose={() => setSaveOpen(false)}
        onSaved={() => {
          setSaveOpen(false);
          refresh();
          toast('Account saved', 'ok');
        }}
      />
    </div>
  );
}

function SaveModal({
  open,
  profile,
  categories,
  existing,
  onClose,
  onSaved,
}: {
  open: boolean;
  profile: UserProfile | null;
  categories: string[];
  existing: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [category, setCategory] = useState(categories[0] ?? 'Default');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  if (!profile) return null;

  const save = async () => {
    setBusy(true);
    try {
      await api.saved.save(category, [
        {
          id: String(profile.id),
          username: profile.username,
          displayName: profile.displayName,
          created: profile.createdDate,
          rap: profile.rap,
          verified: profile.verified,
          banned: profile.banned,
          active: profile.active,
          hats: profile.hats,
          badges: profile.badges.map((b) => b.name),
          note,
          avatarUrl: profile.avatarUrl,
          lastChecked: new Date().toISOString(),
          inventorySummary:
            profile.inventoryStatus === 'ok'
              ? { status: 'ok', itemCount: null, totalRap: profile.rapValue }
              : { status: profile.inventoryStatus, itemCount: null, totalRap: null },
        },
      ]);
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
      title={`Save ${profile.username}`}
      icon={UserPlus}
      footer={
        <>
          <div className="spacer" />
          <ClayButton size="sm" onClick={onClose}>
            Cancel
          </ClayButton>
          <ClayButton size="sm" variant="primary" loading={busy} onClick={() => void save()}>
            Save account
          </ClayButton>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {existing.length > 0 && (
          <div className="tiny" style={{ padding: 10, borderRadius: 'var(--r-sm)', background: 'rgba(139,124,246,0.1)', boxShadow: 'var(--sh-in)' }}>
            Already saved in: {existing.join(', ')} — saving again will update the record and keep its note.
          </div>
        )}
        <ClaySelect label="Category" value={category} options={categories.length ? categories : ['Default']} onChange={setCategory} />
        <div className="field">
          <label className="field__label" htmlFor="save-note">
            Note
          </label>
          <textarea
            id="save-note"
            className="textarea"
            value={note}
            placeholder="Optional note about this account"
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}
