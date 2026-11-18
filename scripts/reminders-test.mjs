// Reminder engine checks with a simulated clock. Run: node scripts/reminders-test.mjs
import { openDb } from '../server/db.js';
import { seedIfEmpty } from '../server/seed.js';
import { makeCore } from '../server/core.js';
import { runReminders } from '../server/scheduler.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const f = path.join(os.tmpdir(), 'mccia-reminders-test.db'); // throwaway database
for (const x of ['', '-wal', '-shm']) try { fs.unlinkSync(f + x); } catch {}
const db = openDb(f); seedIfEmpty(db, { demo: true });
const core = makeCore(db);
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const at = (hhmm) => new Date(`${today}T${hhmm}:00+05:30`);
const n = (q, ...p) => db.prepare(q).get(...p).c;
let ok = 0, bad = 0;
const check = (name, cond, extra = '') => { cond ? ok++ : bad++; console.log(`${cond ? '  ✔' : '  ✘ FAIL'} ${name} ${cond ? '' : extra}`); };

// 10:00 - everyone with no check-in today gets a reminder; tablet-less demo people are all phone-capable
let r = runReminders(core, at('10:00'));
check('10:00 check-in reminders sent to people not yet in', r.sent >= 4, JSON.stringify(r));
const aarav = db.prepare("SELECT id FROM att_users WHERE emp_code='INT1001'").get().id;
check('Aarav got "Good morning" reminder', n("SELECT COUNT(*) c FROM att_notifications WHERE user_id=? AND title LIKE 'Good morning%'", aarav) === 1);
check('running the same minute twice does not duplicate', runReminders(core, at('10:00')).sent === 0);
// 10:30 - second reminder, now labelled "Please check in" and mentions the 10:30 deadline
runReminders(core, at('10:30'));
check('10:30 sends a second, firmer reminder', n("SELECT COUNT(*) c FROM att_notifications WHERE user_id=? AND title='Please check in'", aarav) === 1);
const body = db.prepare("SELECT body FROM att_notifications WHERE user_id=? AND title='Please check in'").get(aarav).body;
check('reminder mentions the shift deadline (start + grace = 10:30)', /before 10:30/.test(body), body);
// someone who already checked in is skipped
db.prepare("INSERT INTO att_records(user_id,date,check_in,in_mode,in_source) VALUES (?,?,?, 'office','phone')").run(aarav, today, new Date().toISOString());
const before = n("SELECT COUNT(*) c FROM att_notifications WHERE user_id=?", aarav);
runReminders(core, at('10:30'));
check('checked-in people are skipped', n("SELECT COUNT(*) c FROM att_notifications WHERE user_id=?", aarav) === before);
// 10:45 HR digest
runReminders(core, at('10:45'));
check('10:45 HR digest lists who is missing', n("SELECT COUNT(*) c FROM att_notifications WHERE kind='digest'") >= 1);
// 17:30 check-out reminder for Aarav (checked in, not out)
runReminders(core, at('17:30'));
check('17:30 check-out reminder for people still checked in', n("SELECT COUNT(*) c FROM att_notifications WHERE user_id=? AND kind='checkout'", aarav) >= 1);
// 11:00 approvals reminder: HR has the seeded pending leave + timesheets
runReminders(core, at('11:00'));
const hr = db.prepare("SELECT id FROM att_users WHERE role='hr'").get().id;
const ap = db.prepare("SELECT title FROM att_notifications WHERE user_id=? AND title LIKE '%waiting for your approval'").get(hr);
check('11:00 HR is reminded about pending approvals', !!ap, JSON.stringify(ap));
// manager gets reminded only for their team
const meera = db.prepare("SELECT id FROM att_users WHERE emp_code='CON2001'").get().id;
const isha = db.prepare("SELECT id FROM att_users WHERE emp_code='INT1002'").get().id;
db.prepare('UPDATE att_users SET manager_id=? WHERE id=?').run(meera, isha);
db.prepare("DELETE FROM att_notifications WHERE dedupe_key LIKE 'appr:%'").run();
runReminders(core, at('11:00'));
const mm = db.prepare("SELECT title FROM att_notifications WHERE user_id=? AND title LIKE '%waiting for your approval'").get(meera);
check('a manager is reminded about their own team\'s pending items', !!mm && /^\d+ request/.test(mm.title), JSON.stringify(mm));
// weekly off: nobody is reminded on a day that is a weekly off for their shift
const off = db.prepare("SELECT id FROM att_shifts WHERE is_default=1").get().id;
const dow = new Date(today + 'T00:00:00Z').getUTCDay();
db.prepare('UPDATE att_shifts SET week_off=? WHERE id=?').run(String(dow), off);
db.prepare("DELETE FROM att_notifications").run();
runReminders(core, at('10:00'));
check('no reminders on a weekly off', n('SELECT COUNT(*) c FROM att_notifications') === 0);
// 09:00 birthdays and work anniversaries (demo data: Rohan's birthday and HR's 5-year anniversary are today)
db.prepare('DELETE FROM att_notifications').run();
const rohanId = db.prepare("SELECT id FROM att_users WHERE emp_code='INT1003'").get().id;
runReminders(core, at('09:00'));
check('09:00 the birthday person gets a greeting', n("SELECT COUNT(*) c FROM att_notifications WHERE user_id=? AND title LIKE 'Happy Birthday%'", rohanId) === 1);
const others = n("SELECT COUNT(*) c FROM att_users WHERE active=1") - 1;
check('everyone else gets one birthday summary', n("SELECT COUNT(*) c FROM att_notifications WHERE kind='birthday' AND title='Today is Rohan Patil''s birthday'") === others);
check('HR gets a work anniversary greeting', n("SELECT COUNT(*) c FROM att_notifications WHERE user_id=? AND title LIKE 'Happy work anniversary%'", hr) === 1);
check('others hear about the 5-year anniversary', n("SELECT COUNT(*) c FROM att_notifications WHERE kind='anniversary' AND title LIKE 'HR Admin completes 5 years%'") === others);
check('running 09:00 again does not duplicate', runReminders(core, at('09:00')).sent === 0);
db.prepare('DELETE FROM att_notifications').run();
db.prepare("INSERT OR REPLACE INTO att_settings(key,value) VALUES ('remind_birthdays','')").run();
runReminders(core, at('09:00'));
check('birthday notices can be switched off in settings', n("SELECT COUNT(*) c FROM att_notifications WHERE kind IN ('birthday','anniversary')") === 0);
console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
