import { ist, toMin, addDays } from './util.js';

/**
 * Reminder engine. Ticks every 30s (IST). Respects each person's shift (weekly off, grace time).
 *  - check-in reminders at `remind_in` times (default 10:00, 10:30) for people not checked in
 *  - check-out reminders at `remind_out` times (default 17:30, 18:00) for people still checked in
 *  - "you forgot to check out yesterday" at the first check-in reminder time
 *  - HR digest of people not checked in at `hr_digest`
 *  - "requests waiting for your approval" for HR and reporting managers at `remind_approvals`
 * Notifications are de-duplicated by key, so a restart or double tick never double-sends.
 */
export function runReminders(core, now = new Date()) {
  const t = ist(now);
  const s = core.settings();
  const hol = core.holidayMap(t.date, t.date);
  let sent = 0;

  const eligible = core.trackedUsers().filter((u) =>
    u.checkin_method !== 'kiosk' && t.date >= u.start_date && (!u.end_date || t.date <= u.end_date));
  const missing = [];

  for (const u of eligible) {
    const shift = core.shiftOf(u);
    if (!core.isWorkingDay(t.date, shift, hol)) continue;
    const rec = core.get('SELECT * FROM att_records WHERE user_id=? AND date=?', u.id, t.date);
    const leaves = core.approvedLeaves(u.id, t.date, t.date);
    if (leaves.some((l) => !l.is_wfh && !l.half)) continue;
    const wfh = leaves.some((l) => l.is_wfh);
    const first = u.name.split(' ')[0];
    if (!rec) missing.push(u);

    const dm = toMin(shift.start) + shift.grace;
    const deadline = `${String(Math.floor(dm / 60)).padStart(2, '0')}:${String(dm % 60).padStart(2, '0')}`;

    if (s.remindIn.includes(t.hhmm) && !rec) {
      const late = t.hhmm > shift.start; // first nudge (at or before shift start) is friendly, later ones are firmer
      sent += core.notify(u.id, 'checkin', late ? 'Please check in' : 'Good morning! Time to check in',
        wfh ? `Hi ${first}, you are on WFH today. Check in from the app and share today's plan.`
          : `Hi ${first}, you haven't checked in yet. Please check in at the MCCIA office before ${deadline} to avoid a late mark.`,
        `in:${t.date}:${t.hhmm}:${u.id}`).changes;
    }
    if (s.remindOut.includes(t.hhmm) && rec?.check_in && !rec.check_out) {
      sent += core.notify(u.id, 'checkout', 'Time to check out',
        `Hi ${first}, wrapping up? Don't forget to check out before you leave.`, `out:${t.date}:${t.hhmm}:${u.id}`).changes;
    }
  }

  // missed check-out in the last few days
  if (s.remindIn[0] === t.hhmm) {
    for (const u of eligible) {
      const rec = core.get('SELECT * FROM att_records WHERE user_id=? AND date<? AND date>=? AND check_in IS NOT NULL AND check_out IS NULL ORDER BY date DESC',
        u.id, t.date, addDays(t.date, -3));
      if (rec) sent += core.notify(u.id, 'checkout', 'You forgot to check out',
        `There is no check-out on ${rec.date}. Send a correction from the calendar so your hours are right.`, `missed:${rec.id}`).changes;
    }
  }

  if (t.hhmm === s.hrDigest && missing.length) {
    core.notifyHr('digest', `${missing.length} yet to check in`, missing.map((u) => u.name).join(', '), `digest:${t.date}`);
    sent++;
  }

  if (t.hhmm === s.remindApprovals) {
    const approvers = [
      ...core.all("SELECT * FROM att_users WHERE role='hr' AND active=1"),
      ...core.all('SELECT * FROM att_users WHERE active=1 AND id IN (SELECT DISTINCT manager_id FROM att_users WHERE manager_id IS NOT NULL AND active=1)'),
    ];
    for (const a of approvers) {
      const n = core.pendingApprovalCount(a);
      if (n > 0) sent += core.notify(a.id, 'approval', `${n} request${n === 1 ? '' : 's'} waiting for your approval`, 'Open Approvals to review them.', `appr:${t.date}:${a.id}`).changes;
    }
  }

  // birthdays and work anniversaries: one greeting for the person, one summary for everyone else
  if (s.birthdayTime && t.hhmm === s.birthdayTime) {
    const c = core.celebrations(t.date, t.date);
    const everyone = core.all('SELECT id FROM att_users WHERE active=1').map((x) => x.id);
    const first = (u) => u.name.split(' ')[0];
    const announce = (kind, list, selfTitle, selfBody, summary) => {
      for (const x of list) sent += core.notify(x.user.id, kind, selfTitle(x), selfBody, `${kind}-self:${t.date}:${x.user.id}`).changes;
      for (const id of everyone) {
        const rest = list.filter((x) => x.user.id !== id);
        if (rest.length) sent += core.notify(id, kind, summary(rest), 'Open Feeds to send your wishes.', `${kind}:${t.date}:${id}`).changes;
      }
    };
    announce('birthday', c.birthdays, (x) => `Happy Birthday, ${first(x.user)}!`, 'Everyone at MCCIA wishes you a wonderful year ahead.',
      (rest) => (rest.length === 1 ? `Today is ${rest[0].user.name}'s birthday` : `Birthdays today: ${rest.map((x) => x.user.name).join(', ')}`));
    announce('anniversary', c.anniversaries, (x) => `Happy work anniversary, ${first(x.user)}!`, 'Thank you for being part of MCCIA.',
      (rest) => (rest.length === 1 ? `${rest[0].user.name} completes ${rest[0].years} year${rest[0].years === 1 ? '' : 's'} at MCCIA today` : `Work anniversaries today: ${rest.map((x) => x.user.name).join(', ')}`));
  }
  return { sent };
}

export function startScheduler(core) {
  const tick = () => { try { runReminders(core); } catch (e) { console.error('[attendance] reminder error', e); } };
  const h = setInterval(tick, 30_000);
  h.unref?.();
  tick();
  return () => clearInterval(h);
}
