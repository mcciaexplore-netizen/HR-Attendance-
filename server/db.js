import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// All tables are prefixed `att_` so this module can share a database with the MCCIA app hub.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS att_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  emp_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT, phone TEXT,
  role TEXT NOT NULL DEFAULT 'intern',            -- hr | approver | intern | consultant
  department TEXT,
  pin_hash TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  checkin_method TEXT NOT NULL DEFAULT 'both',    -- phone | kiosk | both
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS att_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS att_shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  start_time TEXT NOT NULL, end_time TEXT NOT NULL,
  grace_min INTEGER NOT NULL DEFAULT 30,
  full_hours REAL NOT NULL DEFAULT 7,
  half_hours REAL NOT NULL DEFAULT 4,
  week_off TEXT NOT NULL DEFAULT '0,6',           -- weekly-off days, 0=Sun
  is_default INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS att_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES att_users(id),
  date TEXT NOT NULL,
  check_in TEXT, check_out TEXT,
  in_mode TEXT, in_source TEXT, in_lat REAL, in_lng REAL, in_dist INTEGER, in_acc INTEGER, in_note TEXT, in_photo TEXT,
  out_source TEXT, out_lat REAL, out_lng REAL, out_dist INTEGER, out_acc INTEGER, out_note TEXT, out_photo TEXT,
  late INTEGER NOT NULL DEFAULT 0, late_min INTEGER NOT NULL DEFAULT 0,
  regularized INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, date)
);
CREATE TABLE IF NOT EXISTS att_leave_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  quota REAL,                 -- NULL = no cap
  is_wfh INTEGER NOT NULL DEFAULT 0,
  paid INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS att_leaves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES att_users(id),
  type_id INTEGER NOT NULL REFERENCES att_leave_types(id),
  from_date TEXT NOT NULL, to_date TEXT NOT NULL,
  half INTEGER NOT NULL DEFAULT 0, days REAL NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',          -- pending | approved | rejected | cancelled
  decided_by INTEGER, decided_at TEXT, remark TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS att_leave_adjust (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES att_users(id),
  type_id INTEGER NOT NULL REFERENCES att_leave_types(id),
  year INTEGER NOT NULL, days REAL NOT NULL, remark TEXT,
  by_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS att_compoff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES att_users(id),
  worked_date TEXT NOT NULL, days REAL NOT NULL, reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',          -- pending | approved | rejected | cancelled
  expires_on TEXT,
  decided_by INTEGER, decided_at TEXT, remark TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, worked_date)
);
CREATE TABLE IF NOT EXISTS att_holidays (date TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS att_regularizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES att_users(id),
  date TEXT NOT NULL, check_in TEXT NOT NULL, check_out TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by INTEGER, decided_at TEXT, remark TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS att_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES att_users(id),
  kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT,
  dedupe_key TEXT UNIQUE,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS att_announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL, body TEXT, created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS att_kiosks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, token TEXT UNIQUE NOT NULL,
  last_seen TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS att_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL, description TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS att_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES att_projects(id),
  name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS att_timelogs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES att_users(id),
  date TEXT NOT NULL,
  project_id INTEGER NOT NULL REFERENCES att_projects(id),
  job_id INTEGER REFERENCES att_jobs(id),
  minutes INTEGER NOT NULL, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS att_timesheets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES att_users(id),
  week_start TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',          -- pending | approved | rejected
  submitted_at TEXT, decided_by INTEGER, decided_at TEXT, remark TEXT,
  UNIQUE(user_id, week_start)
);
-- birthday / work-anniversary / welcome wishes (one per sender, person, occasion and year)
CREATE TABLE IF NOT EXISTS att_wishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL REFERENCES att_users(id),
  to_id INTEGER NOT NULL REFERENCES att_users(id),
  kind TEXT NOT NULL,                              -- birthday | anniversary | welcome
  year INTEGER NOT NULL, message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(from_id, to_id, kind, year)
);
CREATE INDEX IF NOT EXISTS att_records_date ON att_records(date);
CREATE INDEX IF NOT EXISTS att_leaves_user ON att_leaves(user_id, status);
CREATE INDEX IF NOT EXISTS att_timelogs_user ON att_timelogs(user_id, date);
`;

// Columns added after the first release. Added in place so existing databases keep working.
const COLUMNS = {
  att_users: [['shift_id', 'INTEGER'], ['manager_id', 'INTEGER'], ['dob', 'TEXT'], ['designation', 'TEXT']],
  att_leave_types: [
    ['color', 'TEXT'], ['accrual', "TEXT NOT NULL DEFAULT 'yearly'"], ['carry_forward', 'REAL NOT NULL DEFAULT 0'],
    ['max_consecutive', 'REAL'], ['min_notice_days', 'INTEGER NOT NULL DEFAULT 0'], ['allow_half', 'INTEGER NOT NULL DEFAULT 1'],
    ['backdate_days', 'INTEGER'], ['count_weekends', 'INTEGER NOT NULL DEFAULT 0'], ['doc_after_days', 'REAL'],
    ['applies_to', "TEXT NOT NULL DEFAULT 'all'"], ['is_optional', 'INTEGER NOT NULL DEFAULT 0'],
    ['is_compoff', 'INTEGER NOT NULL DEFAULT 0'], ['active', 'INTEGER NOT NULL DEFAULT 1'],
  ],
  att_leaves: [['session', 'TEXT'], ['attachment', 'TEXT'], ['attachment_name', 'TEXT'], ['cc', 'TEXT']],
  att_holidays: [['optional', 'INTEGER NOT NULL DEFAULT 0']],
};

const TYPE_DEFAULTS = {
  CL: { color: '#38a3f5', max_consecutive: 3, backdate_days: 30 },
  SL: { color: '#f2994a', backdate_days: 30, doc_after_days: 2 },
  CO: { color: '#27ae60', backdate_days: 30, is_compoff: 1 },
  UL: { color: '#7c5ce6', backdate_days: 30 },
  WFH: { color: '#0f9d8a', backdate_days: 7 },
  OH: { color: '#e0003c', allow_half: 0, backdate_days: 0, is_optional: 1 },
};

function migrate(db) {
  for (const [table, cols] of Object.entries(COLUMNS)) {
    const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const [name, ddl] of cols) if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
  }

  // The first release kept the working hours in settings; they now live in a default shift.
  if (!db.prepare('SELECT 1 FROM att_shifts LIMIT 1').get()) {
    const g = (k, d) => db.prepare('SELECT value FROM att_settings WHERE key=?').get(k)?.value ?? d;
    const working = String(g('working_days', '1,2,3,4,5')).split(',').map(Number);
    const off = [0, 1, 2, 3, 4, 5, 6].filter((d) => !working.includes(d)).join(',');
    db.prepare('INSERT INTO att_shifts(name,start_time,end_time,grace_min,full_hours,half_hours,week_off,is_default) VALUES (?,?,?,?,?,?,?,1)')
      .run('General', g('shift_start', '10:00'), g('shift_end', '18:00'), +g('grace_min', 30), +g('full_day_hours', 7), +g('half_day_hours', 4), off);
  }

  // Existing installs: give the built-in leave types their policy defaults and add Optional Holiday.
  if (db.prepare('SELECT 1 FROM att_users LIMIT 1').get()) {
    for (const [code, d] of Object.entries(TYPE_DEFAULTS)) {
      const row = db.prepare('SELECT id, color FROM att_leave_types WHERE code=?').get(code);
      if (row && !row.color) {
        const keys = Object.keys(d);
        db.prepare(`UPDATE att_leave_types SET ${keys.map((k) => k + '=?').join(',')} WHERE id=?`).run(...keys.map((k) => d[k]), row.id);
      }
    }
    if (!db.prepare("SELECT 1 FROM att_leave_types WHERE code='OH'").get()) {
      db.prepare("INSERT INTO att_leave_types(code,name,quota,is_wfh,paid,color,allow_half,backdate_days,is_optional) VALUES ('OH','Optional Holiday',2,0,1,'#e0003c',0,0,1)").run();
    }
  }
}

export function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}
