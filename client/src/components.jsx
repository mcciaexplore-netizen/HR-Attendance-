import { useState } from 'react';
import { api } from './api.js';
import { useAuth } from './auth.js';
import { Icon, Modal, Spinner, useAsync, useToast } from './ui.jsx';
import { fmtDate, fmtDur, parseDuration, todayIst } from './util.js';

export function PinModal({ onClose }) {
  const toast = useToast();
  const [f, setF] = useState({ old_pin: '', new_pin: '' });
  const [err, setErr] = useState('');
  const save = async (e) => {
    e.preventDefault();
    try { await api('/me/pin', { method: 'POST', body: f }); toast('PIN updated'); onClose(); } catch (x) { setErr(x.message); }
  };
  return (
    <Modal title="Change PIN" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <div className="field"><label>Current PIN</label><input type="password" inputMode="numeric" value={f.old_pin} onChange={(e) => setF({ ...f, old_pin: e.target.value })} autoFocus /></div>
        <div className="field"><label>New PIN (4–6 digits)</label><input type="password" inputMode="numeric" value={f.new_pin} onChange={(e) => setF({ ...f, new_pin: e.target.value })} /></div>
        {err && <div className="err">{err}</div>}
        <button className="btn primary">Save PIN</button>
      </form>
    </Modal>
  );
}

// Approve / reject with an optional remark
export function RemarkModal({ title, approve, onClose, onSubmit }) {
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await onSubmit(remark.trim()); } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <form className="stack" onSubmit={go}>
        <div className="field"><label>Remark {approve ? '(optional)' : '(shown to the employee)'}</label><textarea autoFocus value={remark} onChange={(e) => setRemark(e.target.value)} /></div>
        {err && <div className="err">{err}</div>}
        <button className={'btn ' + (approve ? 'primary' : 'danger')} disabled={busy}>{approve ? 'Approve' : 'Reject'}</button>
      </form>
    </Modal>
  );
}

const TITLE = { leave: 'Apply leave', wfh: 'Work from home', fix: 'Correct attendance', comp: 'Request comp-off' };

function readFile(file) {
  return new Promise((resolve, reject) => {
    if (file.size > 1_500_000) return reject(new Error('The file is larger than 1.5 MB.'));
    if (!/^(application\/pdf|image\/(png|jpe?g|webp))$/.test(file.type)) return reject(new Error('Attach a PDF or an image (PNG / JPG).'));
    const fr = new FileReader();
    fr.onload = () => resolve({ name: file.name, data: fr.result });
    fr.onerror = () => reject(new Error('Could not read the file.'));
    fr.readAsDataURL(file);
  });
}

