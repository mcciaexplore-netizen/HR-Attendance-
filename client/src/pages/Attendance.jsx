import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useActions, useAuth } from '../auth.js';
import { PersonCalendar } from '../calendar.jsx';
import { Pills, Spinner, StatusBadge, useAsync } from '../ui.jsx';
import { STATUS, downloadCsv, fmtDate, fmtDur, fmtTime, monthLabel, shiftMonth, todayIst } from '../util.js';

const Stat = ({ label, value, sub, c }) => <div className="stat" style={{ '--c': c }}><small>{label}</small><b>{value}</b>{sub && <span>{sub}</span>}</div>;

// Monthly attendance: four numbers and a plain list. HR and managers can pick a person.
export default function Attendance() {
  const { user } = useAuth();
  const { open } = useActions();
  const hr = user.role === 'hr';
  const [sp, setSp] = useSearchParams();
  const month = sp.get('month') || todayIst().slice(0, 7);
  const view = sp.get('view') || 'list';
  const [more, setMore] = useState(false);
  const today = todayIst();

  const canPick = hr || user.is_manager;
  const people = useAsync(() => (hr ? api('/users').then((u) => u.filter((p) => p.role !== 'hr')) : user.is_manager ? api('/team').then((t) => t.filter((p) => p.manager_id === user.id)) : Promise.resolve([])), [hr, user.is_manager]);
  const uid = canPick ? sp.get('user') || '' : '';
  const own = !uid;
  const apv = user.role === 'approver';
  const waiting = (hr || apv) && !uid; // HR and approvers have no attendance of their own
  const set = (k, v) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n, { replace: true }); };

  const cal = useAsync(() => (waiting ? Promise.resolve(null) : api(`/calendar?month=${month}${uid ? `&user_id=${uid}` : ''}`)), [month, uid, waiting]);
  const s = cal.data?.summary;
  const rows = (cal.data?.days || []).filter((d) => d.date <= today && d.status !== 'na').reverse();
  const who = (people.data || []).find((p) => String(p.id) === uid);
  const canFix = (d) => own && !hr && ['absent', 'missed'].includes(d.status);

  const csv = () => downloadCsv(`attendance-${(who?.emp_code || user.emp_code)}-${month}.csv`,
    ['Date', 'Day', 'Check-in', 'Check-out', 'Hours', 'Late (min)', 'Early out (min)', 'Excess/deficit (min)', 'Status', 'Where'],
    rows.map((d) => [d.date, fmtDate(d.date, { weekday: 'short' }), fmtTime(d.check_in), fmtTime(d.check_out), d.worked != null ? (d.worked / 60).toFixed(2) : '', d.late && !d.extra ? d.late_min : '', d.early_min || '', d.excess_min ?? '', STATUS[d.status]?.[0] || '', d.in_mode === 'wfh' ? 'Home' : d.check_in ? 'Office' : '']));

  return (
    <div className="stack">
      <div className="row wrap">
        {canPick && (
          <select value={uid} onChange={(e) => set('user', e.target.value)} style={{ width: 230 }} aria-label="Person">
            <option value="">{hr || apv ? 'Select person…' : 'My attendance'}</option>
            {(people.data || []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.emp_code})</option>)}
          </select>
        )}
        <Pills items={[['list', 'List'], ['cal', 'Calendar']]} value={view} onChange={(v) => set('view', v === 'list' ? '' : v)} />
        {view === 'list' && !waiting && (
          <div className="row right">
            {own && !hr && <button className="btn primary" onClick={() => open('fix')}>Regularize</button>}
            <button className="btn" onClick={csv}>CSV</button>
          </div>
        )}
      </div>

      {waiting ? <div className="card empty">Choose a person above, or open someone from Today or Reports.</div> : view === 'cal' ? (
        <PersonCalendar key={uid + month} userId={uid || undefined} initialMonth={month} />
      ) : !cal.data ? <Spinner /> : (<>
        <div className="row wrap">
          <div className="range">
            <button className="btn sm" onClick={() => set('month', shiftMonth(month, -1))} aria-label="Previous month">‹</button>
            <span style={{ minWidth: 128, textAlign: 'center' }}>{monthLabel(month)}</span>
            <button className="btn sm" onClick={() => set('month', shiftMonth(month, 1))} aria-label="Next month">›</button>
          </div>
          <span className="muted small right">{cal.data.shift.name} · {cal.data.shift.start}–{cal.data.shift.end}</span>
        </div>

        <div className="sgrid">
          <Stat label="Present" value={s.present + s.late + s.half + s.missed} sub="days" c="var(--ok)" />
          <Stat label="Work from home" value={s.wfh} sub="days" c="var(--info)" />
          <Stat label="Leave" value={s.leave} sub="days" c="var(--violet)" />
          <Stat label="Absent" value={s.absent} sub="days" c="var(--bad)" />
        </div>
        {more && (
          <div className="sgrid">
            <Stat label="Total hours" value={fmtDur(s.minutes)} c="var(--brand)" />
            <Stat label="Late-in" value={s.late_count} sub={s.late_count ? `${fmtDur(s.late_min)} in total` : 'None'} c="var(--warn)" />
            <Stat label="Early-out" value={s.early_count} sub={s.early_count ? `${fmtDur(s.early_min)} in total` : 'None'} c="#e0731a" />
            <Stat label="Excess hours" value={fmtDur(s.excess_min)} c="var(--ok)" />
            <Stat label="Deficit hours" value={fmtDur(s.deficit_min)} c="var(--bad)" />
            <Stat label="Extra-work days" value={s.extra} sub="holiday / weekly off" c="var(--teal)" />
          </div>
        )}
        <button className="link" style={{ alignSelf: 'flex-start' }} onClick={() => setMore(!more)}>{more ? 'Show fewer numbers' : 'Show more numbers'}</button>

        <section className="card flush scroll-x">
          <table className="table">
            <thead><tr><th>Date</th><th>In</th><th>Out</th><th className="hide-m">Hours</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((d) => (!d.check_in && ['weekend', 'holiday'].includes(d.status) ? (
                <tr key={d.date} className="off">
                  <td className="nowrap">{fmtDate(d.date, { day: 'numeric', month: 'short' })} <span className="hide-m">{fmtDate(d.date, { weekday: 'short' })}</span></td>
                  <td colSpan="4">{d.status === 'holiday' ? `Holiday · ${d.holiday}` : 'Weekly off'}</td>
                </tr>
              ) : (
                <tr key={d.date}>
                  <td className="nowrap"><b style={{ fontWeight: 600 }}>{fmtDate(d.date, { day: 'numeric', month: 'short' })}</b> <span className="muted hide-m">{fmtDate(d.date, { weekday: 'short' })}</span></td>
                  <td className="nowrap">{fmtTime(d.check_in)}</td>
                  <td className="nowrap">{d.check_out ? fmtTime(d.check_out) : d.check_in ? <span className="muted">{d.date === today ? 'working…' : 'missing'}</span> : '—'}</td>
                  <td className="hide-m nowrap">{fmtDur(d.worked)}{d.excess_min ? <span className="small" style={{ color: d.excess_min > 0 ? 'var(--ok)' : 'var(--bad)' }}> {d.excess_min > 0 ? '+' : '−'}{fmtDur(Math.abs(d.excess_min))}</span> : null}</td>
                  <td>
                    {STATUS[d.status]?.[0] ? <StatusBadge s={d.status} /> : null}{d.holiday && !d.check_in && <span className="small muted"> {d.holiday}</span>}{d.leave && <span className="small muted"> {d.leave}</span>}
                    {(d.late && !d.extra) || d.early_min > 0 || d.regularized ? (
                      <div className="small muted">
                        {d.late && !d.extra ? <span style={{ color: 'var(--warn)' }}>{d.late_min} min late</span> : null}{d.late && !d.extra && d.early_min > 0 ? ' · ' : ''}{d.early_min > 0 ? <span style={{ color: '#e0731a' }}>left {d.early_min} min early</span> : null}{d.regularized ? ((d.late && !d.extra) || d.early_min > 0 ? ' · corrected' : 'corrected') : ''}
                      </div>
                    ) : null}
                    {canFix(d) && <div style={{ marginTop: 6 }}><button className="btn sm" onClick={() => open('fix', { date: d.date })}>Send correction</button></div>}
                  </td>
                </tr>
              )))}
              {rows.length === 0 && <tr><td colSpan="5" className="empty">No records for this month.</td></tr>}
            </tbody>
          </table>
        </section>
      </>)}
    </div>
  );
}
