import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Avatar, Badge, Modal, Spinner, Tabs, useAsync, useToast } from '../ui.jsx';
import OrgChart from './OrgChart.jsx';
import { fmtDate, roleLabel, todayIst } from '../util.js';

function PersonForm({ person, people, shifts, onClose, onSaved }) {
  const toast = useToast();
  const isNew = !person.id;
  const [f, setF] = useState({ emp_code: '', pin: '', name: '', email: '', phone: '', role: 'intern', department: '', designation: '', dob: '', start_date: todayIst(), end_date: '', checkin_method: 'phone', shift_id: '', manager_id: '', active: 1, ...person });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? +e.target.checked : e.target.value });
  const save = async (e) => {
    e.preventDefault();
    try {
      await api(isNew ? '/users' : '/users/' + person.id, { method: isNew ? 'POST' : 'PUT', body: { ...f, end_date: f.end_date || null, shift_id: f.shift_id || null, manager_id: f.manager_id || null } });
      toast(isNew ? 'Person added' : 'Saved'); onSaved();
    } catch (x) { setErr(x.message); }
  };
  const resetPin = async () => {
    const pin = window.prompt('New PIN for ' + person.name + ' (4–6 digits)');
    if (pin) api(`/users/${person.id}/pin`, { method: 'POST', body: { pin } }).then(() => toast('PIN reset')).catch((x) => toast({ title: x.message, bad: true }));
  };
  return (
    <Modal title={isNew ? 'Add person' : `Edit ${person.name}`} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <div className="grid g2">
          <div className="field"><label>Full name</label><input value={f.name} onChange={set('name')} required autoFocus /></div>
          <div className="field"><label>Employee code</label><input value={f.emp_code} onChange={set('emp_code')} disabled={!isNew} placeholder="INT1010" required /></div>
          <div className="field"><label>Role</label><select value={f.role} onChange={set('role')}><option value="intern">Intern</option><option value="consultant">Consultant</option><option value="approver">Approver (MCCIA manager)</option><option value="hr">HR</option></select></div>
          <div className="field"><label>Department</label><input value={f.department || ''} onChange={set('department')} /></div>
          <div className="field"><label>Email</label><input type="email" value={f.email || ''} onChange={set('email')} /></div>
          <div className="field"><label>Phone</label><input value={f.phone || ''} onChange={set('phone')} /></div>
          <div className="field"><label>Designation</label><input value={f.designation || ''} onChange={set('designation')} placeholder="e.g. Senior Consultant" /></div>
          <div className="field"><label>Date of birth</label><input type="date" max={todayIst()} value={f.dob || ''} onChange={set('dob')} /></div>
          <div className="field"><label>Start date</label><input type="date" value={f.start_date} onChange={set('start_date')} required /></div>
          <div className="field"><label>End date (optional)</label><input type="date" value={f.end_date || ''} onChange={set('end_date')} /></div>
          {!['approver', 'hr'].includes(f.role) && <div className="field"><label>Shift</label>
            <select value={f.shift_id || ''} onChange={set('shift_id')}><option value="">Default shift</option>{shifts.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.start}–{s.end})</option>)}</select></div>}
          <div className="field"><label>Reporting manager</label>
            <select value={f.manager_id || ''} onChange={set('manager_id')}><option value="">None: HR approves directly</option>
              {people.filter((p) => p.id !== person.id && p.active && p.role !== 'hr').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        </div>
        {isNew && <div className="field"><label>Starting PIN (4–6 digits)</label><input value={f.pin} onChange={set('pin')} inputMode="numeric" required /></div>}
        {!isNew && <label className="row"><input type="checkbox" checked={!!f.active} onChange={set('active')} /> Active (untick when the engagement ends)</label>}
        <p className="small muted" style={{ margin: 0 }}>The reporting manager approves this person's leave, WFH, comp-off, corrections and timesheets. Interns and consultants usually report to a consultant manager; a consultant manager reports to an MCCIA manager with an Approver account (they do not need an attendance or leave account here). HR can always approve too.</p>
        {err && <div className="err">{err}</div>}
        <div className="row"><button className="btn primary">Save</button>{!isNew && <button type="button" className="btn" onClick={resetPin}>Reset PIN</button>}</div>
      </form>
    </Modal>
  );
}

export default function People() {
  const nav = useNavigate();
  const { data, reload } = useAsync(() => api('/users'), []);
  const shifts = useAsync(() => api('/shifts'), []);
  const [edit, setEdit] = useState(null);
  const [view, setView] = useState('list');
  if (!data || !shifts.data) return <Spinner />;
  return (
    <>
      <div className="row"><span className="muted">{data.length} {data.length === 1 ? 'person' : 'people'}</span><button className="btn primary right" onClick={() => setEdit({})}>+ Add person</button></div>
      <Tabs items={[['list', 'People'], ['org', 'Org chart']]} value={view} onChange={setView} />
      {view === 'org' ? <OrgChart /> : <section className="card flush scroll-x">
        <table className="table">
          <thead><tr><th>Person</th><th>Role</th><th>Engagement</th><th>Shift</th><th>Reports to</th><th>Status</th><th /></tr></thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.id} style={{ opacity: p.active ? 1 : .55 }}>
                <td><div className="row"><Avatar name={p.name} /><div><b style={{ fontWeight: 600 }}>{p.name}</b><div className="small muted">{p.designation ? `${p.designation} · ` : ''}{p.emp_code} · {p.department || '—'}</div></div></div></td>
                <td style={{ textTransform: 'capitalize' }}>{roleLabel(p.role)}</td>
                <td className="small">{fmtDate(p.start_date)}{p.end_date && ` → ${fmtDate(p.end_date)}`}</td>
                <td className="small">{p.shift_name || <span className="muted">Default</span>}</td>
                <td className="small">{p.manager_name || <span className="muted">HR</span>}</td>
                <td>{p.active ? <Badge color="var(--ok)">Active</Badge> : <Badge>Inactive</Badge>}</td>
                <td className="nowrap"><button className="btn sm" onClick={() => setEdit(p)}>Edit</button>{p.role !== 'hr' && <> <button className="btn sm ghost" onClick={() => nav(`/leave?view=balances&user=${p.id}`)}>Balances</button></>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>}
      {edit && <PersonForm person={edit} people={data} shifts={shifts.data} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}
