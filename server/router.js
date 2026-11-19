import express from 'express';
import crypto from 'node:crypto';
import { makeCore, hashPin, checkPin } from './core.js';
import { ist, addDays, dowOf, haversine, toMin, istIso, isDate, isMonth } from './util.js';
import { httpErr, wrap } from './http.js';
import { registerLeave } from './leave.js';
import { registerTime } from './timetracker.js';
import { registerTeam } from './team.js';
import { registerAdmin } from './admin.js';
import { registerReports } from './reports.js';
import { registerFeeds } from './feeds.js';

export function createAttendanceRouter(db, { secret }) {
  const core = makeCore(db);
  const { all, get, run, settings, publicUser, notify } = core;
  const r = express.Router();
  r.use(express.json({ limit: '3mb' }));

  // ---------- auth ----------
  const sign = (payload) => {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return body + '.' + crypto.createHmac('sha256', secret).update(body).digest('base64url');
  };
  const verify = (token) => {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig) return null;
    const good = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  };

  const attempts = new Map(); // brute-force guard on PINs
  function guard(key) {
    const a = attempts.get(key);
    if (a && a.until > Date.now()) throw httpErr(429, `Too many wrong PIN attempts. Try again in ${Math.ceil((a.until - Date.now()) / 1000)}s.`);
  }
  function fail(key) {
    const a = attempts.get(key) || { n: 0, until: 0 };
    a.n++;
    if (a.n >= 5) { a.until = Date.now() + 120_000; a.n = 0; }
    attempts.set(key, a);
  }

  const withFlags = (u) => ({
    ...publicUser(u), is_manager: core.isManager(u),
    manager: core.managerOf(u.id)?.name || null, shift: core.shiftOf(u)?.name || null,
  });

  const auth = (req, _res, next) => {
    const p = verify((req.headers.authorization || '').replace(/^Bearer /, ''));
    const u = p && get('SELECT * FROM att_users WHERE id=? AND active=1', p.uid);
    if (!u) return next(httpErr(401, 'Please sign in'));
    req.user = u;
    next();
  };
  const hrOnly = (req, _res, next) => (req.user.role === 'hr' ? next() : next(httpErr(403, 'HR access only')));
  const approverOnly = (req, _res, next) => (req.user.role === 'hr' || core.isManager(req.user) ? next() : next(httpErr(403, 'Approvers only')));

  r.post('/login', wrap((req, res) => {
    const code = String(req.body.emp_code || '').trim().toUpperCase();
    guard('login:' + code);
    const u = get('SELECT * FROM att_users WHERE emp_code=? AND active=1', code);
    if (!u || !checkPin(req.body.pin, u.pin_hash)) { fail('login:' + code); throw httpErr(401, 'Wrong employee code or PIN'); }
    res.json({ token: sign({ uid: u.id, exp: Date.now() + 30 * 864e5 }), user: withFlags(u) });
  }));

  // ---------- punching ----------
  function punch(user, action, { source, lat, lng, accuracy, mode, note, photo, extra, ip }) {
    const s = settings();
    const shift = core.shiftOf(user);
    const t = ist();
    const hol = core.holidayMap(t.date, t.date);
    const offReason = hol.has(t.date) ? `a holiday (${hol.get(t.date).name})` : !shift.workingDays.includes(dowOf(t.date)) ? 'your weekly off' : null;
    if (t.date < user.start_date || (user.end_date && t.date > user.end_date)) throw httpErr(400, 'Your engagement is not active today.');
    if (source === 'phone' && user.checkin_method === 'kiosk') throw httpErr(403, 'You check in on the HR tablet, not on your phone.');
    if (source === 'kiosk' && user.checkin_method === 'phone') throw httpErr(403, 'You check in from your phone, not the tablet.');
    const leaves = core.approvedLeaves(user.id, t.date, t.date);
    if (leaves.some((l) => !l.is_wfh && !l.half)) throw httpErr(400, 'You are on approved leave today.');

    const rec = get('SELECT * FROM att_records WHERE user_id=? AND date=?', user.id, t.date);
    if (action === 'in' && !rec && offReason && !extra) {
      throw httpErr(400, `Today is ${offReason}. Working anyway? Check in as extra work to become eligible for comp-off.`, { code: 'OFFDAY' });
    }
    const effMode = source === 'kiosk' ? 'office' : action === 'out' && rec ? rec.in_mode : mode === 'wfh' ? 'wfh' : 'office';
    if (action === 'in' && offReason && effMode === 'wfh') throw httpErr(400, 'Extra work on a holiday or weekly off has to be done at the office.');

    let dist = null;
    if (source === 'phone') {
      if (effMode === 'wfh') {
        if (!leaves.some((l) => l.is_wfh)) throw httpErr(403, 'No approved Work-From-Home for today. Request WFH first.');
        if (!String(note || '').trim()) throw httpErr(400, action === 'in' ? "Tell us what you'll work on today (WFH check-in note)." : 'Add a short summary of what you did today (WFH check-out note).');
      } else {
        if (s.allowedIps.length) {
          const cip = String(ip || '').replace(/^::ffff:/, '');
          if (!s.allowedIps.some((a) => cip === a || (a.endsWith('.') && cip.startsWith(a)))) throw httpErr(403, 'Check-in is allowed only from the MCCIA office network.', { code: 'IP' });
        }
        if (typeof lat !== 'number' || typeof lng !== 'number') throw httpErr(400, 'Location is required. Allow location access and try again.');
        dist = haversine(lat, lng, s.office.lat, s.office.lng);
        const slack = Math.min(Math.max(+accuracy || 0, 0), 100); // forgive GPS jitter up to 100m
        if (dist - slack > s.office.radius) throw httpErr(403, `You are ${dist} m from the MCCIA office. Check-in works within ${s.office.radius} m.`, { code: 'OUTSIDE', distance: dist });
      }
    }
    const photoOk = typeof photo === 'string' && photo.startsWith('data:image/jpeg;base64,') && photo.length < 250_000 ? photo : null;

    if (action === 'in') {
      if (rec) throw httpErr(409, 'You have already checked in today.');
      const late = !offReason && t.min > toMin(shift.start) + shift.grace;
      run(`INSERT INTO att_records(user_id,date,check_in,in_mode,in_source,in_lat,in_lng,in_dist,in_acc,in_note,in_photo,late,late_min)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        user.id, t.date, new Date().toISOString(), effMode, source, lat ?? null, lng ?? null, dist, accuracy ? Math.round(accuracy) : null,
        note?.trim() || null, photoOk, late ? 1 : 0, late ? t.min - toMin(shift.start) : 0);
      return { action: 'in', time: new Date().toISOString(), late, mode: effMode, distance: dist, extra: !!offReason };
    }
    if (!rec) throw httpErr(409, 'Check in first.');
    if (rec.check_out) throw httpErr(409, 'You have already checked out today.');
    run(`UPDATE att_records SET check_out=?, out_source=?, out_lat=?, out_lng=?, out_dist=?, out_acc=?, out_note=?, out_photo=? WHERE id=?`,
      new Date().toISOString(), source, lat ?? null, lng ?? null, dist, accuracy ? Math.round(accuracy) : null, note?.trim() || null, photoOk, rec.id);
    return { action: 'out', time: new Date().toISOString(), early: !offReason && t.min < toMin(shift.end), mode: effMode, distance: dist, extra: !!offReason };
  }

  // ---------- kiosk (device token, no user session; dormant unless HR activates a tablet) ----------
  const kioskAuth = (req, _res, next) => {
    const k = get('SELECT * FROM att_kiosks WHERE token=?', String(req.headers['x-kiosk-token'] || ''));
    if (!k) return next(httpErr(401, 'This tablet is not activated. Ask HR to activate it.'));
    run("UPDATE att_kiosks SET last_seen=datetime('now') WHERE id=?", k.id);
    req.kiosk = k;
    next();
  };
  r.get('/kiosk/people', kioskAuth, wrap((req, res) => {
    const t = ist();
    const people = core.trackedUsers().filter((u) => u.checkin_method !== 'phone' && t.date >= u.start_date && (!u.end_date || t.date <= u.end_date));
    const recs = new Map(all('SELECT user_id,check_in,check_out FROM att_records WHERE date=?', t.date).map((x) => [x.user_id, x]));
    res.json({
      kiosk: req.kiosk.name, office: settings().office.name, now: new Date().toISOString(),
      people: people.map((u) => { const x = recs.get(u.id); return { id: u.id, name: u.name, emp_code: u.emp_code, role: u.role, department: u.department, state: !x ? 'none' : x.check_out ? 'done' : 'in' }; }),
    });
  }));
  r.post('/kiosk/punch', kioskAuth, wrap((req, res) => {
    const u = get("SELECT * FROM att_users WHERE id=? AND active=1 AND role NOT IN ('hr','approver')", +req.body.user_id);
    if (!u) throw httpErr(404, 'Person not found');
    guard('kiosk:' + u.id);
    if (!checkPin(req.body.pin, u.pin_hash)) { fail('kiosk:' + u.id); throw httpErr(401, 'Wrong PIN'); }
    const rec = get('SELECT * FROM att_records WHERE user_id=? AND date=?', u.id, ist().date);
    const action = !rec ? 'in' : !rec.check_out ? 'out' : 'done';
    if (action === 'done') throw httpErr(409, 'You have already checked in and out today.');
    res.json({ ...punch(u, action, { source: 'kiosk', photo: req.body.photo, extra: true }), name: u.name });
  }));

  // ---------- everything below needs a signed-in user ----------
  r.use(auth);

  r.get('/me', (req, res) => res.json({ user: withFlags(req.user) }));
  r.post('/me/pin', wrap((req, res) => {
    const { old_pin, new_pin } = req.body;
    if (!checkPin(old_pin, req.user.pin_hash)) throw httpErr(400, 'Current PIN is wrong');
    if (!/^\d{4,6}$/.test(String(new_pin))) throw httpErr(400, 'PIN must be 4–6 digits');
    run('UPDATE att_users SET pin_hash=? WHERE id=?', hashPin(new_pin), req.user.id);
    res.json({ ok: true });
  }));

  // people edit their own birthday and phone (HR manages the rest in People)
  r.put('/me/profile', wrap((req, res) => {
    const dob = req.body.dob ? String(req.body.dob) : null;
    if (dob && (!isDate(dob) || dob >= ist().date || dob < '1930-01-01')) throw httpErr(400, 'Enter a valid date of birth');
    const phone = String(req.body.phone || '').trim().slice(0, 20) || null;
    run('UPDATE att_users SET dob=?, phone=? WHERE id=?', dob, phone, req.user.id);
    res.json({ user: withFlags(get('SELECT * FROM att_users WHERE id=?', req.user.id)) });
  }));

  r.post('/punch', wrap((req, res) => {
    const { action, lat, lng, accuracy, mode, note, photo, extra } = req.body;
    if (!['in', 'out'].includes(action)) throw httpErr(400, 'Invalid action');
    if (core.isUntracked(req.user)) throw httpErr(403, 'HR and approver accounts do not punch attendance.');
    res.json(punch(req.user, action, { source: 'phone', lat, lng, accuracy, mode, note, photo, extra: !!extra, ip: req.ip }));
  }));

  r.get('/today', wrap((req, res) => {
    const u = req.user, s = settings(), t = ist();
    const shift = core.shiftOf(u);
    const rec = get('SELECT id,check_in,check_out,in_mode,in_source,in_dist,in_note,out_note,late,late_min FROM att_records WHERE user_id=? AND date=?', u.id, t.date);
    const hol = core.holidayMap(t.date, addDays(t.date, 120));
    const lv = core.approvedLeaves(u.id, t.date, t.date);
    const cel = core.celebrations(t.date, t.date);
    const full = lv.find((l) => !l.is_wfh);
    res.json({
      date: t.date, now: new Date().toISOString(), record: rec || null,
      holiday: hol.get(t.date)?.name || null,
      workingDay: shift.workingDays.includes(dowOf(t.date)),
      leave: full ? { type: full.type_name, half: !!full.half } : null,
      wfhApproved: lv.some((l) => l.is_wfh),
      office: s.office,
      shift: { name: shift.name, start: shift.start, end: shift.end, grace: shift.grace, fullHours: shift.fullHours, halfHours: shift.halfHours },
      nextHoliday: [...hol.values()].sort((a, b) => a.date.localeCompare(b.date)).find((h) => h.date >= t.date) || null,
      pendingLeaves: get("SELECT COUNT(*) c FROM att_leaves WHERE user_id=? AND status='pending'", u.id).c,
      announcements: all('SELECT id,title,body,created_at FROM att_announcements ORDER BY id DESC LIMIT 3'),
      summary: core.isUntracked(u) ? null : core.buildCalendar(u, t.month).summary,
      birthday: cel.birthdays.some((x) => x.user.id === u.id),
      anniversary: cel.anniversaries.find((x) => x.user.id === u.id)?.years || null,
      approvals: u.role === 'hr' || core.isManager(u) ? core.pendingApprovalCount(u) : 0,
    });
  }));

  // ---------- calendar / schedule ----------
  r.get('/calendar', wrap((req, res) => {
    const month = isMonth(req.query.month) ? req.query.month : ist().month;
    const id = req.query.user_id ? +req.query.user_id : req.user.id;
    if (!core.canView(req.user, id)) throw httpErr(403, 'Not allowed');
    const u = get('SELECT * FROM att_users WHERE id=?', id);
    if (!u) throw httpErr(404, 'User not found');
    res.json({ user: publicUser(u), month, ...core.buildCalendar(u, month) });
  }));

  // Work Schedule widget: the next few days with the shift timings
  r.get('/schedule', wrap((req, res) => {
    const days = Math.min(14, Math.max(1, +req.query.days || 7));
    const u = req.user, shift = core.shiftOf(u), t = ist();
    const end = addDays(t.date, days - 1);
    const hol = core.holidayMap(t.date, end), opt = core.optionalHolidayMap(t.date, end);
    const leaves = core.approvedLeaves(u.id, t.date, end);
    const out = [];
    for (let i = 0; i < days; i++) {
      const date = addDays(t.date, i), dow = dowOf(date);
      const lv = leaves.find((l) => !l.is_wfh && l.from_date <= date && l.to_date >= date);
      const wf = leaves.find((l) => l.is_wfh && l.from_date <= date && l.to_date >= date);
      let label = 'Working';
      if (hol.has(date)) label = 'Holiday'; else if (!shift.workingDays.includes(dow)) label = 'Weekly off'; else if (lv) label = 'On leave'; else if (wf) label = 'Work from home';
      out.push({ date, dow, label, holiday: hol.get(date)?.name, optional: opt.get(date)?.name, leave: lv?.type_name });
    }
    res.json({ shift: { name: shift.name, start: shift.start, end: shift.end }, days: out });
  }));

  r.get('/photo/:id/:which', hrOnly, wrap((req, res) => {
    const rec = get('SELECT in_photo,out_photo FROM att_records WHERE id=?', +req.params.id);
    const data = rec?.[req.params.which === 'out' ? 'out_photo' : 'in_photo'];
    if (!data) throw httpErr(404, 'No photo');
    res.type('image/jpeg').send(Buffer.from(data.split(',')[1], 'base64'));
  }));

  // ---------- regularization (forgot to punch / missed check-out) ----------
  r.get('/regularizations', (req, res) => {
    res.json(all('SELECT * FROM att_regularizations WHERE user_id=? ORDER BY id DESC LIMIT 200', req.user.id));
  });
  // days that can be corrected (a missed check-in or check-out), with the shift times to prefill the form
  r.get('/regularizations/eligible', wrap((req, res) => {
    const shift = core.shiftOf(req.user);
    res.json({
      days: core.isUntracked(req.user) ? [] : core.regularizable(req.user),
      window: settings().regularizeWindow, shift: { start: shift.start, end: shift.end },
    });
  }));
  r.post('/regularizations', wrap((req, res) => {
    const { date, check_out, reason } = req.body;
    let { check_in } = req.body;
    if (core.isUntracked(req.user)) throw httpErr(403, 'HR and approver accounts do not punch attendance.');
    if (!isDate(date)) throw httpErr(400, 'Pick the day to correct');
    const chk = core.regularizeCheck(req.user, date);
    if (chk.error) throw httpErr(400, chk.error);
    if (chk.missing === 'out') check_in = ist(new Date(chk.day.check_in)).hhmm; // the recorded check-in stays; only the check-out is missing
    if (!/^\d{2}:\d{2}$/.test(check_in || '') || !/^\d{2}:\d{2}$/.test(check_out || '')) throw httpErr(400, chk.missing === 'out' ? 'Enter the check-out time (HH:MM).' : 'Enter both the check-in and check-out time (HH:MM).');
    if (check_out <= check_in) throw httpErr(400, 'Check-out must be after check-in');
    if (!String(reason || '').trim()) throw httpErr(400, 'Please add a reason');
    if (get("SELECT 1 FROM att_regularizations WHERE user_id=? AND date=? AND status='pending'", req.user.id, date)) throw httpErr(409, 'A request for this date is already pending');
    run('INSERT INTO att_regularizations(user_id,date,check_in,check_out,reason) VALUES (?,?,?,?,?)', req.user.id, date, check_in, check_out, reason.trim());
    core.notifyApprovers(req.user.id, 'approval', `Regularization: ${req.user.name}`, `${date} ${check_in}–${check_out}`);
    res.json({ ok: true });
  }));
  r.post('/regularizations/:id/decision', wrap((req, res) => {
    const g = get('SELECT * FROM att_regularizations WHERE id=?', +req.params.id);
    if (!g) throw httpErr(404, 'Not found');
    if (!core.canDecide(req.user, g.user_id)) throw httpErr(403, 'You cannot decide this request');
    if (g.status !== 'pending') throw httpErr(409, 'Already decided');
    const status = req.body.approve ? 'approved' : 'rejected';
    run("UPDATE att_regularizations SET status=?, decided_by=?, decided_at=datetime('now'), remark=? WHERE id=?", status, req.user.id, req.body.remark || null, g.id);
    if (status === 'approved') {
      const target = get('SELECT * FROM att_users WHERE id=?', g.user_id);
      const shift = core.shiftOf(target);
      const ci = istIso(g.date, g.check_in), co = g.check_out ? istIso(g.date, g.check_out) : null;
      const late = toMin(g.check_in) > toMin(shift.start) + shift.grace;
      const lateMin = late ? toMin(g.check_in) - toMin(shift.start) : 0;
      if (get('SELECT 1 FROM att_records WHERE user_id=? AND date=?', g.user_id, g.date))
        run('UPDATE att_records SET check_in=?, check_out=?, late=?, late_min=?, regularized=1 WHERE user_id=? AND date=?', ci, co, late ? 1 : 0, lateMin, g.user_id, g.date);
      else run(`INSERT INTO att_records(user_id,date,check_in,check_out,in_mode,in_source,late,late_min,regularized) VALUES (?,?,?,?, 'office','regularized',?,?,1)`, g.user_id, g.date, ci, co, late ? 1 : 0, lateMin);
    }
    notify(g.user_id, 'approval', `Regularization ${status}`, `${g.date}${req.body.remark ? ' — ' + req.body.remark : ''}`);
    res.json({ ok: true });
  }));

  // ---------- holidays ----------
  r.get('/holidays', (req, res) => {
    const year = String(req.query.year || ist().date.slice(0, 4));
    res.json(all('SELECT * FROM att_holidays WHERE date LIKE ? ORDER BY date', year + '%'));
  });
  r.post('/holidays', hrOnly, wrap((req, res) => {
    if (!isDate(req.body.date) || !String(req.body.name || '').trim()) throw httpErr(400, 'Date and name required');
    run('INSERT OR REPLACE INTO att_holidays(date,name,optional) VALUES (?,?,?)', req.body.date, req.body.name.trim(), req.body.optional ? 1 : 0);
    res.json({ ok: true });
  }));
  r.delete('/holidays/:date', hrOnly, (req, res) => { run('DELETE FROM att_holidays WHERE date=?', req.params.date); res.json({ ok: true }); });

  // ---------- notifications & announcements ----------
  r.get('/notifications', (req, res) => {
    res.json({
      items: all('SELECT id,kind,title,body,read,created_at FROM att_notifications WHERE user_id=? ORDER BY id DESC LIMIT 30', req.user.id),
      unread: get('SELECT COUNT(*) c FROM att_notifications WHERE user_id=? AND read=0', req.user.id).c,
    });
  });
  r.post('/notifications/read', (req, res) => {
    run('UPDATE att_notifications SET read=1 WHERE user_id=?', req.user.id);
    res.json({ ok: true });
  });
  r.get('/announcements', (_req, res) => res.json(all('SELECT * FROM att_announcements ORDER BY id DESC LIMIT 20')));
  r.post('/announcements', hrOnly, wrap((req, res) => {
    if (!String(req.body.title || '').trim()) throw httpErr(400, 'Title required');
    run('INSERT INTO att_announcements(title,body,created_by) VALUES (?,?,?)', req.body.title.trim(), req.body.body || null, req.user.id);
    for (const u of all('SELECT id FROM att_users WHERE active=1 AND id!=?', req.user.id)) notify(u.id, 'announcement', req.body.title.trim(), req.body.body || null);
    res.json({ ok: true });
  }));
  r.delete('/announcements/:id', hrOnly, (req, res) => { run('DELETE FROM att_announcements WHERE id=?', +req.params.id); res.json({ ok: true }); });

  // ---------- feature modules ----------
  const x = { core, hrOnly, approverOnly, httpErr, wrap };
  registerLeave(r, x);
  registerTime(r, x);
  registerTeam(r, x);
  registerAdmin(r, x);
  registerReports(r, x);
  registerFeeds(r, x);

  // eslint-disable-next-line no-unused-vars
  r.use((e, _req, res, _next) => {
    if (!e.status) console.error('[attendance]', e);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong', ...(e.extra || {}) });
  });
  r.core = core;
  return r;
}
