// Public quote endpoint (no auth).
//   GET  ?token=...           -> quote + line items for the customer to view
//   POST { token, name, signature } -> save the drawn signature, mark signed,
//         and (if terms = invoice_later) execute the quote immediately.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const token = req.method === "GET"
      ? new URL(req.url).searchParams.get("token")
      : (await req.clone().json().catch(() => ({})))?.token;
    if (!token) return json({ error: "Missing token" }, 400);

    const { data: quote } = await supabase.from("quotes").select("*").eq("public_token", token).maybeSingle();
    if (!quote) return json({ error: "Quote not found" }, 404);

    if (req.method === "GET") {
      const [{ data: items }, { data: company }, { data: settings }] = await Promise.all([
        supabase.from("quote_line_items").select("*").eq("quote_id", quote.id).order("sort"),
        quote.company_id ? supabase.from("companies").select("name").eq("id", quote.company_id).single() : Promise.resolve({ data: null }),
        supabase.from("support_settings").select("quote_terms").eq("id", 1).maybeSingle(),
      ]);
      // Mark viewed
      if (quote.status === "sent") await supabase.from("quotes").update({ status: "viewed" }).eq("id", quote.id);
      const expired = quote.valid_until && new Date(quote.valid_until) < new Date(new Date().toDateString()) && !["won", "paid", "signed"].includes(quote.status);
      return json({
        quote: {
          number: quote.quote_number, status: quote.status, valid_until: quote.valid_until, go_live_date: quote.go_live_date,
          payment_terms: quote.payment_terms, deposit_percent: quote.deposit_percent,
          one_off_subtotal: quote.one_off_subtotal, tax_amount: quote.tax_amount, one_off_total: quote.one_off_total,
          recurring_arr: quote.recurring_arr, terms: quote.terms || settings?.quote_terms || "", signed: !!quote.signed_at, expired,
        },
        company_name: company?.name || "",
        items: items || [],
      });
    }

    // POST = sign
    const body = await req.json();
    const { name, signature } = body;
    if (!name || !signature) return json({ error: "Name and signature required" }, 422);
    if (["won", "paid"].includes(quote.status)) return json({ error: "This quote is already complete." }, 409);

    // Upload signature PNG (data URL -> bytes)
    let signaturePath: string | null = null;
    try {
      const b64 = signature.split(",")[1] || "";
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      signaturePath = `quotes/${quote.id}/signature-${Date.now()}.png`;
      await supabase.storage.from("attachments").upload(signaturePath, bytes, { contentType: "image/png", upsert: true });
    } catch (_) { /* keep going even if upload fails */ }

    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
    await supabase.from("quotes").update({
      status: "signed", signed_at: new Date().toISOString(), signed_by_name: name, signer_ip: ip, signature_path: signaturePath,
    }).eq("id", quote.id);

    if (quote.payment_terms === "invoice_later") {
      await supabase.rpc("execute_quote", { p_quote_id: quote.id });
      return json({ executed: true });
    }
    return json({ signed: true, needs_payment: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
