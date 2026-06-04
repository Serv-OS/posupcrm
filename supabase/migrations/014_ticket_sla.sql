-- Migration 014: Ticket SLA tracking
-- Per-priority first-response and resolution targets, with due timestamps
-- set automatically and first-response captured from the first outbound reply.

-- Policy table (one row per priority), editable by owners
CREATE TABLE IF NOT EXISTS public.sla_policies (
  priority               text PRIMARY KEY CHECK (priority IN ('P0','P1','P2','P3')),
  first_response_minutes int NOT NULL,
  resolution_minutes     int NOT NULL,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.sla_policies (priority, first_response_minutes, resolution_minutes) VALUES
  ('P0', 15,   240),    -- 15 min / 4 h
  ('P1', 60,   480),    -- 1 h  / 8 h
  ('P2', 240,  1440),   -- 4 h  / 24 h
  ('P3', 480,  4320)    -- 8 h  / 72 h
ON CONFLICT (priority) DO NOTHING;

ALTER TABLE public.sla_policies ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY sla_read ON public.sla_policies FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY sla_write ON public.sla_policies FOR ALL TO authenticated
    USING (public.current_user_role() = 'owner') WITH CHECK (public.current_user_role() = 'owner');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- SLA columns on tickets (additive)
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS first_response_at  timestamptz;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS response_due_at    timestamptz;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS resolution_due_at  timestamptz;

-- Set/refresh due dates from the policy on insert and when priority changes
CREATE OR REPLACE FUNCTION public.set_ticket_sla() RETURNS trigger AS $$
DECLARE
  fr int; rs int;
  base timestamptz := COALESCE(NEW.created_at, now());
BEGIN
  SELECT first_response_minutes, resolution_minutes INTO fr, rs
  FROM public.sla_policies WHERE priority = NEW.priority;
  IF fr IS NULL THEN RETURN NEW; END IF;
  NEW.response_due_at   := base + make_interval(mins => fr);
  NEW.resolution_due_at := base + make_interval(mins => rs);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ticket_sla ON public.tickets;
CREATE TRIGGER trg_ticket_sla BEFORE INSERT OR UPDATE OF priority ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.set_ticket_sla();

-- Capture first response: first outbound, customer-facing reply on the ticket
CREATE OR REPLACE FUNCTION public.mark_ticket_first_response() RETURNS trigger AS $$
BEGIN
  IF NEW.subject_type = 'ticket'
     AND NEW.direction = 'outbound'
     AND COALESCE(NEW.is_internal, false) = false THEN
    UPDATE public.tickets
      SET first_response_at = COALESCE(first_response_at, now())
      WHERE id = NEW.subject_id AND first_response_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_ticket_first_response ON public.crm_activities;
CREATE TRIGGER trg_ticket_first_response AFTER INSERT ON public.crm_activities
  FOR EACH ROW EXECUTE FUNCTION public.mark_ticket_first_response();

-- Backfill existing tickets
UPDATE public.tickets t SET
  response_due_at   = t.created_at + make_interval(mins => p.first_response_minutes),
  resolution_due_at = t.created_at + make_interval(mins => p.resolution_minutes)
FROM public.sla_policies p
WHERE p.priority = t.priority AND t.response_due_at IS NULL;

UPDATE public.tickets t SET first_response_at = a.first_out
FROM (
  SELECT subject_id, min(created_at) AS first_out
  FROM public.crm_activities
  WHERE subject_type = 'ticket' AND direction = 'outbound'
  GROUP BY subject_id
) a
WHERE a.subject_id = t.id AND t.first_response_at IS NULL;
