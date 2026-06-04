// Stripe webhook: on checkout.session.completed, mark the quote paid and
// execute it (close the deal -> create onboarding).
//
// Required secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";

serve(async (req) => {
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!stripeKey || !webhookSecret) return new Response("Stripe not configured", { status: 503 });

  const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16", httpClient: Stripe.createFetchHttpClient() });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const sig = req.headers.get("stripe-signature");
  const raw = await req.text();
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig!, webhookSecret, undefined, Stripe.createSubtleCryptoProvider());
  } catch (e) {
    return new Response(`Webhook signature failed: ${(e as Error).message}`, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as any;
    const quoteId = session.metadata?.quote_id;
    if (quoteId) {
      await supabase.from("quotes").update({
        status: "paid",
        paid_at: new Date().toISOString(),
        amount_paid: (session.amount_total || 0) / 100,
        stripe_payment_intent: session.payment_intent || null,
      }).eq("id", quoteId);
      // Close the deal + create onboarding
      await supabase.rpc("execute_quote", { p_quote_id: quoteId });
    }
  }

  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});
