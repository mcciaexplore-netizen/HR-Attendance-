import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ActionCtx, AuthCtx, useAuth } from './auth.js';
import { api, getToken, setToken } from './api.js';
import { Icon, LOGO, Sheet, Spinner, refreshAll, useTick, useToast } from './ui.jsx';
import { PinModal, RequestModal, TimeLogModal } from './components.jsx';
import { useNotifications } from './notify.js';
import { fmtTime, roleLabel } from './util.js';
import Login from './pages/Login.jsx';
import Home from './pages/Home.jsx';
import Attendance from './pages/Attendance.jsx';
import Leave from './pages/Leave.jsx';
import TimeTracker from './pages/TimeTracker.jsx';
import Team from './pages/Team.jsx';
import Profile from './pages/Profile.jsx';
import Dashboard from './pages/Dashboard.jsx';
import People from './pages/People.jsx';
import Approvals from './pages/Approvals.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';
import Feeds from './pages/Feeds.jsx';

const NAV_EMP = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/leave', label: 'Leave Tracker', icon: 'umbrella' },
  { to: '/attendance', label: 'Attendance', icon: 'calCheck' },
  { to: '/time', label: 'Time Tracker', icon: 'clock' },
  { to: '/team', label: 'Team', icon: 'users' },
];
const APPROVALS = { to: '/approvals', label: 'Approvals', icon: 'check', badge: true };
const FEEDS = { to: '/feeds', label: 'Feeds', icon: 'rss' };
// MCCIA managers who only approve (no attendance or leave of their own here)
const NAV_APPROVER = [APPROVALS, { to: '/attendance', label: 'Attendance', icon: 'calCheck' }, { to: '/team', label: 'Team', icon: 'users' }, FEEDS];
const NAV_HR = [
  { to: '/', label: 'Today', icon: 'home', end: true },
  APPROVALS,
  FEEDS,
  { to: '/people', label: 'People', icon: 'users' },
  { to: '/attendance', label: 'Attendance', icon: 'calCheck' },
  { to: '/leave', label: 'Leave Tracker', icon: 'umbrella' },
  { to: '/time', label: 'Time Tracker', icon: 'clock' },
  { to: '/reports', label: 'Reports', icon: 'chart' },
  { to: '/settings', label: 'Settings', icon: 'gear' },
];
const TITLES = {
  '/leave': 'Leave Tracker', '/attendance': 'Attendance', '/time': 'Time Tracker', '/team': 'Team', '/profile': 'My Profile',
  '/feeds': 'Feeds', '/approvals': 'Approvals', '/people': 'People', '/reports': 'Reports', '/settings': 'Settings',
};

// What the + button offers (same set as Zoho People's Add sheet)
const ADD = [
  { kind: 'leave', label: 'Leave', icon: 'umbrella', c: '#7c5ce6' },
  { kind: 'wfh', label: 'Work from home', icon: 'home', c: '#ee8a2b' },
  { kind: 'fix', label: 'Regularize', icon: 'edit', c: '#12a35e' },
  { kind: 'time', label: 'Time log', icon: 'clock', c: '#1f7fe0' },
  { kind: 'comp', label: 'Comp-off', icon: 'sun', c: '#0f9d8a' },
  { kind: 'leave', typeCode: 'OH', label: 'Optional holiday', icon: 'flag', c: '#e0003c' },
];