function LeaveForm({ wfh, date, typeCode, onDone }) {
  const toast = useToast();
  const { user } = useAuth();
  const approver = user.manager ? `${user.manager} (your reporting manager)` : 'HR';
  const year = (date || todayIst()).slice(0, 4);
  const { data } = useAsync(() => Promise.all([api('/leave-types'), api('/leaves/balance?year=' + year), api('/team'), api('/holidays?year=' + year)])
    .then(([types, bal, team, hols]) => ({ types, bal, team, hols })), []);
  const [f, setF] = useState({ type_id: '', from_date: date || todayIst(), to_date: date || todayIst(), half: false, session: 'first', reason: '', cc: [], file: null });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (!data) return <Spinner />;

  const types = data.types.filter((t) => (wfh ? t.is_wfh : !t.is_wfh));
  const pre = typeCode && types.find((t) => t.code === typeCode);
  const typeId = f.type_id || pre?.id || types[0]?.id;
  const type = types.find((t) => String(t.id) === String(typeId));
  const bal = data.bal.find((b) => b.id === type?.id);
  const optional = data.hols.filter((h) => h.optional && h.date >= todayIst());
  const hints = [];
  if (type && !wfh) {
    if (type.is_compoff) hints.push(`${bal?.balance ?? 0} comp-off day(s) available${bal?.expiring ? ` (earliest expires ${fmtDate(bal.expiring)})` : ''}`);
    else if (!bal?.unlimited && bal) hints.push(`${bal.balance} of ${bal.available ?? type.quota} day(s) left this year`);
    if (type.max_consecutive != null) hints.push(`Up to ${type.max_consecutive} consecutive day(s)`);
    if (type.min_notice_days > 0) hints.push(`Apply ${type.min_notice_days}+ day(s) in advance`);
    if (type.count_weekends) hints.push('Weekends and holidays inside the dates are counted');
    if (!type.allow_half) hints.push('No half days');
  }

  const pickFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try { setF({ ...f, file: await readFile(file) }); setErr(''); } catch (x) { setErr(x.message); e.target.value = ''; }
  };
  const toggleCc = (id) => setF({ ...f, cc: f.cc.includes(id) ? f.cc.filter((x) => x !== id) : [...f.cc, id] });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const to = f.half || type?.is_optional ? f.from_date : f.to_date;
      const r = await api('/leaves', { method: 'POST', body: {
        type_id: typeId, from_date: f.from_date, to_date: to, half: f.half, session: f.session, reason: f.reason, cc: f.cc,
        attachment: f.file?.data, attachment_name: f.file?.name,
      } });
      toast(`Request sent for approval: ${r.days} day${r.days === 1 ? '' : 's'}`);
      onDone();
    } catch (x) { setErr(x.message); setBusy(false); }
  };

  return (
    <form className="stack" onSubmit={submit}>
      <p className="muted small" style={{ margin: 0 }}>
        {wfh ? `${approver} approves this. After that you can check in from home on those days.` : `This goes to ${approver} for approval.`}
      </p>
      {!wfh && (
        <div className="field"><label>Leave type</label>
          <select value={typeId} onChange={(e) => setF({ ...f, type_id: e.target.value, half: false, file: null })}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          {hints.length > 0 && <span className="small muted">{hints.join(' · ')}</span>}
        </div>
      )}

      {type?.is_optional ? (
        <div className="field"><label>Optional holiday</label>
          <select value={f.from_date} onChange={(e) => setF({ ...f, from_date: e.target.value, to_date: e.target.value })}>
            {!optional.some((h) => h.date === f.from_date) && <option value="">Choose a day…</option>}
            {optional.map((h) => <option key={h.date} value={h.date}>{fmtDate(h.date, { weekday: 'short', day: 'numeric', month: 'short' })} · {h.name}</option>)}
          </select>
          {optional.length === 0 && <span className="small muted">HR has not added any optional holidays yet.</span>}
        </div>
      ) : (
        <div className="grid g2">
          <div className="field"><label>{f.half ? 'Date' : 'From'}</label><input type="date" value={f.from_date} onChange={(e) => setF({ ...f, from_date: e.target.value, to_date: e.target.value > f.to_date ? e.target.value : f.to_date })} required /></div>
          {!f.half && <div className="field"><label>To</label><input type="date" min={f.from_date} value={f.to_date} onChange={(e) => setF({ ...f, to_date: e.target.value })} required /></div>}
        </div>
      )}

      {(wfh || type?.allow_half) && !type?.is_optional && (
        <div className="row wrap">
          <label className="row small"><input type="checkbox" checked={f.half} onChange={(e) => setF({ ...f, half: e.target.checked })} /> Half day</label>
          {f.half && (
            <div className="chips">
              <button type="button" className={'chip ' + (f.session === 'first' ? 'on' : '')} onClick={() => setF({ ...f, session: 'first' })}>First half</button>
              <button type="button" className={'chip ' + (f.session === 'second' ? 'on' : '')} onClick={() => setF({ ...f, session: 'second' })}>Second half</button>
            </div>
          )}
        </div>
      )}

      <div className="field"><label>{wfh ? 'What will you work on?' : 'Reason'}</label><textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required /></div>

      {!wfh && type?.doc_after_days != null && (
        <div className="field"><label>Supporting document <span className="muted">(required if more than {type.doc_after_days} day(s))</span></label>
          <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={pickFile} />
          {f.file && <span className="small muted">Attached: {f.file.name}</span>}
        </div>
      )}

      <details className="cc">
        <summary>Notify colleagues {f.cc.length > 0 && <b>({f.cc.length})</b>} <span className="muted small">optional</span></summary>
        <div className="cc-list">
          {data.team.filter((p) => !p.you).map((p) => (
            <label key={p.id} className="row small"><input type="checkbox" checked={f.cc.includes(p.id)} onChange={() => toggleCc(p.id)} /> {p.name} <span className="muted">· {p.department || p.role}</span></label>
          ))}
        </div>
      </details>

      {err && <div className="err" role="alert">{err}</div>}
      <button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Send for approval'}</button>
    </form>
  );
}

