-- Time tracking: one row per work session. company_id/location_id are resolved
-- at start time (denormalised) so reports aggregate cheaply.
create table if not exists public.time_entries (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  subject_type  text,        -- 'ticket' | 'task' | 'project' | 'company' | 'location' | 'deal' | 'onboarding'
  subject_id    uuid,
  label         text,        -- human label of what was worked on (denormalised)
  company_id    uuid references public.companies(id) on delete set null,
  location_id   uuid references public.locations(id) on delete set null,
  note          text,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  duration_seconds integer,  -- set when stopped
  created_at    timestamptz not null default now()
);

create index if not exists idx_time_entries_profile on public.time_entries(profile_id, started_at desc);
create index if not exists idx_time_entries_company on public.time_entries(company_id);
create index if not exists idx_time_entries_subject on public.time_entries(subject_type, subject_id);
-- at most one running timer per user
create unique index if not exists uniq_running_timer on public.time_entries(profile_id) where ended_at is null;

alter table public.time_entries enable row level security;

-- Any signed-in user can read entries (needed for team reports).
drop policy if exists time_entries_select on public.time_entries;
create policy time_entries_select on public.time_entries for select using (auth.uid() is not null);

-- You create/own your entries; owners can edit/delete anyone's.
drop policy if exists time_entries_insert on public.time_entries;
create policy time_entries_insert on public.time_entries for insert
  with check (profile_id = auth.uid());

drop policy if exists time_entries_update on public.time_entries;
create policy time_entries_update on public.time_entries for update using (
  profile_id = auth.uid() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
);

drop policy if exists time_entries_delete on public.time_entries;
create policy time_entries_delete on public.time_entries for delete using (
  profile_id = auth.uid() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
);
