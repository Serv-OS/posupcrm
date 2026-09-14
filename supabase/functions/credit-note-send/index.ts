// Emails a credit note to the customer (from the connected support mailbox)
// and records where and when it went. Auth: caller JWT, editor/owner only,
// the same check invoice-send makes.
//
// The browser cannot write credit_notes at all (the migration grants no
// update), so sent_at and email_to are stamped here with the service role.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { creditNoteEmailHtml, sendInvoiceEmail } from "../_shared/invoiceEmail.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// The invoices this note's credit has been applied to, oldest first, as
// [{ invoice_number, amount }], so the email names each one ("Applied to
// invoice INV-1050"). Read as plain rows rather than a join. Before the credit
// allocations migration the table is not there, and an invoice that cannot be
// read leaves no number to name, so both read as none: the email then gives
// the credit used as one line.
async function appliedInvoices(supabase: any, noteId: string): Promise<{ invoice_number: number; amount: number }[]> {
  const { data: rows, error } = await supabase.from("credit_allocations")
    .select("invoice_id, amount, created_at").eq("credit_note_id", noteId).is("removed_at", null).order("created_at");
  if (error || !rows?.length) return [];
  const ids = [...new Set(rows.map((r: any) => r.invoice_id))];
  const { data: invoices } = await supabase.from("invoices").select("id, invoice_number").in("id", ids);
  const numberOf = new Map((invoices || []).map((i: any) => [i.id, i.invoice_number]));
  const named = rows.map((r: any) => ({ invoice_number: numberOf.get(r.invoice_id), amount: Number(r.amount) || 0 }));
  return named.every((a: any) => a.invoice_number != null) ? named : [];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const auth = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!auth) return json({ error: "Unauthorized" }, 401);
  const { data: { user } } = await supabase.auth.getUser(auth);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!me || !["owner", "editor"].includes(me.role)) return json({ error: "Forbidden" }, 403);

  try {
    const { credit_note_id, to } = await req.json();
    if (!credit_note_id) return json({ error: "Missing credit_note_id" }, 422);

    const { data: note } = await supabase.from("credit_notes").select("*").eq("id", credit_note_id).maybeSingle();
    if (!note) return json({ error: "Credit note not found" }, 404);
    // A cancelled note takes nothing off the invoice; emailing it would tell
    // the customer they owe less than they do.
    if (note.status !== "issued") return json({ error: "This credit note is cancelled, so it cannot be sent." }, 400);

    const { data: inv } = await supabase.from("invoices").select("*").eq("id", note.invoice_id).maybeSingle();
    if (!inv) return json({ error: "Invoice not found" }, 404);

    // Resolve recipient: explicit > the note's > the invoice's > linked contact's email
    let recipient = String(to || note.email_to || inv.email_to || "").trim();
    const contactId = note.contact_id || inv.contact_id;
    if (!recipient && contactId) {
      const { data: c } = await supabase.from("contacts").select("email").eq("id", contactId).maybeSingle();
      recipient = (c?.email || "").trim();
    }
    if (!recipient) return json({ error: "No email address to send to. Add one or link a contact to the invoice." }, 422);
    // The address goes straight into the To: header, so a space or line break
    // in it could add headers of its own (a Bcc). One plain address only.
    if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(recipient)) {
      return json({ error: "That email address does not look right." }, 422);
    }

    const { data: seller } = await supabase.from("support_settings")
      .select("business_name, business_email, business_phone, quote_accent, logo_url").eq("id", 1).maybeSingle();

    const appUrl = Deno.env.get("APP_URL") || "https://posupcrm.vercel.app";
    const link = `${appUrl}/c/${note.public_token}`;
    const applied = await appliedInvoices(supabase, note.id);
    const { subject, html } = creditNoteEmailHtml(note, inv, seller || {}, link, applied);
    await sendInvoiceEmail(supabase, recipient, subject, html);

    // Only the send fields: everything else on an issued credit note is fixed.
    const sentAt = new Date().toISOString();
    const { error: stampErr } = await supabase.from("credit_notes")
      .update({ sent_at: sentAt, email_to: recipient }).eq("id", note.id);
    // The email has gone, so still report success; the log says why the
    // "sent" date on screen did not move.
    if (stampErr) console.error(`credit-note-send: sent CN-${note.credit_number} but could not record it:`, stampErr.message);

    return json({ success: true, to: recipient, sent_at: sentAt });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
