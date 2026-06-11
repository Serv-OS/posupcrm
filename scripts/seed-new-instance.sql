-- Seed data for a NEW instance (run once after schema setup).
-- The schema-clone process copies structure only; these are the lookup/config
-- rows the app needs to function. All idempotent.
-- Replace __PROJECT_REF__ with the new Supabase project ref before running.

-- Settings singletons
INSERT INTO public.support_settings (id, business_name) VALUES (1, '') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.ai_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Contact association roles (the "what they do in the business" dropdown)
INSERT INTO public.association_roles (role, label, sort) VALUES
  ('primary_contact', 'Primary Contact', 0),
  ('owner',           'Owner',           1),
  ('manager',         'Manager',         2),
  ('billing_contact', 'Billing Contact', 3),
  ('staff_member',    'Staff Member',    4)
ON CONFLICT (role) DO NOTHING;

-- Ticket SLA policies per priority
INSERT INTO public.sla_policies (priority, first_response_minutes, resolution_minutes) VALUES
  ('P0', 15, 240),
  ('P1', 60, 480),
  ('P2', 240, 1440),
  ('P3', 480, 4320)
ON CONFLICT (priority) DO NOTHING;

-- Reply templates
INSERT INTO public.templates (name, channel, subject, body)
SELECT v.name, v.channel, v.subject, v.body FROM (VALUES
  ('Acknowledge', 'email', 'Re: your support request', 'Hi {{contact_name}},

Thanks for getting in touch — we''ve logged your request as ticket {{ticket_number}} and are looking into it now. We''ll be back to you shortly.

Best,
ServOS Support'),
  ('Resolved', 'email', 'Your support request is resolved', 'Hi {{contact_name}},

We believe ticket {{ticket_number}} is now resolved. If anything''s still not right, just reply and we''ll pick it straight back up.

Best,
ServOS Support'),
  ('Quick SMS ack', 'sms', NULL, 'Hi {{contact_name}}, thanks for your message — we''re on it and will reply shortly. — ServOS Support')
) AS v(name, channel, subject, body)
WHERE NOT EXISTS (SELECT 1 FROM public.templates);

-- POS module catalogue
INSERT INTO public.modules (name, description, sort_order) VALUES
  ('POS Core',          'Core point-of-sale terminal',                1),
  ('Floor Plan & Tables','Table management and floor layout',         2),
  ('Bar Tabs',          'Open and manage bar tabs',                   3),
  ('Kitchen Display',   'Kitchen display system (KDS)',               4),
  ('Orders',            'Order management and routing',               5),
  ('Cash Management',   'Cash drawer and end-of-day reconciliation',  6),
  ('Diner CRM',         'Customer profiles, loyalty, and engagement', 7),
  ('Reservations',      'Table booking and reservation management',   8),
  ('Allergens',         'Allergen tracking and declarations',         9),
  ('Payments (Stripe)', 'Card payments via Stripe integration',      10),
  ('Delivery (Deliverect)', 'Delivery aggregator integration',       11),
  ('Staff Management',  'Staff scheduling, roles, and permissions',  12),
  ('Fiscal Reports',    'Financial reporting and compliance',        13),
  ('AI Agents',         'AI-powered automation and insights',        14)
ON CONFLICT (name) DO NOTHING;

-- Inventory warehouse
INSERT INTO public.inv_warehouses (name)
SELECT 'Main Warehouse' WHERE NOT EXISTS (SELECT 1 FROM public.inv_warehouses);

-- Staffing seeds
INSERT INTO public.departments (name, colour)
SELECT v.name, v.colour FROM (VALUES
  ('Sales','#15C26A'), ('Customer Support','#7C5CFF'), ('Implementation','#E8743C')
) AS v(name, colour)
WHERE NOT EXISTS (SELECT 1 FROM public.departments);

INSERT INTO public.areas (name, colour, required_per_day)
SELECT v.name, v.colour, v.req FROM (VALUES
  ('Phones','#15C26A',2), ('Support','#7C5CFF',2), ('On Call','#E8743C',1)
) AS v(name, colour, req)
WHERE NOT EXISTS (SELECT 1 FROM public.areas);

-- Cron: poll the shared support mailbox every minute (no-op until connected)
DO $$ BEGIN PERFORM cron.unschedule('gmail-check-poll'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('gmail-check-poll', '* * * * *', $$
  SELECT net.http_post(
    url := 'https://__PROJECT_REF__.supabase.co/functions/v1/gmail-check',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb, timeout_milliseconds := 30000);
$$);

-- Cron: recurring invoices daily at 06:00 UTC
DO $$ BEGIN PERFORM cron.unschedule('invoice-recurring-daily'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('invoice-recurring-daily', '0 6 * * *', $$
  SELECT net.http_post(
    url := 'https://__PROJECT_REF__.supabase.co/functions/v1/invoice-recurring',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb, timeout_milliseconds := 55000);
$$);

-- Realtime: live updates for the bell, tickets, and CRM lists (the schema
-- clone does NOT copy publication membership — without this nothing is live)
ALTER PUBLICATION supabase_realtime ADD TABLE
  public.buckets, public.backlog_items, public.comments, public.activity,
  public.features, public.companies, public.locations, public.contacts,
  public.deals, public.onboardings, public.tickets, public.tasks,
  public.mentions, public.agent_status, public.leads, public.notifications;

-- NOTE: migration 050's dispatch_notification() function embeds the project
-- ref in its pg_net URL — re-run 050 with __PROJECT_REF__ swapped per instance.
