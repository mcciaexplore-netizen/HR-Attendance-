import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useActions, useAuth } from '../auth.js';
import { TeamCalendar } from '../calendar.jsx';
import { openAttachment } from '../components.jsx';
import { Badge, Modal, Pills, Spinner, Tabs, useAsync, useToast } from '../ui.jsx';
import { fmtDate, todayIst } from '../util.js';
import Holidays from './Holidays.jsx';

const STATE = { pending: 'var(--warn)', approved: 'var(--ok)', rejected: 'var(--bad)', cancelled: 'var(--muted)' };
const D = { day: 'numeric', month: 'short', year: 'numeric' };

function YearNav({ year, onChange }) {
  return (
    <div className="range">
      <button className="btn sm" onClick={() => onChange(year - 1)} aria-label="Previous year">‹</button>
      <span>01-01-{year} to 31-12-{year}</span>
      <button className="btn sm" onClick={() => onChange(year + 1)} aria-label="Next year">›</button>
    </div>
  );
}

function RequestCard({ l, onCancel }) {
  const toast = useToast();
  const { user } = useAuth();
  const cc = l.cc ? l.cc.split(',').length : 0;
  return (
    <div className="rq" style={{ '--c': STATE[l.status] }}>
      <div className="row"><b><i className="dot" style={{ '--c': l.color, marginRight: 7 }} />{l.type_name}</b><span className="st right">{l.status}</span></div>
      <div className="small muted">{fmtDate(l.from_date, D)}{l.to_date !== l.from_date && ` – ${fmtDate(l.to_date, D)}`} · {l.days} day{l.days === 1 ? '' : 's'}{l.half ? ` (${l.session === 'second' ? 'second' : 'first'} half)` : ''}</div>
      {l.reason && <div className="small">“{l.reason}”</div>}
      <div className="small muted">
        {l.has_attachment ? <a href="#doc" onClick={(e) => { e.preventDefault(); openAttachment(l.id).catch((x) => toast({ title: x.message, bad: true })); }}>📎 {l.attachment_name || 'Document'}</a> : null}
        {cc > 0 ? <span>{l.has_attachment ? ' · ' : ''}{cc} colleague{cc === 1 ? '' : 's'} notified</span> : null}
      </div>
      {l.status === 'pending' && <div className="small muted">Waiting for {user.manager || 'HR'}</div>}
      {l.decided_by_name && <div className="small muted">{l.status === 'cancelled' ? 'Cancelled' : l.status === 'approved' ? 'Approved' : 'Rejected'} by {l.decided_by_name}{l.remark ? ` — ${l.remark}` : ''}</div>}
      {['pending', 'approved'].includes(l.status) && l.to_date >= todayIst() && onCancel && <button className="btn sm danger" style={{ alignSelf: 'flex-start', marginTop: 8 }} onClick={() => onCancel(l.id)}>Cancel request</button>}
    </div>
  );
}

