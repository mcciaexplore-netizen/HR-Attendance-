import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useActions, useAuth } from '../auth.js';
import { CalendarView, DayCard, useMonthData, useNarrow } from '../calendar.jsx';
import CheckInCard, { to12 } from '../CheckInCard.jsx';
import { Avatar, Icon, Pills, Sheet, Tabs, useAsync, useTick, useToast } from '../ui.jsx';
import { fmtDate, todayIst } from '../util.js';
import { Feeds } from './Feeds.jsx';
import { ProfileDetails } from './Profile.jsx';
import { TeamList } from './Team.jsx';

const DAY = (d) => fmtDate(d, { weekday: 'short' }).toUpperCase();
const LABEL_COLOR = { 'Weekly off': 'var(--orange)', Holiday: 'var(--teal)', 'On leave': 'var(--violet)', 'Work from home': 'var(--info)' };

// Zoho's "Work Schedule" card: today and the next days with the shift timings
function ScheduleCard() {
  const gt = useTick();
  const [sch, setSch] = useState(null);
  const [more, setMore] = useState(false);
  useEffect(() => { api('/schedule?days=7').then(setSch).catch(() => {}); }, [gt]);
  if (!sch) return null;
  const hours = `${to12(sch.shift.start)} – ${to12(sch.shift.end)}`;
  const days = more ? sch.days : sch.days.slice(0, 2);
  return (
    <section className="sched" aria-label="Work schedule">
      <div className="sched-h"><span className="ic"><Icon n="clock" size={20} /></span><div><b>Work Schedule</b><small>{sch.shift.name} shift</small></div></div>
      {days.map((d, i) => {
        const working = d.label === 'Working';
        return (
          <div key={d.date} className={'sd' + (i === 0 ? ' today' : '')}>
            <div className="box"><span>{+d.date.slice(8)}</span><small>{DAY(d.date)}</small></div>
            <div>
              <div className="t1" style={working ? null : { color: LABEL_COLOR[d.label] }}>{working ? sch.shift.name : d.label}</div>
              <div className="t2">{d.label === 'Holiday' ? d.holiday : d.label === 'On leave' ? d.leave : d.label === 'Weekly off' ? 'No check-in needed' : hours}{d.optional ? ` · ★ ${d.optional}` : ''}</div>
            </div>
          </div>
        );
      })}
      <button className="more-btn" onClick={() => setMore(!more)}>{more ? 'View Less' : 'View More'}</button>
    </section>
  );
}

function Activities() {
  const [info, setInfo] = useState(null);
  const ann = info?.announcements?.[0];
  const fresh = ann && Date.now() - Date.parse(ann.created_at.replace(' ', 'T') + 'Z') < 3 * 864e5;
  return (
    <div className="stack">
      {info?.birthday && <Link className="alert ann" to="/?tab=feeds"><span>🎂</span><span className="clip"><b>Happy Birthday!</b> <span className="muted">Everyone at MCCIA wishes you a wonderful year. See your wishes.</span></span></Link>}
      {info?.anniversary && <Link className="alert ann" to="/?tab=feeds"><span>🎉</span><span className="clip"><b>Happy work anniversary!</b> <span className="muted">{info.anniversary} year{info.anniversary === 1 ? '' : 's'} at MCCIA. Thank you!</span></span></Link>}
      {fresh && <Link className="alert ann" to="/?tab=feeds"><Icon n="mega" size={18} /><span className="clip"><b>{ann.title}</b>{ann.body ? <span className="muted"> — {ann.body}</span> : null}</span></Link>}
      <CheckInCard onLoaded={setInfo} />
      <ScheduleCard />
    </div>
  );
}

