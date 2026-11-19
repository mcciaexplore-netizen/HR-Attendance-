import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { Avatar, Badge, Icon, useTick } from './ui.jsx';
import { STATUS, fmtDate, fmtDur, fmtTime, monthLabel, shiftMonth, todayIst } from './util.js';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function useNarrow(px = 900) {
  const q = `(max-width:${px}px)`;
  const [n, setN] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const f = () => setN(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, [q]);
  return n;
}

// Calendar + the person's leave/WFH requests for the month. `userId` is only for HR / a manager looking at someone else.
export function useMonthData(month, userId) {
  const [state, setState] = useState({ cal: null, reqs: [] });
  const gt = useTick(); // reload when a request / time log is saved from anywhere
  const load = useCallback(async () => {
    const [cal, reqs] = await Promise.all([
      api(`/calendar?month=${month}${userId ? `&user_id=${userId}` : ''}`),
      api('/leaves' + (userId ? `?user_id=${userId}` : '')),
    ]);
    setState({ cal, reqs });
  }, [month, userId]);
  useEffect(() => { load().catch(() => {}); }, [load, gt]);
  useEffect(() => { setState((s) => ({ ...s, cal: null })); }, [month, userId]);
  return { ...state, reload: load };
}

export const pendingFor = (reqs, date) => (reqs || []).find((r) => r.status === 'pending' && r.from_date <= date && r.to_date >= date);

// What to print inside a calendar day
export function cellInfo(d, pend) {
  const [name, color] = STATUS[d.status] || ['', 'var(--muted)'];
  let label = name, c = color;
  if (d.status === 'leave') label = d.half ? 'Half leave' : 'Leave';
  else if (d.status === 'missed') label = 'No out';
  else if (d.status === 'extra') label = 'Extra';
  else if (['weekend', 'na', 'pending', 'upcoming'].includes(d.status)) {
    label = '';
    if (d.wfh_approved) { label = 'WFH ✓'; c = 'var(--info)'; }
    else if (pend && d.status !== 'weekend') { label = pend.is_wfh ? 'WFH ?' : 'Leave ?'; c = 'var(--warn)'; }
  }
  if (d.status === 'absent' && pend) { label = pend.is_wfh ? 'WFH ?' : 'Leave ?'; c = 'var(--warn)'; }
  return { label, color: c };
}

export const monthStats = (s) => {
  const present = s ? s.present + s.late + s.half + s.missed : 0;
  const att = s ? present + s.wfh : 0;
  return { present, pct: s && att + s.absent ? Math.round((att / (att + s.absent)) * 100) : null };
};

export function CalendarView({ month, onMonth, cal, reqs, selected, onSelect }) {
  const today = todayIst();
  const days = cal?.days || [];
  const offset = days.length ? (new Date(days[0].date + 'T00:00:00Z').getUTCDay() + 6) % 7 : 0;
  const s = cal?.summary;
  const { present, pct } = monthStats(s);

  return (
    <section className="calbox">
      <div className="cal-head">
        <h2>{monthLabel(month)}</h2>
        <div className="row right" style={{ gap: 6 }}>
          <button className="btn sm" onClick={() => onMonth(shiftMonth(month, -1))} aria-label="Previous month">‹</button>
          <button className="btn sm" onClick={() => onMonth(today.slice(0, 7))}>Today</button>
          <button className="btn sm" onClick={() => onMonth(shiftMonth(month, 1))} aria-label="Next month">›</button>
        </div>
      </div>

      {s && (
        <div className="cal-sum">
          <span className="it"><i className="dot" style={{ '--c': 'var(--ok)' }} /><b>{present}</b> Present</span>
          <span className="it"><i className="dot" style={{ '--c': 'var(--info)' }} /><b>{s.wfh}</b> WFH</span>
          <span className="it"><i className="dot" style={{ '--c': 'var(--violet)' }} /><b>{s.leave}</b> Leave</span>
          <span className="it"><i className="dot" style={{ '--c': 'var(--bad)' }} /><b>{s.absent}</b> Absent</span>
          <span className="pc">{pct != null && <><b>{pct}%</b> attendance · </>}<b>{fmtDur(s.minutes)}</b></span>
        </div>
      )}

      <div className="cal-grid">
        {DOW.map((w) => <div key={w} className="dow">{w}</div>)}
        {Array.from({ length: offset }, (_, i) => <div key={'b' + i} className="cell blank" />)}
        {!cal && Array.from({ length: 30 }, (_, i) => <div key={'s' + i} className="cell na" />)}
        {days.map((d) => {
          const pend = pendingFor(reqs, d.date);
          const { label, color } = cellInfo(d, pend);
          const cls = ['cell', label ? 'has' : '', d.status === 'weekend' ? 'wk' : '', d.status === 'na' ? 'na' : '', d.date === today ? 'today' : '', d.date === selected ? 'sel' : ''].filter(Boolean).join(' ');
          return (
            <button key={d.date} className={cls} style={{ '--c': color }} disabled={d.status === 'na'}
              onClick={() => onSelect(d.date === selected ? null : d.date)}
              aria-label={`${fmtDate(d.date, { weekday: 'long', day: 'numeric', month: 'long' })}${label ? ', ' + label : ''}`} title={d.holiday || d.optional || label}>
              <span className="n">{+d.date.slice(8)}</span>
              {d.optional && <span className="star" title={d.optional}>★</span>}
              <i className="dot" />
            </button>
          );
        })}
      </div>

      <div className="legend">
        {[['Present', 'var(--ok)'], ['Late', 'var(--warn)'], ['WFH', 'var(--info)'], ['Leave', 'var(--violet)'], ['Holiday', 'var(--teal)'], ['Absent', 'var(--bad)']]
          .map(([l, c]) => <span key={l}><i className="dot" style={{ '--c': c }} />{l}</span>)}
        <span><b style={{ color: 'var(--crimson)' }}>★</b> Optional holiday</span>
      </div>
    </section>
  );
}