function MyData({ tick, refresh, onApply }) {
  const toast = useToast();
  const [year, setYear] = useState(+todayIst().slice(0, 4));
  const [tab, setTab] = useState('summary');
  const [flt, setFlt] = useState('all');
  const bal = useAsync(() => api('/leaves/balance?year=' + year), [year, tick]);
  const reqs = useAsync(() => api('/leaves?year=' + year), [year, tick]);
  const comp = useAsync(() => api('/compoff'), [tick]);
  const elig = useAsync(() => api('/compoff/eligible'), [tick]);
  const cancel = (id) => api(`/leaves/${id}/cancel`, { method: 'POST' }).then(() => { toast('Request cancelled'); refresh(); }).catch((x) => toast({ title: x.message, bad: true }));
  const cancelComp = (id) => api(`/compoff/${id}/cancel`, { method: 'POST' }).then(() => { toast('Request cancelled'); refresh(); }).catch((x) => toast({ title: x.message, bad: true }));

  const list = (reqs.data || []).filter((l) => flt === 'all' || l.status === flt);
  const pendingCount = (reqs.data || []).filter((l) => l.status === 'pending').length;

  return (
    <>
      <Tabs items={[['summary', 'Leave Summary'], ['requests', 'Leave Requests', pendingCount], ['comp', 'Comp-off', (elig.data?.items || []).length]]} value={tab} onChange={setTab} />
      {tab !== 'comp' && <YearNav year={year} onChange={setYear} />}

      {tab === 'summary' && (!bal.data ? <Spinner /> : (<>
        <div className="bals">
          {bal.data.map((b) => (
            <div key={b.id} className="bcard" style={{ '--c': b.color || 'var(--info)' }}>
              <div className="bc-h"><i />{b.name}</div>
              <div className="bc-n">
                <div><b>{b.unlimited ? '—' : b.balance}</b><span>Balance</span></div>
                <div><b>{b.booked}</b><span>Booked</span></div>
                {b.pending > 0 && <div><b>{b.pending}</b><span>Pending</span></div>}
              </div>
              <div className="bc-f">
                {b.is_compoff ? (b.expiring ? `Earliest expiry ${fmtDate(b.expiring, { day: 'numeric', month: 'short' })}` : 'Earned by working on holidays')
                  : b.is_wfh ? 'No limit' : b.unlimited ? 'No yearly limit'
                    : `${b.available} available${b.carried ? ` (incl. ${b.carried} carried)` : ''}${b.adjusted ? ` · ${b.adjusted > 0 ? '+' : ''}${b.adjusted} adjusted` : ''}`}
              </div>
            </div>
          ))}
        </div>
      </>))}

      {tab === 'requests' && (<>
        <div className="chips">{['all', 'pending', 'approved', 'rejected', 'cancelled'].map((f) => <button key={f} className={'chip ' + (flt === f ? 'on' : '')} onClick={() => setFlt(f)} style={{ textTransform: 'capitalize' }}>{f}</button>)}</div>
        {!reqs.data ? <Spinner /> : list.length === 0 ? <div className="card empty">No requests here.</div> : <div className="grid g2">{list.map((l) => <RequestCard key={l.id} l={l} onCancel={cancel} />)}</div>}
      </>)}

      {tab === 'comp' && (!comp.data ? <Spinner /> : (<>
        <div className="grid g2">
          <div className="bcard" style={{ '--c': 'var(--green)' }}>
            <div className="bc-h"><i />Comp-off balance</div>
            <div className="bc-n"><div><b>{comp.data.balance.balance}</b><span>Available</span></div><div><b>{comp.data.balance.granted}</b><span>Earned</span></div></div>
            <div className="bc-f">{comp.data.balance.expiring ? `Earliest expiry ${fmtDate(comp.data.balance.expiring, D)}` : 'Use it when you apply for leave: choose Comp-off'}</div>
          </div>
          <div className="card">
            <div className="card-h"><h2>Claim a day you worked</h2></div>
            {!elig.data ? <Spinner /> : elig.data.items.length === 0
              ? <div className="muted small">Nothing to claim. Comp-off is for holidays or weekly offs that you worked (checked in and out) in the last {elig.data.window} days.</div>
              : <><div className="small muted" style={{ marginBottom: 8 }}>{elig.data.items.length} day(s) eligible:</div>{elig.data.items.map((i) => <div key={i.date} className="kv"><span>{fmtDate(i.date, { weekday: 'short', day: 'numeric', month: 'short' })}{i.holiday ? ` · ${i.holiday}` : ''}</span><span>up to {i.max_days} day</span></div>)}</>}
            <button className="btn primary" style={{ marginTop: 12 }} onClick={() => onApply({ kind: 'comp' })} disabled={!elig.data?.items.length}>Request comp-off</button>
          </div>
        </div>
        <h2>Comp-off requests</h2>
        {comp.data.items.length === 0 ? <div className="card empty">No comp-off requests yet.</div> : (
          <section className="card flush scroll-x"><table className="table">
            <thead><tr><th>Day worked</th><th>Days</th><th>Status</th><th>Valid until</th><th>Remark</th><th /></tr></thead>
            <tbody>{comp.data.items.map((c) => (
              <tr key={c.id}>
                <td className="nowrap">{fmtDate(c.worked_date, D)}</td><td>{c.days}</td><td><Badge color={STATE[c.status]}>{c.status}</Badge></td>
                <td className="nowrap">{c.expires_on ? fmtDate(c.expires_on, D) : '—'}</td><td className="small muted">{c.remark || (c.decided_by_name ? `by ${c.decided_by_name}` : '')}</td>
                <td>{c.status === 'pending' && <button className="btn sm danger" onClick={() => cancelComp(c.id)}>Cancel</button>}</td>
              </tr>
            ))}</tbody>
          </table></section>
        )}
      </>))}
    </>
  );
}

