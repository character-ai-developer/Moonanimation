import {
  Award,
  BadgeCheck,
  Calendar,
  Copy,
  ExternalLink as OpenIcon,
  Hash,
  Package,
  RefreshCw,
  User as UserIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { RobloxBadge, UserProfile } from '../../shared/types';
import { accountAge, copyText, formatDate, openProfile } from '../lib/utils';
import { ClayButton, ClayCard, CountUp, EmptyState, IconButton, Modal, Skeleton, StatusPill, useToast } from './clay';
import Inventory from './Inventory';

export type ProfileTab = 'overview' | 'inventory' | 'badges' | 'metadata' | 'notes';
type Tab = ProfileTab;

interface Props {
  profile: UserProfile;
  /** Rendered inside a drawer, so chrome is trimmed. */
  compact?: boolean;
  /** Deep-link target tab (used by the Finder's "full inventory" action). */
  initialTab?: ProfileTab;
  onSave?: (p: UserProfile) => void;
  note?: string;
  onNoteChange?: (note: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}

/**
 * Full profile inspection surface.
 *
 * Every field that could not be read is rendered as "Unavailable" — never as a
 * zero or a guess. `profile.degraded` lists which upstream calls failed.
 */
export default function ProfileView({ profile, compact, initialTab, onSave, note, onNoteChange, onRefresh, refreshing }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'overview');
  const { toast } = useToast();

  // Follow deep links (e.g. Finder row → straight to the inventory tab).
  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab, profile.id]);

  const rapValue =
    profile.rapValue ?? (profile.rap && profile.rap !== 'Unknown' ? Number.parseInt(profile.rap.replace(/,/g, ''), 10) : null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ---- hero ---- */}
      <ClayCard accent>
        <div className="row row--wrap" style={{ gap: 18, alignItems: 'flex-start' }}>
          <div className={`avatar-hero ${compact ? '' : 'avatar-hero--lg'}`}>
            {profile.avatarUrl ? (
              <img src={profile.avatarUrl} alt={`Avatar of ${profile.username}`} />
            ) : (
              <UserIcon aria-hidden />
            )}
          </div>

          <div style={{ flex: 1, minWidth: 210 }}>
            <div className="row row--wrap" style={{ gap: 8, marginBottom: 4 }}>
              <h2 style={{ margin: 0, fontSize: compact ? 19 : 23, fontWeight: 800, letterSpacing: '-0.02em' }}>
                {profile.username || 'Unavailable'}
              </h2>
              {profile.verified === 'Yes' && (
                <span className="pill pill--accent" title="Owns the Verified, Bonafide, Plaidafied asset">
                  <BadgeCheck aria-hidden />
                  Verified
                </span>
              )}
            </div>
            <div className="tiny muted" style={{ marginBottom: 10 }}>
              {profile.displayName && profile.displayName !== profile.username
                ? `Display name: ${profile.displayName}`
                : 'Display name matches username'}
            </div>

            <div className="row row--wrap" style={{ gap: 6, marginBottom: 12 }}>
              <StatusPill value={profile.banned} kind="banned" />
              <StatusPill value={profile.active} kind="active" />
              <span className="pill pill--no">
                <Hash aria-hidden />
                {profile.id}
              </span>
              <span className="pill pill--no">
                <Calendar aria-hidden />
                {formatDate(profile.created)}
              </span>
            </div>

            <div className="row row--wrap" style={{ gap: 8 }}>
              <ClayButton size="sm" variant="primary" icon={Package} onClick={() => setTab('inventory')}>
                Limited Inventory
              </ClayButton>
              <ClayButton size="sm" icon={OpenIcon} onClick={() => openProfile(profile.id)}>
                Open Roblox Profile
              </ClayButton>
              <IconButton
                label="Copy username"
                icon={Copy}
                size="sm"
                onClick={async () => {
                  const ok = await copyText(profile.username);
                  toast(ok ? 'Username copied' : 'Copy failed', ok ? 'ok' : 'bad');
                }}
              />
              <IconButton
                label="Copy user ID"
                icon={Hash}
                size="sm"
                onClick={async () => {
                  const ok = await copyText(String(profile.id));
                  toast(ok ? 'User ID copied' : 'Copy failed', ok ? 'ok' : 'bad');
                }}
              />
              {onSave && (
                <ClayButton size="sm" icon={Award} onClick={() => onSave(profile)}>
                  Save
                </ClayButton>
              )}
              {onRefresh && (
                <IconButton label="Refresh information" icon={RefreshCw} size="sm" onClick={onRefresh} disabled={refreshing} />
              )}
            </div>
          </div>
        </div>
      </ClayCard>

      {/* ---- tabs ---- */}
      <div className="tabs" role="tablist">
        {(
          [
            ['overview', 'Overview'],
            ['inventory', 'Inventory'],
            ['badges', `Badges (${profile.badges.length})`],
            ['metadata', 'Metadata'],
            ['notes', 'Notes'],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <ClayCard>
          <div className="meta-grid">
            <Cell k="User ID" v={profile.id} mono />
            <Cell k="Username" v={profile.username || 'Unavailable'} />
            <Cell k="Display name" v={profile.displayName || 'Unavailable'} />
            <Cell k="Created" v={formatDate(profile.created)} mono />
            <Cell k="Account age" v={accountAge(profile.created)} />
            <Cell k="RAP" v={profile.rap} mono />
            <Cell k="Hats" v={profile.hats} mono />
            <Cell k="Badges" v={String(profile.badges.length)} mono />
            <Cell k="Rig" v={profile.rigType ?? 'Unavailable'} />
            <Cell k="Verified" v={profile.verified} />
            <Cell k="Banned" v={profile.banned} />
            <Cell k="Active" v={profile.active} />
          </div>

          {profile.degraded.length > 0 && (
            <div
              className="tiny"
              style={{
                marginTop: 14,
                padding: 10,
                borderRadius: 'var(--r-sm)',
                background: 'rgba(251,191,119,0.08)',
                boxShadow: 'var(--sh-in)',
                color: 'var(--warn)',
              }}
            >
              Partial data — these upstream calls failed and their values show as Unavailable:{' '}
              {profile.degraded.join(', ')}
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <div className="section-title">Total RAP</div>
            <div className="stat__value" style={{ fontSize: 30 }}>
              {rapValue === null || !Number.isFinite(rapValue) ? (
                <span className="muted" style={{ fontSize: 18 }}>
                  Unknown
                </span>
              ) : (
                <CountUp value={rapValue} />
              )}
            </div>
            <div className="tiny muted" style={{ marginTop: 4 }}>
              {profile.inventoryStatus === 'ok'
                ? 'Summed from the collectibles the inventory API actually returned.'
                : 'The inventory could not be read, so no total is claimed.'}
            </div>
          </div>
        </ClayCard>
      )}

      {tab === 'inventory' && <Inventory user={profile} embedded />}

      {tab === 'badges' && <BadgeSection badges={profile.badges} />}

      {tab === 'metadata' && (
        <ClayCard>
          <div className="section-title">Activity signals</div>
          <p className="tiny muted" style={{ marginTop: 0, marginBottom: 12, lineHeight: 1.65 }}>
            Activity is a heuristic inferred from public signals, not a fact reported by Roblox. It reproduces the
            original tool's rules exactly: ownership of the verified badge asset, a display name that differs from the
            username, an old account whose inventory is now private, and the avatar rig type.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {profile.activeReasons.length ? (
              profile.activeReasons.map((r) => (
                <div key={r} className="tiny mono" style={{ padding: '7px 11px', borderRadius: 'var(--r-sm)', boxShadow: 'var(--sh-in)' }}>
                  {r}
                </div>
              ))
            ) : (
              <div className="tiny muted">No signals recorded.</div>
            )}
          </div>

          <div className="section-title" style={{ marginTop: 20 }}>
            Endpoints consulted
          </div>
          <div className="meta-grid">
            <Cell k="Profile" v="users.roblox.com" mono />
            <Cell k="Rig" v={profile.rigType ? 'avatar.roblox.com' : 'unavailable'} mono />
            <Cell k="Verified" v={profile.degraded.includes('verification') ? 'unavailable' : 'inventory.roblox.com'} mono />
            <Cell k="Collectibles" v={profile.inventoryStatus === 'ok' ? 'inventory.roblox.com' : 'unavailable'} mono />
            <Cell k="Badges" v={profile.badges.length ? 'accountinformation.roblox.com' : 'none returned'} mono />
            <Cell k="Profile URL" v={profile.profileUrl} mono />
          </div>
        </ClayCard>
      )}

      {tab === 'notes' && (
        <ClayCard>
          {onNoteChange ? (
            <>
              <div className="section-title">Note for {profile.username}</div>
              <textarea
                className="textarea"
                value={note ?? ''}
                placeholder="Write a note about this account. Notes are stored with the saved record."
                onChange={(e) => onNoteChange(e.target.value)}
                aria-label="Account note"
                style={{ minHeight: 150 }}
              />
              <div className="tiny muted" style={{ marginTop: 8 }}>
                Notes are saved automatically when this account is saved to a category.
              </div>
            </>
          ) : (
            <EmptyState
              title="Notes live with saved accounts"
              text="Save this account to a category first, then edit its note from the Saved page."
              art="info"
            />
          )}
        </ClayCard>
      )}
    </div>
  );
}

function Cell({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  const text = v === null || v === undefined || v === '' ? 'Unavailable' : String(v);
  return (
    <div className="meta-cell">
      <span className="meta-cell__k">{k}</span>
      <span className={`meta-cell__v ${mono ? 'mono' : ''}`} style={{ fontSize: 13 }} title={text}>
        {text}
      </span>
    </div>
  );
}

/* -------------------------------- badges ---------------------------------- */

function BadgeSection({ badges }: { badges: RobloxBadge[] }) {
  const [selected, setSelected] = useState<RobloxBadge | null>(null);

  if (!badges.length) {
    return (
      <ClayCard pad={false}>
        <EmptyState
          title="No account badges"
          text="The badges endpoint returned nothing for this account. That means either the account holds no account-level badges, or the request could not be completed."
          art="info"
        />
      </ClayCard>
    );
  }

  return (
    <>
      <div className="badge-grid">
        {badges.map((b) => (
          <button key={`${b.id ?? b.name}`} type="button" className="badge-card" onClick={() => setSelected(b)}>
            <span className="badge-card__icon">
              <BadgeIcon badge={b} size={52} />
            </span>
            <span className="badge-card__name">{b.name}</span>
            {b.id !== null && <span className="tiny muted mono">#{b.id}</span>}
          </button>
        ))}
      </div>

      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.name ?? ''}
        icon={Award}
        footer={
          <>
            <div className="spacer" />
            <ClayButton size="sm" onClick={() => setSelected(null)}>
              Close
            </ClayButton>
          </>
        }
      >
        {selected && (
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <div
              className="clay-card clay-card--sunken"
              style={{ width: 104, height: 104, flex: 'none', display: 'grid', placeItems: 'center', padding: 0, borderRadius: '50%', overflow: 'hidden' }}
            >
              <BadgeIcon badge={selected} size={104} />
            </div>
            <div style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="meta-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px,1fr))' }}>
                <Cell k="Badge name" v={selected.name} />
                <Cell k="Badge ID" v={selected.id ?? 'Unavailable'} mono />
                <Cell k="Awarded" v={selected.awardedDate ? formatDate(selected.awardedDate) : 'Unavailable'} mono />
              </div>
              {selected.description && (
                <div className="tiny" style={{ lineHeight: 1.7, color: 'var(--text-2)' }}>
                  {selected.description}
                </div>
              )}
              <div className="tiny muted">
                Roblox exposes no public icon or award-date endpoint for account badges, so the icon comes from a static
                map and the award date is unavailable by design.
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

/** Badge icon with graceful fallback to a generated mark. */
export function BadgeIcon({ badge, size = 20 }: { badge: RobloxBadge | string; size?: number }) {
  const b = typeof badge === 'string' ? ({ name: badge, iconUrl: null } as RobloxBadge) : badge;
  const [failed, setFailed] = useState(false);

  if (b.iconUrl && !failed) {
    return <img src={b.iconUrl} alt={b.name} width={size} height={size} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden style={{ color: 'var(--accent-soft)' }}>
      <path
        d="M12 3.5l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8L12 3.5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Loading placeholder shaped like the profile hero. */
export function ProfileSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <ClayCard>
        <div className="row" style={{ gap: 18, alignItems: 'flex-start' }}>
          <Skeleton w={148} h={148} r={22} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Skeleton w={190} h={22} />
            <Skeleton w={140} h={12} />
            <div className="row" style={{ gap: 6 }}>
              <Skeleton w={70} h={20} r={999} />
              <Skeleton w={70} h={20} r={999} />
              <Skeleton w={90} h={20} r={999} />
            </div>
            <Skeleton w={260} h={30} r={12} />
          </div>
        </div>
      </ClayCard>
      <ClayCard>
        <div className="meta-grid">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} w="100%" h={52} r={14} />
          ))}
        </div>
      </ClayCard>
    </div>
  );
}
