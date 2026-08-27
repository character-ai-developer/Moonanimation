import {
  AlertTriangle,
  ExternalLink,
  Grid3x3,
  Hash,
  LayoutGrid,
  Loader2,
  Lock,
  RefreshCw,
  Rows3,
  Search,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AssetDetails, CollectibleItem, InventorySummary, UserProfile } from '../../shared/types';
import { usePrefs } from '../App';
import { api, ApiError } from '../lib/api';
import { copyText, exportFile, formatNumber, openCatalog } from '../lib/utils';
import {
  ClayButton,
  ClayCard,
  ClayInput,
  ClaySelect,
  CountUp,
  EmptyState,
  IconButton,
  Modal,
  Segmented,
  SkeletonCards,
  useToast,
} from './clay';

type ViewMode = 'grid' | 'compact' | 'table';
type ItemFilter = 'all' | 'limited' | 'limitedu' | 'collectible';
type ItemSort = 'rap_desc' | 'rap_asc' | 'name_asc' | 'name_desc' | 'asset' | 'newest' | 'oldest';

interface Props {
  user: UserProfile;
  /** Compact embedding inside a drawer tab. */
  embedded?: boolean;
}

const FILTERS: { value: ItemFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'limited', label: 'Limited' },
  { value: 'limitedu', label: 'Limited U' },
  { value: 'collectible', label: 'Collectible' },
];

const SORTS: { value: ItemSort; label: string }[] = [
  { value: 'rap_desc', label: 'RAP high → low' },
  { value: 'rap_asc', label: 'RAP low → high' },
  { value: 'name_asc', label: 'Name A → Z' },
  { value: 'name_desc', label: 'Name Z → A' },
  { value: 'asset', label: 'Asset ID' },
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
];

