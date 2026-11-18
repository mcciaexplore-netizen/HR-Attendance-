import { api } from '../api.js';
import { Avatar, Badge, Spinner, useAsync } from '../ui.jsx';
import { roleLabel } from '../util.js';

const ROLE_COLOR = { hr: 'var(--violet)', approver: 'var(--brand)', consultant: 'var(--teal)', intern: 'var(--muted)' };

function Node({ p, kids }) {
  const list = kids.get(p.id) || [];
  const row = (
    <div className={'org-n' + (p.you ? ' you' : '')}>
      <Avatar name={p.name} />
      <div style={{ minWidth: 0 }}>
        <b>{p.name}{p.you && <span className="muted"> (you)</span>}</b>
        <small>{p.designation || p.department || roleLabel(p.role)}</small>
      </div>
      <span className="right row" style={{ gap: 8 }}>
        {list.length > 0 && <span className="small muted">{list.length} report{list.length === 1 ? '' : 's'}</span>}
        <Badge color={ROLE_COLOR[p.role]}>{roleLabel(p.role)}</Badge>
      </span>
    </div>
  );
  if (!list.length) return <div className="org">{row}</div>;
  return (
    <details open className="org">
      <summary>{row}</summary>
      <div className="org-kids">{list.map((c) => <Node key={c.id} p={c} kids={kids} />)}</div>
    </details>
  );
}

// Reporting lines. A request goes to the person's reporting manager; with no manager, HR approves.
export default function OrgChart() {
  const { data } = useAsync(() => api('/org'), []);
  if (!data) return <Spinner />;
  const ids = new Set(data.map((p) => p.id));
  const kids = new Map();
  const roots = [];
  for (const p of data) {
    if (p.parent_id && ids.has(p.parent_id)) kids.set(p.parent_id, [...(kids.get(p.parent_id) || []), p]);
    else roots.push(p);
  }
  return (
    <div className="stack">
      <p className="muted small" style={{ margin: 0 }}>Leave, WFH, comp-off, corrections and timesheets go to a person's reporting manager. With no manager, HR approves.</p>
      <section className="card">{roots.map((p) => <Node key={p.id} p={p} kids={kids} />)}</section>
    </div>
  );
}
