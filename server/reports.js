import { ist, addDays, isDate, isMonth } from './util.js';

// HR reports. Every endpoint returns plain rows so the screen can show them and export CSV.
export function registerReports(r, { core, hrOnly, httpErr, wrap }) {
  const { all, get } = core;

  r.get('/reports/monthly', hrOnly, wrap((req, res) => {
    const month = isMonth(req.query.month) ? req.query.month : ist().month;
    const lateMarks = core.settings().lateMarks;
    const rows = core.trackedUsers().map((u) => {
      const { summary: s } = core.buildCalendar(u, month);
      return {
        id: u.id, name: u.name, emp_code: u.emp_code, role: u.role, department: u.department, shift: core.shiftOf(u)?.name,
        ...s, late_halfdays: lateMarks > 0 ? Math.floor(s.late_count / lateMarks) : 0,
      };
    });
    res.json({ month, lateMarks, rows });
  }));

  r.get('/reports/daily', hrOnly, wrap((req, res) => {
    const date = isDate(req.query.date) ? req.query.date : ist().date;
    const rows = core.trackedUsers().filter((u) => date >= u.start_date && (!u.end_date || date <= u.end_date)).map((u) => {
      const d = core.dayFor(u, date);
      return {
        id: u.id, name: u.name, emp_code: u.emp_code, department: u.department, shift: core.shiftOf(u)?.name,
        status: d.status, check_in: d.check_in || null, check_out: d.check_out || null, worked: d.worked ?? null,
        late_min: d.late && !d.extra ? d.late_min : 0, early_min: d.early_min || 0, mode: d.in_mode || null, leave: d.leave || null, holiday: d.holiday || null,
      };
    });
    res.json({ date, rows });
  }));

  r.get('/reports/leaves', hrOnly, wrap((req, res) => {
    const from = isDate(req.query.from) ? req.query.from : `${ist().date.slice(0, 4)}-01-01`;
    const to = isDate(req.query.to) ? req.query.to : `${ist().date.slice(0, 4)}-12-31`;
    const where = ['l.from_date<=?', 'l.to_date>=?'], p = [to, from];
    if (['pending', 'approved', 'rejected', 'cancelled'].includes(req.query.status)) { where.push('l.status=?'); p.push(req.query.status); }
    if (req.query.type_id) { where.push('l.type_id=?'); p.push(+req.query.type_id); }
    if (req.query.user_id) { where.push('l.user_id=?'); p.push(+req.query.user_id); }
    res.json({
      from, to,
      rows: all(`SELECT l.id,l.from_date,l.to_date,l.days,l.half,l.status,l.reason,l.remark,l.created_at,l.decided_at,t.name AS type_name,t.is_wfh,u.name AS user_name,u.emp_code,u.department,d.name AS decided_by_name
        FROM att_leaves l JOIN att_leave_types t ON t.id=l.type_id JOIN att_users u ON u.id=l.user_id LEFT JOIN att_users d ON d.id=l.decided_by
        WHERE ${where.join(' AND ')} ORDER BY l.from_date DESC, l.id DESC LIMIT 1000`, ...p),
    });
  }));

  r.get('/reports/leave-balance', hrOnly, wrap((req, res) => {
    const year = +req.query.year || +ist().date.slice(0, 4);
    const types = all("SELECT id,code,name,quota,is_wfh,is_compoff FROM att_leave_types WHERE active=1 ORDER BY is_wfh, id");
    const rows = core.trackedUsers().map((u) => ({
      id: u.id, name: u.name, emp_code: u.emp_code, role: u.role,
      balances: Object.fromEntries(core.leaveBalances(u, year).map((b) => [b.id, { balance: b.balance, booked: b.booked, pending: b.pending, available: b.available ?? null, unlimited: b.unlimited }])),
    }));
    res.json({ year, types, rows });
  }));

  r.get('/reports/time', hrOnly, wrap((req, res) => {
    const to = isDate(req.query.to) ? req.query.to : ist().date;
    const from = isDate(req.query.from) ? req.query.from : addDays(to, -29);
    if (from > to) throw httpErr(400, 'From date must be before To date');
    const projects = all('SELECT id,name FROM att_projects ORDER BY name');
    const sums = all(`SELECT l.user_id, l.project_id, SUM(l.minutes) m FROM att_timelogs l WHERE l.date BETWEEN ? AND ? GROUP BY l.user_id, l.project_id`, from, to);
    const rows = core.trackedUsers().map((u) => {
      const mine = sums.filter((s) => s.user_id === u.id);
      return { id: u.id, name: u.name, emp_code: u.emp_code, total: mine.reduce((a, s) => a + s.m, 0), projects: Object.fromEntries(mine.map((s) => [s.project_id, s.m])) };
    });
    res.json({ from, to, projects, rows, unused: get('SELECT COUNT(*) c FROM att_projects WHERE active=0').c });
  }));
}
