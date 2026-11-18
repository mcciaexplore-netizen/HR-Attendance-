import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Badge, Icon, Modal, Spinner, Tabs, useAsync, useToast } from '../ui.jsx';
import { getPosition } from '../util.js';

const DOWS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];

function General() {
  const toast = useToast();
  const [f, setF] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/settings').then(setF); }, []);
  if (!f) return <Spinner />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault(); setErr('');
    try { setF(await api('/settings', { method: 'PUT', body: f })); toast('Settings saved'); } catch (x) { setErr(x.message); }
  };
  const here = async () => {
    try { const p = await getPosition(); setF({ ...f, office_lat: p.lat.toFixed(6), office_lng: p.lng.toFixed(6) }); toast(`Location captured (±${Math.round(p.accuracy)} m). Press Save.`); }
    catch (x) { toast({ title: x.message, bad: true }); }
  };
  return (
    <form className="stack" onSubmit={save}>
      <section className="card stack">
        <div className="card-h" style={{ margin: 0 }}><Icon n="pin" /><h2>Office location (geofence)</h2></div>
        <div className="alert">Stand inside the S.B. Road office and press <b>Use my current location</b> for an accurate centre point. Phones must be within the radius to check in.</div>
        <div className="field"><label>Office name</label><input value={f.office_name} onChange={set('office_name')} /></div>
        <div className="grid g3">
          <div className="field"><label>Latitude</label><input value={f.office_lat} onChange={set('office_lat')} inputMode="decimal" /></div>
          <div className="field"><label>Longitude</label><input value={f.office_lng} onChange={set('office_lng')} inputMode="decimal" /></div>
          <div className="field"><label>Radius (metres)</label><input value={f.radius_m} onChange={set('radius_m')} inputMode="numeric" /></div>
        </div>
        <div className="row wrap"><button type="button" className="btn" onClick={here}><Icon n="pin" size={16} /> Use my current location</button>
          <a className="btn ghost" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${f.office_lat}&mlon=${f.office_lng}#map=18/${f.office_lat}/${f.office_lng}`}>Verify on map ↗</a></div>
        <div className="field"><label>Only allow office check-in from these networks (optional)</label>
          <input value={f.allowed_ips} onChange={set('allowed_ips')} placeholder="e.g. 203.0.113.10, 198.51.100." />
          <span className="small muted">Public IP addresses of the MCCIA office internet connection, comma separated. End with a dot to allow a whole range. Leave empty to rely on location only.</span></div>
      </section>

      <section className="card stack">
        <div className="card-h" style={{ margin: 0 }}><Icon n="bell" /><h2>Reminders</h2></div>
        <p className="muted small" style={{ margin: 0 }}>Times in 24h HH:MM, comma-separated. Skipped on holidays, weekly offs and approved leave (per person's shift).</p>
        <div className="grid g2">
          <div className="field"><label>Check-in reminders</label><input value={f.remind_in} onChange={set('remind_in')} /></div>
          <div className="field"><label>Check-out reminders</label><input value={f.remind_out} onChange={set('remind_out')} /></div>
          <div className="field"><label>HR "who's missing" digest</label><input type="time" value={f.hr_digest} onChange={set('hr_digest')} /></div>
          <div className="field"><label>Pending approvals reminder (HR & managers)</label><input type="time" value={f.remind_approvals} onChange={set('remind_approvals')} /></div>
          <div className="field"><label>Birthday & anniversary notice</label><input type="time" value={f.remind_birthdays || ''} onChange={set('remind_birthdays')} /><span className="small muted">Empty switches it off.</span></div>
        </div>
      </section>

      <section className="card stack">
        <div className="card-h" style={{ margin: 0 }}><Icon n="clock" /><h2>Comp-off & late-in rules</h2></div>
        <div className="grid g3">
          <div className="field"><label>Comp-off valid for (days)</label><input value={f.compoff_expiry_days} onChange={set('compoff_expiry_days')} inputMode="numeric" /><span className="small muted">counted from the day worked</span></div>
          <div className="field"><label>Can request within (days)</label><input value={f.compoff_window_days} onChange={set('compoff_window_days')} inputMode="numeric" /><span className="small muted">after the day worked</span></div>
          <div className="field"><label>Late marks = half-day</label><input value={f.late_marks_per_halfday} onChange={set('late_marks_per_halfday')} inputMode="numeric" /><span className="small muted">0 = off. Shown in the monthly report.</span></div>
        </div>
      </section>
      {err && <div className="err" role="alert">{err}</div>}
      <div><button className="btn primary">Save settings</button></div>
    </form>
  );
}