function CompForm({ onDone }) {
  const toast = useToast();
  const { data } = useAsync(() => api('/compoff/eligible'), []);
  const [sel, setSel] = useState('');
  const [days, setDays] = useState(1);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (!data) return <Spinner />;
  const chosen = data.items.find((i) => i.date === (sel || data.items[0]?.date));

  if (!data.items.length) {
    return (
      <div className="stack">
        <div className="alert">You have no day to claim right now.</div>
        <p className="muted small" style={{ margin: 0 }}>You can request comp-off for a <b>holiday or weekly-off day that you worked</b> (checked in and out), within {data.window} days. On such a day, use <b>Check in as extra work</b> on your home screen.</p>
      </div>
    );
  }
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await api('/compoff', { method: 'POST', body: { worked_date: chosen.date, days: Math.min(days, chosen.max_days), reason } }); toast('Comp-off request sent for approval'); onDone(); }
    catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <form className="stack" onSubmit={submit}>
      <p className="muted small" style={{ margin: 0 }}>Pick the day you worked on a holiday or weekly off. Once approved, you get comp-off days to use as leave (they expire after a while).</p>
      <div className="field"><label>Day worked</label>
        <div className="stack" style={{ gap: 8 }}>
          {data.items.map((i) => (
            <label key={i.date} className={'pick ' + (chosen.date === i.date ? 'on' : '')}>
              <input type="radio" name="d" checked={chosen.date === i.date} onChange={() => { setSel(i.date); setDays(Math.min(days, i.max_days)); }} />
              <span><b>{fmtDate(i.date, { weekday: 'short', day: 'numeric', month: 'short' })}</b>{i.holiday ? ` · ${i.holiday}` : ' · weekly off'}<br /><span className="muted small">Worked {fmtDur(i.worked)} · up to {i.max_days} day(s)</span></span>
            </label>
          ))}
        </div>
      </div>
      <div className="field"><label>Days to claim</label>
        <div className="chips">
          {[1, 0.5].filter((d) => d <= chosen.max_days).map((d) => <button type="button" key={d} className={'chip ' + (Math.min(days, chosen.max_days) === d ? 'on' : '')} onClick={() => setDays(d)}>{d === 1 ? 'Full day' : 'Half day'}</button>)}
        </div>
      </div>
      <div className="field"><label>What did you work on? (optional)</label><textarea value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      {err && <div className="err" role="alert">{err}</div>}
      <button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Send for approval'}</button>
    </form>
  );
}