// HR: balances per person with adjustments
function Balances({ tick, refresh }) {
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const uid = sp.get('user') || '';
  const [year, setYear] = useState(+todayIst().slice(0, 4));
  const [adj, setAdj] = useState(null);
  const people = useAsync(() => api('/users').then((u) => u.filter((p) => p.role !== 'hr')), []);
  const bal = useAsync(() => (uid ? api(`/leaves/balance?user_id=${uid}&year=${year}`) : Promise.resolve(null)), [uid, year, tick]);
  const hist = useAsync(() => (uid ? api(`/leave-adjust?user_id=${uid}&year=${year}`) : Promise.resolve([])), [uid, year, tick]);

  const save = async (e) => {
    e.preventDefault();
    try {
      await api('/leave-adjust', { method: 'POST', body: { user_id: +uid, type_id: adj.type.id, year, days: +adj.days, remark: adj.remark } });
      toast('Balance adjusted'); setAdj(null); refresh();
    } catch (x) { setAdj({ ...adj, err: x.message }); }
  };

  return (
    <>
      <div className="row wrap">
        <select value={uid} onChange={(e) => setSp(e.target.value ? { view: 'balances', user: e.target.value } : { view: 'balances' }, { replace: true })} style={{ width: 260 }}>
          <option value="">Select person…</option>
          {(people.data || []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.emp_code})</option>)}
        </select>
        <YearNav year={year} onChange={setYear} />
      </div>
      {!uid ? <div className="card empty">Choose a person to see and adjust their leave balances.</div> : !bal.data ? <Spinner /> : (<>
        <section className="card flush scroll-x">
          <table className="table">
            <thead><tr><th>Leave type</th><th>Entitled</th><th>Carried</th><th>Adjusted</th><th>Booked</th><th>Pending</th><th>Balance</th><th /></tr></thead>
            <tbody>{bal.data.map((b) => (
              <tr key={b.id}>
                <td><b style={{ fontWeight: 600 }}><i className="dot" style={{ '--c': b.color, marginRight: 8 }} />{b.name}</b></td>
                <td>{b.unlimited ? '—' : b.is_compoff ? b.granted : b.accrued}</td><td>{b.carried ?? '—'}</td><td>{b.adjusted ?? '—'}</td>
                <td>{b.booked}</td><td>{b.pending}</td><td><b>{b.unlimited ? '—' : b.balance}</b></td>
                <td>{!b.unlimited && !b.is_compoff && <button className="btn sm" onClick={() => setAdj({ type: b, days: '', remark: '' })}>Adjust</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
        <h2>Adjustment history</h2>
        {!hist.data || hist.data.length === 0 ? <div className="card empty">No adjustments in {year}.</div> : (
          <section className="card">{hist.data.map((h) => <div key={h.id} className="kv"><span>{fmtDate(h.created_at.slice(0, 10), D)} · {h.type_name}<br /><span className="small">{h.remark} — {h.by_name}</span></span><b style={{ color: h.days > 0 ? 'var(--ok)' : 'var(--bad)' }}>{h.days > 0 ? '+' : ''}{h.days}</b></div>)}</section>
        )}
      </>)}
      {adj && (
        <Modal title={`Adjust ${adj.type.name}`} onClose={() => setAdj(null)}>
          <form className="stack" onSubmit={save}>
            <p className="muted small" style={{ margin: 0 }}>Add days (for example 2) or deduct days (for example -1) for {year}. The employee is notified.</p>
            <div className="field"><label>Days</label><input type="number" step="0.5" value={adj.days} onChange={(e) => setAdj({ ...adj, days: e.target.value })} required autoFocus /></div>
            <div className="field"><label>Remark</label><input value={adj.remark} onChange={(e) => setAdj({ ...adj, remark: e.target.value })} required /></div>
            {adj.err && <div className="err">{adj.err}</div>}
            <button className="btn primary">Save adjustment</button>
          </form>
        </Modal>
      )}
    </>
  );
}

export default function Leave() {
  const { user } = useAuth();
  const { open } = useActions();
  const hr = user.role === 'hr';
  const [sp, setSp] = useSearchParams();
  const view = sp.get('view') || (hr ? 'balances' : 'data');
  const [tick, setTick] = useState(0);
  const refresh = () => setTick((t) => t + 1);
  const go = (v) => setSp(v === (hr ? 'balances' : 'data') ? {} : { view: v });
  const apply = (m) => open(m.kind, { typeCode: m.typeCode, date: m.date });

  return (
    <div className="stack">
      <Pills items={hr ? [['balances', 'Balances'], ['holidays', 'Holidays'], ['team', 'Team Calendar']] : [['data', 'My Data'], ['holidays', 'Holidays'], ['team', 'Team Calendar']]} value={view} onChange={go} />

      {view === 'data' && !hr && <MyData tick={tick} refresh={refresh} onApply={apply} />}
      {view === 'balances' && hr && <Balances tick={tick} refresh={refresh} />}
      {view === 'holidays' && <Holidays onApplyOptional={hr ? undefined : (date) => apply({ kind: 'leave', date, typeCode: 'OH' })} />}
      {view === 'team' && <TeamCalendar />}
    </div>
  );
}
