import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.js';
import { PinModal } from '../components.jsx';
import { Modal, refreshAll, useAsync, useToast } from '../ui.jsx';
import { fmtDate, roleLabel } from '../util.js';

const to12 = (hhmm = '') => { const [h, m] = hhmm.split(':').map(Number); return Number.isNaN(h) ? '' : `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

// Everyone can set their own birthday and phone (HR manages the rest)
function ProfileEdit({ onClose }) {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ dob: user.dob || '', phone: user.phone || '' });
  const [err, setErr] = useState('');
  const save = async (e) => {
    e.preventDefault();
    try { const r = await api('/me/profile', { method: 'PUT', body: f }); setUser(r.user); toast('Profile updated'); refreshAll(); onClose(); } catch (x) { setErr(x.message); }
  };
  return (
    <Modal title="Edit my details" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <div className="field"><label>Date of birth</label><input type="date" max={new Date().toISOString().slice(0, 10)} value={f.dob} onChange={(e) => setF({ ...f, dob: e.target.value })} />
          <span className="small muted">Colleagues see only the day and month, never your age.</span></div>
        <div className="field"><label>Phone</label><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
        {err && <div className="err" role="alert">{err}</div>}
        <button className="btn primary">Save</button>
      </form>
    </Modal>
  );
}

// Employee details, shown on the Home "Profile" tab and on the profile page
export function ProfileDetails() {
  const { user, logout } = useAuth();
  const [pin, setPin] = useState(false);
  const [editing, setEditing] = useState(false);
  const d = useAsync(() => api('/today'), []).data;
  const hr = user.role === 'hr';
  const untracked = hr || user.role === 'approver';
  const rows = [
    ['Employee code', user.emp_code],
    ...(user.designation ? [['Designation', user.designation]] : []),
    ['Department', user.department || '—'],
    ['Email', user.email || '—'],
    ['Phone', user.phone || '—'],
    ['Birthday', user.dob ? fmtDate(user.dob, { day: 'numeric', month: 'long' }) : 'Not added yet'],
    ['Joined', fmtDate(user.start_date)],
    ...(user.end_date ? [['Engagement ends', fmtDate(user.end_date)]] : []),
    ...(!hr ? [['Reports to', user.manager || 'HR (no manager assigned)']] : []),
    ...(d && !untracked ? [['Shift', `${d.shift.name} · ${to12(d.shift.start)} – ${to12(d.shift.end)}`], ['Grace time', `${d.shift.grace} minutes`]] : []),
    ...(d ? [['Office', d.office.name]] : []),
  ];
  return (
    <section className="card">
      <div className="prof-top">
        <span className="big-av">{user.name[0]}</span>
        <div><h1 style={{ fontSize: 20 }}>{user.name}</h1><div className="muted" style={{ textTransform: 'capitalize' }}>{roleLabel(user.role)}{user.is_manager ? ' · team manager' : ''}</div></div>
      </div>
      {rows.map(([k, v]) => <div key={k} className="kv"><span>{k}</span><span style={{ textAlign: 'right', fontWeight: 500 }}>{v}</span></div>)}
      <div className="row wrap" style={{ marginTop: 18 }}>
        <button className="btn primary" onClick={() => setEditing(true)}>Edit details</button>
        <button className="btn" onClick={() => setPin(true)}>Change PIN</button>
        <button className="btn danger" onClick={logout}>Sign out</button>
      </div>
      {pin && <PinModal onClose={() => setPin(false)} />}
      {editing && <ProfileEdit onClose={() => setEditing(false)} />}
    </section>
  );
}

export default function Profile() {
  return <ProfileDetails />;
}
