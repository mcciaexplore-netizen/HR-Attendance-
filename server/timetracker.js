import { ist, addDays, isDate, weekStart } from './util.js';

// Time Tracker: projects & jobs (HR), time logs (everyone), weekly timesheets with approval.
export function registerTime(r, { core, hrOnly, httpErr, wrap }) {
  const { all, get, run } = core;
  const today = () => ist().date;

  // ---------- projects & jobs ----------
  r.get('/projects', (req, res) => {
    const every = req.query.all && req.user.role === 'hr';
    const projects = all(`SELECT * FROM att_projects ${every ? '' : 'WHERE active=1'} ORDER BY name`);
    const jobs = all(`SELECT * FROM att_jobs ${every ? '' : 'WHERE active=1'} ORDER BY name`);
    res.json(projects.map((p) => ({ ...p, active: !!p.active, jobs: jobs.filter((j) => j.project_id === p.id).map((j) => ({ ...j, active: !!j.active })) })));
  });
  r.post('/projects', hrOnly, wrap((req, res) => {
    const name = String(req.body.name || '').trim();
    if (!name) throw httpErr(400, 'Project name is required');
    if (get('SELECT 1 FROM att_projects WHERE name=?', name)) throw httpErr(409, 'A project with that name already exists');
    const { lastInsertRowid } = run('INSERT INTO att_projects(name,description) VALUES (?,?)', name, String(req.body.description || '').trim() || null);
    res.json({ id: lastInsertRowid });
  }));
  r.put('/projects/:id', hrOnly, wrap((req, res) => {
    const p = get('SELECT * FROM att_projects WHERE id=?', +req.params.id);
    if (!p) throw httpErr(404, 'Not found');
    const name = String(req.body.name ?? p.name).trim();
    if (!name) throw httpErr(400, 'Project name is required');
    run('UPDATE att_projects SET name=?, description=?, active=? WHERE id=?', name, req.body.description ?? p.description, req.body.active === false || req.body.active === 0 ? 0 : 1, p.id);
    res.json({ ok: true });
  }));
  r.post('/projects/:id/jobs', hrOnly, wrap((req, res) => {
    if (!get('SELECT 1 FROM att_projects WHERE id=?', +req.params.id)) throw httpErr(404, 'Project not found');
    const name = String(req.body.name || '').trim();
    if (!name) throw httpErr(400, 'Job name is required');
    const { lastInsertRowid } = run('INSERT INTO att_jobs(project_id,name) VALUES (?,?)', +req.params.id, name);
    res.json({ id: lastInsertRowid });
  }));
  r.put('/jobs/:id', hrOnly, wrap((req, res) => {
    const j = get('SELECT * FROM att_jobs WHERE id=?', +req.params.id);
    if (!j) throw httpErr(404, 'Not found');
    run('UPDATE att_jobs SET name=?, active=? WHERE id=?', String(req.body.name ?? j.name).trim() || j.name, req.body.active === false || req.body.active === 0 ? 0 : 1, j.id);
    res.json({ ok: true });
  }));

  // ---------- time logs ----------
  const sheetOf = (userId, date) => get('SELECT * FROM att_timesheets WHERE user_id=? AND week_start=?', userId, weekStart(date));
  const locked = (userId, date) => ['pending', 'approved'].includes(sheetOf(userId, date)?.status);

  function checkLog(user, b, excludeId = 0) {
    if (core.isUntracked(user)) throw httpErr(403, 'HR and approver accounts do not log time.');
    if (!isDate(b.date) || b.date > today()) throw httpErr(400, 'Pick today or an earlier date');
    if (b.date < user.start_date) throw httpErr(400, 'That date is before your joining date.');
    const minutes = Math.round(+b.minutes);
    if (!(minutes >= 5 && minutes <= 720)) throw httpErr(400, 'Time must be between 5 minutes and 12 hours');
    const p = get('SELECT * FROM att_projects WHERE id=? AND active=1', +b.project_id);
    if (!p) throw httpErr(400, 'Choose a project');
    let jobId = null;
    if (b.job_id) {
      const j = get('SELECT * FROM att_jobs WHERE id=? AND project_id=? AND active=1', +b.job_id, p.id);
      if (!j) throw httpErr(400, 'That job does not belong to the project');
      jobId = j.id;
    }
    const day = get('SELECT COALESCE(SUM(minutes),0) m FROM att_timelogs WHERE user_id=? AND date=? AND id!=?', user.id, b.date, excludeId).m;
    if (day + minutes > 1440) throw httpErr(400, 'That is more than 24 hours in a day.');
    if (locked(user.id, b.date)) throw httpErr(409, 'This week is already submitted. Ask your approver to reject the timesheet if you need to change it.');
    return { minutes, projectId: p.id, jobId, notes: String(b.notes || '').trim().slice(0, 300) || null };
  }

  const LOGS = `SELECT l.*, p.name AS project_name, j.name AS job_name FROM att_timelogs l JOIN att_projects p ON p.id=l.project_id LEFT JOIN att_jobs j ON j.id=l.job_id`;
  r.get('/timelogs', wrap((req, res) => {
    const id = req.query.user_id ? +req.query.user_id : req.user.id;
    if (!core.canView(req.user, id)) throw httpErr(403, 'Not allowed');
    const from = isDate(req.query.from) ? req.query.from : addDays(today(), -30);
    const to = isDate(req.query.to) ? req.query.to : today();
    res.json({
      logs: all(`${LOGS} WHERE l.user_id=? AND l.date BETWEEN ? AND ? ORDER BY l.date, l.id`, id, from, to),
      sheets: all('SELECT id,week_start,status,remark FROM att_timesheets WHERE user_id=? AND week_start BETWEEN ? AND ?', id, weekStart(from), to),
    });
  }));
  r.post('/timelogs', wrap((req, res) => {
    const c = checkLog(req.user, req.body);
    const { lastInsertRowid } = run('INSERT INTO att_timelogs(user_id,date,project_id,job_id,minutes,notes) VALUES (?,?,?,?,?,?)', req.user.id, req.body.date, c.projectId, c.jobId, c.minutes, c.notes);
    res.json({ id: lastInsertRowid });
  }));
  r.put('/timelogs/:id', wrap((req, res) => {
    const l = get('SELECT * FROM att_timelogs WHERE id=? AND user_id=?', +req.params.id, req.user.id);
    if (!l) throw httpErr(404, 'Not found');
    if (locked(req.user.id, l.date)) throw httpErr(409, 'This week is already submitted.');
    const c = checkLog(req.user, req.body, l.id);
    run('UPDATE att_timelogs SET date=?, project_id=?, job_id=?, minutes=?, notes=? WHERE id=?', req.body.date, c.projectId, c.jobId, c.minutes, c.notes, l.id);
    res.json({ ok: true });
  }));
  r.delete('/timelogs/:id', wrap((req, res) => {
    const l = get('SELECT * FROM att_timelogs WHERE id=? AND user_id=?', +req.params.id, req.user.id);
    if (!l) throw httpErr(404, 'Not found');
    if (locked(req.user.id, l.date)) throw httpErr(409, 'This week is already submitted.');
    run('DELETE FROM att_timelogs WHERE id=?', l.id);
    res.json({ ok: true });
  }));

  // ---------- timesheets (one per Monday–Sunday week) ----------
  r.get('/timesheets', wrap((req, res) => {
    const id = req.query.user_id ? +req.query.user_id : req.user.id;
    if (!core.canView(req.user, id)) throw httpErr(403, 'Not allowed');
    const u = get('SELECT * FROM att_users WHERE id=?', id);
    if (!u) throw httpErr(404, 'User not found');
    const cur = weekStart(today());
    const oldest = addDays(cur, -7 * 11);
    const first = weekStart(u.start_date) > oldest ? weekStart(u.start_date) : oldest;
    const sums = all('SELECT date, SUM(minutes) m FROM att_timelogs WHERE user_id=? AND date>=? GROUP BY date', id, first);
    const sheets = new Map(all('SELECT * FROM att_timesheets WHERE user_id=? AND week_start>=?', id, first).map((s) => [s.week_start, s]));
    const weeks = [];
    for (let w = cur; w >= first; w = addDays(w, -7)) {
      const end = addDays(w, 6);
      const inWeek = sums.filter((s) => s.date >= w && s.date <= end);
      const sh = sheets.get(w);
      weeks.push({ week_start: w, week_end: end, minutes: inWeek.reduce((a, s) => a + s.m, 0), days: inWeek.length, status: sh?.status || 'open', id: sh?.id || null, remark: sh?.remark || null });
    }
    res.json(weeks);
  }));
  r.get('/timesheets/week', wrap((req, res) => {
    const id = req.query.user_id ? +req.query.user_id : req.user.id;
    if (!core.canView(req.user, id)) throw httpErr(403, 'Not allowed');
    if (!isDate(req.query.week_start)) throw httpErr(400, 'week_start is required');
    const ws = weekStart(req.query.week_start);
    const logs = all(`${LOGS} WHERE l.user_id=? AND l.date BETWEEN ? AND ? ORDER BY l.date, l.id`, id, ws, addDays(ws, 6));
    const sh = get('SELECT * FROM att_timesheets WHERE user_id=? AND week_start=?', id, ws);
    res.json({ week_start: ws, status: sh?.status || 'open', id: sh?.id || null, remark: sh?.remark || null, minutes: logs.reduce((a, l) => a + l.minutes, 0), logs });
  }));
  r.post('/timesheets/submit', wrap((req, res) => {
    const u = req.user, ws = req.body.week_start;
    if (core.isUntracked(u)) throw httpErr(403, 'HR and approver accounts do not log time.');
    if (!isDate(ws) || ws !== weekStart(ws)) throw httpErr(400, 'Week must start on a Monday');
    if (ws > weekStart(today())) throw httpErr(400, 'You cannot submit a future week');
    const total = get('SELECT COALESCE(SUM(minutes),0) m FROM att_timelogs WHERE user_id=? AND date BETWEEN ? AND ?', u.id, ws, addDays(ws, 6)).m;
    if (total <= 0) throw httpErr(400, 'Add at least one time log before submitting.');
    const old = get('SELECT * FROM att_timesheets WHERE user_id=? AND week_start=?', u.id, ws);
    if (old && ['pending', 'approved'].includes(old.status)) throw httpErr(409, `This timesheet is already ${old.status}.`);
    if (old) run("UPDATE att_timesheets SET status='pending', submitted_at=datetime('now'), decided_by=NULL, decided_at=NULL, remark=NULL WHERE id=?", old.id);
    else run("INSERT INTO att_timesheets(user_id,week_start,status,submitted_at) VALUES (?,?,'pending',datetime('now'))", u.id, ws);
    core.notifyApprovers(u.id, 'approval', `Timesheet: ${u.name}`, `Week of ${ws} · ${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`);
    res.json({ ok: true });
  }));
  r.post('/timesheets/:id/decision', wrap((req, res) => {
    const sh = get('SELECT * FROM att_timesheets WHERE id=?', +req.params.id);
    if (!sh) throw httpErr(404, 'Not found');
    if (!core.canDecide(req.user, sh.user_id)) throw httpErr(403, 'You cannot decide this timesheet');
    if (sh.status !== 'pending') throw httpErr(409, 'Already decided');
    const status = req.body.approve ? 'approved' : 'rejected';
    run("UPDATE att_timesheets SET status=?, decided_by=?, decided_at=datetime('now'), remark=? WHERE id=?", status, req.user.id, req.body.remark || null, sh.id);
    core.notify(sh.user_id, 'approval', `Timesheet ${status}`, `Week of ${sh.week_start}${req.body.remark ? ' — ' + req.body.remark : ''}`);
    res.json({ ok: true });
  }));
  // HR: every submitted timesheet
  r.get('/timesheets/all', hrOnly, wrap((req, res) => {
    const st = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : null;
    res.json(all(`SELECT x.id,x.user_id,x.week_start,x.status,x.remark,x.submitted_at,u.name AS user_name,u.emp_code,
        (SELECT COALESCE(SUM(minutes),0) FROM att_timelogs l WHERE l.user_id=x.user_id AND l.date BETWEEN x.week_start AND date(x.week_start,'+6 day')) AS minutes
      FROM att_timesheets x JOIN att_users u ON u.id=x.user_id ${st ? 'WHERE x.status=?' : ''} ORDER BY x.week_start DESC, u.name LIMIT 300`, ...(st ? [st] : [])));
  }));
}
