import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.js';
import { PersonCalendar } from '../calendar.jsx';
import { Avatar, Badge, Modal, Spinner, Tabs, useAsync } from '../ui.jsx';
import { fmtTime } from '../util.js';
import OrgChart from './OrgChart.jsx';

const STATES = {
  in: ['In office', 'var(--ok)'], wfh: ['Home', 'var(--info)'], out: ['Checked out', 'var(--muted)'],
  leave: ['On leave', 'var(--violet)'], off: ['Day off', 'var(--orange)'], not_in: ['Not in yet', 'var(--bad)'],
};

// Who is in, at home or on leave today: a plain list like Zoho's Team space
export function TeamList() {
  const { user } = useAuth();
  const { data } = useAsync(() => api('/team'), []);
  const [flt, setFlt] = useState('all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  const [cal, setCal] = useState(null);
  const [view, setView] = useState('list');

  if (!data) return <Spinner />;
  const count = (k) => data.filter((p) => k === 'all' || p.state === k).length;
  const shown = data.filter((p) => (flt === 'all' || p.state === flt) && (!q || (p.name + p.emp_code + (p.department || '')).toLowerCase().includes(q.toLowerCase())));

  return (
    <div className="stack">
      <Tabs items={[['list', 'Directory'], ['org', 'Org chart']]} value={view} onChange={setView} />
      {view === 'org' ? <OrgChart /> : (<>
      <input type="search" placeholder="Search name or department" aria-label="Search team" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips">
        {[['all', 'All'], ['in', 'In office'], ['wfh', 'WFH'], ['leave', 'On leave'], ['not_in', 'Not in yet']]
          .map(([k, l]) => <button key={k} className={'chip ' + (flt === k ? 'on' : '')} onClick={() => setFlt(k)}>{l} <b>{count(k)}</b></button>)}
      </div>

      <div className="plist">
        {shown.map((p) => {
          const [label, color] = STATES[p.state] || ['', 'var(--muted)'];
          return (
            <button key={p.id} className="prow" onClick={() => setSel(p)}>
              <Avatar name={p.name} />
              <div style={{ minWidth: 0 }}>
                <b>{p.name}{p.you && <span className="muted"> (you)</span>}</b>
                <small>{p.designation || p.department || p.role}{p.manager_id === user.id ? ' · reports to you' : ''}</small>
              </div>
              <div className="end"><Badge color={color}>{label}</Badge>{p.since && p.state !== 'out' ? <small>{fmtTime(p.since)}</small> : null}</div>
            </button>
          );
        })}
        {shown.length === 0 && <div className="empty">Nobody matches.</div>}
      </div>
      </>)}

      {sel && (
        <Modal title={sel.name} onClose={() => setSel(null)}>
          <div className="row" style={{ marginBottom: 8 }}><Avatar name={sel.name} /><div><b>{sel.emp_code}</b><div className="small muted" style={{ textTransform: 'capitalize' }}>{sel.role}</div></div><span className="right"><Badge color={(STATES[sel.state] || [])[1]}>{(STATES[sel.state] || [])[0]}</Badge></span></div>
          {[['Department', sel.department || '—'], ['Email', sel.email ? <a href={`mailto:${sel.email}`}>{sel.email}</a> : '—'], ['Phone', sel.phone ? <a href={`tel:${sel.phone}`}>{sel.phone}</a> : '—'], ['Reports to', sel.manager || '—'], ['Shift', sel.shift || '—']]
            .map(([k, v]) => <div key={k} className="kv"><span>{k}</span><span style={{ fontWeight: 500 }}>{v}</span></div>)}
          {sel.manager_id === user.id && <button className="btn primary" style={{ marginTop: 14 }} onClick={() => { setCal(sel); setSel(null); }}>View attendance calendar</button>}
        </Modal>
      )}
      {cal && <Modal title={`${cal.name} · ${cal.emp_code}`} wide onClose={() => setCal(null)}><PersonCalendar userId={cal.id} stack /></Modal>}
    </div>
  );
}

export default function Team() {
  return <TeamList />;
}
