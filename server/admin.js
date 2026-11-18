import crypto from 'node:crypto';
import { DEFAULT_SETTINGS, hashPin } from './core.js';
import { ist, isDate } from './util.js';
import { runReminders } from './scheduler.js';

// HR administration: live board, people, shifts, settings, kiosk tablets.
export function registerAdmin(r, { core, hrOnly, httpErr, wrap }) {
  const { all, get, run, notify } = core;

  // ---------- live board ----------
  r.get('/board', hrOnly, wrap((_req, res) => {
    const t = ist();
    const hol = core.holidayMap(t.date, t.date);
    const rows = core.trackedUsers().filter((u) => t.date >= u.start_date && (!u.end_date || t.date <= u.end_date)).map((u) => {
      const d = core.dayFor(u, t.date);
      return {
        id: u.id, name: u.name, emp_code: u.emp_code, role: u.role, department: u.department, method: u.checkin_method,
        state: core.stateOf(d), wfh_approved: !!d.wfh_approved, leave: d.leave || null, shift: core.shiftOf(u)?.name || null,
        record_id: d.record_id || null, check_in: d.check_in || null, check_out: d.check_out || null,
        late: !!d.late && !d.extra, extra: !!d.extra, in_source: d.in_source || null, in_dist: d.in_dist ?? null, in_mode: d.in_mode || null,
      };
    });
    res.json({ date: t.date, working: core.isWorkingDay(t.date, core.defaultShift(), hol), holiday: hol.get(t.date)?.name || null, rows });
  }));

  r.post('/board/nudge', hrOnly, wrap((req, res) => {
    const t = ist();
    let n = 0;
    for (const u of core.trackedUsers()) {
      if (u.checkin_method === 'kiosk') continue;
      const d = core.dayFor(u, t.date);
      const wanted = req.body.kind === 'out' ? d.check_in && !d.check_out : d.status === 'pending';
      if (wanted) {
        n += notify(u.id, req.body.kind === 'out' ? 'checkout' : 'checkin',
          req.body.kind === 'out' ? 'Reminder from HR: check out' : 'Reminder from HR: please check in',
          `Sent by ${req.user.name} at ${t.hhmm}`, `nudge:${t.date}:${t.hhmm}:${req.body.kind}:${u.id}`).changes;
      }
    }
    res.json({ sent: n });
  }));
  r.post('/reminders/run', hrOnly, (_req, res) => res.json(runReminders(core)));

  // ---------- people ----------
  r.get('/users', hrOnly, (_req, res) => {
    res.json(all(`SELECT u.*, s.name AS shift_name, m.name AS manager_name FROM att_users u
      LEFT JOIN att_shifts s ON s.id=u.shift_id LEFT JOIN att_users m ON m.id=u.manager_id ORDER BY u.active DESC, u.role, u.name`)
      .map((u) => ({ ...core.publicUser(u), shift_name: u.shift_name, manager_name: u.manager_name })));
  });

  function userFields(b, userId = 0) {
    if (!String(b.name || '').trim()) throw httpErr(400, 'Name required');
    if (!isDate(b.start_date)) throw httpErr(400, 'Start date required');
    if (!['hr', 'approver', 'intern', 'consultant'].includes(b.role)) throw httpErr(400, 'Invalid role');
    const dob = b.dob ? String(b.dob) : null;
    if (dob && (!isDate(dob) || dob >= ist().date || dob < '1930-01-01')) throw httpErr(400, 'Enter a valid date of birth');
    if (!['phone', 'kiosk', 'both'].includes(b.checkin_method || 'phone')) throw httpErr(400, 'Invalid check-in method');
    const shiftId = b.shift_id ? +b.shift_id : null;
    if (shiftId && !get('SELECT 1 FROM att_shifts WHERE id=?', shiftId)) throw httpErr(400, 'Unknown shift');
    const managerId = b.manager_id ? +b.manager_id : null;
    if (managerId) {
      if (managerId === userId) throw httpErr(400, 'A person cannot report to themselves');
      if (!get('SELECT 1 FROM att_users WHERE id=? AND active=1', managerId)) throw httpErr(400, 'Unknown reporting manager');
      for (let m = managerId, i = 0; m && i < 10; i++) { // no reporting loops
        if (userId && m === userId) throw httpErr(400, 'That would create a reporting loop');
        m = get('SELECT manager_id FROM att_users WHERE id=?', m)?.manager_id;
      }
    }
    return [b.name.trim(), b.email || null, b.phone || null, b.role, b.department || null, b.start_date, b.end_date || null, b.checkin_method || 'phone', shiftId, managerId, String(b.designation || '').trim().slice(0, 80) || null, dob];
  }
  r.post('/users', hrOnly, wrap((req, res) => {
    const code = String(req.body.emp_code || '').trim().toUpperCase();
    if (!code) throw httpErr(400, 'Employee code required');
    if (!/^\d{4,6}$/.test(String(req.body.pin || ''))) throw httpErr(400, 'PIN must be 4–6 digits');
    if (get('SELECT 1 FROM att_users WHERE emp_code=?', code)) throw httpErr(409, 'That employee code already exists');
    const f = userFields(req.body);
    const { lastInsertRowid } = run(`INSERT INTO att_users(name,email,phone,role,department,start_date,end_date,checkin_method,shift_id,manager_id,designation,dob,emp_code,pin_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, ...f, code, hashPin(req.body.pin));
    res.json({ id: lastInsertRowid });
  }));
  r.put('/users/:id', hrOnly, wrap((req, res) => {
    const f = userFields(req.body, +req.params.id);
    run('UPDATE att_users SET name=?,email=?,phone=?,role=?,department=?,start_date=?,end_date=?,checkin_method=?,shift_id=?,manager_id=?,designation=?,dob=?,active=? WHERE id=?', ...f, req.body.active ? 1 : 0, +req.params.id);
    res.json({ ok: true });
  }));
  r.post('/users/:id/pin', hrOnly, wrap((req, res) => {
    if (!/^\d{4,6}$/.test(String(req.body.pin || ''))) throw httpErr(400, 'PIN must be 4–6 digits');
    run('UPDATE att_users SET pin_hash=? WHERE id=?', hashPin(req.body.pin), +req.params.id);
    res.json({ ok: true });
  }));

  // ---------- shifts ----------
  r.get('/shifts', (_req, res) => res.json(core.listShifts()));
  function shiftFields(b) {
    const name = String(b.name || '').trim();
    if (!name) throw httpErr(400, 'Shift name required');
    const hhmm = /^\d{2}:\d{2}$/;
    if (!hhmm.test(b.start || '') || !hhmm.test(b.end || '') || b.end <= b.start) throw httpErr(400, 'Enter start and end times (end after start)');
    const grace = Math.round(+b.grace ?? 0), full = +b.fullHours, half = +b.halfHours;
    if (!(grace >= 0 && grace <= 180)) throw httpErr(400, 'Grace must be 0–180 minutes');
    if (!(full >= 1 && full <= 16) || !(half >= 0.5 && half <= full)) throw httpErr(400, 'Full-day hours must be 1–16 and half-day hours at most the full-day hours');
    const off = [...new Set((Array.isArray(b.weekOff) ? b.weekOff : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
    if (off.length >= 7) throw httpErr(400, 'A shift needs at least one working day');
    return [name, b.start, b.end, grace, full, half, off.sort().join(',')];
  }
  r.post('/shifts', hrOnly, wrap((req, res) => {
    const f = shiftFields(req.body);
    if (get('SELECT 1 FROM att_shifts WHERE name=?', f[0])) throw httpErr(409, 'A shift with that name already exists');
    const { lastInsertRowid } = run('INSERT INTO att_shifts(name,start_time,end_time,grace_min,full_hours,half_hours,week_off) VALUES (?,?,?,?,?,?,?)', ...f);
    res.json({ id: lastInsertRowid });
  }));
  r.put('/shifts/:id', hrOnly, wrap((req, res) => {
    const f = shiftFields(req.body);
    if (get('SELECT 1 FROM att_shifts WHERE name=? AND id!=?', f[0], +req.params.id)) throw httpErr(409, 'A shift with that name already exists');
    run('UPDATE att_shifts SET name=?,start_time=?,end_time=?,grace_min=?,full_hours=?,half_hours=?,week_off=? WHERE id=?', ...f, +req.params.id);
    res.json({ ok: true });
  }));
  r.post('/shifts/:id/default', hrOnly, wrap((req, res) => {
    if (!get('SELECT 1 FROM att_shifts WHERE id=?', +req.params.id)) throw httpErr(404, 'Not found');
    run('UPDATE att_shifts SET is_default=0');
    run('UPDATE att_shifts SET is_default=1 WHERE id=?', +req.params.id);
    res.json({ ok: true });
  }));
  r.delete('/shifts/:id', hrOnly, wrap((req, res) => {
    const s = get('SELECT * FROM att_shifts WHERE id=?', +req.params.id);
    if (!s) throw httpErr(404, 'Not found');
    if (s.is_default) throw httpErr(400, 'The default shift cannot be deleted. Make another shift the default first.');
    run('UPDATE att_users SET shift_id=NULL WHERE shift_id=?', s.id); // they fall back to the default shift
    run('DELETE FROM att_shifts WHERE id=?', s.id);
    res.json({ ok: true });
  }));

  // ---------- settings ----------
  r.get('/settings', hrOnly, (_req, res) => res.json(core.rawSettings()));
  r.put('/settings', hrOnly, wrap((req, res) => {
    const b = req.body;
    const lat = +b.office_lat, lng = +b.office_lng;
    if (!(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180)) throw httpErr(400, 'Invalid latitude / longitude');
    if (!(+b.radius_m >= 20 && +b.radius_m <= 5000)) throw httpErr(400, 'Radius must be 20–5000 m');
    for (const k of ['hr_digest', 'remind_approvals']) if (!/^\d{2}:\d{2}$/.test(b[k] || '')) throw httpErr(400, `${k} must be HH:MM`);
    if (b.remind_birthdays && !/^\d{2}:\d{2}$/.test(String(b.remind_birthdays).trim())) throw httpErr(400, 'remind_birthdays must be HH:MM (or empty to switch it off)');
    for (const k of ['remind_in', 'remind_out'])
      if (!String(b[k] || '').split(',').every((v) => /^\d{2}:\d{2}$/.test(v.trim()) || !v.trim())) throw httpErr(400, `${k}: use HH:MM, comma separated`);
    if (!(+b.compoff_expiry_days >= 1 && +b.compoff_expiry_days <= 365)) throw httpErr(400, 'Comp-off validity must be 1–365 days');
    if (!(+b.compoff_window_days >= 1 && +b.compoff_window_days <= 90)) throw httpErr(400, 'Comp-off request window must be 1–90 days');
    if (!(+b.late_marks_per_halfday >= 0 && +b.late_marks_per_halfday <= 10)) throw httpErr(400, 'Late marks per half-day must be 0–10');
    for (const k of Object.keys(DEFAULT_SETTINGS)) if (b[k] !== undefined) run('INSERT OR REPLACE INTO att_settings(key,value) VALUES (?,?)', k, String(b[k]).trim());
    res.json(core.rawSettings());
  }));

  // ---------- kiosk tablets ----------
  r.get('/kiosks', hrOnly, (_req, res) => res.json(all('SELECT id,name,last_seen,created_at FROM att_kiosks ORDER BY id DESC')));
  r.post('/kiosks', hrOnly, wrap((req, res) => {
    const token = crypto.randomBytes(24).toString('base64url');
    const { lastInsertRowid } = run('INSERT INTO att_kiosks(name,token) VALUES (?,?)', String(req.body.name || 'HR Tablet').trim(), token);
    res.json({ id: lastInsertRowid, token });
  }));
  r.delete('/kiosks/:id', hrOnly, (req, res) => { run('DELETE FROM att_kiosks WHERE id=?', +req.params.id); res.json({ ok: true }); });
}