export function DayCard({ day, reqs, shift, readOnly, bare, onClose, onAction, onCancel }) {
  const pend = pendingFor(reqs, day.date);
  const [bname, bcolor] = STATUS[day.status] || [];
  const worked = ['upcoming', 'pending', 'absent'].includes(day.status);
  const canLeave = !readOnly && worked && !pend;
  const canWfh = !readOnly && ['upcoming', 'pending'].includes(day.status) && !day.wfh_approved && !pend;
  const canFix = !readOnly && ['absent', 'missed'].includes(day.status); // a missed check-in or check-out
  const canOh = !readOnly && !!day.optional && !pend && day.date >= todayIst() && !['leave', 'holiday', 'weekend'].includes(day.status);
  const canComp = !readOnly && day.status === 'extra' && !!day.check_out;
  const canCancel = !readOnly && pend;

  return (
    <div className={'dc' + (bare ? ' bare' : '')}>
      <div className="dc-h">
        <div><b>{fmtDate(day.date, { weekday: 'long' })}</b><span>{fmtDate(day.date, { day: 'numeric', month: 'long', year: 'numeric' })}</span></div>
        {onClose && <button className="iconbtn right" onClick={onClose} aria-label="Close"><Icon n="x" size={18} /></button>}
      </div>

      <div className="dc-badges">
        {day.check_in && bname && <Badge color={bcolor}>{bname}</Badge>}
        {day.status === 'holiday' && <Badge color="var(--teal)">Holiday</Badge>}
        {day.status === 'weekend' && <Badge>Weekly off</Badge>}
        {day.status === 'leave' && <Badge color="var(--violet)">On leave</Badge>}
        {day.status === 'absent' && <Badge color="var(--bad)">Absent</Badge>}
        {day.status === 'pending' && !day.check_in && <Badge>Not checked in yet</Badge>}
        {day.status === 'upcoming' && !day.wfh_approved && <Badge>Upcoming</Badge>}
        {day.wfh_approved && <Badge color="var(--info)">WFH approved</Badge>}
        {pend && <Badge color="var(--warn)">Request pending</Badge>}
      </div>

      {shift && !['holiday', 'weekend', 'na'].includes(day.status) && <div className="dc-row"><span>Shift</span><span>{shift.name} · {shift.start}–{shift.end}</span></div>}
      {day.holiday && <div className="dc-row"><span>Holiday</span><span>{day.holiday}</span></div>}
      {day.optional && <div className="dc-row"><span>Optional holiday</span><span>{day.optional}</span></div>}
      {day.leave && <div className="dc-row"><span>Leave</span><span>{day.leave}{day.half ? ` (${day.session === 'second' ? 'second' : 'first'} half)` : ''}</span></div>}
      {pend && <div className="dc-row"><span>{pend.type_name}</span><span>{fmtDate(pend.from_date)}{pend.to_date !== pend.from_date && ` – ${fmtDate(pend.to_date)}`}</span></div>}
      {day.check_in && (<>
        <div className="dc-row"><span>Check-in</span><span>{fmtTime(day.check_in)}</span></div>
        <div className="dc-row"><span>Check-out</span><span>{day.check_out ? fmtTime(day.check_out) : day.date === todayIst() ? 'Still working' : 'Missing'}</span></div>
        {day.worked != null && <div className="dc-row"><span>Worked</span><span>{fmtDur(day.worked)}</span></div>}
        {day.late && !day.extra && <div className="dc-row"><span>Late</span><span style={{ color: 'var(--warn)' }}>{day.late_min} min after shift start</span></div>}
        {day.early_min > 0 && <div className="dc-row"><span>Early out</span><span style={{ color: 'var(--warn)' }}>{day.early_min} min before shift end</span></div>}
        {day.excess_min != null && day.excess_min !== 0 && (
          <div className="dc-row"><span>{day.excess_min > 0 ? 'Excess hours' : 'Deficit hours'}</span><span style={{ color: day.excess_min > 0 ? 'var(--ok)' : 'var(--bad)' }}>{day.excess_min > 0 ? '+' : '−'}{fmtDur(Math.abs(day.excess_min))}</span></div>
        )}
        <div className="dc-row"><span>Where</span><span>{day.in_mode === 'wfh' ? 'Home' : day.in_source === 'regularized' ? 'Corrected' : `Office${day.in_dist != null ? ` · ${day.in_dist} m` : ''}`}</span></div>
        {day.in_note && <div className="dc-row"><span>Plan</span><span style={{ fontWeight: 500 }}>“{day.in_note}”</span></div>}
        {day.out_note && <div className="dc-row"><span>Wrap-up</span><span style={{ fontWeight: 500 }}>“{day.out_note}”</span></div>}
      </>)}

      {(canLeave || canWfh || canFix || canOh || canComp || canCancel) && (
        <div className="dc-act">
          {canFix && <button className="btn primary" onClick={() => onAction('fix')}><Icon n="edit" size={16} /> Correct attendance</button>}
          {canComp && <button className="btn primary" onClick={() => onAction('comp')}><Icon n="plus" size={16} /> Request comp-off for this day</button>}
          {canLeave && <button className="btn" onClick={() => onAction('leave')}><Icon n="umbrella" size={16} /> Apply leave for this day</button>}
          {canWfh && <button className="btn" onClick={() => onAction('wfh')}><Icon n="home" size={16} /> Request work from home</button>}
          {canOh && <button className="btn" onClick={() => onAction('oh')}><span style={{ color: 'var(--crimson)' }}>★</span> Take this optional holiday</button>}
          {canCancel && <button className="btn danger" onClick={() => onCancel(pend)}>Cancel pending request</button>}
        </div>
      )}
    </div>
  );
}

