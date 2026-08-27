import {
  Activity,
  Bookmark,
  Compass,
  LayoutDashboard,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings as SettingsIcon,
  Sparkles,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useApiStatus, usePrefs } from '../App';
import { IconButton, ClayButton } from './clay';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, desc: 'Overview of the workspace and connection health' },
  { to: '/finder', label: 'Account Finder', icon: Compass, desc: 'Discover accounts by username pattern, year and value' },
  { to: '/lookup', label: 'User Lookup', icon: Search, desc: 'Inspect a single account, its badges and collectibles' },
  { to: '/saved', label: 'Saved', icon: Bookmark, desc: 'Categories, notes and persistent account records' },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, desc: 'API configuration, performance, appearance and data' },
] as const;

const HEALTH_LABEL = {
  connected: 'Connected',
  degraded: 'Degraded',
  ratelimited: 'Rate Limited',
  offline: 'Offline',
} as const;

export default function AppShell({ children }: { children: ReactNode }) {
  const { prefs, set } = usePrefs();
  const { status, loading } = useApiStatus();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  const current = NAV.find((n) => location.pathname.startsWith(n.to)) ?? NAV[0];
  const collapsed = prefs.sidebarCollapsed;
  const health = status?.health ?? (loading ? 'connected' : 'offline');

  const sidebar = (
    <nav
      className="sidebar"
      data-collapsed={String(collapsed)}
      data-open={String(drawerOpen)}
      aria-label="Primary"
    >
      <div className="brand">
        <div className="brand__mark" aria-hidden>
          <Moon strokeWidth={2.4} />
        </div>
        <div className="brand__text">
          <span className="brand__name">Vesper</span>
          <span className="brand__sub">Account Intelligence</span>
        </div>
      </div>

      <div className="nav">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className="nav__item"
            title={collapsed ? item.label : undefined}
          >
            <item.icon aria-hidden />
            <span className="nav__label">{item.label}</span>
          </NavLink>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8 }}>
        <button
          type="button"
          className="nav__item"
          onClick={() => set('sidebarCollapsed', !collapsed)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
          <span className="nav__label">Collapse</span>
        </button>
      </div>
    </nav>
  );

  return (
    <div className="app">
      {/* Desktop rail */}
      <div className="sidebar-desktop" style={{ display: 'contents' }}>
        <div className="desktop-only">{sidebar}</div>
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <>
          <div className="scrim" onClick={() => setDrawerOpen(false)} aria-hidden />
          <div className="mobile-only">{sidebar}</div>
        </>
      )}

      <div className="main">
        <header className="topbar">
          <IconButton
            label="Open navigation"
            icon={Menu}
            className="mobile-only"
            onClick={() => setDrawerOpen(true)}
          />
          <div className="topbar__titles">
            <div className="topbar__title">
              <current.icon style={{ width: 18, height: 18, color: 'var(--accent-soft)' }} aria-hidden />
              {current.label}
            </div>
            <div className="topbar__desc">{current.desc}</div>
          </div>

          <div className="topbar__actions">
            <div
              className="status"
              data-health={health}
              role="status"
              aria-label={`API status: ${HEALTH_LABEL[health as keyof typeof HEALTH_LABEL] ?? 'Unknown'}`}
              title={
                status
                  ? `${status.endpoints.filter((e) => e.ok).length}/${status.endpoints.length} endpoints reachable` +
                    (status.latencyMs !== null ? ` · ${status.latencyMs}ms avg` : '') +
                    (status.openCloudConfigured ? ' · Open Cloud key configured' : ' · legacy endpoints')
                  : 'Checking connection'
              }
            >
              <span className="status__dot" aria-hidden />
              <span className="desktop-only-text">{HEALTH_LABEL[health as keyof typeof HEALTH_LABEL] ?? 'Unknown'}</span>
            </div>

            <ClayButton
              size="sm"
              icon={prefs.motion === 'reduced' ? Activity : Sparkles}
              onClick={() => set('motion', prefs.motion === 'reduced' ? 'full' : 'reduced')}
              title={prefs.motion === 'reduced' ? 'Enable animation' : 'Reduce animation'}
              aria-label={prefs.motion === 'reduced' ? 'Enable animation' : 'Reduce animation'}
            >
              <span className="desktop-only-text">{prefs.motion === 'reduced' ? 'Motion off' : 'Motion on'}</span>
            </ClayButton>

            <IconButton
              label="Settings"
              icon={SettingsIcon}
              onClick={() => {
                window.location.hash = '#/settings';
              }}
            />
          </div>
        </header>

        <main className="page">
          <div className="page__inner">{children}</div>
        </main>
      </div>
    </div>
  );
}
