import {
  Bookmark,
  Download,
  ExternalLink,
  FileText,
  FolderPlus,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { SavedAccount } from '../../shared/types';
import { useSaved } from '../App';
import ProfileView, { BadgeIcon } from '../components/ProfileView';
import {
  ClayButton,
  ClayCard,
  ClayInput,
  ClaySelect,
  Drawer,
  EmptyState,
  IconButton,
  Modal,
  StatusPill,
  useToast,
} from '../components/clay';
import { api, ApiError } from '../lib/api';
import { copyText, exportFile, formatNumber, openProfile } from '../lib/utils';
import type { UserProfile } from '../../shared/types';

type SortKey = 'username' | 'id' | 'created' | 'rap' | 'note';

export default function Saved() {
  const { store, index, loading, refresh } = useSaved();
  const { toast } = useToast();

  const categories = store ? Object.keys(store.categories) : [];
  const [current, setCurrent] = useState<string>('');
  const active = current && categories.includes(current) ? current : (categories[0] ?? '');

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('username');
  const [addOpen, setAddOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [noteTarget, setNoteTarget] = useState<SavedAccount | null>(null);
  const [openAccount, setOpenAccount] = useState<SavedAccount | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const accounts = useMemo(() => {
    const cat = store?.categories[active];
    if (!cat) return [];
    let list = Object.values(cat.accounts);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (a) =>
          a.username.toLowerCase().includes(q) ||
          a.id.includes(q) ||
          a.note.toLowerCase().includes(q) ||
          (a.displayName ?? '').toLowerCase().includes(q),
      );
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sort) {
        case 'id':
          return Number(a.id) - Number(b.id);
        case 'created':
          return (a.created || '').localeCompare(b.created || '');
        case 'rap': {
          const pa = Number.parseInt((a.rap || '').replace(/,/g, ''), 10);
          const pb = Number.parseInt((b.rap || '').replace(/,/g, ''), 10);
          return (Number.isFinite(pb) ? pb : -1) - (Number.isFinite(pa) ? pa : -1);
        }
        case 'note':
          return (b.note ? 1 : 0) - (a.note ? 1 : 0) || a.username.localeCompare(b.username);
        default:
          return a.username.toLowerCase().localeCompare(b.username.toLowerCase());
      }
    });
    return sorted;
  }, [store, active, query, sort]);

  const totalAccounts = store
    ? Object.values(store.categories).reduce((n, c) => n + Object.keys(c.accounts).length, 0)
    : 0;

  const openInspector = async (acc: SavedAccount) => {
    setOpenAccount(acc);
    setProfile(null);
    setProfileLoading(true);
    try {
      const res = await api.user.byId(acc.id);
      setProfile(res.profile ?? null);
    } catch {
      setProfile(null);
    } finally {
      setProfileLoading(false);
    }
  };

  const refreshAccount = async (acc: SavedAccount) => {
    try {
      const res = await api.user.byId(acc.id);
      const p = res.profile;
      if (!p) throw new Error('not found');
      await api.saved.update(active, acc.id, {
        username: p.username,
        displayName: p.displayName,
        created: p.createdDate,
        rap: p.rap,
        verified: p.verified,
        banned: p.banned,
        active: p.active,
        hats: p.hats,
        badges: p.badges.map((b) => b.name),
        avatarUrl: p.avatarUrl,
        lastChecked: new Date().toISOString(),
        inventorySummary:
          p.inventoryStatus === 'ok'
            ? { status: 'ok', itemCount: null, totalRap: p.rapValue }
            : { status: p.inventoryStatus, itemCount: null, totalRap: null },
      });
      refresh();
      toast(`${p.username} refreshed`, 'ok');
    } catch {
      toast('Refresh failed', 'bad');
    }
  };

  const onImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      const res = await api.saved.import(parsed, 'merge');
      refresh();
      toast(
        `Imported ${res.report.accounts} account(s) across ${res.report.categories} categor(y/ies)` +
          (res.report.skipped ? ` · ${res.report.skipped} skipped` : ''),
        res.report.skipped ? 'info' : 'ok',
      );
    } catch {
      toast('Import failed — the file was not valid saved-account JSON', 'bad');
    }
  };

  if (loading) {
    return (
      <ClayCard>
        <EmptyState title="Loading saved accounts…" art="info" />
      </ClayCard>
    );
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(210px, 260px) 1fr', gap: 16, alignItems: 'start' }}>
      {/* ---- categories ---- */}
      <ClayCard>
        <div className="section-title">Categories</div>
        <div className="cat-list">
          {categories.map((name) => (
            <button
              key={name}
              type="button"
              className="cat-item"
              aria-current={name === active ? 'true' : undefined}
              onClick={() => setCurrent(name)}
            >
              <Bookmark style={{ width: 15, height: 15, flex: 'none' }} aria-hidden />
              <span className="truncate">{name}</span>
              <span className="cat-item__count">{store?.categories[name] ? Object.keys(store.categories[name].accounts).length : 0}</span>
            </button>
          ))}
        </div>

        <div className="row row--wrap" style={{ gap: 6, marginTop: 14 }}>
          <ClayButton size="sm" icon={FolderPlus} onClick={() => setAddOpen(true)}>
            Add
          </ClayButton>
          <ClayButton size="sm" icon={Pencil} disabled={!active} onClick={() => setRenameOpen(true)}>
            Rename
          </ClayButton>
          <ClayButton size="sm" variant="danger" icon={Trash2} disabled={!active} onClick={() => setDeleteOpen(true)}>
            Delete
          </ClayButton>
        </div>

        <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="section-title">Data</div>
          <ClayButton
            size="sm"
            icon={Download}
            disabled={!totalAccounts}
            onClick={() =>
              exportFile(
                'json',
                'vesper-saved',
                accounts.map((a) => ({ ...a })),
              )
            }
          >
            Export category
          </ClayButton>
          <ClayButton size="sm" icon={Upload} onClick={() => fileRef.current?.click()}>
            Import JSON
          </ClayButton>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImportFile(f);
              e.target.value = '';
            }}
          />
        </div>
      </ClayCard>

      {/* ---- accounts ---- */}
      <ClayCard>
        <div className="row row--wrap row--between" style={{ gap: 10, marginBottom: 12 }}>
          <div className="row row--wrap" style={{ gap: 8 }}>
            <ClayInput
              icon={Search}
              placeholder="Search username, ID or note"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search saved accounts"
              className="grow-sm"
            />
            <ClaySelect
              value={sort}
              options={[
                { value: 'username' as SortKey, label: 'Username A → Z' },
                { value: 'id' as SortKey, label: 'ID low → high' },
                { value: 'created' as SortKey, label: 'Created oldest' },
                { value: 'rap' as SortKey, label: 'RAP high → low' },
                { value: 'note' as SortKey, label: 'Has note first' },
              ]}
              onChange={setSort}
            />
          </div>
          <span className="tiny muted">
            {accounts.length} of {store?.categories[active] ? Object.keys(store.categories[active].accounts).length : 0} in “{active || '—'}”
          </span>
        </div>

        {accounts.length === 0 ? (
          <EmptyState
            title={totalAccounts ? 'No accounts in this category' : 'Nothing saved yet'}
            text={
              totalAccounts
                ? 'This category is empty, or nothing matches your search.'
                : 'Save accounts from the Account Finder or User Lookup and they will appear here, persisted to the server as JSON.'
            }
            art="info"
          />
        ) : (
          <div className="table-wrap" style={{ boxShadow: 'none' }}>
            <div className="table-scroll">
              <table className="clay-table">
                <thead>
                  <tr>
                    <th style={{ width: 56 }}>Note</th>
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
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.id} onDoubleClick={() => setNoteTarget(a)} onClick={() => void openInspector(a)}>
                      <td>
                        {a.note.trim() ? (
                          <span className="pill pill--accent" title={a.note}>
                            <FileText aria-hidden />
                            Note
                          </span>
                        ) : (
                          <span className="tiny muted">—</span>
                        )}
                      </td>
                      <td>
                        <span className="uname">
                          <span className="uname__av">
                            {a.avatarUrl ? <img src={a.avatarUrl} alt="" /> : <Bookmark aria-hidden />}
                          </span>
                          <span className="truncate" style={{ maxWidth: 160 }}>
                            {a.username}
                          </span>
                        </span>
                      </td>
                      <td className="num">{a.id}</td>
                      <td className="num">{a.created || '—'}</td>
                      <td className="num" style={{ color: 'var(--accent-soft)', fontWeight: 700 }}>
                        {a.rap || '—'}
                      </td>
                      <td>
                        <span className="row" style={{ gap: 3 }}>
                          {a.badges.length ? (
                            a.badges.slice(0, 6).map((b) => (
                              <span key={b} className="badge-chip" title={b}>
                                <BadgeIcon badge={b} size={20} />
                              </span>
                            ))
                          ) : (
                            <span className="tiny muted">—</span>
                          )}
                        </span>
                      </td>
                      <td>
                        <StatusPill value={a.verified || '—'} />
                      </td>
                      <td>
                        <StatusPill value={a.banned || '—'} kind="banned" />
                      </td>
                      <td>
                        <StatusPill value={a.active || '—'} kind="active" />
                      </td>
                      <td className="num">{a.hats || '—'}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <span className="row-actions" style={{ opacity: 1 }}>
                          <IconButton label="Edit note" icon={Pencil} size="sm" onClick={() => setNoteTarget(a)} />
                          <IconButton label="Refresh information" icon={RefreshCw} size="sm" onClick={() => void refreshAccount(a)} />
                          <IconButton label="Open Roblox profile" icon={ExternalLink} size="sm" onClick={() => openProfile(a.id)} />
                          <IconButton
                            label="Remove from category"
                            icon={Trash2}
                            size="sm"
                            onClick={async () => {
                              try {
                                await api.saved.remove(active, a.id);
                                refresh();
                                toast('Removed from category', 'ok');
                              } catch (err) {
                                toast(err instanceof ApiError ? err.message : 'Remove failed', 'bad');
                              }
                            }}
                          />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="tiny muted" style={{ marginTop: 10 }}>
          Double-click a row to edit its note. Click a row to open the full inspector with inventory.
        </div>
      </ClayCard>

      {/* ---- modals ---- */}
      <CategoryModal
        open={addOpen}
        mode="add"
        onClose={() => setAddOpen(false)}
        onDone={() => {
          setAddOpen(false);
          refresh();
          toast('Category created', 'ok');
        }}
      />
      <CategoryModal
        open={renameOpen}
        mode="rename"
        initial={active}
        onClose={() => setRenameOpen(false)}
        onDone={() => {
          setRenameOpen(false);
          refresh();
          toast('Category renamed', 'ok');
        }}
      />
      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={`Delete “${active}”?`}
        icon={Trash2}
        footer={
          <>
            <div className="spacer" />
            <ClayButton size="sm" onClick={() => setDeleteOpen(false)}>
              Cancel
            </ClayButton>
            <ClayButton
              size="sm"
              variant="danger"
              onClick={async () => {
                try {
                  await api.saved.deleteCategory(active);
                  setDeleteOpen(false);
                  refresh();
                  toast('Category deleted', 'ok');
                } catch (err) {
                  toast(err instanceof ApiError ? err.message : 'Delete failed', 'bad');
                }
              }}
            >
              Delete category
            </ClayButton>
          </>
        }
      >
        This removes the category and every account saved inside it. Accounts saved in other categories are untouched.
      </Modal>

      <NoteModal
        account={noteTarget}
        category={active}
        onClose={() => setNoteTarget(null)}
        onSaved={() => {
          setNoteTarget(null);
          refresh();
          toast('Note saved', 'ok');
        }}
      />

      <Drawer
        open={openAccount !== null}
        onClose={() => setOpenAccount(null)}
        title={openAccount?.username ?? ''}
        subtitle={openAccount ? `ID ${openAccount.id} · saved ${openAccount.savedAt?.slice(0, 10) ?? 'unknown'}` : undefined}
        actions={
          openAccount ? (
            <IconButton label="Open Roblox profile" icon={ExternalLink} onClick={() => openProfile(openAccount.id)} />
          ) : undefined
        }
      >
        {profileLoading && <div className="tiny muted">Loading profile…</div>}
        {!profileLoading && profile && (
          <ProfileView
            profile={profile}
            compact
            note={openAccount?.note ?? ''}
            onNoteChange={async (note) => {
              if (!openAccount) return;
              await api.saved.note(active, openAccount.id, note);
              refresh();
            }}
          />
        )}
        {!profileLoading && !profile && openAccount && (
          <EmptyState
            title="Profile could not be loaded"
            text="The saved record is intact, but the live profile request failed. The stored values are shown below."
            art="error"
          />
        )}
        {openAccount && (
          <div className="meta-grid" style={{ marginTop: 16 }}>
            <div className="meta-cell">
              <span className="meta-cell__k">Stored RAP</span>
              <span className="meta-cell__v mono">{openAccount.rap || 'Unavailable'}</span>
            </div>
            <div className="meta-cell">
              <span className="meta-cell__k">Stored hats</span>
              <span className="meta-cell__v mono">{openAccount.hats || 'Unavailable'}</span>
            </div>
            <div className="meta-cell">
              <span className="meta-cell__k">Last checked</span>
              <span className="meta-cell__v mono" style={{ fontSize: 12 }}>
                {openAccount.lastChecked?.slice(0, 10) ?? 'Never'}
              </span>
            </div>
            <div className="meta-cell">
              <span className="meta-cell__k">In categories</span>
              <span className="meta-cell__v" style={{ fontSize: 12 }}>
                {(index[openAccount.id] ?? []).join(', ') || '—'}
              </span>
            </div>
            <div className="meta-cell">
              <span className="meta-cell__k">Inventory</span>
              <span className="meta-cell__v" style={{ fontSize: 12 }}>
                {openAccount.inventorySummary
                  ? openAccount.inventorySummary.status === 'ok'
                    ? `${formatNumber(openAccount.inventorySummary.totalRap)} RAP`
                    : openAccount.inventorySummary.status
                  : 'Unknown'}
              </span>
            </div>
            <div className="meta-cell">
              <span className="meta-cell__k">Copy ID</span>
              <span className="meta-cell__v">
                <ClayButton
                  size="sm"
                  icon={FileText}
                  onClick={async () => {
                    const ok = await copyText(openAccount.id);
                    toast(ok ? 'ID copied' : 'Copy failed', ok ? 'ok' : 'bad');
                  }}
                >
                  Copy
                </ClayButton>
              </span>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function CategoryModal({
  open,
  mode,
  initial = '',
  onClose,
  onDone,
}: {
  open: boolean;
  mode: 'add' | 'rename';
  initial?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const clean = name.trim();
    if (!clean) {
      toast('Category name is required', 'bad');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'add') await api.saved.createCategory(clean);
      else await api.saved.renameCategory(initial, clean);
      setName('');
      onDone();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed', 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'add' ? 'New category' : `Rename “${initial}”`}
      icon={FolderPlus}
      footer={
        <>
          <div className="spacer" />
          <ClayButton size="sm" onClick={onClose}>
            Cancel
          </ClayButton>
          <ClayButton size="sm" variant="primary" loading={busy} onClick={() => void submit()}>
            {mode === 'add' ? 'Create' : 'Rename'}
          </ClayButton>
        </>
      }
    >
      <ClayInput
        label="Category name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. High RAP"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
        }}
      />
    </Modal>
  );
}

function NoteModal({
  account,
  category,
  onClose,
  onSaved,
}: {
  account: SavedAccount | null;
  category: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  // Seed the editor whenever a different account is opened.
  const key = account?.id ?? '';
  const [seeded, setSeeded] = useState('');
  if (account && seeded !== key) {
    setText(account.note ?? '');
    setSeeded(key);
  }

  if (!account) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Note — ${account.username}`}
      icon={FileText}
      footer={
        <>
          <span className="tiny muted">ID {account.id} in “{category}”</span>
          <div className="spacer" />
          <ClayButton size="sm" onClick={onClose}>
            Cancel
          </ClayButton>
          <ClayButton
            size="sm"
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.saved.note(category, account.id, text);
                onSaved();
              } catch (err) {
                toast(err instanceof ApiError ? err.message : 'Save failed', 'bad');
              } finally {
                setBusy(false);
              }
            }}
          >
            Save note
          </ClayButton>
        </>
      }
    >
      <textarea
        className="textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Multiline notes are supported."
        style={{ minHeight: 170 }}
        aria-label="Account note"
      />
    </Modal>
  );
}
