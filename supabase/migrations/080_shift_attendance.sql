-- Shift attendance: did the person actually turn up?
--
-- Deliberately NOT folded into shifts.status. status is roster state (draft ->
-- published) and drives publishing and the SMS run; attendance is what happened
-- on the day. Overloading one column would make a no-show un-publish itself and
-- force every publish query to special-case it.
--
-- NULL = not marked yet. The CHECK allows NULL (a CHECK only fails on FALSE),
-- so existing rows stay valid and nothing needs backfilling.
alter table public.shifts add column if not exists attendance text
  check (attendance in ('attended', 'no_show'));
alter table public.shifts add column if not exists attendance_at timestamptz;
alter table public.shifts add column if not exists attendance_by uuid
  references public.profiles(id) on delete set null;

-- The attendance report reads "every marked shift in a date window", so the
-- index only carries marked rows.
create index if not exists idx_shifts_attendance
  on public.shifts (date, attendance) where attendance is not null;
