-- Migration 025: separate dark-mode logo
ALTER TABLE public.support_settings ADD COLUMN IF NOT EXISTS logo_url_dark text;
