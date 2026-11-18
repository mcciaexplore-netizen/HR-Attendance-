import { DEFAULT_SETTINGS, hashPin } from './core.js';
import { ist, addDays, dowOf, istIso, weekStart } from './util.js';

// Small deterministic PRNG so demo data is stable
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export function seedIfEmpty(db, { demo = true } = {}) {
  const run = (sql, ...p) => db.prepare(sql).run(...p);
  const get = (sql, ...p) => db.prepare(sql).get(...p);
  if (get('SELECT COUNT(*) c FROM att_users').c > 0) return;

  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) run('INSERT OR IGNORE INTO att_settings(key,value) VALUES (?,?)', k, v);

  // the default "General" shift is created by the migration; add one more as an example
  run("INSERT OR IGNORE INTO att_shifts(name,start_time,end_time,grace_min,full_hours,half_hours,week_off,is_default) VALUES ('Early Shift','09:00','17:00',15,7,4,'0,6',0)");

  const T = db.prepare(`INSERT OR IGNORE INTO att_leave_types
    (code,name,quota,is_wfh,paid,color,accrual,carry_forward,max_consecutive,min_notice_days,allow_half,backdate_days,count_weekends,doc_after_days,applies_to,is_optional,is_compoff)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  //  code  name               quota wfh paid color      accrual  carry maxC notice half back wknd doc  applies  opt coff
  T.run('CL', 'Casual Leave', 6, 0, 1, '#38a3f5', 'yearly', 0, 3, 0, 1, 30, 0, null, 'all', 0, 0);
  T.run('SL', 'Sick Leave', 6, 0, 1, '#f2994a', 'yearly', 0, null, 0, 1, 30, 0, 2, 'all', 0, 0);
  T.run('CO', 'Comp-off', null, 0, 1, '#27ae60', 'yearly', 0, null, 0, 1, 30, 0, null, 'all', 0, 1);
  T.run('OH', 'Optional Holiday', 2, 0, 1, '#e0003c', 'yearly', 0, 1, 0, 0, 0, 0, null, 'all', 1, 0);
  T.run('UL', 'Unpaid Leave', null, 0, 0, '#7c5ce6', 'yearly', 0, null, 0, 1, 30, 0, null, 'all', 0, 0);
  T.run('WFH', 'Work From Home', null, 1, 1, '#0f9d8a', 'yearly', 0, null, 0, 1, 7, 0, null, 'all', 0, 0);

  const year = ist().date.slice(0, 4);
  const nextYear = String(+year + 1);
  const hols = [
    [`${year}-01-26`, 'Republic Day'], [`${year}-05-01`, 'Maharashtra Day'], [`${year}-08-15`, 'Independence Day'],
    [`${year}-10-02`, 'Gandhi Jayanti'], [`${year}-12-25`, 'Christmas'],
  ];
  for (const h of [...hols, ...hols.map(([d, n]) => [nextYear + d.slice(4), n])]) run('INSERT OR IGNORE INTO att_holidays(date,name) VALUES (?,?)', ...h);
  // optional (restricted) holidays: employees may opt in for up to 2 a year
  run('INSERT OR IGNORE INTO att_holidays(date,name,optional) VALUES (?,?,1)', `${year}-12-24`, 'Christmas Eve (optional)');
  run('INSERT OR IGNORE INTO att_holidays(date,name,optional) VALUES (?,?,1)', `${year}-12-31`, "New Year's Eve (optional)");

  // (demo) HR joined exactly five years ago today, so Feeds has a work anniversary to show
  run(`INSERT INTO att_users(emp_code,name,email,role,department,designation,dob,pin_hash,start_date,checkin_method)
       VALUES ('HR001','HR Admin','hr@mccia.example','hr','Human Resources','HR Manager',?,?,?,'both')`,
    `1988-${addDays(ist().date, 40).slice(5)}`, hashPin('1234'), `${+year - 5}-${ist().date.slice(5)}`);
  const hrId = get("SELECT id FROM att_users WHERE emp_code='HR001'").id;

  run(`INSERT INTO att_announcements(title,body) VALUES (?,?)`,
    'Welcome to MCCIA Attendance Tracker',
    'Check in before 10:30 AM and check out after 6:00 PM. Working from home? Apply for WFH first, then check in from the Home screen.');

  // time tracker: projects and jobs
  const PROJECTS = [
    ['Membership Drive', 'New member outreach and onboarding', ['Data entry', 'Outreach calls']],
    ['Events & Conferences', 'Planning and on-ground support', ['Planning', 'On-ground support']],
    ['Research & Policy', 'Desk research and policy notes', ['Desk research', 'Report writing']],
    ['General / Admin', 'Everything else', ['Meetings', 'Training']],
  ];
  for (const [name, desc, jobs] of PROJECTS) {
    const { lastInsertRowid: pid } = run('INSERT INTO att_projects(name,description) VALUES (?,?)', name, desc);
    for (const j of jobs) run('INSERT INTO att_jobs(project_id,name) VALUES (?,?)', pid, j);
  }

  if (!demo) return;

  const today = ist().date;
  const people = [
    ['INT1001', 'Aarav Deshmukh', 'intern', 'Research', 'both'],
    ['INT1002', 'Isha Kulkarni', 'intern', 'Events', 'both'],
    ['INT1003', 'Rohan Patil', 'intern', 'Policy', 'both'],
    ['CON2001', 'Meera Joshi', 'consultant', 'Trade Facilitation', 'phone'],
    ['INT1004', 'Sahil Bhosale', 'intern', 'Membership', 'both'],
  ];
  const start = addDays(today, -70);
  const typeId = (code) => get('SELECT id FROM att_leave_types WHERE code=?', code).id;
  const wfhId = typeId('WFH'), clId = typeId('CL');
  const hol = new Set(hols.map((h) => h[0]));
  const ins = db.prepare(`INSERT INTO att_records(user_id,date,check_in,check_out,in_mode,in_source,in_dist,in_note,late,late_min,out_source)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insLeave = db.prepare(`INSERT INTO att_leaves(user_id,type_id,from_date,to_date,days,reason,status,decided_by,decided_at) VALUES (?,?,?,?,1,?,?,?,datetime('now'))`);
  const ids = {};

  people.forEach(([code, name, role, dept, method], i) => {
    const { lastInsertRowid: uid } = run(
      `INSERT INTO att_users(emp_code,name,email,role,department,pin_hash,start_date,checkin_method)
       VALUES (?,?,?,?,?,?,?,?)`, code, name, `${code.toLowerCase()}@mccia.example`, role, dept, hashPin('1111'), start, method);
    ids[code] = uid;
    const r = rng(7 + i * 31);
    for (let d = start; d < today; d = addDays(d, 1)) {
      if (![1, 2, 3, 4, 5].includes(dowOf(d)) || hol.has(d)) continue;
      const x = r();
      if (x < 0.05) { insLeave.run(uid, clId, d, d, 'Personal work', 'approved', hrId); continue; }
      if (x < 0.09) continue; // absent
      const wfh = x > 0.9;
      if (wfh) insLeave.run(uid, wfhId, d, d, 'Report writing', 'approved', hrId);
      const late = x > 0.78 && x <= 0.9;
      const inMin = late ? 631 + Math.floor(r() * 50) : 575 + Math.floor(r() * 50);
      const outMin = 1050 + Math.floor(r() * 70);
      const miss = r() < 0.03;
      ins.run(uid, d, istIso(d, hhmm(inMin)), miss ? null : istIso(d, hhmm(outMin)),
        wfh ? 'wfh' : 'office', method === 'kiosk' ? 'kiosk' : 'phone', wfh ? null : Math.floor(r() * 90),
        wfh ? 'Working on policy note draft' : null, late ? 1 : 0, late ? inMin - 600 : 0, miss ? null : method === 'kiosk' ? 'kiosk' : 'phone');
    }
  });

  // designations and birthdays (one today, the others in the coming weeks) so Feeds has something to show
  const profile = { INT1001: ['Research Intern', 9, 2002], INT1002: ['Events Intern', 3, 2003], INT1003: ['Policy Intern', 0, 2002], CON2001: ['Senior Consultant', 17, 1990], INT1004: ['Membership Intern', 25, 2003] };
  for (const [code, [designation, off, y]] of Object.entries(profile)) {
    run('UPDATE att_users SET designation=?, dob=? WHERE id=?', designation, `${y}-${addDays(today, off).slice(5)}`, ids[code]);
  }

  // Two approval cycles. Interns report to a consultant manager (Meera); the consultant manager reports to an MCCIA
  // department head who only approves (role "approver", no attendance of their own here).
  const { lastInsertRowid: anjali } = run(
    `INSERT INTO att_users(emp_code,name,email,role,department,designation,dob,pin_hash,start_date,checkin_method)
     VALUES ('MGR3001','Anjali Kulkarni','mgr3001@mccia.example','approver','Trade Facilitation','Head, Trade Facilitation',?,?,?,'phone')`,
    `1979-${addDays(today, 26).slice(5)}`, hashPin('1111'), `${+today.slice(0, 4) - 4}-${addDays(today, 5).slice(5)}`);
  run('UPDATE att_users SET manager_id=? WHERE id=?', anjali, ids.CON2001);
  run('UPDATE att_users SET manager_id=? WHERE id=?', ids.CON2001, ids.INT1003);

  // a pending request and an approved future WFH, so the approval screens and calendar have something to show
  run(`INSERT INTO att_leaves(user_id,type_id,from_date,to_date,days,reason,status) VALUES (?,?,?,?,1,'Family function','pending')`, ids.INT1002, clId, addDays(today, 9), addDays(today, 9));
  insLeave.run(ids.CON2001, wfhId, addDays(today, 2), addDays(today, 2), 'Writing the quarterly report', 'approved', hrId);

  // extra work on a Saturday → comp-off. Meera has an approved comp-off; Rohan's is still to be requested.
  const lastSat = (back) => { let d = addDays(today, -back); while (dowOf(d) !== 6) d = addDays(d, -1); return d; };
  const sat1 = lastSat(8), sat2 = lastSat(16);
  ins.run(ids.CON2001, sat1, istIso(sat1, '10:05'), istIso(sat1, '17:40'), 'office', 'phone', 40, null, 0, 0, 'phone');
  ins.run(ids.INT1003, sat2, istIso(sat2, '10:15'), istIso(sat2, '17:20'), 'office', 'phone', 22, null, 0, 0, 'phone');
  run(`INSERT INTO att_compoff(user_id,worked_date,days,reason,status,expires_on,decided_by,decided_at) VALUES (?,?,1,'Event set-up on Saturday','approved',?,?,datetime('now'))`,
    ids.CON2001, sat1, addDays(sat1, 60), hrId);

  // time logs for the last three weeks (before the current one) and their timesheets
  const w0 = weekStart(today);
  const jobsByProject = new Map();
  for (const j of db.prepare('SELECT * FROM att_jobs').all()) jobsByProject.set(j.project_id, [...(jobsByProject.get(j.project_id) || []), j.id]);
  const insLog = db.prepare('INSERT INTO att_timelogs(user_id,date,project_id,job_id,minutes,notes) VALUES (?,?,?,?,?,?)');
  const notes = ['Data cleanup', 'Call follow-ups', 'Draft note', 'Venue coordination', 'Weekly sync', 'Research summary'];
  people.forEach(([code], i) => {
    const r = rng(101 + i * 17);
    for (let d = addDays(w0, -21); d < w0; d = addDays(d, 1)) {
      if (![1, 2, 3, 4, 5].includes(dowOf(d)) || hol.has(d)) continue;
      let left = 360 + Math.floor(r() * 4) * 30; // 6 to 7.5 hours
      while (left > 0) {
        const pid = 1 + Math.floor(r() * 4);
        const js = jobsByProject.get(pid);
        const m = Math.min(left, (1 + Math.floor(r() * 4)) * 60);
        insLog.run(ids[code], d, pid, js[Math.floor(r() * js.length)], m, notes[Math.floor(r() * notes.length)]);
        left -= m;
      }
    }
    for (const back of [21, 14]) run(`INSERT INTO att_timesheets(user_id,week_start,status,submitted_at,decided_by,decided_at) VALUES (?,?,'approved',datetime('now'),?,datetime('now'))`, ids[code], addDays(w0, -back), hrId);
    if (i < 2) run(`INSERT INTO att_timesheets(user_id,week_start,status,submitted_at) VALUES (?,?,'pending',datetime('now'))`, ids[code], addDays(w0, -7));
  });
}
