import crypto from 'node:crypto';
import { ist, dowOf, addDays, monthDays, toMin, daysBetween } from './util.js';

export const hashPin = (pin) => {
  const salt = crypto.randomBytes(8).toString('hex');
  return salt + ':' + crypto.scryptSync(String(pin), salt, 32).toString('hex');
};
export const checkPin = (pin, hash) => {
  const [salt, hex] = String(hash).split(':');
  const a = Buffer.from(hex, 'hex');
  const b = crypto.scryptSync(String(pin), salt, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

export const DEFAULT_SETTINGS = {
  office_name: 'MCCIA – S.B. Road Office',
  // ICC Trade Tower, Senapati Bapat Marg (OpenStreetMap). Fine-tune in Settings → "Use my current location" from inside the office.
  office_lat: '18.5357',
  office_lng: '73.8299',
  radius_m: '150',
  remind_in: '10:00,10:30',
  remind_out: '17:30,18:00',
  hr_digest: '10:45',
  remind_approvals: '11:00',
  remind_birthdays: '09:00',     // daily birthday / work-anniversary notice; empty = off
  compoff_expiry_days: '60',     // comp-off is valid this many days from the day worked
  regularize_window_days: '31',  // corrections (missed check-in / check-out) are allowed for this many past days
  compoff_window_days: '30',     // can request comp-off up to this many days after the day worked
  allowed_ips: '',               // optional: only allow office check-ins from these public IPs (prefix ending in "." allowed)
  late_marks_per_halfday: '0',   // 0 = off. e.g. 3 → every 3 late marks count as one half-day in reports
};

const round1 = (n) => Math.round(n * 10) / 10;
const csvNums = (v) => String(v ?? '').split(',').map((x) => x.trim()).filter((x) => x !== '').map(Number);

export function makeCore(db) {
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const get = (sql, ...p) => db.prepare(sql).get(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);

  // ---------- settings ----------
  function rawSettings() {
    const o = { ...DEFAULT_SETTINGS };
    for (const { key, value } of all('SELECT * FROM att_settings')) if (key in DEFAULT_SETTINGS) o[key] = value;
    return o;
  }
  function settings() {
    const o = rawSettings();
    const list = (v) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    return {
      office: { name: o.office_name, lat: +o.office_lat, lng: +o.office_lng, radius: +o.radius_m },
      remindIn: list(o.remind_in), remindOut: list(o.remind_out), hrDigest: o.hr_digest, remindApprovals: o.remind_approvals, birthdayTime: o.remind_birthdays,
      compoffExpiry: +o.compoff_expiry_days, compoffWindow: +o.compoff_window_days, regularizeWindow: +o.regularize_window_days,
      allowedIps: list(o.allowed_ips), lateMarks: +o.late_marks_per_halfday,
    };
  }

  // ---------- shifts ----------
  const shiftRow = (r) => {
    if (!r) return null;
    const weekOff = csvNums(r.week_off);
    return {
      id: r.id, name: r.name, start: r.start_time, end: r.end_time, grace: r.grace_min,
      fullHours: r.full_hours, halfHours: r.half_hours, weekOff,
      workingDays: [0, 1, 2, 3, 4, 5, 6].filter((d) => !weekOff.includes(d)), isDefault: !!r.is_default,
    };
  };
  const listShifts = () => all('SELECT * FROM att_shifts ORDER BY is_default DESC, name').map(shiftRow);
  const defaultShift = () => shiftRow(get('SELECT * FROM att_shifts WHERE is_default=1') || get('SELECT * FROM att_shifts ORDER BY id LIMIT 1'));
  const shiftOf = (user) => (user?.shift_id && shiftRow(get('SELECT * FROM att_shifts WHERE id=?', user.shift_id))) || defaultShift();

  const publicUser = (u) => u && ({
    id: u.id, emp_code: u.emp_code, name: u.name, email: u.email, phone: u.phone,
    role: u.role, department: u.department, designation: u.designation ?? null, dob: u.dob ?? null, start_date: u.start_date, end_date: u.end_date,
    checkin_method: u.checkin_method, active: u.active, shift_id: u.shift_id ?? null, manager_id: u.manager_id ?? null,
  });

  // ---------- holidays ----------
  function holidayMap(from, to) { // gazetted holidays (employees are off)
    const m = new Map();
    for (const h of all('SELECT * FROM att_holidays WHERE optional=0 AND date BETWEEN ? AND ?', from, to)) m.set(h.date, h);
    return m;
  }
  function optionalHolidayMap(from, to) { // restricted holidays (employee may opt in)
    const m = new Map();
    for (const h of all('SELECT * FROM att_holidays WHERE optional=1 AND date BETWEEN ? AND ?', from, to)) m.set(h.date, h);
    return m;
  }
  const isWorkingDay = (date, shift, hol) => shift.workingDays.includes(dowOf(date)) && !hol.has(date);

  const approvedLeaves = (userId, from, to) => all(
    `SELECT l.*, t.code, t.name AS type_name, t.is_wfh, t.is_compoff, t.color FROM att_leaves l JOIN att_leave_types t ON t.id=l.type_id
     WHERE l.user_id=? AND l.status='approved' AND l.from_date<=? AND l.to_date>=?`, userId, to, from);

  // ---------- one day ----------
  function dayInfo(user, date, rec, ctx) {
    const { shift, hol, opt, leaves, today } = ctx;
    const dow = dowOf(date);
    const base = { date, dow };
    const o = opt?.get(date);
    if (o) base.optional = o.name;
    if (date < user.start_date || (user.end_date && date > user.end_date)) return { ...base, status: 'na' };
    const h = hol.get(date);
    const weekOff = !shift.workingDays.includes(dow);
    const lv = leaves.find((l) => !l.is_wfh && l.from_date <= date && l.to_date >= date);
    const wf = leaves.find((l) => l.is_wfh && l.from_date <= date && l.to_date >= date);

    if (rec && rec.check_in) {
      const worked = rec.check_out ? Math.round((new Date(rec.check_out) - new Date(rec.check_in)) / 60000) : null;
      const extra = !!h || weekOff; // worked on a holiday / weekly off → "extra work" (eligible for comp-off)
      let status = extra ? 'extra' : rec.in_mode === 'wfh' ? 'wfh' : rec.late ? 'late' : 'present';
      if (!extra && worked !== null && worked < shift.halfHours * 60) status = 'half';
      if (worked === null && date < today) status = 'missed';
      let early = 0;
      if (rec.check_out && !extra) {
        const co = ist(new Date(rec.check_out));
        if (co.date === date) early = Math.max(0, toMin(shift.end) - co.min);
      }
      return {
        ...base, status, worked, record_id: rec.id, check_in: rec.check_in, check_out: rec.check_out,
        in_mode: rec.in_mode, in_source: rec.in_source, late: !!rec.late, late_min: rec.late_min, early_min: early,
        excess_min: worked !== null && !extra ? worked - Math.round(shift.fullHours * 60) : null,
        in_dist: rec.in_dist, in_note: rec.in_note, out_note: rec.out_note, regularized: !!rec.regularized,
        holiday: h?.name, leave: lv?.type_name, extra,
      };
    }
    if (h) return { ...base, status: 'holiday', holiday: h.name };
    if (weekOff) return { ...base, status: 'weekend' };
    if (lv) return { ...base, status: 'leave', leave: lv.type_name, half: !!lv.half, session: lv.session };
    if (date > today) return { ...base, status: 'upcoming', wfh_approved: !!wf };
    if (date === today) return { ...base, status: 'pending', wfh_approved: !!wf };
    return { ...base, status: 'absent' };
  }

  function dayFor(user, date) {
    const ctx = {
      shift: shiftOf(user), hol: holidayMap(date, date), opt: optionalHolidayMap(date, date),
      leaves: approvedLeaves(user.id, date, date), today: ist().date,
    };
    return dayInfo(user, date, get('SELECT * FROM att_records WHERE user_id=? AND date=?', user.id, date), ctx);
  }

  // in | wfh | out | leave | off | not_in | na  (for the live board and team view)
  function stateOf(d) {
    if (d.check_in) return d.check_out ? 'out' : d.in_mode === 'wfh' ? 'wfh' : 'in';
    if (d.status === 'leave') return 'leave';
    if (d.status === 'weekend' || d.status === 'holiday') return 'off';
    if (d.status === 'na') return 'na';
    return 'not_in';
  }

  function buildCalendar(user, month) {
    const shift = shiftOf(user);
    const dates = monthDays(month);
    const today = ist().date;
    const hol = holidayMap(dates[0], dates.at(-1));
    const opt = optionalHolidayMap(dates[0], dates.at(-1));
    const leaves = approvedLeaves(user.id, dates[0], dates.at(-1));
    const recs = new Map(all('SELECT * FROM att_records WHERE user_id=? AND date BETWEEN ? AND ?', user.id, dates[0], dates.at(-1)).map((r) => [r.date, r]));
    const ctx = { shift, hol, opt, leaves, today };
    const days = dates.map((d) => dayInfo(user, d, recs.get(d), ctx));
    const sum = {
      working_days: 0, present: 0, late: 0, wfh: 0, half: 0, leave: 0, absent: 0, missed: 0, extra: 0, minutes: 0,
      late_count: 0, late_min: 0, early_count: 0, early_min: 0, excess_min: 0, deficit_min: 0,
    };
    for (const d of days) {
      if (d.date <= today && ['present', 'late', 'wfh', 'half', 'leave', 'absent', 'missed', 'pending'].includes(d.status)) sum.working_days++;
      if (d.status in sum) sum[d.status]++;
      if (d.worked) sum.minutes += d.worked;
      if (d.late && !d.extra) { sum.late_count++; sum.late_min += d.late_min || 0; }
      if (d.early_min > 0) { sum.early_count++; sum.early_min += d.early_min; }
      if (d.excess_min != null) { if (d.excess_min >= 0) sum.excess_min += d.excess_min; else sum.deficit_min += -d.excess_min; }
    }
    return { days, summary: sum, shift: { id: shift.id, name: shift.name, start: shift.start, end: shift.end, fullHours: shift.fullHours } };
  }

  // ---------- people & approvers ----------
  // HR and approvers (MCCIA managers who only approve) do not punch attendance, apply for leave or log time here
  const isUntracked = (u) => u.role === 'hr' || u.role === 'approver';
  const trackedUsers = () => all("SELECT * FROM att_users WHERE role NOT IN ('hr','approver') AND active=1 ORDER BY name");
  const reporteeIds = (managerId) => all('SELECT id FROM att_users WHERE manager_id=? AND active=1', managerId).map((r) => r.id);
  const isManager = (u) => !!get('SELECT 1 FROM att_users WHERE manager_id=? AND active=1', u.id);
  const managerOf = (userId) => {
    const u = get('SELECT manager_id FROM att_users WHERE id=?', userId);
    return u?.manager_id ? get('SELECT * FROM att_users WHERE id=? AND active=1', u.manager_id) : null;
  };
  const canView = (actor, targetId) => actor.id === +targetId || actor.role === 'hr' || !!get('SELECT 1 FROM att_users WHERE id=? AND manager_id=?', +targetId, actor.id);
  const canDecide = (actor, targetId) => actor.id !== +targetId && (actor.role === 'hr' || !!get('SELECT 1 FROM att_users WHERE id=? AND manager_id=?', +targetId, actor.id));

  function notify(userId, kind, title, body, key = null) {
    return run('INSERT OR IGNORE INTO att_notifications (user_id,kind,title,body,dedupe_key) VALUES (?,?,?,?,?)',
      userId, kind, title, body ?? null, key);
  }
  function notifyHr(kind, title, body, key = null) {
    for (const h of all("SELECT id FROM att_users WHERE role='hr' AND active=1")) notify(h.id, kind, title, body, key ? `${key}:${h.id}` : null);
  }
  // a request goes to the person's reporting manager; with no manager it goes to HR
  function notifyApprovers(userId, kind, title, body, key = null) {
    const m = managerOf(userId);
    if (m) notify(m.id, kind, title, body, key ? `${key}:${m.id}` : null);
    else notifyHr(kind, title, body, key);
  }

  function pendingApprovalCount(actor) {
    const ids = actor.role === 'hr' ? null : reporteeIds(actor.id);
    if (ids && !ids.length) return 0;
    const where = ids ? `AND user_id IN (${ids.map(() => '?').join(',')})` : '';
    const q = (table) => get(`SELECT COUNT(*) c FROM ${table} WHERE status='pending' ${where}`, ...(ids || [])).c;
    return q('att_leaves') + q('att_regularizations') + q('att_compoff') + q('att_timesheets');
  }

  // ---------- birthdays, work anniversaries, new joiners ----------
  const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const onYear = (md, y) => (md === '02-29' && !isLeap(y) ? `${y}-02-28` : `${y}-${md}`);
  // everyone (active) whose birthday / work anniversary falls between two dates; only the day and month are shared, never the age
  function celebrations(from, to) {
    const out = { birthdays: [], anniversaries: [] };
    const y0 = +from.slice(0, 4), y1 = +to.slice(0, 4);
    for (const u of all('SELECT * FROM att_users WHERE active=1')) {
      for (let y = y0; y <= y1; y++) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(u.dob || '')) {
          const d = onYear(u.dob.slice(5), y);
          if (d >= from && d <= to) out.birthdays.push({ user: u, date: d });
        }
        const years = y - +String(u.start_date).slice(0, 4);
        if (years >= 1) {
          const d = onYear(String(u.start_date).slice(5), y);
          if (d >= from && d <= to && (!u.end_date || d <= u.end_date)) out.anniversaries.push({ user: u, date: d, years });
        }
      }
    }
    const by = (a, b) => a.date.localeCompare(b.date) || a.user.name.localeCompare(b.user.name);
    out.birthdays.sort(by); out.anniversaries.sort(by);
    return out;
  }

  // ---------- corrections (regularization) ----------
  // A day can only be corrected when a punch was actually missed: no check-in at all, or a check-in without a check-out.
  // Today, upcoming days, holidays, weekly offs, leave days and complete days are refused.
  function regularizeCheck(user, date) {
    const t = ist().date, win = settings().regularizeWindow;
    if (date >= t) return { error: date === t ? 'Today is not over yet. Check in or out from the Home screen; corrections are for earlier days.' : 'You can only correct days that have already passed, not upcoming days.' };
    if (date < addDays(t, -win)) return { error: `Corrections are allowed for the last ${win} days only.` };
    const d = dayFor(user, date);
    if (d.status === 'na') return { error: 'That date is outside your engagement.' };
    if (d.check_in && d.check_out) return { error: 'Check-in and check-out are both recorded for that day, so there is nothing to correct.' };
    if (d.check_in) return { missing: 'out', day: d };
    if (d.status === 'absent' || (d.status === 'leave' && d.half)) return { missing: 'in', day: d };
    return { error: d.status === 'holiday' ? 'That day is a holiday, so no punch is missing.' : d.status === 'weekend' ? 'That day is a weekly off, so no punch is missing.' : 'You are on leave that day, so no punch is missing.' };
  }
  function regularizable(user) {
    const t = ist().date, from = [addDays(t, -settings().regularizeWindow), user.start_date].sort().at(-1);
    const pending = new Set(all("SELECT date FROM att_regularizations WHERE user_id=? AND status='pending'", user.id).map((x) => x.date));
    const days = [];
    for (let d = addDays(t, -1); d >= from; d = addDays(d, -1)) {
      if (pending.has(d)) continue;
      const c = regularizeCheck(user, d);
      if (c.missing) days.push({ date: d, missing: c.missing, check_in: c.day.check_in ? ist(new Date(c.day.check_in)).hhmm : null });
    }
    return days;
  }

  // ---------- leave policy engine ----------
  function countLeaveDays(user, type, from, to, half) {
    if (half) return 0.5;
    const shift = shiftOf(user);
    const hol = holidayMap(from, to);
    let n = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) if (type.count_weekends || isWorkingDay(d, shift, hol)) n++;
    return n;
  }

  // Comp-off: oldest grants are used first; a grant can only be used before it expires.
  function compoffBalance(userId, asOf = ist().date) {
    const grants = all("SELECT days, expires_on FROM att_compoff WHERE user_id=? AND status='approved' ORDER BY worked_date", userId).map((g) => ({ ...g, left: g.days }));
    const uses = all(
      `SELECT l.days, l.from_date FROM att_leaves l JOIN att_leave_types t ON t.id=l.type_id
       WHERE l.user_id=? AND t.is_compoff=1 AND l.status IN ('approved','pending') ORDER BY l.from_date`, userId);
    for (const u of uses) {
      let need = u.days;
      for (const g of grants) {
        if (need <= 0) break;
        if (g.left > 0 && g.expires_on >= u.from_date) { const take = Math.min(g.left, need); g.left -= take; need -= take; }
      }
    }
    return {
      granted: grants.reduce((a, g) => a + g.days, 0),
      balance: grants.filter((g) => g.expires_on >= asOf).reduce((a, g) => a + g.left, 0),
      expiring: grants.filter((g) => g.left > 0 && g.expires_on >= asOf).sort((a, b) => a.expires_on.localeCompare(b.expires_on))[0]?.expires_on || null,
    };
  }

  function balanceFor(user, t, year) {
    const yStart = `${year}-01-01`, yEnd = `${year}-12-31`;
    const sumDays = (status, y0 = yStart, y1 = yEnd) => get(
      'SELECT COALESCE(SUM(days),0) d FROM att_leaves WHERE user_id=? AND type_id=? AND status=? AND from_date BETWEEN ? AND ?', user.id, t.id, status, y0, y1).d;
    const adjusted = (y) => get('SELECT COALESCE(SUM(days),0) d FROM att_leave_adjust WHERE user_id=? AND type_id=? AND year=?', user.id, t.id, y).d;
    const out = {
      id: t.id, code: t.code, name: t.name, color: t.color, paid: !!t.paid, is_wfh: !!t.is_wfh, is_compoff: !!t.is_compoff, is_optional: !!t.is_optional,
      quota: t.quota, booked: sumDays('approved'), pending: sumDays('pending'), unlimited: false,
    };
    if (t.is_wfh) return { ...out, unlimited: true, balance: null };
    if (t.is_compoff) { const b = compoffBalance(user.id); return { ...out, granted: b.granted, expiring: b.expiring, balance: b.balance }; }
    if (t.quota == null) return { ...out, unlimited: true, balance: null };

    const now = ist();
    const nowY = +now.date.slice(0, 4), nowM = +now.date.slice(5, 7);
    const months = year < nowY ? 12 : year > nowY ? 0 : nowM;
    const accrued = t.accrual === 'monthly' ? Math.round((t.quota / 12) * months * 2) / 2 : t.quota;
    let carried = 0;
    if (t.carry_forward > 0 && user.start_date <= `${year - 1}-12-31`) {
      const closing = t.quota + adjusted(year - 1) - sumDays('approved', `${year - 1}-01-01`, `${year - 1}-12-31`);
      carried = Math.min(t.carry_forward, Math.max(0, closing));
    }
    const adj = adjusted(year);
    const available = accrued + carried + adj;
    return { ...out, accrued: round1(accrued), carried: round1(carried), adjusted: round1(adj), available: round1(available), balance: round1(available - out.booked - out.pending) };
  }

  const typesFor = (user) => all('SELECT * FROM att_leave_types WHERE active=1 ORDER BY is_wfh, id')
    .filter((t) => t.applies_to === 'all' || t.applies_to === user.role || user.role === 'hr');
  const leaveBalances = (user, year) => typesFor(user).map((t) => balanceFor(user, t, year));

  return {
    all, get, run, settings, rawSettings, publicUser, listShifts, defaultShift, shiftOf, shiftRow,
    holidayMap, optionalHolidayMap, isWorkingDay, approvedLeaves, dayInfo, dayFor, stateOf, buildCalendar,
    trackedUsers, isUntracked, celebrations, regularizeCheck, regularizable, reporteeIds, isManager, managerOf, canView, canDecide, notify, notifyHr, notifyApprovers, pendingApprovalCount,
    countLeaveDays, compoffBalance, balanceFor, typesFor, leaveBalances, daysBetween,
  };
}