export default function Inventory({ user, embedded = false }: Props) {
  const { prefs, set } = usePrefs();
  const { toast } = useToast();
  const view: ViewMode = prefs.inventoryView;

  const [items, setItems] = useState<CollectibleItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'loadingMore' | 'done' | 'error'>('idle');
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filter, setFilter] = useState<ItemFilter>('all');
  const [sort, setSort] = useState<ItemSort>('rap_desc');
  const [selected, setSelected] = useState<CollectibleItem | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const controller = useRef<AbortController | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  /** Caps the progressive-enrichment polling so it cannot loop forever. */
  const enrichAttempts = useRef(0);

  /** Running totals across every page fetched, not just the last one. */
  const running = useRef({ total: 0, count: 0, withRap: 0 });

  /* ---- debounced search ---- */
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim().toLowerCase()), 220);
    return () => clearTimeout(t);
  }, [query]);

  const loadPage = useCallback(
    async (pageCursor: string | null, reset: boolean) => {
      controller.current?.abort();
      const ac = new AbortController();
      controller.current = ac;

      setStatus(reset ? 'loading' : 'loadingMore');
      if (reset) {
        setError(null);
        running.current = { total: 0, count: 0, withRap: 0 };
      }

      try {
        const page = await api.inventory.page(user.id, pageCursor, prefs.inventoryLimit, ac.signal);
        if (ac.signal.aborted) return;

        const r = running.current;
        for (const it of page.items) {
          if (typeof it.rap === 'number') {
            r.total += it.rap;
            r.withRap++;
          }
        }
        r.count += page.items.length;

        setItems((prev) => (reset ? page.items : [...prev, ...page.items]));
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);
        setStatus('done');

        // Only trust the summary while the inventory is readable.
        setSummary((prev) =>
          page.summary.status === 'ok'
            ? {
                ...page.summary,
                itemCount: r.count,
                totalRap: r.total,
                averageRap: r.withRap ? Math.round(r.total / r.withRap) : null,
                limitedCount: (reset ? 0 : (prev?.limitedCount ?? 0)) + page.items.filter((i) => i.isLimited === true).length,
                limitedUniqueCount:
                  (reset ? 0 : (prev?.limitedUniqueCount ?? 0)) + page.items.filter((i) => i.isLimitedUnique === true).length,
              }
            : page.summary,
        );
      } catch (err) {
        if (ac.signal.aborted) return;
        const msg = err instanceof ApiError ? err.message : 'Unable to retrieve inventory data';
        setError(msg);
        setStatus('error');
      }
    },
    [user.id, prefs.inventoryLimit],
  );

  // Reset whenever the inspected user changes.
  useEffect(() => {
    setItems([]);
    setSummary(null);
    setQuery('');
    setDebounced('');
    setFilter('all');
    enrichAttempts.current = 0;
    void loadPage(null, true);
    return () => controller.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id, retryKey]);

  /* ---- infinite scroll ---- */
  useEffect(() => {
    if (!hasMore || status === 'loadingMore' || status === 'loading') return;
    const el = sentinel.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && cursor) void loadPage(cursor, false);
      },
      { rootMargin: '500px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, status, cursor, loadPage]);

  /* ---- progressive enrichment ----
     The page paints from the inventory listing plus cached metadata; missing
     asset details stream in from the enrich endpoint while the server warms
     them in the background, so tags/creator/resale fields fill in without
     ever blocking the first paint. */
  useEffect(() => {
    if (status === 'error') return;
    const degradedIds = [...new Set(items.filter((i) => i.detailsDegraded && i.assetId > 0).map((i) => i.assetId))];
    if (!degradedIds.length || enrichAttempts.current >= 25) return;

    const ac = new AbortController();
    const t = setTimeout(() => {
      enrichAttempts.current += 1;
      api.inventory
        .enrich(degradedIds.slice(0, 200), ac.signal)
        .then((r) => {
          const map = r.details ?? {};
          if (!Object.keys(map).length) return;
          setItems((prev) => prev.map((it) => (map[it.assetId] ? applyDetails(it, map[it.assetId]) : it)));
        })
        .catch(() => {
          /* next tick retries; cards keep showing Partial meanwhile */
        });
    }, 2000);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [items, status]);

  /* ---- filter + sort (client side, over what has been loaded) ---- */
  const visible = useMemo(() => {
    let out = items;
    if (debounced) out = out.filter((i) => i.name.toLowerCase().includes(debounced) || String(i.assetId).includes(debounced));
    if (filter === 'limited') out = out.filter((i) => i.isLimited === true);
    else if (filter === 'limitedu') out = out.filter((i) => i.isLimitedUnique === true);
    else if (filter === 'collectible') out = out.filter((i) => i.isLimited === true || i.isLimitedUnique === true);

    const sorted = [...out];
    switch (sort) {
      case 'rap_desc':
        sorted.sort((a, b) => (b.rap ?? -1) - (a.rap ?? -1));
        break;
      case 'rap_asc':
        sorted.sort((a, b) => (a.rap ?? Number.MAX_SAFE_INTEGER) - (b.rap ?? Number.MAX_SAFE_INTEGER));
        break;
      case 'name_asc':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'name_desc':
        sorted.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case 'asset':
        sorted.sort((a, b) => a.assetId - b.assetId);
        break;
      case 'newest':
        sorted.sort((a, b) => (b.created ?? '').localeCompare(a.created ?? ''));
        break;
      case 'oldest':
        sorted.sort((a, b) => (a.created ?? '').localeCompare(b.created ?? ''));
        break;
    }
    return sorted;
  }, [items, debounced, filter, sort]);

  /* Limited counts are recomputed from the loaded items so progressive
     enrichment updates them live instead of waiting for the next page. */
  const liveSummary = useMemo(() => {
    if (!summary || summary.status !== 'ok') return summary;
    return {
      ...summary,
      limitedCount: items.filter((i) => i.isLimited === true).length,
      limitedUniqueCount: items.filter((i) => i.isLimitedUnique === true).length,
    };
  }, [summary, items]);

  const unreadable = liveSummary !== null && liveSummary.status !== 'ok';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ---- header ---- */}
      <ClayCard>
        <div className="row row--wrap row--between" style={{ gap: 14, marginBottom: 14 }}>
          <div className="row" style={{ gap: 12 }}>
            <div className="avatar-hero" style={{ width: 52, height: 52 }}>
              {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <Hash aria-hidden />}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{user.username}</div>
              <div className="tiny muted">
                {unreadable
                  ? liveSummary?.message || 'Inventory is private or unavailable'
                  : `${formatNumber(liveSummary?.itemCount ?? 0)} items loaded${hasMore ? ' · more available' : ''}`}
              </div>
            </div>
          </div>

          <div className="row row--wrap" style={{ gap: 8 }}>
            <Segmented
              label="View mode"
              value={view}
              onChange={(v) => set('inventoryView', v)}
              options={[
                { value: 'grid', label: 'Grid', icon: LayoutGrid },
                { value: 'compact', label: 'Compact', icon: Grid3x3 },
                { value: 'table', label: 'Table', icon: Rows3 },
              ]}
            />
            <IconButton label="Reload inventory" icon={RefreshCw} onClick={() => setRetryKey((k) => k + 1)} />
            <ClayButton
              size="sm"
              icon={ExternalLink}
              disabled={!visible.length}
              onClick={() =>
                exportFile(
                  'csv',
                  `inventory-${user.username}`,
                  visible.map((i) => ({
                    name: i.name,
                    assetId: i.assetId,
                    rap: i.rap,
                    serial: i.serialNumber,
                    creator: i.creator?.name ?? '',
                    assetType: i.assetTypeName ?? '',
                    isLimited: i.isLimited,
                    isLimitedUnique: i.isLimitedUnique,
                    originalPrice: i.originalPrice,
                    lowestResalePrice: i.lowestResalePrice,
                  })),
                )
              }
            >
              Export
            </ClayButton>
          </div>
        </div>

        {/* ---- statistics: only real returned data ---- */}
        {unreadable ? (
          <PrivateInventory message={liveSummary?.message} status={liveSummary?.status ?? 'unavailable'} />
        ) : (
          <div className="meta-grid">
            <Stat label="Total RAP" value={liveSummary?.totalRap ?? null} animated />
            <Stat label="Total items" value={liveSummary?.itemCount ?? null} />
            <Stat label="Average RAP" value={liveSummary?.averageRap ?? null} />
            <Stat label="Highest RAP" value={liveSummary?.highest?.rap ?? null} caption={liveSummary?.highest?.name} />
            <Stat label="Lowest RAP" value={liveSummary?.lowest?.rap ?? null} caption={liveSummary?.lowest?.name} />
            <Stat label="Limiteds" value={liveSummary?.limitedCount ?? null} />
            <Stat label="Limited U" value={liveSummary?.limitedUniqueCount ?? null} />
          </div>
        )}
      </ClayCard>

      {/* ---- controls ---- */}
      {!unreadable && (
        <ClayCard>
          <div className="row row--wrap" style={{ gap: 10 }}>
            <ClayInput
              icon={Search}
              placeholder="Search item name or asset ID"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="grow"
              aria-label="Search inventory"
            />
            <ClaySelect label="" value={filter} options={FILTERS} onChange={setFilter} className="grow-sm" />
            <ClaySelect label="" value={sort} options={SORTS} onChange={setSort} className="grow" />
          </div>
        </ClayCard>
      )}

      {/* ---- error ---- */}
      {status === 'error' && (
        <ClayCard sunken>
          <div className="row" style={{ gap: 10 }}>
            <AlertTriangle style={{ width: 18, height: 18, color: 'var(--bad)', flex: 'none' }} aria-hidden />
            <div style={{ flex: 1 }}>{error ?? 'Unable to retrieve inventory data'}</div>
            <ClayButton size="sm" icon={RefreshCw} onClick={() => setRetryKey((k) => k + 1)}>
              Retry
            </ClayButton>
          </div>
        </ClayCard>
      )}

      {/* ---- content ---- */}
      {status === 'loading' ? (
        <SkeletonCards count={embedded ? 6 : 12} />
      ) : unreadable ? null : visible.length === 0 && status !== 'loadingMore' ? (
        <ClayCard pad={false}>
          <EmptyState
            title={items.length ? 'No items match your filters' : 'No collectibles found'}
            text={
              items.length
                ? 'Try a different search term, or widen the filter to see everything that has loaded.'
                : 'The API returned no collectible items for this account. This is not the same as a private inventory — the inventory was readable and simply held no limiteds.'
            }
            art={items.length ? 'search' : 'info'}
          />
        </ClayCard>
      ) : view === 'table' ? (
        <InventoryTable items={visible} onOpen={setSelected} />
      ) : (
        <div className={`inv-grid ${view === 'compact' ? 'inv-grid--compact' : ''}`}>
          {visible.map((item) => (
            <ItemCard key={`${item.assetId}-${item.userAssetId ?? ''}`} item={item} compact={view === 'compact'} onOpen={setSelected} />
          ))}
        </div>
      )}

      {/* ---- infinite scroll sentinel ---- */}
      <div ref={sentinel} style={{ height: 1 }} aria-hidden />
      {status === 'loadingMore' && (
        <div className="row" style={{ justifyContent: 'center', padding: 18, gap: 9, color: 'var(--text-3)' }}>
          <Loader2 className="spin" style={{ width: 15, height: 15 }} aria-hidden />
          <span className="tiny">Loading more items…</span>
        </div>
      )}
      {!hasMore && items.length > 0 && !unreadable && (
        <div className="tiny muted" style={{ textAlign: 'center', padding: '10px 0 4px' }}>
          End of inventory — {items.length} item{items.length === 1 ? '' : 's'} loaded
        </div>
      )}

      <ItemModal item={selected} onClose={() => setSelected(null)} onCopy={toast} />
    </div>
  );
}

