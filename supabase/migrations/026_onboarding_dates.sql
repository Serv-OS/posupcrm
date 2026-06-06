-- Migration 026: onboarding tracking dates + install location
ALTER TABLE public.onboardings ADD COLUMN IF NOT EXISTS kickoff_at timestamptz;
ALTER TABLE public.onboardings ADD COLUMN IF NOT EXISTS expected_install_date date;
ALTER TABLE public.onboardings ADD COLUMN IF NOT EXISTS actual_install_date date;
ALTER TABLE public.onboardings ADD COLUMN IF NOT EXISTS activation_date date;
ALTER TABLE public.onboardings ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL;
