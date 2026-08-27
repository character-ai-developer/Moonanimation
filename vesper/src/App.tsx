import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { ApiStatus, SavedStore } from '../shared/types';
import AppShell from './components/AppShell';
import { ToastProvider } from './components/clay';
import { api } from './lib/api';
import { applyPrefs, DEFAULT_PREFS, loadPrefs, savePrefs, type Prefs } from './lib/utils';
import Dashboard from './pages/Dashboard';
import Finder from './pages/Finder';
import Lookup from './pages/Lookup';
import Saved from './pages/Saved';
import Settings from './pages/Settings';

/* ------------------------------ preferences ------------------------------- */

interface PrefsCtx {
  prefs: Prefs;
  set: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
  reset: () => void;
}
const PrefsContext = createContext<PrefsCtx>({ prefs: DEFAULT_PREFS, set: () => {}, reset: () => {} });
export const usePrefs = () => useContext(PrefsContext);

/* --------------------------------- status --------------------------------- */

interface StatusCtx {
  status: ApiStatus | null;
  loading: boolean;
  refresh: () => void;
}
const StatusContext = createContext<StatusCtx>({ status: null, loading: true, refresh: () => {} });
export const useApiStatus = () => useContext(StatusContext);

/* ------------------------------ saved store ------------------------------- */

interface SavedCtx {
  store: SavedStore | null;
  index: Record<string, string[]>;
  loading: boolean;
  refresh: () => void;
}
const SavedContext = createContext<SavedCtx>({ store: null, index: {}, loading: true, refresh: () => {} });
export const useSaved = () => useContext(SavedContext);

export default function App() {
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());

  useEffect(() => {
    applyPrefs(prefs);
    savePrefs(prefs);
  }, [prefs]);

  // Honour the OS reduced-motion preference until the user overrides it.
  const motionInitialised = useRef(false);
  useEffect(() => {
    if (motionInitialised.current) return;
    motionInitialised.current = true;
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (mq?.matches) setPrefs((p) => ({ ...p, motion: 'reduced' }));
  }, []);

  const setPref = useCallback(<K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    setPrefs((p) => ({ ...p, [key]: value }));
  }, []);

  const resetPrefs = useCallback(() => setPrefs({ ...DEFAULT_PREFS }), []);
  const prefsValue = useMemo(() => ({ prefs, set: setPref, reset: resetPrefs }), [prefs, setPref, resetPrefs]);

  /* ---- API status polling ---- */
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  const refreshStatus = useCallback(() => {
    api
      .status()
      .then((r) => setStatus(r.status))
      .catch(() => setStatus(null))
      .finally(() => setStatusLoading(false));
  }, []);

  useEffect(() => {
    refreshStatus();
    const t = setInterval(refreshStatus, 45000);
    return () => clearInterval(t);
  }, [refreshStatus]);

  const statusValue = useMemo(
    () => ({ status, loading: statusLoading, refresh: refreshStatus }),
    [status, statusLoading, refreshStatus],
  );

  /* ---- saved store ---- */
  const [store, setStore] = useState<SavedStore | null>(null);
  const [index, setIndex] = useState<Record<string, string[]>>({});
  const [savedLoading, setSavedLoading] = useState(true);

  const refreshSaved = useCallback(() => {
    api
      .saved
      .all()
      .then((r) => {
        setStore(r.store);
        setIndex(r.index ?? {});
      })
      .catch(() => setStore({ categories: {} }))
      .finally(() => setSavedLoading(false));
  }, []);

  useEffect(() => {
    refreshSaved();
  }, [refreshSaved]);

  const savedValue = useMemo(
    () => ({ store, index, loading: savedLoading, refresh: refreshSaved }),
    [store, index, savedLoading, refreshSaved],
  );

  return (
    <ToastProvider>
      <PrefsContext.Provider value={prefsValue}>
        <StatusContext.Provider value={statusValue}>
          <SavedContext.Provider value={savedValue}>
            <HashRouter>
              <AppShell>
                <Routes>
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/finder" element={<Finder />} />
                  <Route path="/lookup" element={<Lookup />} />
                  <Route path="/saved" element={<Saved />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="*" element={<Navigate to="/dashboard" replace />} />
                </Routes>
              </AppShell>
            </HashRouter>
          </SavedContext.Provider>
        </StatusContext.Provider>
      </PrefsContext.Provider>
    </ToastProvider>
  );
}
