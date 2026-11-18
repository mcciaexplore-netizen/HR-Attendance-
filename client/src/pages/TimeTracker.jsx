import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.js';
import { TimeLogModal } from '../components.jsx';
import { SHEET_STATE, TimesheetModal, weekLabel } from '../timesheet.jsx';
import { Badge, Icon, Modal, Spinner, Tabs, useAsync, useToast } from '../ui.jsx';
import { addDaysStr, fmtDate, fmtDur, todayIst, weekStartOf } from '../util.js';

function TimeLogs({ week, setWeek, tick, refresh }) {
  const toast = useToast();
  const to = addDaysStr(week, 6);
  const { data } = useAsync(() => api(`/timelogs?from=${week}&to=${to}`), [week, tick]);
  const [modal, setModal] = useState(null);
  const status = data?.sheets.find((s) => s.week_start === week)?.status || 'open';
  const locked = ['pending', 'approved'].includes(status);
  const total = (data?.logs || []).reduce((a, l) => a + l.minutes, 0);
  const cur = weekStartOf(todayIst());
  const [label, color] = SHEET_STATE[status];
  // only days with logs (and today) are listed; "Add time log" covers any other day
  const days = Array.from({ length: 7 }, (_, i) => addDaysStr(week, i)).filter((d) => d === todayIst() || (data?.logs || []).some((l) => l.date === d));
  const submit = () => api('/timesheets/submit', { method: 'POST', body: { week_start: week } })
    .then(() => { toast('Timesheet submitted for approval'); refresh(); }).catch((x) => toast({ title: x.message, bad: true }));

  return (
    <>
      <div className="row wrap">
        <div className="range">
          <button className="btn sm" onClick={() => setWeek(addDaysStr(week, -7))} aria-label="Previous week">‹</button>
          <span style={{ minWidth: 190, textAlign: 'center' }}>{weekLabel(week)}</span>
          <button className="btn sm" onClick={() => setWeek(addDaysStr(week, 7))} aria-label="Next week">›</button>
        </div>
        {week !== cur && <button className="btn sm" onClick={() => setWeek(cur)}>This week</button>}
        <Badge color={color}>{label}</Badge>
        <button className="btn primary right" onClick={() => setModal({})} disabled={locked}><Icon n="plus" size={16} /> Add time log</button>
      </div>

      {!data ? <Spinner /> : (<>
        <section className="card flush">
          {days.length === 0 && <div className="empty">No time logged this week.</div>}
          {days.map((date) => {
            const logs = data.logs.filter((l) => l.date === date);
            const sum = logs.reduce((a, l) => a + l.minutes, 0);
            const future = date > todayIst();
            return (
              <div key={date} className="tl-day">
                <div className="tl-h">
                  <div className="tl-d"><b>{+date.slice(8)}</b><small>{fmtDate(date, { weekday: 'short' }).toUpperCase()}</small></div>
                  <div className="muted small" style={{ flex: 1 }}>{fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
                  <b>{sum ? fmtDur(sum) : '—'}</b>
                  {!locked && !future && <button className="btn sm ghost" onClick={() => setModal({ date })} aria-label="Add log"><Icon n="plus" size={15} /></button>}
                </div>
                {logs.map((l) => (
                  <div key={l.id} className="tl-row">
                    <div style={{ flex: 1, minWidth: 0 }}><b style={{ fontWeight: 600 }}>{l.project_name}</b>{l.job_name ? <span className="muted"> · {l.job_name}</span> : null}{l.notes ? <div className="small muted">{l.notes}</div> : null}</div>
                    <b>{fmtDur(l.minutes)}</b>
                    {!locked && <button className="btn sm ghost" onClick={() => setModal({ log: l })} aria-label="Edit log"><Icon n="edit" size={15} /></button>}
                  </div>
                ))}
              </div>
            );
          })}
        </section>
        <div className="row wrap">
          <b style={{ fontSize: 18 }}>Week total: {fmtDur(total)}</b>
          {status === 'rejected' && <span className="small" style={{ color: 'var(--bad)' }}>Rejected: {data.sheets.find((s) => s.week_start === week)?.remark || 'please review and resubmit'}</span>}
          {!locked && week <= cur && <button className="btn primary right" disabled={total === 0} onClick={submit}>Submit timesheet</button>}
        </div>
      </>)}
      {modal && <TimeLogModal log={modal.log} date={modal.date} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
    </>
  );
}

function Timesheets({ openWeek, tick, refresh }) {
  const toast = useToast();
  const { data } = useAsync(() => api('/timesheets'), [tick]);
  const cur = weekStartOf(todayIst());
  const submit = (w) => api('/timesheets/submit', { method: 'POST', body: { week_start: w } })
    .then(() => { toast('Timesheet submitted for approval'); refresh(); }).catch((x) => toast({ title: x.message, bad: true }));
  if (!data) return <Spinner />;
  return (
    <section className="card flush scroll-x">
      <table className="table">
        <thead><tr><th>Week</th><th>Days logged</th><th>Hours</th><th>Status</th><th className="hide-m">Remark</th><th /></tr></thead>
        <tbody>{data.map((w) => {
          const [label, color] = SHEET_STATE[w.status];
          return (
            <tr key={w.week_start}>
              <td className="nowrap"><b style={{ fontWeight: 600 }}>{weekLabel(w.week_start)}</b>{w.week_start === cur && <span className="muted small"> · this week</span>}</td>
              <td>{w.days}</td><td>{w.minutes ? fmtDur(w.minutes) : '—'}</td><td><Badge color={color}>{label}</Badge></td><td className="small muted hide-m">{w.remark || ''}</td>
              <td className="nowrap">
                <button className="btn sm" onClick={() => openWeek(w.week_start)}>{['open', 'rejected'].includes(w.status) ? 'Edit logs' : 'View'}</button>{' '}
                {['open', 'rejected'].includes(w.status) && w.minutes > 0 && w.week_start <= cur && <button className="btn sm primary" onClick={() => submit(w.week_start)}>Submit</button>}
              </td>
            </tr>
          );
        })}</tbody>
      </table>
    </section>
  );
}

function Projects({ hr, tick, refresh }) {
  const toast = useToast();
  const { data } = useAsync(() => api('/projects' + (hr ? '?all=1' : '')), [hr, tick]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [jobFor, setJobFor] = useState(null);
  const [job, setJob] = useState('');
  const call = (p, o, msg) => api(p, o).then(() => { if (msg) toast(msg); refresh(); }).catch((x) => toast({ title: x.message, bad: true }));
  if (!data) return <Spinner />;
  return (
    <>
      {hr && (
        <div className="row">
          {adding ? (
            <form className="row" onSubmit={(e) => { e.preventDefault(); call('/projects', { method: 'POST', body: { name } }, 'Project added').then(() => { setName(''); setAdding(false); }); }}>
              <input autoFocus placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 260 }} required /><button className="btn primary">Add</button><button type="button" className="btn ghost" onClick={() => setAdding(false)}>Cancel</button>
            </form>
          ) : <button className="btn primary" onClick={() => setAdding(true)}><Icon n="plus" size={16} /> Add project</button>}
        </div>
      )}
      <div className="grid g2">
        {data.map((p) => (
          <div key={p.id} className="card" style={{ opacity: p.active ? 1 : .55 }}>
            <div className="row"><h3 style={{ flex: 1 }}>{p.name}</h3>{!p.active && <Badge>Inactive</Badge>}
              {hr && <button className="btn sm ghost" onClick={() => call(`/projects/${p.id}`, { method: 'PUT', body: { name: p.name, description: p.description, active: !p.active } }, p.active ? 'Project deactivated' : 'Project activated')}>{p.active ? 'Deactivate' : 'Activate'}</button>}</div>
            {p.description && <div className="small muted" style={{ marginBottom: 8 }}>{p.description}</div>}
            <div className="chips">{p.jobs.map((j) => (
              <span key={j.id} className="chip" style={{ cursor: hr ? 'pointer' : 'default', opacity: j.active ? 1 : .5 }} title={hr ? (j.active ? 'Click to deactivate' : 'Click to activate') : ''}
                onClick={() => hr && call(`/jobs/${j.id}`, { method: 'PUT', body: { name: j.name, active: !j.active } })}>{j.name}</span>
            ))}{p.jobs.length === 0 && <span className="muted small">No jobs yet</span>}</div>
            {hr && (jobFor === p.id ? (
              <form className="row" style={{ marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); call(`/projects/${p.id}/jobs`, { method: 'POST', body: { name: job } }, 'Job added').then(() => { setJob(''); setJobFor(null); }); }}>
                <input autoFocus placeholder="Job name" value={job} onChange={(e) => setJob(e.target.value)} required /><button className="btn sm primary">Add</button>
              </form>
            ) : <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => setJobFor(p.id)}>+ Add job</button>)}
          </div>
        ))}
      </div>
    </>
  );
}

