import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.js';
import { Spinner, useAsync, useToast } from '../ui.jsx';
import { fmtDate, todayIst } from '../util.js';

const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const when = (date, today) => {
  const n = daysBetween(today, date);
  return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n > 1 ? `in ${n} days` : '';
};

export default function Holidays({ onApplyOptional }) {
  const { user } = useAuth();
  const toast = useToast();
  const [year, setYear] = useState(todayIst().slice(0, 4));
  const { data, reload } = useAsync(() => api('/holidays?year=' + year), [year]);
  const [f, setF] = useState({ date: '', name: '', optional: false });
  const today = todayIst();
  const hr = user.role === 'hr';

  const add = async (e) => {
    e.preventDefault();
    try { await api('/holidays', { method: 'POST', body: f }); setF({ date: '', name: '', optional: false }); reload(); toast('Holiday saved'); }
    catch (x) { toast({ title: x.message, bad: true }); }
  };

  const groups = [];
  for (const h of data || []) {
    const m = h.date.slice(0, 7);
    if (!groups.length || groups.at(-1).m !== m) groups.push({ m, items: [] });
    groups.at(-1).items.push(h);
  }

  return (
    <>
      <div className="row wrap">
        <div className="range"><button className="btn sm" onClick={() => setYear(String(+year - 1))} aria-label="Previous year">‹</button><span>{year}</span><button className="btn sm" onClick={() => setYear(String(+year + 1))} aria-label="Next year">›</button></div>
        <span className="small muted right"><b style={{ color: 'var(--crimson)' }}>★</b> Optional: your choice, up to your policy limit</span>
      </div>

      {hr && (
        <form className="card row wrap" onSubmit={add}>
          <div className="field" style={{ flex: '0 0 180px' }}><label>Date</label><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /></div>
          <div className="field" style={{ flex: 1, minWidth: 200 }}><label>Holiday name</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Diwali (Lakshmi Pujan)" required /></div>
          <label className="row small" style={{ alignSelf: 'flex-end', paddingBottom: 12 }}><input type="checkbox" checked={f.optional} onChange={(e) => setF({ ...f, optional: e.target.checked })} /> Optional</label>
          <button className="btn primary" style={{ alignSelf: 'flex-end' }}>Add holiday</button>
        </form>
      )}

      {!data ? <Spinner /> : data.length === 0 ? <div className="card empty">No holidays added for {year}.</div> : groups.map((g) => (
        <div key={g.m}>
          <div className="mh">{fmtDate(g.m + '-01', { month: 'long', year: 'numeric' })}</div>
          <div className="plist">
            {g.items.map((h) => (
              <div key={h.date} className={'hl ' + (h.date < today ? 'past' : '')}>
                <div className="d">{+h.date.slice(8)}<small>{fmtDate(h.date, { month: 'short' })}</small></div>
                <div><b>{h.optional ? <span style={{ color: 'var(--crimson)' }}>★ </span> : null}{h.name}</b><div className="small muted">{fmtDate(h.date, { weekday: 'long' })}{h.optional ? ' · optional' : ''}</div></div>
                <span className="when">{when(h.date, today)}</span>
                {h.optional && h.date >= today && onApplyOptional && <button className="btn sm" onClick={() => onApplyOptional(h.date)}>Take it</button>}
                {hr && <button className="btn sm danger" onClick={() => api('/holidays/' + h.date, { method: 'DELETE' }).then(reload)}>Remove</button>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
