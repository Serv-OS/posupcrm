-- Notification delivery: email/SMS dispatch + new-ticket broadcast.

-- Delivery receipts (also prevents double sends)
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS emailed_at timestamptz;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS smsed_at timestamptz;

-- Every NEW support ticket notifies the support team (owners too) — assigned or not.
CREATE OR REPLACE FUNCTION public.notify_new_ticket() RETURNS trigger AS $$
BEGIN
  INSERT INTO public.notifications (recipient_id, actor_id, type, title, body, entity_type, link_id)
  SELECT p.id, NULL, 'system',
         'New ticket #' || NEW.ticket_number || ': ' || COALESCE(NEW.subject, 'No subject'),
         'A new support ticket has arrived', 'ticket', NEW.id
  FROM public.profiles p
  WHERE 'support' = ANY(COALESCE(p.teams, '{}')) OR p.role = 'owner';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_new_ticket_notify ON public.tickets;
CREATE TRIGGER trg_new_ticket_notify AFTER INSERT ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.notify_new_ticket();

-- Push every notification to the delivery function (email/SMS per user prefs)
CREATE OR REPLACE FUNCTION public.dispatch_notification() RETURNS trigger AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://__PROJECT_REF__.supabase.co/functions/v1/notify-dispatch',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('notification_id', NEW.id),
    timeout_milliseconds := 10000
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_notify_dispatch ON public.notifications;
CREATE TRIGGER trg_notify_dispatch AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.dispatch_notification();
