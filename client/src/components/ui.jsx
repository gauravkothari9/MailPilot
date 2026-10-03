import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

// ---------- icons (feather-style paths) ----------
const PATHS = {
  dashboard: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><path d="m22 6-10 7L2 6"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  template: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  click: '<path d="m9 9 5 12 1.8-5.2L21 14z"/><path d="M7.2 2.2 8 5.1M5.1 8l-2.9-.8M14 4.1 12 6M6 12l-1.9 2"/>',
  x: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
  userx: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="m18 8 5 5M23 8l-5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  bot: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M12 8V4M8 14h.01M16 14h.01M9 18h6"/>',
  pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
  play: '<path d="m5 3 14 9-14 9z"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  trash: '<path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>',
  tag: '<path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><path d="M7 7h.01"/>',
  split: '<path d="M16 3h5v5M8 3H3v5M21 3l-7 7M3 3l7 7M12 22V12"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
  menu: '<path d="M3 12h18M3 6h18M3 18h18"/>',
  arrowLeft: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
};

export function Icon({ name, size, className, style }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      width={size} height={size} className={className} style={style} aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: PATHS[name] || '' }} />
  );
}

// ---------- formatting ----------
export const fmtNum = (n) => (n ?? 0).toLocaleString();
export const fmtPct = (n) => `${(n ?? 0).toFixed(1)}%`;
export function fmtDate(d, withTime = true) {
  if (!d) return '—';
  const date = new Date(d);
  return date.toLocaleString(undefined, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
}
export function timeAgo(d) {
  if (!d) return '';
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
  return fmtDate(d, false);
}
export const fullName = (c) => [c?.firstName, c?.lastName].filter(Boolean).join(' ');

// ---------- small components ----------
export const Spinner = () => <span className="spinner" />;
export const Loading = () => <div className="loading"><Spinner /></div>;

export function Badge({ color = '', children, pulse }) {
  return <span className={`badge ${color}`}>{pulse && <span className="pulse" />}{children}</span>;
}

const STATUS = {
  draft: ['', 'Draft'], scheduled: ['blue', 'Scheduled'], testing: ['violet', 'A/B testing'], sending: ['indigo', 'Sending'],
  paused: ['amber', 'Paused'], sent: ['green', 'Sent'], queued: ['', 'Queued'], failed: ['red', 'Failed'], skipped: ['', 'Skipped'],
};
export function StatusBadge({ status }) {
  const [color, label] = STATUS[status] || ['', status];
  return <Badge color={color} pulse={status === 'sending' || status === 'testing'}>{label}</Badge>;
}

export function Kpi({ label, value, sub, dot, icon }) {
  return (
    <div className="card kpi">
      <div className="label">{dot && <span className="dot" style={{ background: dot }} />}{icon && <Icon name={icon} size={14} />}{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function Empty({ title, children, action }) {
  return <div className="empty"><h3>{title}</h3>{children && <div>{children}</div>}{action}</div>;
}

export function Pager({ page, per, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / per));
  if (total <= per) return null;
  return (
    <div className="pager">
      <span>{fmtNum((page - 1) * per + 1)}–{fmtNum(Math.min(total, page * per))} of {fmtNum(total)}</span>
      <div className="row">
        <button className="btn btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <button className="btn btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

export function Field({ label, hint, children, style }) {
  return (
    <label className="field" style={style}>
      {label && <span className="label-text">{label}</span>}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…' }) {
  return (
    <div className="search">
      <Icon name="search" />
      <input type="search" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} className={value === t.value ? 'active' : ''} onClick={() => onChange(t.value)}>
          {t.label}{t.count !== undefined && <span className="count">{fmtNum(t.count)}</span>}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="modal-head"><h2>{title}</h2><button className="x" onClick={onClose} aria-label="Close">×</button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Promise-based confirm dialog: const [confirm, dialog] = useConfirm(); await confirm({...}) */
export function useConfirm() {
  const [state, setState] = useState(null);
  const confirm = useCallback((opts) => new Promise((resolve) => setState({ ...opts, resolve })), []);
  const close = (v) => { state?.resolve(v); setState(null); };
  const dialog = state && (
    <Modal title={state.title || 'Are you sure?'} onClose={() => close(false)}
      footer={<>
        <button className="btn" onClick={() => close(false)}>Cancel</button>
        <button className={`btn ${state.danger ? 'btn-danger-solid' : 'btn-primary'}`} onClick={() => close(true)}>{state.confirmLabel || 'Confirm'}</button>
      </>}>
      <div style={{ color: 'var(--text-2)' }}>{state.message}</div>
    </Modal>
  );
  return [confirm, dialog];
}

export function Progress({ value, color }) {
  return <div className="progress"><span style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: color }} /></div>;
}

export function ScorePill({ score }) {
  if (score === null || score === undefined) return <span className="muted small">—</span>;
  const color = score >= 60 ? 'green' : score >= 25 ? 'amber' : '';
  return <Badge color={color}>{score}</Badge>;
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** Re-runs fn every `ms` while `active` is true. */
export function usePoll(fn, ms, active) {
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  }, [fn, ms, active]);
}

export const EVENT_META = {
  sent: { icon: 'send', label: 'Delivered to server' },
  open: { icon: 'eye', label: 'Opened' },
  click: { icon: 'click', label: 'Clicked' },
  unsubscribe: { icon: 'userx', label: 'Unsubscribed' },
  failed: { icon: 'x', label: 'Failed' },
};