function Layout({ children }) {
  const { user, logout } = useAuth();
  const toast = useToast();
  const loc = useLocation();
  const go = useNavigate();
  const gt = useTick();
  const hr = user.role === 'hr';
  const apv = user.role === 'approver';
  const approver = hr || user.is_manager;
  const nav = hr ? NAV_HR : apv ? NAV_APPROVER : approver ? [...NAV_EMP, APPROVALS] : NAV_EMP;
  const notes = useNotifications(user, toast);
  const [open, setOpen] = useState(null);   // 'bell' | 'user'
  const [sheet, setSheet] = useState(null); // 'add' | 'more'
  const [modal, setModal] = useState(null); // { kind, date, typeCode }
  const [pin, setPin] = useState(false);
  const [pending, setPending] = useState(0);

  const actions = useMemo(() => ({
    open: (kind, o = {}) => { setSheet(null); setModal({ kind, ...o }); },
    openAdd: () => setSheet('add'),
  }), []);

  useEffect(() => { setOpen(null); setSheet(null); }, [loc.pathname, loc.search]);
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (!e.target.closest('.menu, .iconbtn, .avbtn')) setOpen(null); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  useEffect(() => {
    if (!approver) return;
    const load = () => api('/approvals/count').then((d) => setPending(d.count)).catch(() => {});
    load();
    const h = setInterval(load, 30_000);
    return () => clearInterval(h);
  }, [approver, loc.pathname, gt]);

  const canAsk = 'Notification' in window && Notification.permission === 'default';
  const isHome = loc.pathname === '/';
  const title = isHome ? (hr ? 'Today' : 'Home') : TITLES[loc.pathname] || 'Attendance';
  const wide = ['/people', '/reports', '/settings'].includes(loc.pathname) || (hr && ['/attendance', '/leave', '/time'].includes(loc.pathname));

  const more = hr
    ? [['/attendance', 'Attendance', 'calCheck'], ['/leave', 'Leave Tracker', 'umbrella'], ['/time', 'Time Tracker', 'clock'], ['/feeds', 'Feeds', 'rss'], ['/settings', 'Settings', 'gear']]
    : apv ? []
      : [['/attendance', 'Attendance', 'calCheck'], ['/team', 'Team', 'users'], ['/feeds', 'Feeds', 'rss'], ['/leave?view=holidays', 'Holidays', 'flag'], ...(approver ? [['/approvals', 'Approvals', 'check', pending]] : [])];

  return (
    <ActionCtx.Provider value={actions}>
      <div className="app">
        <aside className="side">
          <img className="logo" src={LOGO} alt="MCCIA" />
          {!hr && !apv && <button className="add" onClick={() => setSheet('add')}><Icon n="plus" size={18} /> Add</button>}
          <nav aria-label="Main">
            {nav.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.end}><Icon n={t.icon} size={19} />{t.label}{t.badge && pending > 0 && <span className="count">{pending}</span>}</NavLink>
            ))}
          </nav>
        </aside>

        <div className="main">
          <header className={'top' + (isHome ? ' home' : '')}>
            <div className="relative acct">
              <button className="avbtn" aria-label="Account menu" onClick={() => setOpen(open === 'user' ? null : 'user')}>{user.name[0]}</button>
              {open === 'user' && (
                <div className="menu sm acct-menu">
                  <div className="item"><b>{user.name}</b><div className="small muted">{user.emp_code} · {roleLabel(user.role)}</div></div>
                  <button className="item" onClick={() => go('/profile')}>My profile</button>
                  <button className="item" onClick={() => { setOpen(null); setPin(true); }}>Change PIN</button>
                  <button className="item" onClick={logout}>Sign out</button>
                </div>
              )}
            </div>
            <img className="logo" src={LOGO} alt="MCCIA" />
            <h1>{title}</h1>
            <div className="relative bell">
              <button className="iconbtn" aria-label="Notifications" onClick={() => setOpen(open === 'bell' ? null : 'bell')}>
                <Icon n="bell" size={21} />{notes.unread > 0 && <span className="dotc">{notes.unread > 9 ? '9+' : notes.unread}</span>}
              </button>
              {open === 'bell' && (
                <div className="menu">
                  <div className="row item" style={{ background: 'var(--soft)' }}>
                    <b>Notifications</b>
                    {notes.unread > 0 && <button className="btn sm ghost right" onClick={notes.markRead}>Mark all read</button>}
                  </div>
                  {canAsk && <div className="item"><div className="small muted">Get pop-up reminders for check-in / check-out on this device.</div><button className="btn sm primary" style={{ marginTop: 6 }} onClick={notes.enable}>Turn on reminders</button></div>}
                  <div style={{ maxHeight: 360, overflow: 'auto' }}>
                    {notes.items.length === 0 && <div className="empty">You're all caught up.</div>}
                    {notes.items.map((n) => (
                      <div key={n.id} className={'item ' + (n.read ? '' : 'unread')}>
                        <b>{n.title}</b>
                        {n.body && <div className="small muted">{n.body}</div>}
                        <div className="small muted">{fmtTime(n.created_at.replace(' ', 'T') + 'Z')}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </header>

          <main className={'page' + (wide ? ' wide' : '')}>{children}</main>
        </div>

        <nav className="bottom" aria-label="Main">
          {hr ? (<>
            <NavLink to="/" end><Icon n="home" size={22} />Today</NavLink>
            <NavLink to="/approvals"><Icon n="check" size={22} />Approvals</NavLink>
            <NavLink to="/people"><Icon n="users" size={22} />People</NavLink>
            <NavLink to="/reports"><Icon n="chart" size={22} />Reports</NavLink>
          </>) : apv ? (<>
            <NavLink to="/approvals"><Icon n="check" size={22} />Approvals</NavLink>
            <NavLink to="/attendance"><Icon n="calCheck" size={22} />Attendance</NavLink>
            <NavLink to="/team"><Icon n="users" size={22} />Team</NavLink>
            <NavLink to="/feeds"><Icon n="rss" size={22} />Feeds</NavLink>
          </>) : (<>
            <NavLink to="/" end><Icon n="home" size={22} />Home</NavLink>
            <NavLink to="/leave"><Icon n="umbrella" size={22} />Leave</NavLink>
            <button className="fab-btn" onClick={() => setSheet('add')}><span className="fab"><Icon n="plus" size={24} /></span>Add</button>
            <NavLink to="/time"><Icon n="clock" size={22} />Time</NavLink>
          </>)}
          <button onClick={() => setSheet('more')}><Icon n="more" size={22} />More</button>
        </nav>
      </div>

      {sheet === 'add' && (
        <Sheet title="Add" onClose={() => setSheet(null)} closeBtn>
          <div className="add-grid">
            {ADD.map((a) => (
              <button key={a.label} style={{ '--c': a.c }} onClick={() => actions.open(a.kind, { typeCode: a.typeCode })}>
                <span className="ic"><Icon n={a.icon} size={24} /></span>{a.label}
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {sheet === 'more' && (
        <Sheet title="More" onClose={() => setSheet(null)} closeBtn>
          <div className="more-list">
            {more.map(([to, label, icon, count]) => (
              <button key={to} onClick={() => go(to)}><Icon n={icon} size={21} />{label}{count > 0 && <span className="count">{count}</span>}</button>
            ))}
            <button onClick={() => go('/profile')}><Icon n="user" size={21} />My profile</button>
            <button onClick={() => { setSheet(null); setPin(true); }}><Icon n="gear" size={21} />Change PIN</button>
            <button onClick={logout}><Icon n="out" size={21} />Sign out</button>
          </div>
        </Sheet>
      )}

      {modal?.kind === 'time' && <TimeLogModal date={modal.date} onClose={() => setModal(null)} onDone={() => { setModal(null); refreshAll(); }} />}
      {modal && modal.kind !== 'time' && <RequestModal kind={modal.kind} date={modal.date} typeCode={modal.typeCode} onClose={() => setModal(null)} onDone={() => { setModal(null); refreshAll(); }} />}
      {pin && <PinModal onClose={() => setPin(false)} />}
    </ActionCtx.Provider>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined);
  const logout = useCallback(() => { setToken(null); setUser(null); }, []);

  useEffect(() => {
    if (!getToken()) { setUser(null); return; }
    api('/me').then((d) => setUser(d.user)).catch(() => setUser(null));
  }, []);
  useEffect(() => { window.addEventListener('att-logout', logout); return () => window.removeEventListener('att-logout', logout); }, [logout]);

  if (user === undefined) return <Spinner />;
  if (!user) return <Login onLogin={(t, u) => { setToken(t); setUser(u); }} />;

  const hr = user.role === 'hr';
  const apv = user.role === 'approver';
  const approver = hr || user.is_manager;
  return (
    <AuthCtx.Provider value={{ user, logout, setUser }}>
      <Layout>
        <Routes>
          <Route path="/" element={hr ? <Dashboard /> : apv ? <Navigate to="/approvals" replace /> : <Home />} />
          <Route path="/attendance" element={<Attendance />} />
          {!apv && <Route path="/leave" element={<Leave />} />}
          {!apv && <Route path="/holidays" element={<Navigate to="/leave?view=holidays" replace />} />}
          {!apv && <Route path="/time" element={<TimeTracker />} />}
          <Route path="/team" element={<Team />} />
          <Route path="/feeds" element={<Feeds />} />
          <Route path="/profile" element={<Profile />} />
          {approver && <Route path="/approvals" element={<Approvals />} />}
          {hr && (
            <>
              <Route path="/people" element={<People />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/settings" element={<Settings />} />
            </>
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </AuthCtx.Provider>
  );
}