// Balances, next holidays, who is out, announcements
function DashTab() {
  const gt = useTick();
  const year = +todayIst().slice(0, 4);
  const [d, setD] = useState(null);
  useEffect(() => {
    let dead = false;
    Promise.all([
      api('/leaves/balance?year=' + year).catch(() => []),
      api('/team').catch(() => []),
      Promise.all([api('/holidays?year=' + year), api('/holidays?year=' + (year + 1))]).then(([a, b]) => [...a, ...b]).catch(() => []),
      api('/today').catch(() => null),
    ]).then(([bal, team, hols, info]) => { if (!dead) setD({ bal, team, hols: hols.filter((h) => h.date >= todayIst()).slice(0, 4), info }); });
    return () => { dead = true; };
  }, [gt, year]);
  if (!d) return <div className="empty">Loading…</div>;

  const out = d.team.filter((t) => ['leave', 'wfh'].includes(t.state));
  const bal = d.bal.filter((b) => !b.is_wfh);
  return (
    <div className="stack">
      {d.info?.approvals > 0 && <div className="alert">{d.info.approvals} request{d.info.approvals === 1 ? '' : 's'} waiting for your approval. <Link to="/approvals">Review</Link></div>}

      <section className="card">
        <div className="card-h"><h2>Leave balance</h2><Link className="small right" to="/leave">View all</Link></div>
        {bal.length === 0 ? <div className="muted small">No leave types yet.</div> : bal.map((b) => (
          <div key={b.id} className="dash-row"><i className="dot" style={{ '--c': b.color || 'var(--info)' }} />{b.name}<b>{b.unlimited ? '—' : `${b.balance} day${b.balance === 1 ? '' : 's'}`}</b></div>
        ))}
      </section>

      <section className="card">
        <div className="card-h"><h2>Upcoming holidays</h2><Link className="small right" to="/leave?view=holidays">View all</Link></div>
        {d.hols.length === 0 ? <div className="muted small">No upcoming holidays added yet.</div> : d.hols.map((h) => (
          <div key={h.date} className="dash-row"><div className="hd">{+h.date.slice(8)}<small>{fmtDate(h.date, { month: 'short' }).toUpperCase()}</small></div>
            <div><b style={{ margin: 0 }}>{h.name}</b><div className="small muted">{fmtDate(h.date, { weekday: 'long' })}{h.optional ? ' · optional' : ''}</div></div></div>
        ))}
      </section>

      <section className="card">
        <div className="card-h"><h2>Out today</h2><Link className="small right" to="/?space=team">Team</Link></div>
        {out.length === 0 ? <div className="muted small">Nobody is on leave or working from home.</div> : out.map((p) => (
          <div key={p.id} className="dash-row"><Avatar name={p.name} /><div><b style={{ margin: 0 }}>{p.name}</b><div className="small muted">{p.state === 'wfh' ? 'Working from home' : p.leave || 'On leave'}</div></div></div>
        ))}
      </section>

    </div>
  );
}

function CalendarTab() {
  const toast = useToast();
  const { open } = useActions();
  const narrow = useNarrow();
  const [month, setMonth] = useState(todayIst().slice(0, 7));
  const { cal, reqs, reload } = useMonthData(month);
  const [sel, setSel] = useState(null);
  const shown = sel ?? (narrow ? null : todayIst());
  const day = shown && cal?.days.find((d) => d.date === shown);

  const cancel = (r) => api(`/leaves/${r.id}/cancel`, { method: 'POST' })
    .then(() => { toast('Request cancelled'); reload(); })
    .catch((x) => toast({ title: x.message, bad: true }));
  const act = (kind) => (kind === 'oh' ? open('leave', { date: day.date, typeCode: 'OH' }) : open(kind, { date: day.date }));
  const card = (bare) => <DayCard day={day} reqs={reqs} shift={cal.shift} bare={bare} onClose={bare ? () => setSel(null) : undefined} onAction={act} onCancel={cancel} />;

  return (
    <>
      <div className={'pcal' + (narrow ? ' stack1' : '')}>
        <CalendarView month={month} onMonth={(m) => { setMonth(m); setSel(null); }} cal={cal} reqs={reqs} selected={shown} onSelect={setSel} />
        {!narrow && (day ? card(false) : <div className="card empty" style={{ alignSelf: 'start' }}>Pick a day to see its details.</div>)}
      </div>
      {sel && day && narrow && <Sheet onClose={() => setSel(null)}>{card(true)}</Sheet>}
    </>
  );
}

const TABS = ['activities', 'dashboard', 'feeds', 'calendar', 'profile'];

export default function Home() {
  const { user } = useAuth();
  const go = useNavigate();
  const [sp, setSp] = useSearchParams();
  const space = sp.get('space') === 'team' ? 'team' : 'me';
  const tab = TABS.includes(sp.get('tab')) ? sp.get('tab') : 'activities';
  const pending = useAsync(() => (user.is_manager ? api('/approvals/count') : Promise.resolve({ count: 0 })), [user.is_manager]).data?.count || 0;

  return (
    <div className="stack">
      <Pills items={[['me', 'My Space'], ['team', 'Team']]} value={space} onChange={(v) => setSp(v === 'team' ? { space: 'team' } : {}, { replace: true })} />
      {space === 'team' ? <TeamList /> : (<>
        <Tabs
          items={[['activities', 'Activities'], ['dashboard', 'Dashboard'], ['feeds', 'Feeds'], ['calendar', 'Calendar'], ['profile', 'Profile'], ...(user.is_manager ? [['approvals', 'Approvals', pending]] : [])]}
          value={tab}
          onChange={(k) => (k === 'approvals' ? go('/approvals') : setSp(k === 'activities' ? {} : { tab: k }, { replace: true }))} />
        {tab === 'activities' && <Activities />}
        {tab === 'dashboard' && <DashTab />}
        {tab === 'feeds' && <Feeds />}
        {tab === 'calendar' && <CalendarTab />}
        {tab === 'profile' && <ProfileDetails />}
      </>)}
    </div>
  );
}
