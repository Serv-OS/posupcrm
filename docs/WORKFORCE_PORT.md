# Porting ServOS staff management into posupcrm

Assessment, 31 Aug 2026. Read the summary; the detail is here when you need it.

## The short version

**Don't port it wholesale.** ServOS Workforce is 21 tables, 13 screens and 3
edge functions built for **multi-venue hourly hospitality staff on a till**.
posupcrm has **3 users in one office with no till**. Most of that machinery
solves problems you don't have here.

Port in **tiers**, cheapest and most useful first. Tier 0 is already built.

---

## What each side actually has

### ServOS Workforce (the source)
Staff HR records, rota build + publish, timesheets, **clock-in via PIN on a
tablet**, breaks, **holiday accrual ledger** (12.07%, UK 52-week averaging),
availability, **payroll runs + BACS CSV**, **tronc/tips**, positions + rate
card with future-dated changes, compliance document vault, 7-step onboarding
with **e-signed contracts**, training modules, announcements.

Pay-critical maths runs **server-side** in the `workforce-compute` edge
function. The browser never computes money for the record.

### posupcrm staffing (the target)
Rota by staff or area, drag-drop, copy week forward, coverage gaps, publish +
SMS the rota, time off with approve/deny, leave balances, departments/areas.

Missing entirely: **clock-in, attendance, pay rates, payroll, accrual,
availability, staff self-service.** A "viewer" can't even request their own
holiday.

---

## Why it's a re-platform, not a copy

Five walls, in the order they'll stop you:

1. **Tenancy.** Every ServOS row is scoped `(location_id, org_id)` with RLS
   built on `user_accessible_locations()`. posupcrm has neither, and its
   `locations` table is a record of a *customer's* venue (prospect/churned,
   est_monthly_revenue), not an operating site. The rota's primary scoping
   key doesn't exist here.
2. **Identity.** ServOS staff can exist with **no login at all** (PIN or NFC
   card). In posupcrm a staff member IS `profiles` = `auth.users`. Everyone
   rota'd needs an email login.
3. **The clock.** `workforce-clock` exists because a paired tablet is
   *anonymous* and can't write under RLS. posupcrm has no devices, no
   pairing, no PIN. A CRM clock-in is a **rewrite** (each person clocks
   themselves in as their own `auth.uid()`), not a port.
4. **Time.** ServOS business time = the venue's timezone. posupcrm's
   `staffing.js` is entirely device-local. ⚠ **The source isn't clean
   either** — `wfWeek.js` and `workforce-clock` use device/UTC time. Fix at
   source or you'll debug it twice.
5. **Leave.** ServOS is an **append-only ledger** (accrual +, taken −).
   posupcrm **recomputes** `entitlement − taken` on every render. These
   cannot coexist; porting the ledger needs a seeding migration.

Also: posupcrm's `shifts.user_id` is `ON DELETE CASCADE` — **deleting a user
destroys their rota and leave history.** ServOS is deliberately RESTRICT with
soft-delete. Flip this before porting anything financial.

---

## Recommended tiers

### Tier 0 — land what's already built (hours, not days)
The **attendance feature is finished and parked in a git stash**, and its
migration is **already applied to the live database**:
`shifts.attendance` / `attendance_at` / `attendance_by` exist right now, all
null across 95 rows.

- `git show stash@{0}^3:supabase/migrations/080_shift_attendance.sql` recovers
  the missing file (repo jumps 079 → 081)
- ⚠ The stash **will conflict** on `Sidebar.jsx` — its hunk rewrites the line
  that has since gained Booking Page. Careless resolution drops that nav item.
- Migrate the **"NO SHOW" fake-area data** into `shifts.attendance` (see below)

### Tier 1 — make the rota trustworthy (small, high value)
Fix the things that make attendance data meaningless:
- **No mobile = silently skipped** by every rota SMS. One person has no
  number, so has never received a rota text.
- **Draft shifts are never sent.** Nothing on screen distinguishes "they were
  told" from "we wrote it down".
- **The confirm link is dead.** Every rota SMS says `Confirm: crm.co/r/…` —
  there is no such route, handler or table. Shift acceptance is implied by
  the UI and does not exist.
- **Approved leave hides a clashing shift** instead of blocking it — the
  shift still exists, still gets texted, and is invisible on the grid.
- **Everyone can read everyone's sickness and holiday** (RLS is
  `auth.uid() is not null`). A real privacy problem the moment a non-manager
  account exists.

### Tier 2 — worth porting properly
- **Leave ledger** (`wf_holiday_accrual` pattern): append-only, SELECT+INSERT
  policies only, plus the explicit REVOKE — TRUNCATE bypasses RLS. Needs a
  migration seeding from existing `time_off` rows.
- **Availability model** — there is none today; nothing asks whether a person
  is free before assigning them.
- **Self-service** — staff seeing their own rota and requesting their own
  leave. ⚠ Needs its own Supabase client with its own `storageKey`; ServOS
  learned this the hard way (6 Aug: one shared client signed the Back Office
  out and broke every write).

### Tier 3 — only if this becomes a product
Clock-in, timesheets, rate cards, payroll + BACS, tronc, compliance vault,
onboarding e-sign. All of it assumes hourly staff, a venue and a till.
**For a 3-person office team this is cost with no return.**

### Don't port
POS PIN identity, multi-venue tenancy, tronc, age-banded pay, SIA gating,
sales-driven labour %. They need a till and a venue.

---

## Flowing the other way
ServOS Workforce has **no realtime and no notification feed** — its rota SMS
is fire-and-forget with no delivery receipt. posupcrm's `notifications` table
+ dispatch + delivery receipts is the better design. Worth pushing **CRM →
ServOS**: the notification pipeline, and copy-week-forward on the rota.

---

## The "NO SHOW" workaround

Someone has been recording absences by assigning shifts to a **fake area
named "NO SHOW"** (`areas`, colour #b51a00, required_per_day 1). This:
- silently corrupts by-area coverage maths (it counts as a staffed area)
- must be migrated into `shifts.attendance` when Tier 0 lands
- exists only because the finished attendance feature was never merged
