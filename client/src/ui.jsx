import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';
import { initials, STATUS } from './util.js';

const ICONS = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  cal: 'M7 2v3M17 2v3M3 8h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  leave: 'M12 3a9 9 0 1 0 9 9M12 7v5l3 2M17 3l4 4-4 4',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  check: 'M20 6L9 17l-5-5',
  chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  out: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  pin: 'M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  laptop: 'M4 5h16v11H4zM2 20h20',
  tablet: 'M6 2h12a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM11 18h2',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  mega: 'M3 11v2a1 1 0 0 0 1 1h3l7 4V6L7 10H4a1 1 0 0 0-1 1zM18 8a5 5 0 0 1 0 8',
  flame: 'M12 22c4 0 7-3 7-7 0-3-2-5-3-7-1 2-2 3-3 3 0-4-2-7-4-9 0 4-4 6-4 12 0 4 3 8 7 8z',
};
ICONS.grid = 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z';
ICONS.user = 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z';
export const LOGO = `${import.meta.env.BASE_URL}logo.png`;
export const Icon =({ n, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[n]} /></svg>
);

export const Avatar = ({ name }) => <span className="avatar">{initials(name)}</span>;
export const Badge = ({ color, children }) => <span className="badge" style={{ '--c': color }}>{children}</span>;
export const StatusBadge = ({ s }) => (STATUS[s]?.[0] ? <Badge color={STATUS[s][1]}>{STATUS[s][0]}</Badge> : null);
export const Spinner = () => <div className="empty">Loading…</div>;

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { width: 'min(760px,100%)' } : null} role="dialog" aria-modal="true" aria-label={title}>
        <div className="card-h"><h2>{title}</h2><button className="btn sm ghost right" onClick={onClose} aria-label="Close">✕</button></div>
        {children}
      </div>
    </div>
  );
}

// ---- toasts ----
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((t) => {
    const id = Math.random();
    const item = typeof t === 'string' ? { title: t } : t;
    setItems((x) => [...x, { id, ...item }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), item.ms || 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((i) => <div key={i.id} className={'toast ' + (i.bad ? 'bad' : '')}><b>{i.title}</b>{i.body}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

// image behind auth header (HR photo viewing)
export function AuthImg({ path, alt, style }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let url, dead = false;
    api(path, { raw: true }).then(async (r) => { if (r.ok && !dead) { url = URL.createObjectURL(await r.blob()); setSrc(url); } });
    return () => { dead = true; url && URL.revokeObjectURL(url); };
  }, [path]);
  return src ? <img src={src} alt={alt} style={{ borderRadius: 12, maxWidth: '100%', ...style }} /> : <span className="muted small">No photo</span>;
}

// Loads data and reloads it when `deps` change or when something is saved anywhere in the app (refreshAll).
export function useAsync(fn, deps) {
  const [state, set] = useState({ data: null, error: null, loading: true });
  const gt = useTick();
  const reload = useCallback(() => {
    fn().then((data) => set({ data, error: null, loading: false })).catch((error) => set((s) => ({ ...s, error, loading: false })));
  }, [...deps, gt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { set((s) => ({ ...s, loading: true })); reload(); }, [reload]);
  return { ...state, reload };
}

ICONS.edit = 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z';
ICONS.plus = 'M12 5v14M5 12h14';
ICONS.x = 'M18 6L6 18M6 6l12 12';
ICONS.more = 'M4 6h16M4 12h16M4 18h16';
ICONS.clock = 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2';
ICONS.umbrella = 'M12 2a10 10 0 0 0-10 10h20A10 10 0 0 0 12 2zM12 12v7a2 2 0 0 0 4 0';

export function Sheet({ title, onClose, children, closeBtn }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="sheet-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="grab" />
        {title && <h3>{title}</h3>}
        {children}
        {closeBtn && <button className="sheet-x" onClick={onClose} aria-label="Close"><Icon n="x" size={22} /></button>}
      </div>
    </div>
  );
}

ICONS.userCheck = 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17 11l2 2 4-4';
ICONS.calCheck = 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 16l2 2 4-4';
ICONS.file = 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h6';
ICONS.chevDown = 'M6 9l6 6 6-6';
ICONS.login = 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3';

// underline tabs: items = [[key, label, count?], ...]
export function Tabs({ items, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {items.map(([k, label, n]) => (
        <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>
          {label}{n > 0 && <span className="n">{n}</span>}
        </button>
      ))}
    </div>
  );
}
// pill switcher: items = [[key, label], ...]
export function Pills({ items, value, onChange }) {
  return <div className="pills" role="tablist">{items.map(([k, label]) => <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{label}</button>)}</div>;
}

// After a request / time log is saved anywhere, screens that show data refresh themselves.
export const refreshAll = () => window.dispatchEvent(new Event('att-refresh'));
export function useTick() {
  const [t, setT] = useState(0);
  useEffect(() => {
    const f = () => setT((x) => x + 1);
    window.addEventListener('att-refresh', f);
    return () => window.removeEventListener('att-refresh', f);
  }, []);
  return t;
}

ICONS.search = 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35';
ICONS.list = 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01';

ICONS.gift = 'M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z';
ICONS.rss = 'M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16M5 19h.01';