function ShiftForm({ shift, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(shift?.id ? { ...shift } : { name: '', start: '10:00', end: '18:00', grace: 30, fullHours: 7, halfHours: 4, weekOff: [0, 6] });
  const [err, setErr] = useState('');
  const toggle = (d) => setF({ ...f, weekOff: f.weekOff.includes(d) ? f.weekOff.filter((x) => x !== d) : [...f.weekOff, d] });
  const save = async (e) => {
    e.preventDefault();
    try { await api(shift?.id ? `/shifts/${shift.id}` : '/shifts', { method: shift?.id ? 'PUT' : 'POST', body: f }); toast('Shift saved'); onSaved(); }
    catch (x) { setErr(x.message); }
  };
  return (
    <Modal title={shift?.id ? `Edit ${shift.name}` : 'Add shift'} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <div className="field"><label>Shift name</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus /></div>
        <div className="grid g3">
          <div className="field"><label>Starts</label><input type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} required /></div>
          <div className="field"><label>Ends</label><input type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} required /></div>
          <div className="field"><label>Grace (min)</label><input type="number" min="0" max="180" value={f.grace} onChange={(e) => setF({ ...f, grace: e.target.value })} /></div>
        </div>
        <div className="grid g2">
          <div className="field"><label>Full day (hours)</label><input type="number" step="0.5" value={f.fullHours} onChange={(e) => setF({ ...f, fullHours: e.target.value })} /></div>
          <div className="field"><label>Half day below (hours)</label><input type="number" step="0.5" value={f.halfHours} onChange={(e) => setF({ ...f, halfHours: e.target.value })} /></div>
        </div>
        <div className="field"><label>Weekly off</label>
          <div className="chips">{DOWS.map(([d, l]) => <button type="button" key={d} className={'chip ' + (f.weekOff.includes(d) ? 'on' : '')} onClick={() => toggle(d)}>{l}</button>)}</div></div>
        <p className="small muted" style={{ margin: 0 }}>Check-in after start + grace is a late mark. Working fewer hours than "half day below" counts as a half day. Excess and deficit hours are measured against the full day.</p>
        {err && <div className="err">{err}</div>}
        <button className="btn primary">Save shift</button>
      </form>
    </Modal>
  );
}

