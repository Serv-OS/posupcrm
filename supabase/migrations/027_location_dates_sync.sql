-- Migration 027: mirror onboarding key dates onto the location, and keep
-- them in sync (onboarding -> location) whenever an onboarding is saved.

ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS kickoff_at timestamptz;
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS expected_install_date date;
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS actual_install_date date;
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS activation_date date;
-- locations.go_live_date already exists

CREATE OR REPLACE FUNCTION public.sync_onboarding_to_location() RETURNS trigger AS $$
BEGIN
  IF NEW.location_id IS NOT NULL THEN
    UPDATE public.locations SET
      kickoff_at            = COALESCE(NEW.kickoff_at, kickoff_at),
      expected_install_date = COALESCE(NEW.expected_install_date, expected_install_date),
      actual_install_date   = COALESCE(NEW.actual_install_date, actual_install_date),
      activation_date       = COALESCE(NEW.activation_date, activation_date),
      go_live_date          = COALESCE(NEW.target_go_live, go_live_date)
    WHERE id = NEW.location_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_onboarding_sync_location ON public.onboardings;
CREATE TRIGGER trg_onboarding_sync_location AFTER INSERT OR UPDATE ON public.onboardings
  FOR EACH ROW EXECUTE FUNCTION public.sync_onboarding_to_location();
