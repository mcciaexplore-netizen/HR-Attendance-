import { useState } from 'react';
import { api } from '../api.js';
import { Avatar, Icon, Modal, Spinner, refreshAll, useAsync, useToast } from '../ui.jsx';
import { fmtDate, relDay } from '../util.js';

const TEMPLATES = {
  birthday: ['Happy Birthday! 🎂 Wishing you a wonderful year ahead.', 'Many happy returns of the day! 🎉', 'Have a great birthday and a fantastic year!'],
  anniversary: ['Congratulations on your work anniversary! 🎉 Thank you for all you do.', 'Happy work anniversary! Here is to many more years together.'],
  welcome: ['Welcome to MCCIA! 👋 Glad to have you on board.', 'Welcome aboard! Let us know if you need anything.'],
};
const ACTION = { birthday: 'Send wishes', anniversary: 'Congratulate', welcome: 'Welcome' };
const sub = (p) => p.designation || p.department || '';

function WishModal({ person, kind, onClose, onDone }) {
  const toast = useToast();
  const [msg, setMsg] = useState(TEMPLATES[kind][0]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await api('/wishes', { method: 'POST', body: { to_id: person.id, kind, message: msg } }); toast(`Sent to ${person.name.split(' ')[0]}`); onDone(); }
    catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <Modal title={`${ACTION[kind]}: ${person.name}`} onClose={onClose}>
      <form className="stack" onSubmit={send}>
        <div className="chips">{TEMPLATES[kind].map((t) => <button type="button" key={t} className={'chip ' + (msg === t ? 'on' : '')} onClick={() => setMsg(t)}>{t.length > 28 ? t.slice(0, 26) + '…' : t}</button>)}</div>
        <div className="field"><label>Your message</label><textarea value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={300} /></div>
        {err && <div className="err" role="alert">{err}</div>}
        <button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
      </form>
    </Modal>
  );
}

// A person with a button to wish them (only on the day itself)
function Celebrant({ p, kind, today, onWish, note }) {
  return (
    <div className="dash-row">
      <Avatar name={p.name} />
      <div style={{ minWidth: 0 }}>
        <b style={{ margin: 0 }}>{p.name}{p.you && <span className="muted"> (you)</span>}</b>
        <div className="small muted">{[sub(p), note].filter(Boolean).join(' · ')}</div>
      </div>
      <span className="right">
        {today && !p.you && (p.wished ? <span className="small muted">Wished ✓</span> : <button className="btn sm primary" onClick={() => onWish(p, kind)}>{ACTION[kind]}</button>)}
        {!today && <span className="small muted">{relDay(p.date)}</span>}
      </span>
    </div>
  );
}

function Section({ title, children, count }) {
  return <section className="card"><div className="card-h"><h2>{title}</h2>{count > 0 && <span className="small muted right">{count}</span>}</div>{children}</section>;
}

// Birthdays, work anniversaries, new joiners and announcements, like the Feeds tab of Zoho People
export function Feeds() {
  const { data } = useAsync(() => api('/feeds'), []);
  const [wish, setWish] = useState(null);
  if (!data) return <Spinner />;
  const { birthdays: b, anniversaries: a, joiners, announcements, wishes } = data;
  const myBirthday = b.today.find((p) => p.you), myAnniv = a.today.find((p) => p.you);
  const others = { b: b.today.filter((p) => !p.you), a: a.today.filter((p) => !p.you), j: joiners.filter((p) => !p.you) };
  const anything = b.today.length || a.today.length || joiners.length || announcements.length || b.upcoming.length || a.upcoming.length;

  return (
    <div className="stack">
      {(myBirthday || myAnniv) && (
        <section className="card hero">
          <div className="hero-t">{myBirthday ? '🎂 Happy Birthday!' : `🎉 Happy work anniversary! ${myAnniv.years} year${myAnniv.years === 1 ? '' : 's'} at MCCIA`}</div>
          <div className="muted">{wishes.length ? `${wishes.length} wish${wishes.length === 1 ? '' : 'es'} so far.` : 'Your colleagues can send you wishes from here today.'}</div>
          {wishes.map((w) => <div key={w.id} className="wish"><b>{w.from_name}</b>{w.message ? ` — ${w.message}` : ''}</div>)}
        </section>
      )}

      {others.b.length > 0 && <Section title="Birthdays today">{others.b.map((p) => <Celebrant key={p.id} p={p} kind="birthday" today onWish={(x, k) => setWish({ p: x, kind: k })} />)}</Section>}
      {others.a.length > 0 && <Section title="Work anniversaries today">{others.a.map((p) => <Celebrant key={p.id} p={p} kind="anniversary" today note={`${p.years} year${p.years === 1 ? '' : 's'}`} onWish={(x, k) => setWish({ p: x, kind: k })} />)}</Section>}
      {others.j.length > 0 && <Section title="New joiners">{others.j.map((p) => <Celebrant key={p.id} p={p} kind="welcome" today note={`joined ${fmtDate(p.date, { day: 'numeric', month: 'short' })}`} onWish={(x, k) => setWish({ p: x, kind: k })} />)}</Section>}

      {announcements.length > 0 && (
        <Section title="Announcements">
          {announcements.slice(0, 5).map((x) => (
            <div key={x.id} className="dash-row" style={{ alignItems: 'flex-start' }}><Icon n="mega" size={18} /><div><b style={{ margin: 0 }}>{x.title}</b>{x.body && <div className="small muted">{x.body}</div>}<div className="small muted">{fmtDate(x.created_at.slice(0, 10), { day: 'numeric', month: 'short' })}</div></div></div>
          ))}
        </Section>
      )}

      {b.upcoming.length > 0 && <Section title="Upcoming birthdays">{b.upcoming.map((p) => <Celebrant key={p.id} p={p} kind="birthday" note={fmtDate(p.date, { day: 'numeric', month: 'short' })} />)}</Section>}
      {a.upcoming.length > 0 && <Section title="Upcoming work anniversaries">{a.upcoming.map((p) => <Celebrant key={p.id} p={p} kind="anniversary" note={`${p.years} year${p.years === 1 ? '' : 's'} · ${fmtDate(p.date, { day: 'numeric', month: 'short' })}`} />)}</Section>}
      {!anything && <div className="card empty">Nothing here yet.</div>}

      {wish && <WishModal person={wish.p} kind={wish.kind} onClose={() => setWish(null)} onDone={() => { setWish(null); refreshAll(); }} />}
    </div>
  );
}

export default function FeedsPage() {
  return <Feeds />;
}
