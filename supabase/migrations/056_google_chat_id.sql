-- Personal @mention pings in the team Chat space need each user's Google numeric
-- ID (same value Chat uses for <users/{id}> mentions). Resolved lazily by
-- notify-dispatch from the user's existing Google connection, then cached here.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS google_chat_id text;