/* ------------------------------- sub-parts -------------------------------- */

/** Merge streamed-in asset metadata into a loaded inventory item. */
function applyDetails(item: CollectibleItem, d: AssetDetails): CollectibleItem {
  return {
    ...item,
    name: item.name || d.name || '',
    creator: d.creator ?? item.creator,
    assetTypeId: d.assetTypeId ?? item.assetTypeId,
    assetTypeName: d.assetTypeName ?? item.assetTypeName,
    isLimited: d.isLimited ?? item.isLimited,
    isLimitedUnique: d.isLimitedUnique ?? item.isLimitedUnique,
    collectibleItemId: d.collectibleItemId ?? item.collectibleItemId,
    lowestResalePrice: d.lowestResalePrice ?? item.lowestResalePrice,
    totalQuantity: d.totalQuantity ?? item.totalQuantity,
    sales: d.sales ?? item.sales,
    created: d.created ?? item.created,
    originalPrice: item.originalPrice ?? d.priceInRobux ?? null,
    thumbnailUrl: item.thumbnailUrl ?? d.thumbnailUrl,
    detailsDegraded: false,
  };
}

function Stat({
  label,
  value,
  caption,
  animated = false,
}: {
  label: string;
  value: number | null;
  caption?: string | null;
  animated?: boolean;
}) {
  return (
    <div className="meta-cell">
      <span className="meta-cell__k">{label}</span>
      <span className="meta-cell__v" style={{ fontSize: 16 }}>
        {animated ? <CountUp value={value} /> : value === null ? <span className="muted">Unavailable</span> : formatNumber(value)}
      </span>
      {caption && <span className="tiny muted truncate">{caption}</span>}
    </div>
  );
}

