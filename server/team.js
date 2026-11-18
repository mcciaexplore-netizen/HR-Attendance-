import { ist, monthDays, isMonth } from './util.js';

// Team directory ("who is in / out today") and the team leave calendar.
export function registerTeam(r, { core, httpErr, wrap }) {
  const { all, get } = core;

  r.get('/team', wrap((req, res) => {
    const t = ist().date;
    const users = all("SELECT * FROM att_users WHERE active=1 AND role NOT IN ('hr','approver') ORDER BY name");
    const names = new Map(all('SELECT id,name FROM att_users').map((u) => [u.id, u.name]));
    res.json(users.filter((u) => t >= u.start_date).map((u) => {
      const d = core.dayFor(u, t);
      return {
        id: u.id, name: u.name, emp_code: u.emp_code, role: u.role, department: u.department, designation: u.designation || null, email: u.email, phone: u.phone,
        manager: u.manager_id ? names.get(u.manager_id) || null : null, manager_id: u.manager_id || null, shift: core.shiftOf(u)?.name || null,
        state: core.stateOf(d), since: d.check_in || null, leave: d.leave || null, wfh_approved: !!d.wfh_approved, you: u.id === req.user.id,
      };
    }));
  }));

  // Org chart: everyone with their reporting line. People without a manager report to HR (who approve for them).
  r.get('/org', wrap((req, res) => {
    const users = all('SELECT * FROM att_users WHERE active=1 ORDER BY name');
    const ids = new Set(users.map((u) => u.id));
    const hrId = users.find((u) => u.role === 'hr')?.id ?? null;
    res.json(users.map((u) => {
      const manager = u.manager_id && ids.has(u.manager_id) ? u.manager_id : null;
      return {
        id: u.id, name: u.name, emp_code: u.emp_code, role: u.role, department: u.department, designation: u.designation || null,
        manager_id: manager, parent_id: manager ?? (u.role === 'hr' ? null : hrId), you: u.id === req.user.id,
      };
    }));
  }));

  r.get('/team/calendar', wrap((req, res) => {
    const month = isMonth(req.query.month) ? req.query.month : ist().month;
    const dates = monthDays(month), from = dates[0], to = dates.at(-1);
    const leaves = all(`SELECT l.user_id,l.from_date,l.to_date,l.half,t.name AS type_name,t.is_wfh,u.name
      FROM att_leaves l JOIN att_leave_types t ON t.id=l.type_id JOIN att_users u ON u.id=l.user_id
      WHERE l.status='approved' AND l.from_date<=? AND l.to_date>=? AND u.active=1 AND u.role!='hr'`, to, from);
    const hols = new Map(all('SELECT * FROM att_holidays WHERE date BETWEEN ? AND ?', from, to).map((h) => [h.date, h]));
    const cel = core.celebrations(from, to);
    res.json({
      month,
      days: dates.map((date) => ({
        date, holiday: hols.get(date)?.optional ? null : hols.get(date)?.name || null, optional: hols.get(date)?.optional ? hols.get(date).name : null,
        birthdays: cel.birthdays.filter((x) => x.date === date).map((x) => ({ user_id: x.user.id, name: x.user.name })),
        anniversaries: cel.anniversaries.filter((x) => x.date === date).map((x) => ({ user_id: x.user.id, name: x.user.name, years: x.years })),
        out: leaves.filter((l) => l.from_date <= date && l.to_date >= date).map((l) => ({ user_id: l.user_id, name: l.name, type: l.type_name, wfh: !!l.is_wfh, half: !!l.half })),
      })),
    });
  }));
}
