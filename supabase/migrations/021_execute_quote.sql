-- Migration 021: execute_quote() — when a quote is signed+paid (or signed with
-- invoice-later terms), mark it won, close the deal, and create onboarding with
-- the go-live date. Mirrors handleClosedWon so both the sign flow and the Stripe
-- webhook can call it.

ALTER TABLE public.onboardings ADD COLUMN IF NOT EXISTS target_go_live date;

CREATE OR REPLACE FUNCTION public.execute_quote(p_quote_id uuid) RETURNS void AS $$
DECLARE
  q public.quotes%ROWTYPE;
  d public.deals%ROWTYPE;
  ob_id uuid;
BEGIN
  SELECT * INTO q FROM public.quotes WHERE id = p_quote_id;
  IF q.id IS NULL THEN RETURN; END IF;

  UPDATE public.quotes SET status = 'won' WHERE id = p_quote_id AND status <> 'won';

  IF q.deal_id IS NULL THEN RETURN; END IF;
  SELECT * INTO d FROM public.deals WHERE id = q.deal_id;
  IF d.id IS NULL THEN RETURN; END IF;

  IF d.stage <> 'closed_won' THEN
    UPDATE public.deals SET stage = 'closed_won', closed_at = now() WHERE id = d.id;
    INSERT INTO public.stage_history (object_type, object_id, from_stage, to_stage, changed_by)
      VALUES ('deal', d.id, d.stage, 'closed_won', d.owner_id);
  END IF;

  -- Onboarding (one per deal)
  SELECT id INTO ob_id FROM public.onboardings WHERE deal_id = d.id LIMIT 1;
  IF ob_id IS NULL THEN
    INSERT INTO public.onboardings (company_id, deal_id, owner_id, target_go_live, notes)
      VALUES (d.company_id, d.id, d.owner_id, q.go_live_date, 'Auto-created from accepted quote #' || q.quote_number)
      RETURNING id INTO ob_id;
    INSERT INTO public.stage_history (object_type, object_id, from_stage, to_stage, changed_by)
      VALUES ('onboarding', ob_id, NULL, 'kickoff', d.owner_id);
    -- copy location + contact associations from the deal
    INSERT INTO public.associations (from_type, from_id, to_type, to_id, label)
      SELECT 'onboarding', ob_id, 'location', a.to_id, COALESCE(a.label, 'affected_location')
      FROM public.associations a WHERE a.from_type = 'deal' AND a.from_id = d.id AND a.to_type = 'location';
    INSERT INTO public.associations (from_type, from_id, to_type, to_id, label)
      SELECT 'onboarding', ob_id, 'contact', a.to_id, a.label
      FROM public.associations a WHERE a.from_type = 'deal' AND a.from_id = d.id AND a.to_type = 'contact';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.execute_quote(uuid) TO authenticated, anon, service_role;
