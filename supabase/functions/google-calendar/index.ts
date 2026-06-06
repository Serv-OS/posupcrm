// Per-user Google Calendar: create a meeting on the caller's calendar and
// email a Google invite to the attendees (sendUpdates=all). Logs a meeting
// activity on the linked record.
// Auth: caller's JWT identifies the user_integrations row to use.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function freshAccessToken(supabase: any, integ: any): Promise<string | null> {
  // Reuse the stored token if still valid (>60s left)
  if (integ.access_token && integ.token_expires_at && new Date(integ.token_expires_at).getTime() - Date.now() > 60000) {
    return integ.access_token;
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GMAIL_CLIENT_ID")!,
      client_secret: Deno.env.get("GMAIL_CLIENT_SECRET")!,
      refresh_token: integ.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const t = await res.json();
  if (!t.access_token) return null;
  await supabase.from("user_integrations").update({
    access_token: t.access_token,
    token_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
  }).eq("id", integ.id);
  return t.access_token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const auth = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!auth) return json({ error: "Unauthorized" }, 401);
  const { data: { user } } = await supabase.auth.getUser(auth);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const { data: integ } = await supabase.from("user_integrations").select("*").eq("profile_id", user.id).maybeSingle();
  if (!integ?.refresh_token) return json({ error: "Connect your Google account first (My Account → Connect Google)." }, 400);

  try {
    const body = await req.json();

    const accessToken = await freshAccessToken(supabase, integ);
    if (!accessToken) return json({ error: "Google session expired — reconnect in My Account." }, 401);

    // ---- LIST: upcoming events in a time window ----
    if (body.action === "list") {
      const timeMin = body.timeMin ? new Date(body.timeMin).toISOString() : new Date().toISOString();
      const timeMax = body.timeMax ? new Date(body.timeMax).toISOString() : new Date(Date.now() + 14 * 86400000).toISOString();
      const params = new URLSearchParams({
        timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "100",
      });
      const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const d = await r.json();
      if (!r.ok) return json({ error: d.error?.message || "Could not load calendar." }, 400);
      const items = (d.items || []).map((e: any) => ({
        id: e.id,
        summary: e.summary || "(no title)",
        description: e.description || "",
        location: e.location || "",
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        allDay: !e.start?.dateTime,
        htmlLink: e.htmlLink,
        hangoutLink: e.hangoutLink || null,
        attendees: (e.attendees || []).map((a: any) => a.email),
        status: e.status,
      }));
      return json({ events: items });
    }

    // ---- CREATE (default) ----
    const { title, description, start, end, attendees = [], subject_type, subject_id, contact_id, location } = body;
    if (!title || !start) return json({ error: "Missing title or start time" }, 422);

    const tz = "Europe/London";
    const startISO = new Date(start).toISOString();
    const endISO = new Date(end || (new Date(start).getTime() + 30 * 60000)).toISOString();

    const event = {
      summary: title,
      description: description || "",
      location: location || undefined,
      start: { dateTime: startISO, timeZone: tz },
      end: { dateTime: endISO, timeZone: tz },
      attendees: (attendees || []).filter(Boolean).map((e: string) => ({ email: e })),
    };

    const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
    const ev = await res.json();
    if (!res.ok) return json({ error: ev.error?.message || "Could not create the event." }, 400);

    // Log a meeting activity on the linked record
    if (subject_type && subject_id) {
      await supabase.from("crm_activities").insert({
        type: "meeting",
        subject: title,
        body: `Meeting scheduled for ${new Date(startISO).toLocaleString("en-GB")}${attendees.length ? ` with ${attendees.join(", ")}` : ""}.${description ? `\n${description}` : ""}`,
        subject_type, subject_id,
        contact_id: contact_id || null,
        actor_id: user.id,
        direction: "outbound",
        is_internal: false,
        occurred_at: startISO,
        channel_metadata: { calendar_event_id: ev.id, html_link: ev.htmlLink, attendees },
      });
    }

    return json({ success: true, event_id: ev.id, html_link: ev.htmlLink });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
