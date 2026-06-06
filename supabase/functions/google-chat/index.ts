// Per-user Google Chat. The caller's JWT identifies the user_integrations row
// whose Google token we use. Actions:
//   { action:'spaces' }                       -> spaces & DMs the user is in
//   { action:'messages', space }              -> recent messages in a space
//   { action:'send', space, text }            -> post a message as the user
// Requires the user to have reconnected Google with chat scopes.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const CHAT = "https://chat.googleapis.com/v1";

async function freshAccessToken(supabase: any, integ: any): Promise<string | null> {
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

// Friendly error when the Chat scopes aren't granted yet.
function scopeHint(detail: string): string {
  if (/scope|permission|insufficient|forbidden/i.test(detail)) {
    return "Google Chat access not granted yet — reconnect Google in My Account to enable Chat.";
  }
  return detail;
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

  const accessToken = await freshAccessToken(supabase, integ);
  if (!accessToken) return json({ error: "Google session expired — reconnect in My Account." }, 401);
  const H = { Authorization: `Bearer ${accessToken}` };

  try {
    const body = await req.json();
    const action = body.action;

    // ---- SPACES: list rooms & DMs ----
    if (action === "spaces") {
      const r = await fetch(`${CHAT}/spaces?pageSize=100`, { headers: H });
      const d = await r.json();
      if (!r.ok) return json({ error: scopeHint(d.error?.message || "Could not load chats.") }, r.status === 403 ? 403 : 400);
      const spaces = (d.spaces || []).map((s: any) => ({
        name: s.name,                                  // "spaces/XXXX"
        displayName: s.displayName || (s.spaceType === "DIRECT_MESSAGE" ? "Direct message" : "Untitled space"),
        type: s.spaceType || s.type || "SPACE",
        single: s.singleUserBotDm || false,
      })).filter((s: any) => s.type !== "SPACE" || s.displayName);
      return json({ spaces });
    }

    // ---- MESSAGES: recent messages in a space ----
    if (action === "messages") {
      if (!body.space) return json({ error: "Missing space" }, 422);
      const params = new URLSearchParams({ pageSize: "40", orderBy: "createTime desc" });
      const r = await fetch(`${CHAT}/${body.space}/messages?${params}`, { headers: H });
      const d = await r.json();
      if (!r.ok) return json({ error: scopeHint(d.error?.message || "Could not load messages.") }, 400);
      const messages = (d.messages || []).map((m: any) => ({
        name: m.name,
        text: m.text || m.formattedText || "",
        createTime: m.createTime,
        sender: m.sender?.displayName || (m.sender?.type === "BOT" ? "App" : "Someone"),
        senderId: m.sender?.name || null,
      })).reverse(); // oldest -> newest for display
      return json({ messages });
    }

    // ---- SEND: post a message as the user ----
    if (action === "send") {
      if (!body.space || !body.text?.trim()) return json({ error: "Missing space or text" }, 422);
      const r = await fetch(`${CHAT}/${body.space}/messages`, {
        method: "POST", headers: { ...H, "Content-Type": "application/json" },
        body: JSON.stringify({ text: body.text }),
      });
      const d = await r.json();
      if (!r.ok) return json({ error: scopeHint(d.error?.message || "Could not send.") }, 400);
      return json({ success: true, name: d.name });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
