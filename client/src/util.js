const TZ = 'Asia/Kolkata';

export const fmtTime = (iso) => iso
  ? new Date(iso).toLocaleTimeString('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase()
  : '—';
export const fmtClock = (ms) => new Date(ms).toLocaleTimeString('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).toUpperCase();
export const fmtDate = (d, opts = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { timeZone: 'UTC', ...opts });
export const fmtLong = (ms) => new Date(ms).toLocaleDateString('en-IN', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const fmtDur = (min) => (min == null ? '—' : `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m`);
export const hhmmNow = () => new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
export const todayIst = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
export const monthOf = (d) => d.slice(0, 7);
export function shiftMonth(m, n) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
export const monthLabel = (m) => new Date(m + '-01T00:00:00Z').toLocaleDateString('en-IN', { timeZone: 'UTC', month: 'long', year: 'numeric' });
export const initials = (n = '') => n.split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
export const greeting = () => {
  const h = +new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false });
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

export const STATUS = {
  present: ['Present', 'var(--ok)'], late: ['Late', 'var(--warn)'], wfh: ['WFH', 'var(--info)'],
  half: ['Half day', '#e0731a'], leave: ['On leave', 'var(--violet)'], holiday: ['Holiday', 'var(--teal)'],
  weekend: ['Weekend', 'var(--muted)'], absent: ['Absent', 'var(--bad)'], missed: ['No check-out', 'var(--bad)'],
  extra: ['Extra work', 'var(--teal)'], pending: ['Today', 'var(--muted)'], upcoming: ['', 'var(--muted)'], na: ['', 'var(--muted)'],
};

export function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000, r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

export const getPosition = () => new Promise((resolve, reject) => {
  if (!navigator.geolocation) return reject(new Error('This device does not support location.'));
  navigator.geolocation.getCurrentPosition(
    (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
    (e) => reject(new Error(e.code === 1 ? 'Location permission denied. Allow location for this site and try again.' : e.code === 3 ? 'Could not get your location in time. Try again outdoors / near a window.' : 'Could not read your location.')),
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
});

export const addDaysStr = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const weekStartOf = (d) => addDaysStr(d, -((new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7)); // Monday
// "1:30", "1.5" or "90m" → minutes (null if it cannot be read)
export function parseDuration(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;
  let m;
  if ((m = t.match(/^(\d+):(\d{1,2})$/))) return +m[1] * 60 + +m[2];
  if ((m = t.match(/^(\d+)\s*m(in)?$/))) return +m[1];
  if ((m = t.match(/^(\d+(?:\.\d+)?)\s*h?$/))) return Math.round(+m[1] * 60);
  return null;
}
export function downloadCsv(name, head, rows) {
  const text = [head, ...rows].map((l) => l.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + text], { type: 'text/csv' }));
  a.download = name;
  a.click();
}
export const roleLabel = (r) => ({ hr: 'HR', approver: 'Approver' }[r] || r);
export const relDay = (date, today = todayIst()) => {
  const n = Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 864e5);
  return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `in ${n} days`;
};
