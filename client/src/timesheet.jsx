import { useState } from 'react';
import { api } from './api.js';
import { RemarkModal } from './components.jsx';
import { Badge, Modal, Spinner, useAsync, useToast } from './ui.jsx';
import { addDaysStr, fmtDate, fmtDur } from './util.js';

export const SHEET_STATE = { open: ['Not submitted', 'var(--muted)'], pending: ['Pending', 'var(--warn)'], approved: ['Approved', 'var(--ok)'], rejected: ['Rejected', 'var(--bad)'] };
export const weekLabel = (ws) => `${fmtDate(ws, { day: 'numeric', month: 'short' })} – ${fmtDate(addDaysStr(ws, 6), { day: 'numeric', month: 'short', year: 'numeric' })}`;

// Review one week of someone's time logs; approvers can approve / reject a pending timesheet.
export function TimesheetModal({ item, canDecide, onClose, onDone }) {
  const toast = useToast();
  const { data } = useAsync(() => api(`/timesheets/week?week_start=${item.week_start}&user_id=${item.user_id}`), []);
  const [ask, setAsk] = useState(null); // 'approve' | 'reject'
  const [label, color] = SHEET_STATE[data?.status || item.status] || SHEET_STATE.open;

  const byDay = {};
  for (const l of data?.logs || []) (byDay[l.date] ||= []).push(l);
  const byProject = {};
  for (const l of data?.logs || []) byProject[l.project_name] = (byProject[l.project_name] || 0) + l.minutes;

  return (
    <Modal title={`${item.user_name ? item.user_name + ' · ' : ''}${weekLabel(item.week_start)}`} wide onClose={onClose}>
      {!data ? <Spinner /> : (<>
        <div className="row wrap" style={{ marginBottom: 10 }}>
          <Badge color={color}>{label}</Badge><b>{fmtDur(data.minutes)} in total</b>
          <span className="muted small right">{Object.entries(byProject).map(([n, m]) => `${n} ${fmtDur(m)}`).join(' · ')}</span>
        </div>
        {data.remark && <div className="alert small" style={{ marginBottom: 10 }}>Remark: {data.remark}</div>}
        {Object.keys(byDay).length === 0 ? <div className="empty">No time logged this week.</div> : Object.entries(byDay).map(([date, logs]) => (
          <div key={date} style={{ marginBottom: 10 }}>
            <div className="mh" style={{ margin: '8px 0 4px' }}>{fmtDate(date, { weekday: 'long', day: 'numeric', month: 'short' })} · {fmtDur(logs.reduce((a, l) => a + l.minutes, 0))}</div>
            {logs.map((l) => <div key={l.id} className="kv"><span style={{ color: 'var(--ink)' }}><b style={{ fontWeight: 600 }}>{l.project_name}</b>{l.job_name ? ` · ${l.job_name}` : ''}<br /><span className="small muted">{l.notes}</span></span><b>{fmtDur(l.minutes)}</b></div>)}
          </div>
        ))}
        {canDecide && (data.status === 'pending') && (
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={() => setAsk('approve')}>Approve</button>
            <button className="btn danger" onClick={() => setAsk('reject')}>Reject</button>
          </div>
        )}
      </>)}
      {ask && (
        <RemarkModal title={ask === 'approve' ? 'Approve timesheet' : 'Reject timesheet'} approve={ask === 'approve'} onClose={() => setAsk(null)}
          onSubmit={async (remark) => { await api(`/timesheets/${data.id}/decision`, { method: 'POST', body: { approve: ask === 'approve', remark } }); toast(ask === 'approve' ? 'Timesheet approved' : 'Timesheet rejected'); onDone(); }} />
      )}
    </Modal>
  );
}
