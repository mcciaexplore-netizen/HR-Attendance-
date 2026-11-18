import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { PersonCalendar } from '../calendar.jsx';
import { Avatar, Badge, Icon, Modal, Spinner, useAsync, useToast } from '../ui.jsx';
import { fmtDate, fmtTime } from '../util.js';

const STATES = {
  not_in: ['Not in yet', 'var(--bad)'], in: ['In office', 'var(--ok)'], wfh: ['Home', 'var(--info)'],
  leave: ['On leave', 'var(--violet)'], out: ['Checked out', 'var(--muted)'], off: ['Day off', 'var(--orange)'],
};
const ORDER = Object.keys(STATES);

function sub(r) {
  if (r.state === 'not_in') return r.wfh_approved ? 'WFH approved' : r.department || r.role;
  if (r.state === 'in') return `In ${fmtTime(r.check_in)}${r.late ? ' · late' : ''}${r.extra ? ' · extra work' : ''}`;
  if (r.state === 'wfh') return `In ${fmtTime(r.check_in)}${r.late ? ' · late' : ''}`;
  if (r.state === 'off') return 'Weekly off / holiday';
  if (r.state === 'leave') return r.leave || 'On leave';
  return `${fmtTime(r.check_in)} – ${fmtTime(r.check_out)}`;
}

function Announce({ onClose }) {
  const toast = useToast();
  const ann = useAsync(() => api('/announcements'), []);
  const [a, setA] = useState({ title: '', body: '' });
  const post = async (e) => {
    e.preventDefault();
    await api('/announcements', { method: 'POST', body: a });
    setA({ title: '', body: '' }); ann.reload(); toast('Announcement posted');
  };
  return (
    <Modal title="Announcements" onClose={onClose}>
      <form className="stack" onSubmit={post}>
        <input placeholder="Title" value={a.title} onChange={(e) => setA({ ...a, title: e.target.value })} required />
        <textarea placeholder="Message (optional)" value={a.body} onChange={(e) => setA({ ...a, body: e.target.value })} />
        <button className="btn primary" style={{ alignSelf: 'flex-start' }}>Post to everyone</button>
      </form>
      <div style={{ marginTop: 16 }}>
        {(ann.data || []).slice(0, 5).map((x) => (
          <div key={x.id} className="kv"><div><b>{x.title}</b><div className="small muted">{x.body}</div></div>
            <button className="btn sm ghost danger" onClick={() => api('/announcements/' + x.id, { method: 'DELETE' }).then(ann.reload)}>Delete</button></div>
        ))}
      </div>
    </Modal>
  );
}

// HR "Today": who has checked in, as a plain list
export default function Dashboard() {
  const toast = useToast();
  const { data, reload } = useAsync(() => api('/board'), []);
  const [ann, setAnn] = useState(false);
  const [menu, setMenu] = useState(false);
  const [person, setPerson] = useState(null);
  const [flt, setFlt] = useState('all');

  useEffect(() => { const h = setInterval(reload, 20_000); return () => clearInterval(h); }, [reload]);
  useEffect(() => {
    if (!menu) return;
    const away = (e) => { if (!e.target.closest('.menu, .actbtn')) setMenu(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [menu]);
  if (!data) return <Spinner />;

  const rows = data.rows;
  const checkedIn = rows.filter((r) => r.check_in).length;
  const count = (k) => rows.filter((r) => k === 'all' || r.state === k).length;
  const shown = rows.filter((r) => flt === 'all' || r.state === flt).sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || a.name.localeCompare(b.name));
  const nudge = async (kind) => {
    setMenu(false);
    const r = await api('/board/nudge', { method: 'POST', body: { kind } });
    toast(r.sent ? `Reminder sent to ${r.sent} people` : 'Nobody needs a reminder right now');
  };

  return (
    <div className="stack">
      <div className="row">
        <div>
          <b style={{ fontSize: 17 }}>{checkedIn} of {rows.length} checked in</b>
          <div className="small muted">{fmtDate(data.date, { weekday: 'long', day: 'numeric', month: 'long' })}{data.holiday && ` · Holiday: ${data.holiday}`}{!data.working && !data.holiday && ' · Non-working day'}</div>
        </div>
        <div className="relative right">
          <button className="btn actbtn" onClick={() => setMenu(!menu)}>Actions <Icon n="chevDown" size={15} /></button>
          {menu && (
            <div className="menu sm">
              <button className="item" onClick={() => { setMenu(false); setAnn(true); }}>Post announcement</button>
              <button className="item" onClick={() => nudge('in')}>Remind to check in</button>
              <button className="item" onClick={() => nudge('out')}>Remind to check out</button>
            </div>
          )}
        </div>
      </div>

      <div className="chips">
        {[['all', 'All'], ...ORDER.map((k) => [k, STATES[k][0]])].filter(([k]) => k === 'all' || k === flt || count(k) > 0)
          .map(([k, l]) => <button key={k} className={'chip ' + (flt === k ? 'on' : '')} onClick={() => setFlt(k)}>{l} <b>{count(k)}</b></button>)}
      </div>

      <div className="plist">
        {shown.map((r) => (
          <button key={r.id} className="prow" onClick={() => setPerson(r)}>
            <Avatar name={r.name} />
            <div style={{ minWidth: 0 }}><b>{r.name}</b><small>{sub(r)}</small></div>
            <div className="end"><Badge color={STATES[r.state]?.[1]}>{STATES[r.state]?.[0]}</Badge></div>
          </button>
        ))}
        {shown.length === 0 && <div className="empty">Nobody here.</div>}
      </div>

      {ann && <Announce onClose={() => setAnn(false)} />}
      {person && (
        <Modal title={`${person.name} · ${person.emp_code}`} wide onClose={() => setPerson(null)}>
          <PersonCalendar userId={person.id} stack />
        </Modal>
      )}
    </div>
  );
}