function Shifts() {
  const toast = useToast();
  const shifts = useAsync(() => api('/shifts'), []);
  const users = useAsync(() => api('/users'), []);
  const [edit, setEdit] = useState(null);
  if (!shifts.data || !users.data) return <Spinner />;
  const call = (p, o, msg) => api(p, o).then(() => { toast(msg); shifts.reload(); users.reload(); }).catch((x) => toast({ title: x.message, bad: true }));
  const count = (s) => users.data.filter((u) => u.role !== 'hr' && u.active && (u.shift_id === s.id || (!u.shift_id && s.isDefault))).length;
  return (
    <>
      <div className="row"><p className="muted" style={{ margin: 0 }}>A shift sets working hours, grace time and weekly offs. Assign shifts to people on the People page.</p><button className="btn primary right" onClick={() => setEdit({})}><Icon n="plus" size={16} /> Add shift</button></div>
      <section className="card flush scroll-x">
        <table className="table">
          <thead><tr><th>Shift</th><th>Timing</th><th>Grace</th><th>Full / half day</th><th>Weekly off</th><th>People</th><th /></tr></thead>
          <tbody>{shifts.data.map((s) => (
            <tr key={s.id}>
              <td><b style={{ fontWeight: 600 }}>{s.name}</b> {s.isDefault && <Badge color="var(--brand)">Default</Badge>}</td>
              <td className="nowrap">{s.start} – {s.end}</td><td>{s.grace} min</td><td className="nowrap">{s.fullHours}h / {s.halfHours}h</td>
              <td className="small">{DOWS.filter(([d]) => s.weekOff.includes(d)).map(([, l]) => l).join(', ') || 'None'}</td><td>{count(s)}</td>
              <td className="nowrap">
                <button className="btn sm" onClick={() => setEdit(s)}>Edit</button>{' '}
                {!s.isDefault && <><button className="btn sm ghost" onClick={() => call(`/shifts/${s.id}/default`, { method: 'POST' }, 'Default shift changed')}>Make default</button>{' '}
                  <button className="btn sm ghost danger" onClick={() => window.confirm(`Delete "${s.name}"? People on it move to the default shift.`) && call(`/shifts/${s.id}`, { method: 'DELETE' }, 'Shift deleted')}>Delete</button></>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </section>
      {edit && <ShiftForm shift={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); shifts.reload(); users.reload(); }} />}
    </>
  );
}

function TypeForm({ type, onClose, onSaved }) {
  const toast = useToast();
  const isNew = !type.id;
  const system = !!(type.is_wfh || type.is_compoff);
  const [f, setF] = useState(isNew
    ? { code: '', name: '', quota: 6, color: '#38a3f5', accrual: 'yearly', carry_forward: 0, max_consecutive: '', min_notice_days: 0, backdate_days: 30, doc_after_days: '', applies_to: 'all', paid: true, allow_half: true, count_weekends: false, is_optional: false, active: true }
    : { ...type, quota: type.quota ?? '', max_consecutive: type.max_consecutive ?? '', backdate_days: type.backdate_days ?? '', doc_after_days: type.doc_after_days ?? '' });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async (e) => {
    e.preventDefault();
    try { await api(isNew ? '/leave-types' : `/leave-types/${type.id}`, { method: isNew ? 'POST' : 'PUT', body: f }); toast('Leave type saved'); onSaved(); }
    catch (x) { setErr(x.message); }
  };
  return (
    <Modal title={isNew ? 'Add leave type' : `Edit ${type.name}`} wide onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <div className="grid g3">
          <div className="field"><label>Name</label><input value={f.name} onChange={set('name')} required autoFocus /></div>
          <div className="field"><label>Code</label><input value={f.code} onChange={set('code')} disabled={!isNew} placeholder="EL" required /></div>
          <div className="field"><label>Colour</label><input type="color" value={f.color || '#38a3f5'} onChange={set('color')} style={{ padding: 4, height: 44 }} /></div>
        </div>
        {!system && (<>
          <div className="grid g3">
            <div className="field"><label>Yearly quota (days)</label><input value={f.quota} onChange={set('quota')} inputMode="decimal" placeholder="blank = no limit" /></div>
            <div className="field"><label>Accrual</label><select value={f.accrual} onChange={set('accrual')}><option value="yearly">Full quota from January</option><option value="monthly">Earned month by month</option></select></div>
            <div className="field"><label>Carry forward (max days)</label><input value={f.carry_forward} onChange={set('carry_forward')} inputMode="decimal" /></div>
          </div>
        </>)}
        <div className="grid g3">
          <div className="field"><label>Max consecutive days</label><input value={f.max_consecutive} onChange={set('max_consecutive')} inputMode="decimal" placeholder="blank = no limit" /></div>
          <div className="field"><label>Notice needed (days)</label><input value={f.min_notice_days} onChange={set('min_notice_days')} inputMode="numeric" /></div>
          <div className="field"><label>Can apply for past dates up to (days)</label><input value={f.backdate_days} onChange={set('backdate_days')} inputMode="numeric" placeholder="blank = any" /></div>
        </div>
        <div className="grid g2">
          <div className="field"><label>Document required if more than (days)</label><input value={f.doc_after_days} onChange={set('doc_after_days')} inputMode="decimal" placeholder="blank = never (e.g. 2 for sick leave)" /></div>
          <div className="field"><label>Available to</label><select value={f.applies_to} onChange={set('applies_to')}><option value="all">Everyone</option><option value="intern">Interns only</option><option value="consultant">Consultants only</option></select></div>
        </div>
        <div className="row wrap" style={{ gap: 22 }}>
          <label className="row small"><input type="checkbox" checked={!!f.allow_half} onChange={set('allow_half')} /> Half days allowed</label>
          {!system && <label className="row small"><input type="checkbox" checked={!!f.paid} onChange={set('paid')} /> Paid</label>}
          {!system && <label className="row small"><input type="checkbox" checked={!!f.count_weekends} onChange={set('count_weekends')} /> Count weekends & holidays in between</label>}
          <label className="row small"><input type="checkbox" checked={f.active !== false && f.active !== 0} onChange={set('active')} /> Active</label>
        </div>
        {err && <div className="err">{err}</div>}
        <button className="btn primary">Save leave type</button>
      </form>
    </Modal>
  );
}

function LeaveTypes() {
  const types = useAsync(() => api('/leave-types?all=1'), []);
  const [edit, setEdit] = useState(null);
  if (!types.data) return <Spinner />;
  const yn = (v) => (v ? '✓' : '—');
  return (
    <>
      <div className="row"><p className="muted" style={{ margin: 0 }}>Policies decide what people can apply for: balances, notice, limits, documents and who it is available to.</p><button className="btn primary right" onClick={() => setEdit({})}><Icon n="plus" size={16} /> Add leave type</button></div>
      <section className="card flush scroll-x">
        <table className="table">
          <thead><tr><th>Leave type</th><th>Quota</th><th>Carry fwd</th><th>Max days</th><th>Notice</th><th>Past dates</th><th>Document</th><th>Half day</th><th>For</th><th /></tr></thead>
          <tbody>{types.data.map((t) => (
            <tr key={t.id} style={{ opacity: t.active ? 1 : .5 }}>
              <td className="nowrap"><i className="dot" style={{ '--c': t.color, marginRight: 8 }} /><b style={{ fontWeight: 600 }}>{t.name}</b> <span className="muted small">{t.code}</span>{t.is_wfh && <> <Badge color="var(--info)">WFH</Badge></>}{t.is_compoff && <> <Badge color="var(--green)">Comp-off</Badge></>}{t.is_optional && <> <Badge color="var(--crimson)">Optional holiday</Badge></>}{!t.active && <> <Badge>Inactive</Badge></>}</td>
              <td>{t.is_wfh || t.is_compoff ? '—' : t.quota == null ? 'No limit' : `${t.quota}${t.accrual === 'monthly' ? ' (monthly)' : ''}`}</td>
              <td>{t.carry_forward || '—'}</td><td>{t.max_consecutive ?? '—'}</td><td>{t.min_notice_days ? `${t.min_notice_days}d` : '—'}</td>
              <td>{t.backdate_days == null ? 'Any' : t.backdate_days === 0 ? 'No' : `${t.backdate_days}d`}</td><td>{t.doc_after_days != null ? `> ${t.doc_after_days}d` : '—'}</td>
              <td>{yn(t.allow_half)}</td><td style={{ textTransform: 'capitalize' }}>{t.applies_to}</td>
              <td><button className="btn sm" onClick={() => setEdit(t)}>Edit</button></td>
            </tr>
          ))}</tbody>
        </table>
      </section>
      {edit && <TypeForm type={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); types.reload(); }} />}
    </>
  );
}

export default function Settings() {
  const [tab, setTab] = useState('general');
  return (
    <>
      
      <Tabs value={tab} onChange={setTab} items={[['general', 'General'], ['shifts', 'Shifts'], ['types', 'Leave types']]} />
      {tab === 'general' && <General />}{tab === 'shifts' && <Shifts />}{tab === 'types' && <LeaveTypes />}
    </>
  );
}
