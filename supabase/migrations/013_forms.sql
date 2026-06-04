-- Migration 013: Lead-capture / support forms
-- Build forms in the CRM, embed them on a website, route submissions to
-- Leads or Support with source tracking.

CREATE TABLE IF NOT EXISTS public.forms (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  slug         text NOT NULL UNIQUE,           -- public embed key
  description  text,
  destination  text NOT NULL DEFAULT 'lead' CHECK (destination IN ('lead','support')),
  source_tag   text,                           -- default lead/ticket source, e.g. "homepage"
  fields       jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{key,label,type,required,options,maps_to,placeholder}]
  settings     jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {success_message, redirect_url, default_priority, submit_label}
  enabled      boolean NOT NULL DEFAULT true,
  owner_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_forms_slug ON public.forms(slug);

CREATE TABLE IF NOT EXISTS public.form_submissions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id             uuid REFERENCES public.forms(id) ON DELETE CASCADE,
  data                jsonb NOT NULL DEFAULT '{}'::jsonb,  -- raw submitted values
  source_tag          text,
  page_url            text,
  referrer            text,
  created_lead_id     uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  created_ticket_id   uuid REFERENCES public.tickets(id) ON DELETE SET NULL,
  created_contact_id  uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  created_company_id  uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  status              text NOT NULL DEFAULT 'processed',
  error               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_form_submissions_form ON public.form_submissions(form_id, created_at DESC);

ALTER TABLE public.forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_submissions ENABLE ROW LEVEL SECURITY;

-- Forms: any signed-in user can read; editors/owners manage.
DO $$ BEGIN
  CREATE POLICY forms_read ON public.forms FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY forms_write ON public.forms FOR ALL TO authenticated
    USING (public.current_user_role() IN ('editor','owner'))
    WITH CHECK (public.current_user_role() IN ('editor','owner'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Submissions: signed-in users can read; writes happen via the edge
-- function (service role), so no public insert policy is needed.
DO $$ BEGIN
  CREATE POLICY form_submissions_read ON public.form_submissions FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP TRIGGER IF EXISTS trg_forms_touch ON public.forms;
CREATE TRIGGER trg_forms_touch BEFORE UPDATE ON public.forms
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
