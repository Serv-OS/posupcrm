-- gmail-oauth-callback upserts ON CONFLICT (email); without this constraint the
-- write fails (and the function used to swallow the error and report success).
DELETE FROM public.gmail_connections a USING public.gmail_connections b
  WHERE a.email = b.email AND a.created_at < b.created_at;
ALTER TABLE public.gmail_connections ADD CONSTRAINT gmail_connections_email_key UNIQUE (email);
