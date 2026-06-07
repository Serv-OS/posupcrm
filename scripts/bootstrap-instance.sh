#!/usr/bin/env bash
# Bootstrap a fresh ServOS instance: apply all migrations + deploy all edge
# functions to a brand-new Supabase project. Idempotent — safe to re-run.
#
# Required env vars:
#   SUPABASE_ACCESS_TOKEN   your Supabase personal access token (sbp_...)
#   PROJECT_REF             the new project's ref
#   SUPABASE_DB_PASSWORD    the new project's database password (for `db push`)
#
# Usage: ./scripts/bootstrap-instance.sh
set -euo pipefail

: "${SUPABASE_ACCESS_TOKEN:?set SUPABASE_ACCESS_TOKEN}"
: "${PROJECT_REF:?set PROJECT_REF}"

cd "$(dirname "$0")/.."

echo "==> Linking project $PROJECT_REF"
npx supabase link --project-ref "$PROJECT_REF"

echo "==> Applying migrations"
npx supabase db push

# App functions: gateway-verified JWT (default). Safe to deploy normally.
JWT_FUNCS=(gmail-personal gmail-send google-calendar google-chat ai-draft stripe-connect twilio-voice-token twilio-send-sms)

# Public / webhook functions: called by browsers or external services with NO
# Supabase JWT — must be deployed with --no-verify-jwt or they reject callers.
NOJWT_FUNCS=(forms-public quote-public quote-checkout gmail-oauth-callback gmail-check stripe-webhook twilio-inbound-sms twilio-recording twilio-voice-incoming twilio-voice-status twilio-voicemail)

for fn in "${JWT_FUNCS[@]}"; do
  echo "==> deploy $fn (verify_jwt on)"
  npx supabase functions deploy "$fn" --project-ref "$PROJECT_REF"
done

for fn in "${NOJWT_FUNCS[@]}"; do
  echo "==> deploy $fn (verify_jwt OFF — public/webhook)"
  npx supabase functions deploy "$fn" --project-ref "$PROJECT_REF" --no-verify-jwt
done

echo
echo "Done. Next:"
echo "  1. Set Edge Function secrets (GMAIL_CLIENT_ID/SECRET, TWILIO_*, APP_URL)"
echo "  2. Create the Vercel project with VITE_SUPABASE_URL / _ANON_KEY / VITE_GOOGLE_CLIENT_ID"
echo "  3. Do the Google Cloud project setup (see docs/setup-new-customer.md)"
echo "  4. First owner logs in and fills Settings → Branding + the rest"
