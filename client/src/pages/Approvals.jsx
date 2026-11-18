import { useState } from 'react';
import { api } from '../api.js';
import { RemarkModal, openAttachment } from '../components.jsx';
import { TimesheetModal, weekLabel } from '../timesheet.jsx';
import { Avatar, Badge, Spinner, Tabs, refreshAll, useAsync, useToast } from '../ui.jsx';
import { fmtDate, fmtDur } from '../util.js';

const COLOR = { pending: 'var(--warn)', approved: 'var(--ok)', rejected: 'var(--bad)', cancelled: 'var(--muted)' };
const D = { day: 'numeric', month: 'short', year: 'numeric' };

function Row({ who, code, children, status, actions, remark }) {
  return (
    <div className="ap">
      <Avatar name={who} />
      <div style={{ flex: 1, minWidth: 200 }}>
        <b style={{ fontWeight: 600 }}>{who}</b> <span className="muted small">{code}</span>
        {children}
        {remark && <div className="small muted">Remark: {remark}</div>}
      </div>
      {status && status !== 'pending' ? <Badge color={COLOR[status]}>{status}</Badge> : actions}
    </div>
  );
}

// Everything waiting for you: HR sees all requests, a reporting manager sees their team's.
export default function Approvals() {
  const toast = useToast();
  const [hist, setHist] = useState(false);
  const [tab, setTab] = useState('leaves');
  const [ask, setAsk] = useState(null);
  const [sheet, setSheet] = useState(null);
  const { data } = useAsync(() => api('/approvals' + (hist ? '?status=all' : '')), [hist]);

  if (!data) return <Spinner />;
  const pend = (a) => a.filter((x) => x.status === 'pending').length;
  const decide = (title, url, approve) => setAsk({ title, url, approve });
  const buttons = (title, url) => (
    <div className="row"><button className="btn sm primary" onClick={() => decide(title, url, true)}>Approve</button><button className="btn sm danger" onClick={() => decide(title, url, false)}>Reject</button></div>
  );
  const lists = { leaves: data.leaves, compoff: data.compoff, regs: data.regs, sheets: data.timesheets };
  const empty = <div className="card empty">Nothing here{hist ? '' : ' waiting'} 🎉</div>;

  return (
    <div className="stack">
      <div className="chips"><button className={'chip ' + (!hist ? 'on' : '')} onClick={() => setHist(false)}>Pending</button><button className={'chip ' + (hist ? 'on' : '')} onClick={() => setHist(true)}>History</button></div>
      <Tabs value={tab} onChange={setTab} items={[['leaves', 'Leave & WFH', pend(data.leaves)], ['compoff', 'Comp-off', pend(data.compoff)], ['regs', 'Corrections', pend(data.regs)], ['sheets', 'Timesheets', pend(data.timesheets)]]} />

      {lists[tab].length === 0 ? empty : (
        <section className="card flush">
          {tab === 'leaves' && data.leaves.map((l) => (
            <Row key={l.id} who={l.user_name} code={l.emp_code} status={l.status} remark={l.remark} actions={buttons(`${l.type_name}: ${l.user_name}`, `/leaves/${l.id}/decision`)}>
              <div className="small"><Badge color={l.is_wfh ? 'var(--info)' : l.color || 'var(--violet)'}>{l.type_name}</Badge> {fmtDate(l.from_date, D)}{l.to_date !== l.from_date && ` – ${fmtDate(l.to_date, D)}`} · {l.days} day{l.days === 1 ? '' : 's'}{l.half ? ` (${l.session === 'second' ? 'second' : 'first'} half)` : ''}</div>
              <div className="small muted">“{l.reason}”{l.has_attachment ? <> · <a href="#doc" onClick={(e) => { e.preventDefault(); openAttachment(l.id).catch((x) => toast({ title: x.message, bad: true })); }}>📎 {l.attachment_name || 'document'}</a></> : null}</div>
            </Row>
          ))}
          {tab === 'compoff' && data.compoff.map((c) => (
            <Row key={c.id} who={c.user_name} code={c.emp_code} status={c.status} remark={c.remark} actions={buttons(`Comp-off: ${c.user_name}`, `/compoff/${c.id}/decision`)}>
              <div className="small">Worked on <b>{fmtDate(c.worked_date, D)}</b> · claims {c.days} day{c.days === 1 ? '' : 's'}{c.expires_on ? ` · valid until ${fmtDate(c.expires_on, D)}` : ''}</div>
              {c.reason && <div className="small muted">“{c.reason}”</div>}
            </Row>
          ))}
          {tab === 'regs' && data.regs.map((g) => (
            <Row key={g.id} who={g.user_name} code={g.emp_code} status={g.status} remark={g.remark} actions={buttons(`Correction: ${g.user_name}`, `/regularizations/${g.id}/decision`)}>
              <div className="small"><b>{fmtDate(g.date, D)}</b> · In {g.check_in}{g.check_out ? ` · Out ${g.check_out}` : ''}</div>
              <div className="small muted">“{g.reason}”</div>
            </Row>
          ))}
          {tab === 'sheets' && data.timesheets.map((t) => (
            <Row key={t.id} who={t.user_name} code={t.emp_code} status={t.status} remark={t.remark} actions={<button className="btn sm primary" onClick={() => setSheet(t)}>Review</button>}>
              <div className="small">Week of <b>{weekLabel(t.week_start)}</b> · {fmtDur(t.minutes)}</div>
              {t.status !== 'pending' && <div className="small"><button className="btn sm ghost" style={{ padding: 0 }} onClick={() => setSheet(t)}>View logs</button></div>}
            </Row>
          ))}
        </section>
      )}

      {ask && (
        <RemarkModal title={ask.title} approve={ask.approve} onClose={() => setAsk(null)}
          onSubmit={async (remark) => { await api(ask.url, { method: 'POST', body: { approve: ask.approve, remark } }); toast(ask.approve ? 'Approved' : 'Rejected'); setAsk(null); refreshAll(); }} />
      )}
      {sheet && <TimesheetModal item={sheet} canDecide onClose={() => setSheet(null)} onDone={() => { setSheet(null); refreshAll(); }} />}
    </div>
  );
}
