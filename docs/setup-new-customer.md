# Spin up a new customer instance

One codebase, one instance per customer. Each customer gets their own Supabase
project, Vercel deployment, and Google Cloud project. **Never fork the code** —
all per-customer differences are configuration (env vars + Settings), so a bug
fix shipped to `main` reaches every customer.

Rough time: ~15–20 min, most of it the Google Cloud step (the only part that
can't be scripted).

---

## 1. Supabase project

1. Create a new project at supabase.com → note the **project ref** and **anon key**.
2. From this repo, run the bootstrap (applies all migrations + deploys edge functions):
   ```sh
   export SUPABASE_ACCESS_TOKEN=sbp_...        # your Supabase personal access token
   export PROJECT_REF=<new-project-ref>
   export SUPABASE_DB_PASSWORD=<db-password>   # shown once at project creation
   ./scripts/bootstrap-instance.sh
   ```
3. In the dashboard → **Edge Functions → Secrets**, set the per-instance secrets:
   - `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` (this customer's Google OAuth client)
   - Twilio: `TWILIO_*` (if they want phone/SMS)
   - `APP_URL` = the customer's Vercel URL
   - (Anthropic + Stripe are entered in-app, not here)
4. Auth → set **Email OTP length = 6** and update the magic-link email template.
5. Storage → confirm the `branding` (public) and `attachments` (private) buckets exist
   (the bootstrap creates them; re-check if you skipped that step).

## 2. Vercel project

1. New project from this Git repo.
2. Environment variables:
   - `VITE_SUPABASE_URL` = `https://<project-ref>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = the anon key
   - `VITE_GOOGLE_CLIENT_ID` = this customer's Google OAuth **web client ID**
3. Deploy.

## 3. Google Cloud project (the manual part)

Per customer (Google ties OAuth + Chat config to a project):
1. New project → **APIs & Services**: enable Gmail, Calendar, Chat, People APIs.
2. **OAuth consent screen / Audience**: set User type to **Internal** if the customer
   is a Google Workspace org (no verification, no test-user list); otherwise External + test users.
3. **Data Access → scopes**: add `gmail.modify`, `gmail.send`, `calendar.events`,
   `chat.spaces.readonly`, `chat.messages`, `chat.memberships.readonly`, `directory.readonly`.
4. **Chat API → Configuration**: app name, avatar URL, description; turn interactive features OFF.
5. **Clients**: create a Web application OAuth client. Authorized redirect URI =
   `https://<project-ref>.supabase.co/functions/v1/gmail-oauth-callback`.
   Put the client ID/secret into Vercel (`VITE_GOOGLE_CLIENT_ID`) and Supabase secrets
   (`GMAIL_CLIENT_ID`/`GMAIL_CLIENT_SECRET`).

## 4. First login + customise

1. First user signs in (magic link / OTP) → set their role to `owner` in `profiles`.
2. **Settings → Branding & white-label**: app name + brand colours.
3. **Settings → Quote branding**: upload light/dark logos + business info.
4. Configure the rest in-app: Quote terms, tax, SLA targets, auto-reply, templates,
   forms, phone/voicemail, ticket auto-assignment, AI key, Stripe key, products/plans.

That's it — the instance is fully branded and configured without any code change.

---

## What's configuration vs code

| Configured in-app (per instance) | Configured via env / secrets |
|---|---|
| App name, brand colours, logos | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| Quote terms, tax, payment terms | `VITE_GOOGLE_CLIENT_ID` |
| SLA targets, auto-reply, templates, forms | `GMAIL_CLIENT_ID/SECRET` |
| Phone/voicemail, ticket auto-assignment | `TWILIO_*`, `APP_URL` |
| AI key + tone, Stripe key, products/plans | (service role auto-set by Supabase) |
