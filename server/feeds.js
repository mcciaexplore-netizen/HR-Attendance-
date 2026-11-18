import { ist, addDays } from './util.js';

const VERB = { birthday: 'a happy birthday', anniversary: 'a happy work anniversary', welcome: 'a warm welcome' };

// Feeds: today's birthdays and work anniversaries, upcoming ones, new joiners, announcements, and the wishes people send.
export function registerFeeds(r, { core, httpErr, wrap }) {
  const { all, get, run, notify } = core;

  const person = (u, extra = {}) => ({ id: u.id, name: u.name, department: u.department, designation: u.designation, role: u.role, ...extra });

  r.get('/feeds', wrap((req, res) => {
    const t = ist().date, me = req.user.id, year = +t.slice(0, 4);
    const c = core.celebrations(t, addDays(t, 30));
    const wished = new Set(all('SELECT to_id, kind FROM att_wishes WHERE from_id=? AND year=?', me, year).map((w) => `${w.to_id}:${w.kind}`));
    const mk = (kind) => (x) => person(x.user, { date: x.date, years: x.years, you: x.user.id === me, wished: wished.has(`${x.user.id}:${kind}`) });
    const bd = c.birthdays.map(mk('birthday')), an = c.anniversaries.map(mk('anniversary'));
    const joiners = all('SELECT * FROM att_users WHERE active=1 AND start_date BETWEEN ? AND ? ORDER BY start_date DESC, name', addDays(t, -30), t)
      .map((u) => person(u, { date: u.start_date, you: u.id === me, wished: wished.has(`${u.id}:welcome`) }));
    res.json({
      today: t,
      birthdays: { today: bd.filter((x) => x.date === t), upcoming: bd.filter((x) => x.date > t) },
      anniversaries: { today: an.filter((x) => x.date === t), upcoming: an.filter((x) => x.date > t) },
      joiners,
      announcements: all('SELECT id,title,body,created_at FROM att_announcements ORDER BY id DESC LIMIT 10'),
      wishes: all(`SELECT w.id, w.kind, w.message, w.created_at, u.name AS from_name FROM att_wishes w JOIN att_users u ON u.id=w.from_id
        WHERE w.to_id=? AND w.created_at >= datetime('now','-14 day') ORDER BY w.id DESC LIMIT 30`, me),
    });
  }));

  // Send wishes: only on the day itself (birthday / anniversary) or within 30 days of joining (welcome), once per person.
  r.post('/wishes', wrap((req, res) => {
    const { kind } = req.body;
    if (!VERB[kind]) throw httpErr(400, 'Unknown kind of wish');
    const to = get('SELECT * FROM att_users WHERE id=? AND active=1', +req.body.to_id);
    if (!to) throw httpErr(404, 'Person not found');
    if (to.id === req.user.id) throw httpErr(400, 'You cannot send wishes to yourself.');
    const t = ist().date, c = core.celebrations(t, t);
    const valid = kind === 'birthday' ? c.birthdays.some((x) => x.user.id === to.id)
      : kind === 'anniversary' ? c.anniversaries.some((x) => x.user.id === to.id)
        : to.start_date <= t && to.start_date >= addDays(t, -30);
    if (!valid) throw httpErr(400, kind === 'welcome' ? `${to.name} did not join recently.` : `${to.name} has no ${kind} today.`);
    const message = String(req.body.message || '').trim().slice(0, 300);
    try {
      run('INSERT INTO att_wishes(from_id,to_id,kind,year,message) VALUES (?,?,?,?,?)', req.user.id, to.id, kind, +t.slice(0, 4), message || null);
    } catch (e) {
      if (/UNIQUE/.test(String(e.message))) throw httpErr(409, `You have already wished ${to.name.split(' ')[0]}.`);
      throw e;
    }
    notify(to.id, 'wish', `${req.user.name} wished you ${VERB[kind]}`, message || null);
    res.json({ ok: true });
  }));
}
