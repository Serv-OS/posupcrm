// The customer's photo upload page, behind no login.
//
// Twilio carries picture messages in the US and Canada only, so a photo texted
// to our UK number never arrives. The auto reply instead carries a link to
// /u/<token>, this function backs that page, and the photos land on the ticket
// exactly where an emailed attachment would.
//
// The token is an HMAC of the ticket id (see _shared/uploadLink.ts): it opens
// one ticket and nothing else, and the page is told only that ticket's number.
//
// POST { action: 'info',   token }                    -> { ticket_number, business_name, count }
// POST { action: 'upload', token, name, mime, data }  -> { ok, count }   data = base64

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ticketFromToken, uploadToken, uploadUrl } from "../_shared/uploadLink.ts";
import { storeAttachment, b64ToBytes } from "../_shared/attachments.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: cors });

// A phone photo is a few MB; 12 keeps a modern camera shot while refusing a
// video dump. The per-ticket cap stops a texted link becoming free storage.
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_PER_TICKET = 20;
const ALLOWED = /^image\/(jpeg|png|gif|webp|heic|heif)$|^application\/pdf$/i;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  // The signing secret never leaves the server, and is already per instance.
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Staff asking for the link to send: they arrive with a login, not a token.
  if (body?.action === "staff_link") {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: who } = await supabase.auth.getUser(jwt);
    if (!who?.user) return json({ error: "Please sign in." }, 401);
    const { data: me } = await supabase.from("profiles").select("role").eq("id", who.user.id).maybeSingle();
    if (!me || !["owner", "editor"].includes(me.role)) return json({ error: "Not allowed." }, 403);
    const id = String(body?.ticket_id || "");
    const { data: t } = await supabase.from("tickets").select("id").eq("id", id).maybeSingle();
    if (!t) return json({ error: "Ticket not found." }, 404);
    const appUrl = Deno.env.get("APP_URL") || "https://posupcrm.vercel.app";
    return json({ url: uploadUrl(appUrl, await uploadToken(id, secret)) });
  }

  const ticketId = await ticketFromToken(String(body?.token || ""), secret);
  if (!ticketId) return json({ error: "This link is not valid. Please ask us for a new one." }, 403);

  const { data: ticket } = await supabase
    .from("tickets").select("id, ticket_number, status").eq("id", ticketId).maybeSingle();
  if (!ticket) return json({ error: "This link is not valid. Please ask us for a new one." }, 404);

  const countNow = async () => {
    const { count } = await supabase.from("attachments")
      .select("id", { count: "exact", head: true })
      .eq("subject_type", "ticket").eq("subject_id", ticketId);
    return count || 0;
  };

  if (body.action === "info") {
    const { data: s } = await supabase.from("support_settings").select("business_name").eq("id", 1).maybeSingle();
    return json({
      ticket_number: ticket.ticket_number,
      business_name: s?.business_name || null,
      count: await countNow(),
      max: MAX_PER_TICKET,
    });
  }

  if (body.action === "upload") {
    const mime = String(body?.mime || "");
    if (!ALLOWED.test(mime)) return json({ error: "Photos and PDFs only." }, 415);

    const used = await countNow();
    if (used >= MAX_PER_TICKET) return json({ error: `That is the maximum of ${MAX_PER_TICKET} files on this ticket.` }, 409);

    let bytes: Uint8Array;
    try { bytes = b64ToBytes(String(body?.data || "")); } catch { return json({ error: "That file could not be read." }, 400); }
    if (!bytes.length) return json({ error: "That file is empty." }, 400);
    if (bytes.length > MAX_BYTES) return json({ error: "That file is too big. 12 MB is the limit." }, 413);

    const ok = await storeAttachment(supabase, {
      ticketId, activityId: null,
      name: String(body?.name || "photo"), mime, bytes, source: "customer_upload",
    });
    if (!ok) return json({ error: "That did not save. Please try again." }, 500);

    // Say so on the ticket, so whoever is handling it sees the photo arrive.
    await supabase.from("crm_activities").insert({
      type: "note", subject_type: "ticket", subject_id: ticketId, direction: "inbound",
      is_internal: true, body: `Customer added a file: ${String(body?.name || "photo")}`,
      channel_metadata: { customer_upload: true },
    });

    return json({ ok: true, count: await countNow() });
  }

  return json({ error: "Unknown action" }, 400);
});