// HR: every submitted timesheet
function AllTimesheets({ tick, refresh }) {
  const [st, setSt] = useState('pending');
  const [view, setView] = useState(null);
  const { data } = useAsync(() => api('/timesheets/all' + (st ? `?status=${st}` : '')), [st, tick]);
  return (
    <>
      <div className="chips">{[['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['', 'All']].map(([k, l]) => <button key={l} className={'chip ' + (st === k ? 'on' : '')} onClick={() => setSt(k)}>{l}</button>)}</div>
      {!data ? <Spinner /> : (
        <section className="card flush scroll-x">
          <table className="table">
            <thead><tr><th>Person</th><th>Week</th><th>Hours</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.map((t) => <tr key={t.id}><td><b style={{ fontWeight: 600 }}>{t.user_name}</b> <span className="muted small">{t.emp_code}</span></td><td className="nowrap">{weekLabel(t.week_start)}</td><td>{fmtDur(t.minutes)}</td><td><Badge color={SHEET_STATE[t.status][1]}>{SHEET_STATE[t.status][0]}</Badge></td><td><button className="btn sm" onClick={() => setView(t)}>Review</button></td></tr>)}
              {data.length === 0 && <tr><td colSpan="5" className="empty">No timesheets here.</td></tr>}
            </tbody>
          </table>
        </section>
      )}
      {view && <TimesheetModal item={view} canDecide onClose={() => setView(null)} onDone={() => { setView(null); refresh(); }} />}
    </>
  );
}

export default function TimeTracker() {
  const { user } = useAuth();
  const hr = user.role === 'hr';
  const [tab, setTab] = useState(hr ? 'sheets' : 'logs');
  const [week, setWeek] = useState(weekStartOf(todayIst()));
  const [tick, setTick] = useState(0);
  const refresh = () => setTick((t) => t + 1);
  const openWeek = (w) => { setWeek(w); setTab('logs'); };

  return (
    <div className="stack">
      <Tabs items={hr ? [['sheets', 'Timesheets'], ['projects', 'Projects']] : [['logs', 'Time Logs'], ['sheets', 'Timesheets'], ['projects', 'Projects']]} value={tab} onChange={setTab} />
      {tab === 'logs' && !hr && <TimeLogs week={week} setWeek={setWeek} tick={tick} refresh={refresh} />}
      {tab === 'sheets' && (hr ? <AllTimesheets tick={tick} refresh={refresh} /> : <Timesheets openWeek={openWeek} tick={tick} refresh={refresh} />)}
      {tab === 'projects' && <Projects hr={hr} tick={tick} refresh={refresh} />}
    </div>
  );
}
