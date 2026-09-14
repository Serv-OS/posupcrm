// Public invoice endpoint (no auth). GET ?token=... -> invoice + lines +
// seller branding + customer details for the hosted invoice page (/i/<token>),
// with the credit notes raised on it and the credit applied to it from other
// invoices' credit notes, so the page can show each step down to the balance.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { amountAllocatedOn, balanceDue, sameCustomer } from "../_shared/invoiceEmail.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const token = new URL(req.url).searchParams.get("token");
    if (!token) return json({ error: "Missing token" }, 400);

    const { data: inv } = await supabase.from("invoices").select("*").eq("public_token", token).maybeSingle();
    if (!inv || inv.status === "void") return json({ error: "Invoice not found" }, 404);

    const [{ data: items }, { data: company }, { data: contact }, { data: location }, { data: settings }, { data: credits }, { data: applied }] = await Promise.all([
      supabase.from("invoice_line_items").select("*").eq("invoice_id", inv.id).order("sort"),
      inv.company_id ? supabase.from("companies").select("name, address, city, postcode").eq("id", inv.company_id).maybeSingle() : Promise.resolve({ data: null }),
      inv.contact_id ? supabase.from("contacts").select("first_name, last_name, email").eq("id", inv.contact_id).maybeSingle() : Promise.resolve({ data: null }),
      inv.location_id ? supabase.from("locations").select("name, address, city, postcode").eq("id", inv.location_id).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from("support_settings").select("invoice_terms, business_name, business_address, business_email, business_phone, quote_accent, logo_url").eq("id", 1).maybeSingle(),
      // Issued credit notes only: a cancelled one takes nothing off. Until the
      // credit notes migration is applied this query errors and shows none.
      supabase.from("credit_notes").select("credit_number, issue_date, total, public_token")
        .eq("invoice_id", inv.id).eq("status", "issued").order("credit_number"),
      // Credit applied to this invoice, active only: removed credit takes
      // nothing off. Until the credit allocations migration is applied this
      // query errors and shows none.
      supabase.from("credit_allocations")
        .select("amount, allocated_on, created_at, credit_note:credit_notes(credit_number, public_token, status, company_id, contact_id)")
        .eq("invoice_id", inv.id).is("removed_at", null).order("created_at"),
    ]);

    if (inv.status === "sent") await supabase.from("invoices").update({ status: "viewed" }).eq("id", inv.id);

    const s = settings || {};
    // What the Pay button charges (invoice-checkout uses the same balanceDue):
    // payments, credit notes and applied credit all come off. An invoice
    // credited down to nothing left to pay is not overdue.
    const balance = balanceDue(inv);
    const overdue = !!inv.due_date && new Date(inv.due_date) < new Date(new Date().toDateString()) && !["paid", "void"].includes(inv.status) && balance > 0;
    return json({
      invoice: {
        number: inv.invoice_number, status: inv.status, issue_date: inv.issue_date, due_date: inv.due_date,
        po_number: inv.po_number || null,
        tax_rate: inv.tax_rate, subtotal: inv.subtotal, tax_amount: inv.tax_amount, total: inv.total,
        terms: inv.terms || s.invoice_terms || "", notes: inv.notes || "", paid_at: inv.paid_at,
        amount_paid: inv.amount_paid, amount_credited: Number(inv.amount_credited) || 0,
        amount_allocated: amountAllocatedOn(inv), balance_due: balance, overdue,
      },
      seller: {
        name: s.business_name || "ServOS", address: s.business_address || "",
        email: s.business_email || "", phone: s.business_phone || "",
        accent: s.quote_accent || "#15C26A", logo_url: s.logo_url || null,
      },
      company: company ? { name: company.name, address: [company.address, company.city, company.postcode].filter(Boolean).join(", ") } : null,
      contact: contact ? { name: [contact.first_name, contact.last_name].filter(Boolean).join(" "), email: contact.email } : null,
      location: location ? { name: location.name, address: [location.address, location.city, location.postcode].filter(Boolean).join(", ") } : null,
      items: items || [],
      credit_notes: (credits || []).map((c: any) => ({ number: c.credit_number, issue_date: c.issue_date, total: c.total, public_token: c.public_token })),
      // "Credit applied CN-1003" rows. The credit note belongs to another
      // invoice, which can be another customer's (a group paying across its
      // companies), so its link is only given when it is this customer's own
      // (sameCustomer) and its page still opens.
      credit_applied: (applied || []).map((a: any) => ({
        number: a.credit_note?.credit_number ?? null,
        date: a.allocated_on,
        amount: Number(a.amount) || 0,
        public_token: a.credit_note && a.credit_note.status === "issued" && sameCustomer(a.credit_note, inv) ? a.credit_note.public_token || null : null,
      })),
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