function FixForm({ date, onDone }) {
  const toast = useToast();
  const { data } = useAsync(() => api('/regularizations/eligible'), []);
  const [sel, setSel] = useState(date || '');
  const [f, setF] = useState({ check_in: '', check_out: '', reason: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (!data) return <Spinner />;
  const days = data.days;

  if (!days.length) {
    return (
      <div className="stack">
        <div className="alert">Nothing to correct.</div>
        <p className="muted small" style={{ margin: 0 }}>A correction is only for a day when your <b>check-in or check-out was missed</b>, within the last {data.window} days. Today, upcoming days and days with both punches recorded cannot be corrected.</p>
      </div>
    );
  }
  const chosen = days.find((d) => d.date === sel) || days[0];
  const outOnly = chosen.missing === 'out';
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await api('/regularizations', { method: 'POST', body: { date: chosen.date, check_in: outOnly ? chosen.check_in : f.check_in || data.shift.start, check_out: f.check_out || data.shift.end, reason: f.reason } });
      toast('Correction sent for approval'); onDone();
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <form className="stack" onSubmit={submit}>
      <p className="muted small" style={{ margin: 0 }}>Pick the day you missed a check-in or check-out and enter the actual times. Your manager (or HR) will review it.</p>
      <div className="field"><label>Day to correct</label>
        <div className="stack" style={{ gap: 8 }}>
          {days.map((d) => (
            <label key={d.date} className={'pick ' + (chosen.date === d.date ? 'on' : '')}>
              <input type="radio" name="fixday" checked={chosen.date === d.date} onChange={() => setSel(d.date)} />
              <span><b>{fmtDate(d.date, { weekday: 'short', day: 'numeric', month: 'short' })}</b><br /><span className="muted small">{d.missing === 'out' ? `No check-out (you checked in at ${d.check_in})` : 'No check-in'}</span></span>
            </label>
          ))}
        </div>
      </div>
      <div className="grid g2">
        {outOnly
          ? <div className="field"><label>Check-in</label><input value={chosen.check_in} disabled /></div>
          : <div className="field"><label>Check-in time</label><input type="time" value={f.check_in || data.shift.start} onChange={(e) => setF({ ...f, check_in: e.target.value })} required /></div>}
        <div className="field"><label>Check-out time</label><input type="time" value={f.check_out || data.shift.end} onChange={(e) => setF({ ...f, check_out: e.target.value })} required /></div>
      </div>
      <div className="field"><label>Reason</label><textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Phone battery died / forgot to tap check-out" required /></div>
      {err && <div className="err" role="alert">{err}</div>}
      <button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Send for approval'}</button>
    </form>
  );
}

// One modal for everything an employee can ask for. `date` pre-fills the chosen calendar day.
export function RequestModal({ kind, date, typeCode, onClose, onDone }) {
  return (
    <Modal title={typeCode === 'OH' ? 'Optional holiday' : TITLE[kind]} onClose={onClose}>
      {kind === 'fix' ? <FixForm date={date} onDone={onDone} />
        : kind === 'comp' ? <CompForm onDone={onDone} />
          : <LeaveForm wfh={kind === 'wfh'} date={date} typeCode={typeCode} onDone={onDone} />}
    </Modal>
  );
}

// Add / edit a time log (Time Tracker)
export function TimeLogModal({ log, date, onClose, onDone }) {
  const toast = useToast();
  const { data: projects } = useAsync(() => api('/projects'), []);
  const [f, setF] = useState({
    date: log?.date || date || todayIst(), project_id: log?.project_id || '', job_id: log?.job_id || '',
    time: log ? `${Math.floor(log.minutes / 60)}:${String(log.minutes % 60).padStart(2, '0')}` : '', notes: log?.notes || '',
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (!projects) return <Modal title="Time log" onClose={onClose}><Spinner /></Modal>;
  const pid = +f.project_id || projects[0]?.id;
  const project = projects.find((p) => p.id === pid);
  const minutes = parseDuration(f.time);

  const submit = async (e) => {
    e.preventDefault();
    if (!minutes) { setErr('Enter the time as hours, for example 1:30 or 1.5'); return; }
    setBusy(true); setErr('');
    try {
      const body = { date: f.date, project_id: pid, job_id: f.job_id && project?.jobs.some((j) => j.id === +f.job_id) ? +f.job_id : null, minutes, notes: f.notes };
      await api(log ? `/timelogs/${log.id}` : '/timelogs', { method: log ? 'PUT' : 'POST', body });
      toast(log ? 'Time log updated' : 'Time logged');
      onDone();
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  const remove = async () => {
    try { await api(`/timelogs/${log.id}`, { method: 'DELETE' }); toast('Time log deleted'); onDone(); } catch (x) { setErr(x.message); }
  };
  return (
    <Modal title={log ? 'Edit time log' : 'Add time log'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="field"><label>Date</label><input type="date" max={todayIst()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /></div>
        <div className="grid g2">
          <div className="field"><label>Project</label>
            <select value={pid} onChange={(e) => setF({ ...f, project_id: e.target.value, job_id: '' })}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div className="field"><label>Job (optional)</label>
            <select value={f.job_id} onChange={(e) => setF({ ...f, job_id: e.target.value })}><option value="">—</option>{project?.jobs.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}</select></div>
        </div>
        <div className="field"><label>Time spent</label>
          <input value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} placeholder="e.g. 1:30 or 1.5" required />
          <div className="chips" style={{ marginTop: 4 }}>{['0:30', '1:00', '2:00', '4:00'].map((t) => <button type="button" key={t} className="chip" onClick={() => setF({ ...f, time: t })}>{t}</button>)}</div>
          {minutes ? <span className="small muted">= {fmtDur(minutes)}</span> : null}
        </div>
        <div className="field"><label>What did you do?</label><textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
        {err && <div className="err" role="alert">{err}</div>}
        <div className="row"><button className="btn primary" disabled={busy}>{log ? 'Save' : 'Add log'}</button>{log && <button type="button" className="btn danger right" onClick={remove}><Icon n="x" size={14} /> Delete</button>}</div>
      </form>
    </Modal>
  );
}

// Attachments sit behind the sign-in, so fetch them with the token and open the blob.
export async function openAttachment(id) {
  const res = await api(`/leaves/${id}/attachment`, { raw: true });
  if (!res.ok) throw new Error('Could not open the file');
  window.open(URL.createObjectURL(await res.blob()), '_blank');
}
