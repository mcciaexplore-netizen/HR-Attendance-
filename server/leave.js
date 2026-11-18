import { ist, addDays, dowOf, isDate, daysBetween } from './util.js';

const ATTACH_RE = /^data:(application\/pdf|image\/(?:png|jpeg|jpg|webp));base64,/;

// Leave Tracker: leave types & policies, balances, requests, adjustments, compensatory off, approvals inbox.
export function registerLeave(r, { core, hrOnly, approverOnly, httpErr, wrap }) {
  const { all, get, run, notify } = core;

  // ---------- leave types / policies ----------
  const typeOut = (t) => ({
    ...t, is_wfh: !!t.is_wfh, paid: !!t.paid, allow_half: !!t.allow_half, count_weekends: !!t.count_weekends,
    is_optional: !!t.is_optional, is_compoff: !!t.is_compoff, active: !!t.active,
  });

  r.get('/leave-types', (req, res) => {
    const rows = req.query.all && req.user.role === 'hr' ? all('SELECT * FROM att_leave_types ORDER BY is_wfh, id') : core.typesFor(req.user);
    res.json(rows.map(typeOut));
  });

  function typeFields(b, existing) {
    const name = String(b.name || '').trim();
    if (!name) throw httpErr(400, 'Name is required');
    const code = existing ? existing.code : String(b.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{2,6}$/.test(code)) throw httpErr(400, 'Code must be 2–6 letters/digits');
    const nullableNum = (v, label, max) => {
      if (v === '' || v == null) return null;
      const n = +v;
      if (!(n >= 0 && n <= max)) throw httpErr(400, `${label} must be between 0 and ${max}`);
      return n;
    };
    const quota = nullableNum(b.quota, 'Yearly quota', 366);
    const carry = nullableNum(b.carry_forward, 'Carry forward', 366) ?? 0;
    const maxC = nullableNum(b.max_consecutive, 'Max consecutive days', 366);
    const notice = nullableNum(b.min_notice_days, 'Notice days', 365) ?? 0;
    const back = nullableNum(b.backdate_days, 'Back-date days', 365);
    const doc = nullableNum(b.doc_after_days, 'Document after days', 30);
    if (!['yearly', 'monthly'].includes(b.accrual || 'yearly')) throw httpErr(400, 'Invalid accrual');
    if (!['all', 'intern', 'consultant'].includes(b.applies_to || 'all')) throw httpErr(400, 'Invalid "applies to"');
    const color = /^#[0-9a-fA-F]{6}$/.test(b.color || '') ? b.color : '#38a3f5';
    return {
      code, name, quota, color, accrual: b.accrual || 'yearly', carry_forward: carry, max_consecutive: maxC, min_notice_days: Math.round(notice),
      backdate_days: back == null ? null : Math.round(back), doc_after_days: doc, applies_to: b.applies_to || 'all',
      paid: b.paid ? 1 : 0, allow_half: b.allow_half ? 1 : 0, count_weekends: b.count_weekends ? 1 : 0, active: b.active === false || b.active === 0 ? 0 : 1,
    };
  }
  r.post('/leave-types', hrOnly, wrap((req, res) => {
    const f = typeFields(req.body);
    if (get('SELECT 1 FROM att_leave_types WHERE code=?', f.code)) throw httpErr(409, 'That code already exists');
    const { lastInsertRowid } = run(`INSERT INTO att_leave_types(code,name,quota,is_wfh,paid,color,accrual,carry_forward,max_consecutive,min_notice_days,allow_half,backdate_days,count_weekends,doc_after_days,applies_to,is_optional,is_compoff,active)
      VALUES (?,?,?,0,?,?,?,?,?,?,?,?,?,?,?,?,0,?)`, f.code, f.name, f.quota, f.paid, f.color, f.accrual, f.carry_forward, f.max_consecutive, f.min_notice_days, f.allow_half, f.backdate_days, f.count_weekends, f.doc_after_days, f.applies_to, req.body.is_optional ? 1 : 0, f.active);
    res.json({ id: lastInsertRowid });
  }));
  r.put('/leave-types/:id', hrOnly, wrap((req, res) => {
    const t = get('SELECT * FROM att_leave_types WHERE id=?', +req.params.id);
    if (!t) throw httpErr(404, 'Not found');
    const f = typeFields(req.body, t);
    run(`UPDATE att_leave_types SET name=?,quota=?,paid=?,color=?,accrual=?,carry_forward=?,max_consecutive=?,min_notice_days=?,allow_half=?,backdate_days=?,count_weekends=?,doc_after_days=?,applies_to=?,active=? WHERE id=?`,
      f.name, f.quota, f.paid, f.color, f.accrual, f.carry_forward, f.max_consecutive, f.min_notice_days, f.allow_half, f.backdate_days, f.count_weekends, f.doc_after_days, f.applies_to, f.active, t.id);
    res.json({ ok: true });
  }));

  // ---------- balances ----------
  const targetUser = (req) => {
    const id = req.query.user_id ? +req.query.user_id : req.user.id;
    if (!core.canView(req.user, id)) throw httpErr(403, 'Not allowed');
    const u = get('SELECT * FROM att_users WHERE id=?', id);
    if (!u) throw httpErr(404, 'User not found');
    return u;
  };
  r.get('/leaves/balance', wrap((req, res) => {
    const u = targetUser(req);
    res.json(core.leaveBalances(u, +req.query.year || +ist().date.slice(0, 4)));
  }));

  // HR: grant / deduct days
  r.post('/leave-adjust', hrOnly, wrap((req, res) => {
    const { user_id, type_id, year, days, remark } = req.body;
    const u = get("SELECT * FROM att_users WHERE id=? AND role NOT IN ('hr','approver')", +user_id);
    const t = get('SELECT * FROM att_leave_types WHERE id=?', +type_id);
    if (!u || !t) throw httpErr(400, 'Pick a person and a leave type');
    if (t.is_wfh || t.is_compoff || t.quota == null) throw httpErr(400, `${t.name} has no yearly balance to adjust.`);
    const n = +days;
    if (!Number.isFinite(n) || n === 0 || Math.abs(n) > 100) throw httpErr(400, 'Enter the number of days to add (or a negative number to deduct)');
    if (!String(remark || '').trim()) throw httpErr(400, 'Please add a remark');
    run('INSERT INTO att_leave_adjust(user_id,type_id,year,days,remark,by_id) VALUES (?,?,?,?,?,?)', u.id, t.id, +year || +ist().date.slice(0, 4), n, remark.trim(), req.user.id);
    notify(u.id, 'approval', `${t.name} balance ${n > 0 ? 'increased' : 'reduced'} by ${Math.abs(n)}`, remark.trim());
    res.json({ ok: true });
  }));
  r.get('/leave-adjust', hrOnly, wrap((req, res) => {
    res.json(all(`SELECT a.*, t.name AS type_name, b.name AS by_name FROM att_leave_adjust a JOIN att_leave_types t ON t.id=a.type_id LEFT JOIN att_users b ON b.id=a.by_id
      WHERE a.user_id=? ${req.query.year ? 'AND a.year=?' : ''} ORDER BY a.id DESC LIMIT 100`, +req.query.user_id, ...(req.query.year ? [+req.query.year] : [])));
  }));

  // ---------- requests ----------
  r.get('/leaves', wrap((req, res) => {
    const u = targetUser(req);
    const where = ['l.user_id=?'], p = [u.id];
    if (req.query.status) { where.push('l.status=?'); p.push(req.query.status); }
    if (req.query.year) { where.push('l.from_date LIKE ?'); p.push(req.query.year + '%'); }
    res.json(all(`SELECT l.id,l.user_id,l.type_id,l.from_date,l.to_date,l.half,l.session,l.days,l.reason,l.status,l.decided_by,l.decided_at,l.remark,l.created_at,l.cc,
        (l.attachment IS NOT NULL) AS has_attachment, l.attachment_name, t.code, t.name AS type_name, t.is_wfh, t.color, u.name AS user_name, u.emp_code, d.name AS decided_by_name
      FROM att_leaves l JOIN att_leave_types t ON t.id=l.type_id JOIN att_users u ON u.id=l.user_id LEFT JOIN att_users d ON d.id=l.decided_by
      WHERE ${where.join(' AND ')} ORDER BY l.from_date DESC, l.id DESC LIMIT 500`, ...p));
  }));

  r.post('/leaves', wrap((req, res) => {
    const u = req.user, b = req.body;
    if (core.isUntracked(u)) throw httpErr(403, 'HR and approver accounts do not apply for leave here.');
    const type = get('SELECT * FROM att_leave_types WHERE id=? AND active=1', +b.type_id);
    if (!type) throw httpErr(400, 'Choose a leave type');
    if (type.applies_to !== 'all' && type.applies_to !== u.role) throw httpErr(403, `${type.name} is not available for ${u.role}s.`);
    if (!isDate(b.from_date) || !isDate(b.to_date) || b.to_date < b.from_date) throw httpErr(400, 'Check the dates');
    const today = ist().date;
    const half = !!b.half;
    if (half) {
      if (!type.allow_half) throw httpErr(400, `${type.name} cannot be taken as a half day.`);
      if (b.from_date !== b.to_date) throw httpErr(400, 'Half day applies to a single date');
    }
    if (!String(b.reason || '').trim()) throw httpErr(400, 'Please add a reason');
    if (b.from_date < u.start_date) throw httpErr(400, 'Dates cannot be before your joining date.');
    if (type.backdate_days != null && b.from_date < today && daysBetween(b.from_date, today) > type.backdate_days)
      throw httpErr(400, type.backdate_days === 0 ? `${type.name} cannot be applied for past dates.` : `${type.name} can only be applied up to ${type.backdate_days} days back.`);
    if (type.min_notice_days > 0 && b.from_date >= today && daysBetween(today, b.from_date) < type.min_notice_days)
      throw httpErr(400, `${type.name} needs at least ${type.min_notice_days} day(s) notice.`);
    if (type.is_optional) {
      if (b.from_date !== b.to_date || !get('SELECT 1 FROM att_holidays WHERE date=? AND optional=1', b.from_date)) throw httpErr(400, 'Pick a single optional holiday date.');
    }
    const days = type.is_optional ? 1 : core.countLeaveDays(u, type, b.from_date, b.to_date, half);
    if (days <= 0) throw httpErr(400, 'Those dates are holidays / weekly off days, so there is nothing to apply for.');
    if (type.max_consecutive != null && days > type.max_consecutive) throw httpErr(400, `${type.name} is limited to ${type.max_consecutive} consecutive day(s).`);
    const clash = get(`SELECT 1 FROM att_leaves WHERE user_id=? AND status IN ('pending','approved') AND from_date<=? AND to_date>=?
      AND type_id IN (SELECT id FROM att_leave_types WHERE is_wfh=?)`, u.id, b.to_date, b.from_date, type.is_wfh);
    if (clash) throw httpErr(409, 'You already have a request overlapping these dates.');
    if (!type.is_wfh) {
      const bal = core.balanceFor(u, type, +b.from_date.slice(0, 4));
      if (!bal.unlimited && bal.balance < days) throw httpErr(400, `Only ${Math.max(0, bal.balance)} day(s) of ${type.name} left.`);
    }
    let attachment = null, attachmentName = null;
    if (b.attachment) {
      if (typeof b.attachment !== 'string' || !ATTACH_RE.test(b.attachment) || b.attachment.length > 2_200_000) throw httpErr(400, 'Attach a PDF or image under 1.5 MB.');
      attachment = b.attachment;
      attachmentName = String(b.attachment_name || 'document').slice(0, 80);
    }
    if (type.doc_after_days != null && days > type.doc_after_days && !attachment)
      throw httpErr(400, `${type.name} for more than ${type.doc_after_days} day(s) needs a supporting document (for example a medical certificate).`);

    const cc = [...new Set((Array.isArray(b.cc) ? b.cc : []).map(Number).filter(Number.isInteger))]
      .filter((id) => id !== u.id && get('SELECT 1 FROM att_users WHERE id=? AND active=1', id)).slice(0, 10);
    const { lastInsertRowid } = run(`INSERT INTO att_leaves(user_id,type_id,from_date,to_date,half,session,days,reason,attachment,attachment_name,cc) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      u.id, type.id, b.from_date, b.to_date, half ? 1 : 0, half ? (b.session === 'second' ? 'second' : 'first') : null, days, b.reason.trim(), attachment, attachmentName, cc.length ? cc.join(',') : null);
    const when = `${b.from_date}${b.to_date !== b.from_date ? ' → ' + b.to_date : ''} (${days} day${days === 1 ? '' : 's'})`;
    core.notifyApprovers(u.id, 'approval', `${type.is_wfh ? 'WFH' : 'Leave'} request: ${u.name}`, `${type.name}, ${when}`);
    for (const id of cc) notify(id, 'info', `${u.name} applied for ${type.name}`, `${when}. You were added in CC.`);
    res.json({ id: lastInsertRowid, days });
  }));

  r.post('/leaves/:id/decision', wrap((req, res) => {
    const l = get('SELECT l.*, t.name AS type_name, t.is_wfh FROM att_leaves l JOIN att_leave_types t ON t.id=l.type_id WHERE l.id=?', +req.params.id);
    if (!l) throw httpErr(404, 'Not found');
    if (!core.canDecide(req.user, l.user_id)) throw httpErr(403, 'You cannot decide this request');
    if (l.status !== 'pending') throw httpErr(409, 'Already decided');
    const status = req.body.approve ? 'approved' : 'rejected';
    if (status === 'approved' && !l.is_wfh) {
      const target = get('SELECT * FROM att_users WHERE id=?', l.user_id);
      const type = get('SELECT * FROM att_leave_types WHERE id=?', l.type_id);
      const bal = core.balanceFor(target, type, +l.from_date.slice(0, 4));
      if (!bal.unlimited && bal.balance < 0) throw httpErr(409, `${target.name} does not have enough ${type.name} balance any more.`);
    }
    run("UPDATE att_leaves SET status=?, decided_by=?, decided_at=datetime('now'), remark=? WHERE id=?", status, req.user.id, req.body.remark || null, l.id);
    notify(l.user_id, 'approval', `${l.type_name} ${status}`, `${l.from_date}${l.to_date !== l.from_date ? ' → ' + l.to_date : ''}${req.body.remark ? ' — ' + req.body.remark : ''}`);
    res.json({ ok: true });
  }));

  r.post('/leaves/:id/cancel', wrap((req, res) => {
    const l = get('SELECT l.*, t.name AS type_name FROM att_leaves l JOIN att_leave_types t ON t.id=l.type_id WHERE l.id=?', +req.params.id);
    const mine = l && l.user_id === req.user.id;
    if (!l || (!mine && !core.canDecide(req.user, l.user_id))) throw httpErr(404, 'Not found');
    if (!['pending', 'approved'].includes(l.status)) throw httpErr(409, 'Cannot cancel');
    if (l.status === 'approved' && l.from_date <= ist().date && mine && !core.canDecide(req.user, l.user_id))
      throw httpErr(400, 'Leave that has already started can only be cancelled by your approver.');
    run("UPDATE att_leaves SET status='cancelled' WHERE id=?", l.id);
    if (mine && l.status === 'approved') core.notifyApprovers(l.user_id, 'approval', `Leave cancelled: ${req.user.name}`, `${l.type_name}, ${l.from_date}`);
    else if (!mine) notify(l.user_id, 'approval', `${l.type_name} cancelled`, `${l.from_date} · cancelled by ${req.user.name}`);
    res.json({ ok: true });
  }));

  r.get('/leaves/:id/attachment', wrap((req, res) => {
    const l = get('SELECT user_id, attachment, attachment_name FROM att_leaves WHERE id=?', +req.params.id);
    if (!l?.attachment || !core.canView(req.user, l.user_id)) throw httpErr(404, 'No attachment');
    const m = l.attachment.match(ATTACH_RE);
    res.type(m[1]).set('Content-Disposition', `inline; filename="${String(l.attachment_name).replace(/[^\w.\- ]/g, '_')}"`)
      .send(Buffer.from(l.attachment.slice(m[0].length), 'base64'));
  }));

  // ---------- compensatory off ----------
  function eligibleCompoff(user) {
    const s = core.settings(), t = ist().date, from = addDays(t, -s.compoffWindow);
    const shift = core.shiftOf(user), hol = core.holidayMap(from, t);
    const recs = all('SELECT date,check_in,check_out FROM att_records WHERE user_id=? AND date BETWEEN ? AND ? AND check_in IS NOT NULL AND check_out IS NOT NULL ORDER BY date DESC', user.id, from, t);
    const taken = new Set(all("SELECT worked_date FROM att_compoff WHERE user_id=? AND status IN ('pending','approved')", user.id).map((x) => x.worked_date));
    const out = [];
    for (const rec of recs) {
      if (taken.has(rec.date) || !(hol.has(rec.date) || !shift.workingDays.includes(dowOf(rec.date)))) continue;
      const worked = Math.round((new Date(rec.check_out) - new Date(rec.check_in)) / 60000);
      const max = worked >= shift.fullHours * 60 ? 1 : worked >= shift.halfHours * 60 ? 0.5 : 0;
      if (max > 0) out.push({ date: rec.date, worked, max_days: max, holiday: hol.get(rec.date)?.name || null });
    }
    return out;
  }

  r.get('/compoff/eligible', wrap((req, res) => res.json({ window: core.settings().compoffWindow, items: eligibleCompoff(req.user) })));
  r.get('/compoff', wrap((req, res) => {
    const u = targetUser(req);
    res.json({
      balance: core.compoffBalance(u.id),
      items: all(`SELECT c.*, d.name AS decided_by_name FROM att_compoff c LEFT JOIN att_users d ON d.id=c.decided_by WHERE c.user_id=? ORDER BY c.worked_date DESC LIMIT 100`, u.id),
    });
  }));
  r.post('/compoff', wrap((req, res) => {
    const u = req.user;
    if (core.isUntracked(u)) throw httpErr(403, 'HR and approver accounts do not apply for comp-off.');
    const days = +req.body.days;
    const e = eligibleCompoff(u).find((x) => x.date === req.body.worked_date);
    if (!e) throw httpErr(400, 'You can request comp-off only for a day you worked on a holiday or weekly off (checked in and out), within the allowed window.');
    if (![0.5, 1].includes(days) || days > e.max_days) throw httpErr(400, `You can claim up to ${e.max_days} day(s) for that date.`);
    const old = get('SELECT id FROM att_compoff WHERE user_id=? AND worked_date=?', u.id, e.date);
    if (old) run("UPDATE att_compoff SET days=?, reason=?, status='pending', decided_by=NULL, decided_at=NULL, remark=NULL, expires_on=NULL WHERE id=?", days, String(req.body.reason || '').trim() || null, old.id);
    else run('INSERT INTO att_compoff(user_id,worked_date,days,reason) VALUES (?,?,?,?)', u.id, e.date, days, String(req.body.reason || '').trim() || null);
    core.notifyApprovers(u.id, 'approval', `Comp-off request: ${u.name}`, `Worked on ${e.date} · ${days} day(s)`);
    res.json({ ok: true });
  }));
  r.post('/compoff/:id/decision', wrap((req, res) => {
    const c = get('SELECT * FROM att_compoff WHERE id=?', +req.params.id);
    if (!c) throw httpErr(404, 'Not found');
    if (!core.canDecide(req.user, c.user_id)) throw httpErr(403, 'You cannot decide this request');
    if (c.status !== 'pending') throw httpErr(409, 'Already decided');
    const status = req.body.approve ? 'approved' : 'rejected';
    const expires = status === 'approved' ? addDays(c.worked_date, core.settings().compoffExpiry) : null;
    run("UPDATE att_compoff SET status=?, expires_on=?, decided_by=?, decided_at=datetime('now'), remark=? WHERE id=?", status, expires, req.user.id, req.body.remark || null, c.id);
    notify(c.user_id, 'approval', `Comp-off ${status}`, `${c.worked_date}${expires ? ` · valid until ${expires}` : ''}${req.body.remark ? ' — ' + req.body.remark : ''}`);
    res.json({ ok: true });
  }));
  r.post('/compoff/:id/cancel', wrap((req, res) => {
    const c = get('SELECT * FROM att_compoff WHERE id=? AND user_id=?', +req.params.id, req.user.id);
    if (!c || c.status !== 'pending') throw httpErr(404, 'Not found');
    run("UPDATE att_compoff SET status='cancelled' WHERE id=?", c.id);
    res.json({ ok: true });
  }));

  // ---------- approvals inbox (HR sees everything; a reporting manager sees their team) ----------
  r.get('/approvals/count', (req, res) => res.json({ count: req.user.role === 'hr' || core.isManager(req.user) ? core.pendingApprovalCount(req.user) : 0 }));
  r.get('/approvals', approverOnly, wrap((req, res) => {
    const history = req.query.status === 'all';
    const ids = req.user.role === 'hr' ? null : core.reporteeIds(req.user.id);
    const params = ids || [];
    const where = `WHERE 1=1 ${history ? '' : "AND x.status='pending'"} ${ids ? `AND x.user_id IN (${ids.length ? ids.map(() => '?').join(',') : 'NULL'})` : ''}`;
    res.json({
      leaves: all(`SELECT x.id,x.user_id,x.from_date,x.to_date,x.half,x.session,x.days,x.reason,x.status,x.remark,x.created_at,(x.attachment IS NOT NULL) AS has_attachment,x.attachment_name,x.cc,
          t.name AS type_name,t.is_wfh,t.color,u.name AS user_name,u.emp_code
        FROM att_leaves x JOIN att_leave_types t ON t.id=x.type_id JOIN att_users u ON u.id=x.user_id ${where} ORDER BY x.id DESC LIMIT 300`, ...params),
      compoff: all(`SELECT x.*, u.name AS user_name, u.emp_code FROM att_compoff x JOIN att_users u ON u.id=x.user_id ${where} ORDER BY x.id DESC LIMIT 200`, ...params),
      regs: all(`SELECT x.*, u.name AS user_name, u.emp_code FROM att_regularizations x JOIN att_users u ON u.id=x.user_id ${where} ORDER BY x.id DESC LIMIT 200`, ...params),
      timesheets: all(`SELECT x.id,x.user_id,x.week_start,x.status,x.submitted_at,x.remark,u.name AS user_name,u.emp_code,
          (SELECT COALESCE(SUM(minutes),0) FROM att_timelogs l WHERE l.user_id=x.user_id AND l.date BETWEEN x.week_start AND date(x.week_start,'+6 day')) AS minutes
        FROM att_timesheets x JOIN att_users u ON u.id=x.user_id ${where} ORDER BY x.id DESC LIMIT 200`, ...params),
    });
  }));
}