function PrivateInventory({ message, status }: { message?: string; status: string }) {
  return (
    <div
      className="row"
      style={{
        gap: 14,
        padding: 18,
        borderRadius: 'var(--r-md)',
        background: 'linear-gradient(148deg, rgba(251,122,149,0.09), rgba(251,122,149,0.03))',
        boxShadow: 'var(--sh-in)',
      }}
    >
      <Lock style={{ width: 26, height: 26, color: 'var(--bad)', flex: 'none' }} aria-hidden />
      <div>
        <div style={{ fontWeight: 700, marginBottom: 3 }}>
          {status === 'private' ? 'Inventory Private / Unavailable' : 'Inventory could not be read'}
        </div>
        <div className="tiny muted" style={{ maxWidth: 620, lineHeight: 1.6 }}>
          {message || 'The Roblox API could not return this inventory.'} Totals are deliberately not shown as zero —
          an unreadable inventory is not an empty one, and guessing a value would be wrong.
        </div>
      </div>
    </div>
  );
}

function ItemThumb({ item, size = 150 }: { item: CollectibleItem; size?: number }) {
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  if (item.thumbnailUrl && !failed) {
    return (
      <img
        src={item.thumbnailUrl}
        alt=""
        loading="lazy"
        decoding="async"
        width={size}
        height={size}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        color: 'var(--text-3)',
        padding: 8,
      }}
    >
      <TriangleAlert style={{ width: 20, height: 20 }} aria-hidden />
      <span className="tiny">Unavailable</span>
      <button
        type="button"
        className="btn btn--sm btn--ghost"
        onClick={(e) => {
          e.stopPropagation();
          setFailed(false);
          setRetry((r) => r + 1);
        }}
      >
        <RefreshCw aria-hidden />
        Retry {retry > 0 ? `(${retry})` : ''}
      </button>
    </div>
  );
}

