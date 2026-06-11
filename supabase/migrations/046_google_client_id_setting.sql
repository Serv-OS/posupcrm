-- Per-instance Google OAuth client ID (frontend reads this; env var is fallback)
ALTER TABLE public.support_settings ADD COLUMN IF NOT EXISTS google_client_id text;
