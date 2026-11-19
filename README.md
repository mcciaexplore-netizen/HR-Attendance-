# MCCIA Attendance Tracker

Attendance, leave, comp-off, work-from-home and time tracking for MCCIA interns and consultants, modelled on the
attendance / leave / time modules of Zoho People. Runs locally now and drops into the MCCIA app hub later.

## Run it

```bash
npm install
npm run build      # builds the UI into client/dist
npm start          # http://localhost:4000  (API + UI, one process)
```

Development with hot reload: `npm run dev` (UI on :5173, API on :4000).
Reset all data: stop the server, `npm run reset-db`. Skip the demo people with `SEED_DEMO=0`.
Needs Node 22.5+ (built-in `node:sqlite`, nothing to compile). An existing database upgrades itself on start.

**Demo logins** — HR: `HR001` / `1234`. Interns `INT1001`–`INT1004`, consultant manager `CON2001` and MCCIA approver `MGR3001`: PIN `1111`.

**Tests** (on a fresh database): `npm run reset-db`, start the server, then `npm run smoke` (≈140 API checks covering the rules
below) and `npm run test:reminders` (reminder engine with a simulated clock).

## How the screens are laid out (same as Zoho People)

- **Phones:** a bottom bar with Home · Leave · **+ Add** · Time · More. **Laptops:** the same pages in a left sidebar.
- **Home** has *My Space / Team* pills and *Activities · Dashboard · Calendar · Profile* tabs. The check-in card shows the hours
  worked today as HH : MM : SS next to one **Check-In / Check-Out** button, with the Work Schedule card under it.
- **+ Add** opens one sheet for Leave, Work from home, Regularize, Time log, Comp-off and Optional holiday.
- HR gets *Today · Approvals · People · Attendance · Leave Tracker · Time Tracker · Reports · Settings*.

## What it does (and the Zoho People feature it follows)

| Area | Features |
|---|---|
| **Check-in / out** | One tap on the phone, only within the office geofence (150 m, GPS jitter forgiven). Optional "office network only" rule by public IP. Live clock, hours worked today. Late mark = after shift start + grace. |
| **Shifts & work schedule** | Shifts with start/end, grace time, full-day and half-day hours and weekly offs. Assigned per person; one is the default. "Work schedule" widget shows the next days (working day / weekly off / holiday / leave / WFH). |
| **Attendance summary** | List or calendar. Per day: late-in, early-out, excess / deficit hours against the shift, extra-work days. Month cards, CSV download. |
| **Regularization** | Only for a day when a check-in or check-out was actually **missed** (no check-in, or a check-in without a check-out), within the last 31 days (HR can change this in Settings). Today, upcoming days, holidays, weekly offs, leave days and days with both punches are refused, and the form only offers the correctable days. Goes to the approver and updates the record when approved. |
| **Extra work & comp-off** | Working on a holiday or weekly off: "Check in as extra work". Request comp-off for that day (full / half), valid for N days (setting), used later as leave. Balance uses oldest-first and respects expiry. |
| **Work from home** | Request → approver approves → WFH check-in unlocks anywhere, with a plan note at check-in and a summary at check-out. |
| **Leave policies** | Per leave type: yearly quota, accrual (full / monthly), carry-forward cap, max consecutive days, notice period, how far back it can be applied, half days (first / second half), "count weekends in between", supporting document after N days (e.g. sick leave), available to interns / consultants / all, colour. HR edits them under Settings → Leave types. |
| **Leave tracker** | Leave Summary (balance / booked per type, year selector), Leave Requests (status, who approved, remark, attachment), Compensatory Off, Holidays, Team Calendar. CC colleagues on a request. Cancel pending or future leave. |
| **Optional holidays** | HR marks holidays "optional"; employees take up to the policy limit (default 2 / year). |
| **Balances (HR)** | Per person and year: entitled, carried, adjusted, booked, pending, balance. HR can add or deduct days with a remark; the employee is notified. |
| **Approvals (two cycles)** | Every request goes to the person's **reporting manager**; with no manager it goes to HR, and HR can approve anything. *Cycle 1:* interns and consultants → their reporting manager (often a consultant). *Cycle 2:* a consultant manager applies in this app too and their request goes to **their** manager, an MCCIA manager with an **Approver** account. One inbox: Leave & WFH, Comp-off, Corrections, Timesheets (approve / reject with remark, history). The leave form and request cards show who it is waiting for. |
| **Approver account** | For MCCIA managers who already use Zoho for their own attendance: they only approve. They see their direct reports' requests and attendance, the team, the org chart and Feeds, but do not punch, apply for leave or log time here. |
| **Feeds** | Today's **birthdays** and **work anniversaries** with a *Send wishes* button (templates or your own message, once per person), **new joiners** (*Welcome*), upcoming birthdays and anniversaries (next 30 days), announcements. The person sees the wishes and gets a notification. Only the day and month are shown, never the age. A daily notice goes out at the time set in Settings (default 09:00); birthdays and anniversaries are marked in the team calendar. |
| **Org chart** | Reporting lines for everyone (Team → Org chart, and People for HR). People with no manager sit under HR. |
| **Profile** | Designation, birthday, phone. Everyone edits their own birthday and phone; HR manages the rest in People. |
| **Time Tracker** | Projects and jobs (HR manages). Time logs by day, weekly timesheets, submit for approval; a submitted week is locked until rejected. |
| **Team** | Directory with who is in / WFH / on leave / not in yet today, contacts, manager. A manager can open their team's calendars. |
| **HR** | Today list (not in yet / in office / WFH / on leave, filterable), people (shift + manager), reports (monthly with late/early/excess/deficit, daily, leave balance, leave history, time by project) with CSV, announcements, reminders on demand. |
| **Reminders** | 10:00 and 10:30 check-in, 17:30 and 18:00 check-out (editable), "you forgot to check out yesterday", HR digest 10:45, pending-approvals reminder 11:00 for HR and managers. Skipped on holidays, weekly offs and approved leave, per person's shift. |

