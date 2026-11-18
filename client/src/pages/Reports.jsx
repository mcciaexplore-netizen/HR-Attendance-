import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Badge, Spinner, Tabs, useAsync } from '../ui.jsx';
import { STATUS, addDaysStr, downloadCsv, fmtDate, fmtDur, fmtTime, monthLabel, shiftMonth, todayIst } from '../util.js';

const hrs = (m) => (m / 60).toFixed(1);
const D = { day: 'numeric', month: 'short', year: 'numeric' };

function Monthly() {
  const nav = useNavigate();
  const [month, setMonth] = useState(todayIst().slice(0, 7));
  const { data } = useAsync(() => api('/reports/monthly?month=' + month), [month]);
  const csv = () => downloadCsv(`attendance-${month}.csv`,
    ['Code', 'Name', 'Role', 'Department', 'Shift', 'Working days so far', 'Present', 'Late', 'WFH', 'Half day', 'Leave', 'Absent', 'No check-out', 'Extra-work days', 'Late-in count', 'Late-in minutes', 'Early-out count', 'Early-out minutes', 'Excess hours', 'Deficit hours', 'Total hours', 'Late half-days'],
    data.rows.map((r) => [r.emp_code, r.name, r.role, r.department || '', r.shift || '', r.working_days, r.present, r.late, r.wfh, r.half, r.leave, r.absent, r.missed, r.extra, r.late_count, r.late_min, r.early_count, r.early_min, hrs(r.excess_min), hrs(r.deficit_min), hrs(r.minutes), r.late_halfdays]));
  return (
    <>
      <div className="row wrap">
        <div className="range"><button className="btn sm" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button><span>{monthLabel(month)}</span><button className="btn sm" onClick={() => setMonth(shiftMonth(month, 1))}>›</button></div>
        <button className="btn right" onClick={csv} disabled={!data}>Download CSV</button>
      </div>
      {!data ? <Spinner /> : (
        <section className="card flush scroll-x">
          <table className="table dense">
            <thead><tr><th>Person</th><th>Days</th><th>Present</th><th>Late</th><th>WFH</th><th>Leave</th><th>Absent</th><th>No out</th><th>Extra</th><th>Late-in</th><th>Early-out</th><th>Excess</th><th>Deficit</th><th>Hours</th><th>Attendance</th></tr></thead>
            <tbody>
              {data.rows.map((r) => {
                const att = r.present + r.late + r.wfh + r.half + r.missed;
                const pct = att + r.absent ? Math.round((att / (att + r.absent)) * 100) : null;
                return (
                  <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/attendance?user=${r.id}&month=${month}`)}>
                    <td className="nowrap"><b style={{ fontWeight: 600 }}>{r.name}</b><div className="small muted">{r.emp_code} · {r.shift}</div></td>
                    <td>{r.working_days}</td><td>{r.present}</td><td style={{ color: r.late ? 'var(--warn)' : '' }}>{r.late}</td><td>{r.wfh}</td><td>{r.leave}</td>
                    <td style={{ color: r.absent ? 'var(--bad)' : '' }}>{r.absent}</td><td style={{ color: r.missed ? 'var(--bad)' : '' }}>{r.missed}</td><td>{r.extra}</td>
                    <td className="nowrap">{r.late_count}{r.late_count ? <span className="small muted"> · {r.late_min}m</span> : ''}{data.lateMarks > 0 && r.late_halfdays > 0 && <span className="small" style={{ color: 'var(--bad)' }}> −{r.late_halfdays} ½d</span>}</td>
                    <td className="nowrap">{r.early_count}{r.early_count ? <span className="small muted"> · {r.early_min}m</span> : ''}</td>
                    <td className="nowrap" style={{ color: 'var(--ok)' }}>{r.excess_min ? '+' + fmtDur(r.excess_min) : '—'}</td><td className="nowrap" style={{ color: 'var(--bad)' }}>{r.deficit_min ? '−' + fmtDur(r.deficit_min) : '—'}</td>
                    <td className="nowrap">{fmtDur(r.minutes)}</td>
                    <td style={{ minWidth: 110 }}>{pct == null ? '—' : <><div style={{ height: 7, borderRadius: 9, background: 'var(--line)' }}><div style={{ width: pct + '%', height: '100%', borderRadius: 9, background: pct >= 90 ? 'var(--ok)' : pct >= 75 ? 'var(--warn)' : 'var(--bad)' }} /></div><span className="small muted">{pct}%</span></>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
      <p className="small muted">Click a row for the person's calendar.{data?.lateMarks > 0 ? ` Late-in rule: every ${data.lateMarks} late marks count as a half-day.` : ''}</p>
    </>
  );
}

function Daily() {
  const [date, setDate] = useState(todayIst());
  const { data } = useAsync(() => api('/reports/daily?date=' + date), [date]);
  const csv = () => downloadCsv(`attendance-${date}.csv`, ['Code', 'Name', 'Department', 'Shift', 'Status', 'Check-in', 'Check-out', 'Hours', 'Late (min)', 'Early out (min)', 'Where'],
    data.rows.map((r) => [r.emp_code, r.name, r.department || '', r.shift || '', STATUS[r.status]?.[0] || r.status, fmtTime(r.check_in), fmtTime(r.check_out), r.worked != null ? (r.worked / 60).toFixed(2) : '', r.late_min || '', r.early_min || '', r.mode === 'wfh' ? 'Home' : r.check_in ? 'Office' : '']));
  return (
    <>
      <div className="row wrap">
        <div className="range"><button className="btn sm" onClick={() => setDate(addDaysStr(date, -1))}>‹</button><input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ width: 160 }} /><button className="btn sm" onClick={() => setDate(addDaysStr(date, 1))}>›</button></div>
        <button className="btn right" onClick={csv} disabled={!data}>Download CSV</button>
      </div>
      {!data ? <Spinner /> : (
        <section className="card flush scroll-x">
          <table className="table">
            <thead><tr><th>Person</th><th>Shift</th><th>Status</th><th>In</th><th>Out</th><th>Hours</th><th>Late</th><th>Early</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id}><td className="nowrap"><b style={{ fontWeight: 600 }}>{r.name}</b> <span className="muted small">{r.emp_code}</span></td><td className="small">{r.shift}</td>
                  <td>{STATUS[r.status]?.[0] ? <Badge color={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge> : null}{r.leave && <span className="small muted"> {r.leave}</span>}{r.holiday && <span className="small muted"> {r.holiday}</span>}</td>
                  <td>{fmtTime(r.check_in)}</td><td>{fmtTime(r.check_out)}</td><td>{fmtDur(r.worked)}</td><td style={{ color: 'var(--warn)' }}>{r.late_min ? r.late_min + 'm' : ''}</td><td style={{ color: '#e0731a' }}>{r.early_min ? r.early_min + 'm' : ''}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

function LeaveBalance() {
  const [year, setYear] = useState(+todayIst().slice(0, 4));
  const { data } = useAsync(() => api('/reports/leave-balance?year=' + year), [year]);
  const types = (data?.types || []).filter((t) => !t.is_wfh);
  const csv = () => downloadCsv(`leave-balance-${year}.csv`, ['Code', 'Name', ...types.flatMap((t) => [`${t.name} balance`, `${t.name} booked`])],
    data.rows.map((r) => [r.emp_code, r.name, ...types.flatMap((t) => [r.balances[t.id]?.unlimited ? '' : r.balances[t.id]?.balance, r.balances[t.id]?.booked])]));
  return (
    <>
      <div className="row wrap"><div className="range"><button className="btn sm" onClick={() => setYear(year - 1)}>‹</button><span>{year}</span><button className="btn sm" onClick={() => setYear(year + 1)}>›</button></div><button className="btn right" onClick={csv} disabled={!data}>Download CSV</button></div>
      {!data ? <Spinner /> : (
        <section className="card flush scroll-x">
          <table className="table">
            <thead><tr><th>Person</th>{types.map((t) => <th key={t.id}>{t.name}<div className="small muted" style={{ fontWeight: 400 }}>balance · booked</div></th>)}</tr></thead>
            <tbody>{data.rows.map((r) => (
              <tr key={r.id}><td className="nowrap"><b style={{ fontWeight: 600 }}>{r.name}</b> <span className="muted small">{r.emp_code}</span></td>
                {types.map((t) => { const b = r.balances[t.id]; return <td key={t.id} className="nowrap">{b ? <><b>{b.unlimited ? '—' : b.balance}</b> <span className="muted">· {b.booked}{b.pending ? ` (+${b.pending} pending)` : ''}</span></> : '—'}</td>; })}</tr>
            ))}</tbody>
          </table>
        </section>
      )}
    </>
  );
}

function LeaveHistory() {
  const [f, setF] = useState({ from: `${todayIst().slice(0, 4)}-01-01`, to: `${todayIst().slice(0, 4)}-12-31`, status: '' });
  const { data } = useAsync(() => api(`/reports/leaves?from=${f.from}&to=${f.to}${f.status ? '&status=' + f.status : ''}`), [f.from, f.to, f.status]);
  const csv = () => downloadCsv('leave-history.csv', ['Code', 'Name', 'Type', 'From', 'To', 'Days', 'Status', 'Reason', 'Decided by', 'Remark'],
    data.rows.map((r) => [r.emp_code, r.user_name, r.type_name, r.from_date, r.to_date, r.days, r.status, r.reason, r.decided_by_name || '', r.remark || '']));
  return (
    <>
      <div className="row wrap">
        <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} style={{ width: 160 }} /> to <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} style={{ width: 160 }} />
        <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} style={{ width: 150 }}><option value="">All statuses</option>{['pending', 'approved', 'rejected', 'cancelled'].map((s) => <option key={s}>{s}</option>)}</select>
        <button className="btn right" onClick={csv} disabled={!data}>Download CSV</button>
      </div>
      {!data ? <Spinner /> : (
        <section className="card flush scroll-x">
          <table className="table">
            <thead><tr><th>Person</th><th>Type</th><th>Dates</th><th>Days</th><th>Status</th><th>Decided by</th></tr></thead>
            <tbody>
              {data.rows.map((r) => <tr key={r.id}><td className="nowrap"><b style={{ fontWeight: 600 }}>{r.user_name}</b> <span className="muted small">{r.emp_code}</span></td><td>{r.type_name}</td><td className="nowrap">{fmtDate(r.from_date, D)}{r.to_date !== r.from_date && ` – ${fmtDate(r.to_date, D)}`}</td><td>{r.days}</td><td><Badge color={{ pending: 'var(--warn)', approved: 'var(--ok)', rejected: 'var(--bad)', cancelled: 'var(--muted)' }[r.status]}>{r.status}</Badge></td><td className="small muted">{r.decided_by_name || '—'}</td></tr>)}
              {data.rows.length === 0 && <tr><td colSpan="6" className="empty">No leave in this period.</td></tr>}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

function TimeReport() {
  const [f, setF] = useState({ from: addDaysStr(todayIst(), -29), to: todayIst() });
  const { data } = useAsync(() => api(`/reports/time?from=${f.from}&to=${f.to}`), [f.from, f.to]);
  const csv = () => downloadCsv(`time-${f.from}-to-${f.to}.csv`, ['Code', 'Name', 'Total hours', ...data.projects.map((p) => p.name + ' (hours)')],
    data.rows.map((r) => [r.emp_code, r.name, hrs(r.total), ...data.projects.map((p) => hrs(r.projects[p.id] || 0))]));
  return (
    <>
      <div className="row wrap">
        <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} style={{ width: 160 }} /> to <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} style={{ width: 160 }} />
        <button className="btn right" onClick={csv} disabled={!data}>Download CSV</button>
      </div>
      {!data ? <Spinner /> : (
        <section className="card flush scroll-x">
          <table className="table">
            <thead><tr><th>Person</th><th>Total</th>{data.projects.map((p) => <th key={p.id}>{p.name}</th>)}</tr></thead>
            <tbody>{data.rows.map((r) => <tr key={r.id}><td className="nowrap"><b style={{ fontWeight: 600 }}>{r.name}</b> <span className="muted small">{r.emp_code}</span></td><td><b>{r.total ? fmtDur(r.total) : '—'}</b></td>{data.projects.map((p) => <td key={p.id}>{r.projects[p.id] ? fmtDur(r.projects[p.id]) : '—'}</td>)}</tr>)}</tbody>
          </table>
        </section>
      )}
    </>
  );
}

export default function Reports() {
  const [tab, setTab] = useState('monthly');
  return (
    <>
      
      <Tabs value={tab} onChange={setTab} items={[['monthly', 'Monthly attendance'], ['daily', 'Daily'], ['balance', 'Leave balance'], ['history', 'Leave history'], ['time', 'Time']]} />
      {tab === 'monthly' && <Monthly />}{tab === 'daily' && <Daily />}{tab === 'balance' && <LeaveBalance />}{tab === 'history' && <LeaveHistory />}{tab === 'time' && <TimeReport />}
    </>
  );
}
