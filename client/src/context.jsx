import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

const BIZ_KEY = 'mp_business';
const readBiz = () => { try { return localStorage.getItem(BIZ_KEY); } catch { return null; } };

export function AppProvider({ children }) {
  const [auth, setAuth] = useState({ loading: true, user: null, needsSetup: false });
  const [businesses, setBusinesses] = useState([]);
  const [bizLoaded, setBizLoaded] = useState(false);
  const [businessId, setBusinessIdState] = useState(readBiz());
  const [toasts, setToasts] = useState([]);
  const toastId = useRef(0);

  const toast = useCallback((message, type = 'info') => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'error' ? 6000 : 3500);
  }, []);

  const setBusinessId = useCallback((id) => {
    setBusinessIdState(id);
    try { localStorage.setItem(BIZ_KEY, id); } catch { /* storage unavailable */ }
  }, []);

  const refreshAuth = useCallback(async () => {
    const s = await api.get('/auth/status');
    setAuth({ loading: false, user: s.user, needsSetup: s.needsSetup });
  }, []);

  const refreshBusinesses = useCallback(async () => {
    const list = await api.get('/businesses');
    setBusinesses(list);
    setBizLoaded(true);
    setBusinessIdState((cur) => (list.some((b) => b._id === cur) ? cur : list[0]?._id || null));
    return list;
  }, []);

  useEffect(() => { refreshAuth().catch(() => setAuth({ loading: false, user: null, needsSetup: false })); }, [refreshAuth]);
  useEffect(() => { if (auth.user) refreshBusinesses().catch((e) => toast(e.message, 'error')); }, [auth.user, refreshBusinesses, toast]);
  useEffect(() => {
    const onLogout = () => setAuth((a) => ({ ...a, user: null }));
    window.addEventListener('mp:logout', onLogout);
    return () => window.removeEventListener('mp:logout', onLogout);
  }, []);

  const business = businesses.find((b) => b._id === businessId) || null;

  const value = useMemo(() => ({
    auth, refreshAuth, businesses, bizLoaded, business, businessId: business?._id || null, setBusinessId, refreshBusinesses, toast,
  }), [auth, refreshAuth, businesses, bizLoaded, business, setBusinessId, refreshBusinesses, toast]);

  return (
    <AppContext.Provider value={value}>
      {children}
      <div id="toasts">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.type}`}>{t.message}</div>)}
      </div>
    </AppContext.Provider>
  );
}