// Calendar + day details for one person (HR / manager view, read-only)
export function PersonCalendar({ userId, initialMonth, stack }) {
  const [month, setMonth] = useState(initialMonth || todayIst().slice(0, 7));
  const { cal, reqs } = useMonthData(month, userId);
  const [sel, setSel] = useState(null);
  const day = sel && cal?.days.find((d) => d.date === sel);
  return (
    <div className={'pcal' + (stack ? ' stack1' : '')}>
      <CalendarView month={month} onMonth={(m) => { setMonth(m); setSel(null); }} cal={cal} reqs={reqs} selected={sel} onSelect={setSel} />
      {day ? <DayCard day={day} reqs={reqs} shift={cal.shift} readOnly onClose={() => setSel(null)} />
        : <div className="card empty" style={{ alignSelf: 'start' }}>Select a day to see its check-in details.</div>}
    </div>
  );
}

// Everyone's approved leave / WFH (names and type only), like Zoho's team leave calendar
export function TeamCalendar() {
  const [month, setMonth] = useState(todayIst().slice(0, 7));
  const [data, setData] = useState(null);
  const [sel, setSel] = useState(todayIst());
  useEffect(() => { setData(null); api('/team/calendar?month=' + month).then(setData).catch(() => {}); }, [month]);
  const today = todayIst();
  const days = data?.days || [];
  const offset = days.length ? (new Date(days[0].date + 'T00:00:00Z').getUTCDay() + 6) % 7 : 0;
  const day = days.find((d) => d.date === sel);

  return (
    <div className="pcal">
      <section className="calbox">
        <div className="cal-head">
          <h2>{monthLabel(month)}</h2>
          <div className="row right" style={{ gap: 6 }}>
            <button className="btn sm" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">‹</button>
            <button className="btn sm" onClick={() => { setMonth(today.slice(0, 7)); setSel(today); }}>Today</button>
            <button className="btn sm" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">›</button>
          </div>
        </div>
        <div className="cal-grid">
          {DOW.map((w) => <div key={w} className="dow">{w}</div>)}
          {Array.from({ length: offset }, (_, i) => <div key={'b' + i} className="cell blank" />)}
          {!data && Array.from({ length: 30 }, (_, i) => <div key={'s' + i} className="cell na" />)}
          {days.map((d) => {
            const leave = d.out.filter((o) => !o.wfh).length, wfh = d.out.filter((o) => o.wfh).length;
            const party = (d.birthdays?.length || 0) + (d.anniversaries?.length || 0);
            const label = d.holiday ? 'Holiday' : leave ? `${leave} on leave` : wfh ? `${wfh} WFH` : party ? 'Celebration' : '';
            const color = d.holiday ? 'var(--teal)' : leave ? 'var(--violet)' : wfh ? 'var(--info)' : 'var(--pink)';
            const wk = [0, 6].includes(new Date(d.date + 'T00:00:00Z').getUTCDay());
            return (
              <button key={d.date} className={['cell', label ? 'has' : '', wk && !label ? 'wk' : '', d.date === today ? 'today' : '', d.date === sel ? 'sel' : ''].filter(Boolean).join(' ')} style={{ '--c': color }} title={label} onClick={() => setSel(d.date)}>
                <span className="n">{+d.date.slice(8)}</span>
                {d.optional && <span className="star" title={d.optional}>★</span>}
                {party > 0 && <span className="party" title="Birthday / work anniversary">🎂</span>}
                <i className="dot" />
              </button>
            );
          })}
        </div>
      </section>
      <div className="dc" style={{ alignSelf: 'start' }}>
        {!day ? <div className="muted">Pick a day.</div> : (<>
          <div className="dc-h"><div><b>{fmtDate(day.date, { weekday: 'long' })}</b><span>{fmtDate(day.date, { day: 'numeric', month: 'long', year: 'numeric' })}</span></div></div>
          {day.holiday && <div className="dc-badges"><Badge color="var(--teal)">{day.holiday}</Badge></div>}
          {day.optional && <div className="dc-badges"><Badge color="var(--crimson)">★ {day.optional}</Badge></div>}
          {day.birthdays?.map((b) => <div key={'b' + b.user_id} className="row" style={{ padding: '8px 0', borderTop: '1px dashed var(--line)' }}><span style={{ fontSize: 20 }}>🎂</span><div><b style={{ fontWeight: 600 }}>{b.name}</b><div className="small muted">Birthday</div></div></div>)}
          {day.anniversaries?.map((a) => <div key={'a' + a.user_id} className="row" style={{ padding: '8px 0', borderTop: '1px dashed var(--line)' }}><span style={{ fontSize: 20 }}>🎉</span><div><b style={{ fontWeight: 600 }}>{a.name}</b><div className="small muted">{a.years} year{a.years === 1 ? '' : 's'} at MCCIA</div></div></div>)}
          {day.out.length === 0 ? <div className="muted" style={{ padding: '10px 0' }}>Nobody is on leave or working from home.</div> : day.out.map((o) => (
            <div key={o.user_id} className="row" style={{ padding: '8px 0', borderTop: '1px dashed var(--line)' }}>
              <Avatar name={o.name} /><div><b style={{ fontWeight: 600 }}>{o.name}</b><div className="small muted">{o.type}{o.half ? ' (half day)' : ''}</div></div>
              <Badge color={o.wfh ? 'var(--info)' : 'var(--violet)'}>{o.wfh ? 'WFH' : 'Leave'}</Badge>
            </div>
          ))}
        </>)}
      </div>
    </div>
  );
}
