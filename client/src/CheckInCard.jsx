import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { useActions } from './auth.js';
import { Icon, Spinner, useTick, useToast } from './ui.jsx';
import { distanceM, fmtDur, fmtTime, getPosition } from './util.js';

const pad = (n) => String(n).padStart(2, '0');
const parts = (s) => [pad(Math.floor(s / 3600)), pad(Math.floor((s % 3600) / 60)), pad(Math.floor(s % 60))];
export const to12 = (hhmm = '') => { const [h, m] = hhmm.split(':').map(Number); return Number.isNaN(h) ? '' : `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`; };

// Zoho-People-style check-in card: hours worked today as HH : MM : SS and one Check-In / Check-Out button.
export default function CheckInCard({ onLoaded, onChanged }) {
  const toast = useToast();
  const { open } = useActions();
  const gt = useTick();
  const [d, setD] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [wfh, setWfh] = useState(false);
  const [note, setNote] = useState('');
  const [pos, setPos] = useState({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(() => api('/today').then((t) => { setD(t); onLoaded?.(t); }), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load().catch(() => {}); }, [load, gt]);
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(h); }, []);
  useEffect(() => { if (d?.wfhApproved && !d.record) setWfh(true); }, [d?.wfhApproved, d?.record]);

  const rec = d?.record;
  const fullLeave = !!(d?.leave && !d.leave.half);
  const extraDay = !!(d && (d.holiday || !d.workingDay)); // holiday or weekly off
  const noWork = !rec && (extraDay || fullLeave);          // nothing is expected today
  const atHome = rec ? rec.in_mode === 'wfh' : wfh && !extraDay;

  const locate = useCallback(async () => {
    setPos({ state: 'loading' });
    try { setPos({ state: 'ok', ...(await getPosition()) }); } catch (e) { setPos({ state: 'error', message: e.message }); }
  }, []);
  useEffect(() => {
    if (d && !atHome && !(rec && rec.check_out) && !fullLeave) locate();
  }, [d?.date, atHome]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!d) return <section className="ci"><Spinner /></section>;

  const dist = pos.state === 'ok' ? distanceM(pos.lat, pos.lng, d.office.lat, d.office.lng) : null;
  const inside = dist !== null && dist - Math.min(pos.accuracy || 0, 100) <= d.office.radius;
  const action = !rec ? 'in' : !rec.check_out ? 'out' : 'done';
  const canPunch = action !== 'done' && !fullLeave;
  const sec = rec?.check_in ? Math.max(0, ((rec.check_out ? new Date(rec.check_out).getTime() : now) - new Date(rec.check_in).getTime()) / 1000) : 0;
  const blocked = busy || (!atHome && (pos.state === 'loading' || (pos.state === 'ok' && !inside))) || (atHome && !note.trim());
  const place = atHome ? 'Working from home' : d.office.name;
  const [hh, mm, ss] = parts(sec);

  // "In" / "Out" status like Zoho
  let tag, tagCls = '', text;
  if (noWork) {
    tag = fullLeave ? 'On leave' : d.holiday ? 'Holiday' : 'Weekly off'; tagCls = 'off';
    text = fullLeave ? d.leave.type : d.holiday ? d.holiday : 'No check-in needed';
  } else if (action === 'in') {
    tag = 'Not checked in'; tagCls = 'off'; text = `Shift ${to12(d.shift.start)} – ${to12(d.shift.end)}`;
  } else if (action === 'out') {
    tag = 'In'; text = `since ${fmtTime(rec.check_in)}${rec.late && !extraDay ? ' (late)' : ''} · ${place}`;
  } else {
    tag = 'Out'; tagCls = 'done'; text = `${fmtTime(rec.check_in)} – ${fmtTime(rec.check_out)} · ${fmtDur(sec / 60)} worked`;
  }

  const punch = async () => {
    setBusy(true); setErr('');
    try {
      let body = { action, mode: atHome ? 'wfh' : 'office', note, extra: action === 'in' && extraDay };
      try {
        const p = await getPosition();
        setPos({ state: 'ok', ...p });
        body = { ...body, lat: p.lat, lng: p.lng, accuracy: p.accuracy };
      } catch (e) { if (!atHome) throw e; }
      const r = await api('/punch', { method: 'POST', body });
      toast({ title: r.action === 'in' ? (r.extra ? 'Checked in (extra work)' : r.late ? 'Checked in (running late)' : 'Checked in') : 'Checked out', body: r.extra && r.action === 'out' ? 'You can now request comp-off for today.' : fmtTime(r.time) });
      setNote('');
      await load();
      onChanged?.();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const chooseWhere = canPunch && !extraDay && action === 'in' && d.wfhApproved;

  return (
    <section className="ci" aria-label="Check-in">
      <div className="ci-row">
        <div className="digits" role="timer" aria-label={`Worked today ${hh} hours ${mm} minutes ${ss} seconds`}><b>{hh}</b><i>:</i><b>{mm}</b><i>:</i><b>{ss}</b></div>
        {canPunch && (
          <button className={'ci-btn ' + (action === 'out' ? 'out' : noWork ? 'alt' : '')} onClick={punch} disabled={blocked}>
            {busy ? 'Please wait…' : action === 'in' ? (extraDay ? 'Check-In (extra work)' : 'Check-In') : 'Check-Out'}
          </button>
        )}
      </div>

      <div className="ci-status"><span className={'tag ' + tagCls}>{tag}</span><span>{text}</span></div>

      {(chooseWhere || (canPunch && atHome)) && (
        <div className="ci-more">
          {chooseWhere && (
            <div className="row wrap"><span className="muted">Working from</span>
              <div className="chips">
                <button className={'chip ' + (!wfh ? 'on' : '')} onClick={() => setWfh(false)}>Office</button>
                <button className={'chip ' + (wfh ? 'on' : '')} onClick={() => setWfh(true)}>Home</button>
              </div>
            </div>
          )}
          {atHome && <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={action === 'in' ? 'What will you work on today? (required)' : 'What did you complete today? (required)'} />}
        </div>
      )}

      {canPunch && !atHome && (
        <div className={'ci-geo ' + (pos.state === 'ok' ? (inside ? 'good' : 'bad') : '')}>
          <Icon n="pin" size={15} />
          <span>{pos.state === 'loading' ? 'Checking your location…' : pos.state === 'error' ? pos.message : pos.state === 'ok' ? (inside ? "You're at the MCCIA office" : `${dist} m away. Come within ${d.office.radius} m of the office.`) : 'Location not checked yet'}</span>
          <button onClick={locate}>Retry</button>
        </div>
      )}
      {noWork && !fullLeave && canPunch && <div className="ci-link muted">Working today? You can claim comp-off for it later.</div>}
      {d.summary?.missed > 0 && <div className="ci-link">You forgot to check out on {d.summary.missed} day{d.summary.missed === 1 ? '' : 's'} this month. <button className="link" onClick={() => open('fix')}>Regularize</button></div>}
      {err && <div className="ci-geo bad" role="alert">{err}</div>}
    </section>
  );
}