## Who can do what

| | Intern / consultant | Reporting manager | HR |
|---|---|---|---|
| Check in/out, apply, correct, log time | ✔ | ✔ | – |
| See the team directory, org chart, feeds & team leave calendar | ✔ | ✔ | ✔ |
| Send birthday / anniversary wishes | ✔ | ✔ | ✔ |
| Approve requests of their direct reports | – | ✔ | ✔ (everyone) |
| See a team member's attendance calendar | – | ✔ (reportees) | ✔ (everyone) |
| People, shifts, leave types, balances, holidays, settings, reports | – | – | ✔ |

An **Approver** (MCCIA manager) behaves like a reporting manager from the second column but has no attendance, leave or time of their own here.

## First things to set up (HR)

1. **Settings → General → Use my current location** while standing in the office (the default point is ICC Trade Tower, S.B. Road).
2. **Settings → Shifts**: adjust the General shift; add others if needed. **People**: pick each person's shift and reporting manager. Add the MCCIA managers who approve consultants' leave as role **Approver**, then set the consultant managers' *Reporting manager* to them. Add birthdays and designations here too (people can add their own birthday in their profile).
3. **Settings → Leave types**: check quotas and rules. **Leave → Holidays**: add the year's holidays (tick *Optional* for restricted ones).

## Important: HTTPS for phones

Browsers allow **location and notifications only on HTTPS or `localhost`**. On a laptop at `localhost` everything works; for
interns' phones the app must be served over HTTPS (the app hub's domain will do this).

## Plugging into the MCCIA app hub

- All tables are prefixed `att_`. Columns added after the first release are applied on start (`server/db.js`), so a shared
  database is upgraded in place. The SQL is plain; no SQLite-only features beyond `datetime('now')` and `PRAGMA`.
- The backend is an Express router, split by feature (`router.js`, `leave.js`, `timetracker.js`, `team.js`, `admin.js`, `reports.js`, `scheduler.js`):
  ```js
  import { mountAttendance } from './mccia-attendance/server/index.js';
  mountAttendance(app, { db: hubDb /* optional */, mountPath: '/api/attendance', secret: process.env.ATT_SECRET });
  ```
  It also starts the reminder scheduler. Replace PIN login with the hub's SSO by changing the `auth` middleware to set `req.user`
  from the hub session. `att_users.emp_code` can map to hub users.
- Frontend: `VITE_BASE=/attendance/ npm run build` for a sub-path; API URL overridable with `window.MCCIA_ATT_API`.
  Brand colours are CSS variables at the top of `client/src/theme.css`; the logo is `client/public/logo.png`.
- Times are computed in IST and stored as UTC ISO.

## Not included (compared with the full Zoho People)

Several check-in/out sessions in one day (one in/out per day), overtime pay and payroll, leave encashment, pro-rata entitlement
for mid-year joiners, second-level approvals in one request and approval delegation (a manager's request goes to one approver; HR can always step in), location-specific holiday lists, shift rotation rosters,
automatic late-mark leave deductions (shown in reports only), biometric devices, e-mail notifications and background push when
the app is closed (reminders are in-app and as device pop-ups while the app is open), clients/billing in Time Tracker, and the other Zoho People modules (recruitment, performance, payroll, helpdesk, documents).
The HR tablet kiosk (PIN + selfie) still exists in the server but has no screen.
+