function ItemCard({ item, compact, onOpen }: { item: CollectibleItem; compact: boolean; onOpen: (i: CollectibleItem) => void }) {
  return (
    <button type="button" className={`inv-card ${compact ? 'inv-card--compact' : ''}`} onClick={() => onOpen(item)}>
      <div className="inv-card__thumb">
        <ItemThumb item={item} />
        <div className="inv-card__tags">
          {item.isLimitedUnique === true && <span className="pill pill--info">LU</span>}
          {item.isLimited === true && item.isLimitedUnique !== true && <span className="pill pill--accent">LTD</span>}
          {item.detailsDegraded && <span className="pill pill--warn">Partial</span>}
        </div>
        {item.serialNumber && <span className="inv-card__serial">#{item.serialNumber}</span>}
      </div>
      <div className="inv-card__body">
        <span className="inv-card__name">{item.name || 'Unnamed item'}</span>
        <div className="inv-card__meta">
          <span className="inv-card__rap">{item.rap === null ? '—' : formatNumber(item.rap)}</span>
          <span className="tiny muted mono">{item.assetId}</span>
        </div>
      </div>
    </button>
  );
}

function InventoryTable({ items, onOpen }: { items: CollectibleItem[]; onOpen: (i: CollectibleItem) => void }) {
  return (
    <div className="table-wrap">
      <div className="table-scroll">
        <table className="clay-table">
          <thead>
            <tr>
              <th style={{ width: 52 }}></th>
              <th>Name</th>
              <th>Asset ID</th>
              <th>RAP</th>
              <th>Serial</th>
              <th>Creator</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={`${item.assetId}-${item.userAssetId ?? ''}`} onClick={() => onOpen(item)}>
                <td>
                  <div style={{ width: 34, height: 34, borderRadius: 9, overflow: 'hidden', background: '#10131d' }}>
                    <ItemThumb item={item} size={34} />
                  </div>
                </td>
                <td style={{ fontWeight: 600, maxWidth: 260 }}>
                  <span className="truncate" style={{ display: 'block' }}>
                    {item.name || 'Unnamed item'}
                  </span>
                </td>
                <td className="num">{item.assetId}</td>
                <td className="num" style={{ color: 'var(--accent-soft)', fontWeight: 700 }}>
                  {item.rap === null ? '—' : formatNumber(item.rap)}
                </td>
                <td className="num">{item.serialNumber ?? <span className="muted">—</span>}</td>
                <td>{item.creator?.name ?? <span className="muted">Unavailable</span>}</td>
                <td>{item.assetTypeName ?? <span className="muted">Unavailable</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ItemModal({
  item,
  onClose,
  onCopy,
}: {
  item: CollectibleItem | null;
  onClose: () => void;
  onCopy: (msg: string, tone?: 'ok' | 'bad' | 'info') => void;
}) {
  const [details, setDetails] = useState<CollectibleItem | null>(null);
  const [loading, setLoading] = useState(false);

  // Pull the high-resolution asset record when the modal opens.
  useEffect(() => {
    if (!item) return;
    setDetails(item);
    setLoading(true);
    const ac = new AbortController();
    api
      .asset(item.assetId, ac.signal)
      .then((r) => {
        setDetails((prev) =>
          prev
            ? {
                ...prev,
                name: r.asset.name ?? prev.name,
                creator: r.asset.creator ?? prev.creator,
                assetTypeName: r.asset.assetTypeName ?? prev.assetTypeName,
                isLimited: r.asset.isLimited ?? prev.isLimited,
                isLimitedUnique: r.asset.isLimitedUnique ?? prev.isLimitedUnique,
                collectibleItemId: r.asset.collectibleItemId ?? prev.collectibleItemId,
                lowestResalePrice: r.asset.lowestResalePrice ?? prev.lowestResalePrice,
                totalQuantity: r.asset.totalQuantity ?? prev.totalQuantity,
                sales: r.asset.sales ?? prev.sales,
                created: r.asset.created ?? prev.created,
                thumbnailUrl: r.asset.thumbnailUrl ?? prev.thumbnailUrl,
                detailsDegraded: false,
              }
            : prev,
        );
      })
      .catch(() => {
        /* the card already holds inventory-derived data; leave it partial */
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [item]);

  if (!item || !details) return null;

  const rows: { k: string; v: React.ReactNode; mono?: boolean }[] = [
    { k: 'Asset ID', v: details.assetId, mono: true },
    { k: 'Collectible ID', v: details.collectibleItemId ?? 'Unavailable', mono: true },
    { k: 'Recent average price', v: details.rap === null ? 'Unavailable' : formatNumber(details.rap), mono: true },
    { k: 'Serial number', v: details.serialNumber ?? 'Unavailable', mono: true },
    { k: 'Original price', v: details.originalPrice === null ? 'Unavailable' : formatNumber(details.originalPrice), mono: true },
    { k: 'Lowest resale price', v: details.lowestResalePrice === null ? 'Unavailable' : formatNumber(details.lowestResalePrice), mono: true },
    { k: 'Total quantity', v: details.totalQuantity === null ? 'Unavailable' : formatNumber(details.totalQuantity), mono: true },
    { k: 'Sales', v: details.sales === null ? 'Unavailable' : formatNumber(details.sales), mono: true },
    { k: 'Creator', v: details.creator?.name ?? 'Unavailable' },
    { k: 'Creator ID', v: details.creator?.id ?? 'Unavailable', mono: true },
    { k: 'Asset type', v: details.assetTypeName ?? 'Unavailable' },
    { k: 'Limited', v: details.isLimited === null ? 'Unavailable' : details.isLimited ? 'Yes' : 'No' },
    { k: 'Limited U', v: details.isLimitedUnique === null ? 'Unavailable' : details.isLimitedUnique ? 'Yes' : 'No' },
    { k: 'Acquired', v: details.created ? new Date(details.created).toISOString().slice(0, 10) : 'Unavailable', mono: true },
  ];

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={details.name || 'Unnamed item'}
      footer={
        <>
          <ClayButton
            size="sm"
            icon={Hash}
            onClick={async () => {
              const ok = await copyText(String(details.assetId));
              onCopy(ok ? 'Asset ID copied' : 'Copy failed', ok ? 'ok' : 'bad');
            }}
          >
            Copy asset ID
          </ClayButton>
          <ClayButton size="sm" icon={ExternalLink} onClick={() => openCatalog(details.assetId)}>
            Open on Roblox
          </ClayButton>
          <div className="spacer" />
          <ClayButton size="sm" onClick={onClose}>
            Close
          </ClayButton>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <div
          className="clay-card clay-card--sunken"
          style={{ width: 190, height: 190, flex: 'none', display: 'grid', placeItems: 'center', padding: 0, overflow: 'hidden' }}
        >
          <ItemThumb item={details} size={190} />
        </div>
        <div style={{ flex: 1, minWidth: 240, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="row row--wrap" style={{ gap: 6 }}>
            {details.isLimitedUnique === true && <span className="pill pill--info">Limited U</span>}
            {details.isLimited === true && details.isLimitedUnique !== true && <span className="pill pill--accent">Limited</span>}
            {details.detailsDegraded && (
              <span className="pill pill--warn" title="Asset metadata could not be retrieved; some fields show Unavailable">
                Partial data
              </span>
            )}
            {loading && (
              <span className="pill pill--no">
                <Loader2 className="spin" aria-hidden />
                Loading
              </span>
            )}
          </div>
          <div className="meta-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
            {rows.map((r) => (
              <div className="meta-cell" key={r.k}>
                <span className="meta-cell__k">{r.k}</span>
                <span className={`meta-cell__v ${r.mono ? 'mono' : ''}`} style={{ fontSize: 13 }}>
                  {r.v}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
