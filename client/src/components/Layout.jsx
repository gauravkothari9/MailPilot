import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useApp } from '../context';
import { api } from '../api';
import { Icon } from './ui';

const NAV = [
  ['/', 'dashboard', 'Dashboard'],
  ['/campaigns', 'send', 'Campaigns'],
  ['/contacts', 'users', 'Contacts'],
  ['/lists', 'list', 'Lists'],
  ['/templates', 'template', 'Templates'],
  ['/senders', 'mail', 'Sender emails'],
  ['/activity', 'activity', 'Live activity'],
];

export default function Layout() {
  const { businesses, businessId, setBusinessId, auth, refreshAuth } = useApp();
  const [open, setOpen] = useState(false);
  const current = businesses.find((b) => b._id === businessId);

  const logout = async () => {
    await api.post('/auth/logout');
    refreshAuth();
  };

  return (
    <div className={`shell ${open ? 'nav-open' : ''}`}>
      <div className="mobile-top">
        <button onClick={() => setOpen(true)} aria-label="Open menu"><Icon name="menu" size={22} /></button>
        MailPilot
      </div>
      <aside className="sidebar" onClick={(e) => e.target.closest('a') && setOpen(false)}>
        <div className="brand">
          <span className="brand-logo"><Icon name="mail" size={17} /></span>
          MailPilot
        </div>
        {businesses.length > 0 && (
          <div className="biz-switch">
            <label htmlFor="biz">Business</label>
            <div className="biz-select">
              <span className="dot" style={{ background: current?.color || '#4f46e5' }} />
              <select id="biz" value={businessId || ''} onChange={(e) => setBusinessId(e.target.value)}>
                {businesses.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
              </select>
            </div>
          </div>
        )}
        <nav className="nav">
          {NAV.map(([to, icon, label]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon name={icon} />{label}
            </NavLink>
          ))}
          <div className="nav-sep">Workspace</div>
          <NavLink to="/businesses"><Icon name="briefcase" />Businesses</NavLink>
          <NavLink to="/settings"><Icon name="settings" />Settings</NavLink>
        </nav>
        <div className="sidebar-foot">
          <span>{auth.user?.username}</span>
          <button onClick={logout}>Log out</button>
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <main className="main"><Outlet /></main>
    </div>
  );
}
