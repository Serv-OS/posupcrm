-- Who has the CRM open RIGHT NOW, and whether it is awake.
--
-- "Last login" was answering the wrong question. Supabase only stamps
-- auth.users.last_sign_in_at when someone actually types their password;
-- refresh tokens keep a session alive for months without touching it. Peter is
-- logged in and using the CRM daily, and the monitor said "25 Jun" — 69 days.
--
-- agent_status already carries a heartbeat, but that column is Twilio call
-- presence: it decides whether a call rings you, and a stale 'online' there has
-- already sent a customer to voicemail once. It must not be overloaded with
-- browser presence.
--
-- So: a separate table with one row per person, written by the app itself.
--
-- The state is what makes it precise. A heartbeat alone cannot tell you the
-- difference between someone working, someone who left the tab open and walked
-- away, and a laptop that went to sleep mid-sentence. Recording the state at
-- each beat, and letting the beats simply STOP when the machine sleeps, gives
-- all three.

create table if not exists public.user_presence (
  profile_id         uuid primary key references public.profiles(id) on delete cascade,
  -- 'active'  = tab visible and they have touched something recently
  -- 'idle'    = tab visible, but no input for a while (walked away, screen on)
  -- 'hidden'  = tab open but in the background, or the screen is locked
  -- 'closed'  = they closed the tab and the browser managed to tell us
  state              text        not null default 'active'
                     check (state in ('active', 'idle', 'hidden', 'closed')),
  last_seen_at       timestamptz not null default now(),   -- last heartbeat of any kind
  last_active_at     timestamptz,                          -- last real keypress/click/scroll
  session_started_at timestamptz,                          -- when this tab was opened
  page               text,                                 -- which screen they are on
  user_agent         text,
  updated_at         timestamptz not null default now()
);

comment on table public.user_presence is
  'Live browser presence per person. Heartbeat stops when the machine sleeps or the tab dies, so a stale last_seen_at IS the signal, not a bug.';

create index if not exists idx_user_presence_seen on public.user_presence(last_seen_at desc);

alter table public.user_presence enable row level security;

-- Everyone signed in can read presence: it is the same information you get by
-- looking across the office, and the activity monitor itself is owner-gated.
do $$ begin
  create policy user_presence_read on public.user_presence
    for select to authenticated using (true);
exception when duplicate_object then null; end $$;

-- You may only write your OWN presence. Without this anyone could claim to have
-- been at their desk, which would make the whole table worthless as evidence.
do $$ begin
  create policy user_presence_write_self on public.user_presence
    for all to authenticated
    using (profile_id = auth.uid())
    with check (profile_id = auth.uid());
exception when duplicate_object then null; end $$;
