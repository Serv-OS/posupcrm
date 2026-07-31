// chat — the public support bot behind the embeddable widget.
//
// Runs as service_role (the chat_* tables have no anon policy on purpose), so
// every request is validated here: site key must exist, be active, and the
// caller's Origin must be in the site's allow-list.
//
// Two rules drive the behaviour, per AI_CHATBOT_PLAN.md:
//   1. Know the location before answering. A site can be BOUND to a venue
//      (POS tills), in which case there is nothing to ask.
//   2. Never guess. Anything it can't ground, or that the playbook forbids,
//      becomes a real ticket for a human.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const MAX_TURNS = 40;          // hard stop per session — runaway/loop guard
const HISTORY_TURNS = 12;      // how much context we send the model

type Playbook = {
  enabled: boolean; greeting: string; tone: string; ask_location: boolean;
  never_answer: string[]; always_escalate: string[]; persona_names: string[];
  unknown_reply: string;
};

/** Origin must match the site's allow-list. Empty list = unrestricted (dev). */
function originAllowed(origin: string | null, allowed: string[]): boolean {
  if (!allowed?.length) return true;
  if (!origin) return false;
  let host = origin;
  try { host = new URL(origin).host; } catch { /* keep raw */ }
  return allowed.some((a) => {
    const clean = a.trim().replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();
    return !!clean && (host.toLowerCase() === clean || host.toLowerCase().endsWith("." + clean));
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json();
    const { site_key, session_id, message, visitor } = body || {};
    if (!site_key) return json({ error: "Missing site_key" }, 422);

    // ── Site + origin ───────────────────────────────────────────────────────
    const { data: site } = await supabase.from("chat_sites")
      .select("*").eq("site_key", site_key).eq("active", true).maybeSingle();
    if (!site) return json({ error: "Unknown or inactive site key" }, 403);

    const origin = req.headers.get("origin");
    if (!originAllowed(origin, site.allowed_origins || [])) {
      return json({ error: "This domain isn't allowed to use this chat." }, 403);
    }

    const { data: pbRow } = await supabase.from("chat_playbook").select("*").eq("id", 1).maybeSingle();
    const pb = (pbRow || {}) as Playbook;
    if (pb.enabled === false) return json({ error: "Chat is turned off." }, 503);

    // ── Session (created on first contact; venue inherited from a bound site) ─
    let session: any = null;
    if (session_id) {
      const { data } = await supabase.from("chat_sessions").select("*").eq("id", session_id).maybeSingle();
      session = data;
    }
    if (!session) {
      const { data } = await supabase.from("chat_sessions").insert({
        site_id: site.id,
        location_id: site.location_id,          // POS embeds already know the venue
        origin: origin || null,
        visitor_name: visitor?.name || null,
        visitor_email: visitor?.email || null,
      }).select().single();
      session = data;
      // Opening turn: greet, nothing to answer yet.
      if (!message) {
        await supabase.from("chat_messages").insert({ session_id: session.id, role: "bot", content: pb.greeting });
        return json({ session_id: session.id, reply: pb.greeting, escalated: false });
      }
    }
    if (session.status === "closed") return json({ error: "This chat has ended." }, 410);
    if (!message || !String(message).trim()) return json({ error: "Empty message" }, 422);

    const text = String(message).trim().slice(0, 2000);
    await supabase.from("chat_messages").insert({ session_id: session.id, role: "visitor", content: text });

    const { data: history } = await supabase.from("chat_messages")
      .select("role, content").eq("session_id", session.id).order("created_at", { ascending: true });
    const turns = (history || []).length;

    // Anything that ends the conversation writes a ticket and says so.
    const escalate = async (reply: string, reason: string) => {
      const subjectSrc = (history || []).find((m) => m.role === "visitor")?.content || text;
      const transcript = (history || [])
        .map((m) => `${m.role === "visitor" ? "Customer" : m.role === "bot" ? "Assistant" : "Agent"}: ${m.content}`)
        .join("\n");
      // NB: tickets have no location_id column — the venue is linked through
      // `associations`, same as the rest of the CRM.
      const { data: ticket, error: tErr } = await supabase.from("tickets").insert({
        subject: subjectSrc.slice(0, 120),
        description: `Raised from website chat (${reason}).\n\n${transcript}\n\nCustomer: ${text}`,
        channel: "chat",
        source: "chat",
        customer_email: session.visitor_email || visitor?.email || null,
        contact_id: session.contact_id,
      }).select("id, ticket_number").maybeSingle();

      // The whole safety net is "it raises a ticket" — never let that fail quietly.
      if (tErr || !ticket) {
        console.error("chat: ESCALATION FAILED to create a ticket:", tErr?.message || "no row returned");
      }

      if (ticket) {
        await supabase.from("stage_history").insert({
          object_type: "ticket", object_id: ticket.id, from_stage: null, to_stage: "new",
        });
        if (session.location_id) {
          await supabase.from("associations").insert({
            from_type: "ticket", from_id: ticket.id,
            to_type: "location", to_id: session.location_id, label: "affected_location",
          });
        }
      }
      const withNumber = ticket?.ticket_number ? `${reply} (Reference #${ticket.ticket_number}.)` : reply;
      await supabase.from("chat_messages").insert({
        session_id: session.id, role: "bot", content: withNumber, escalated: true,
      });
      await supabase.from("chat_sessions").update({
        status: "escalated", ticket_id: ticket?.id || null, last_at: new Date().toISOString(),
      }).eq("id", session.id);
      return json({ session_id: session.id, reply: withNumber, escalated: true, ticket_number: ticket?.ticket_number || null });
    };

    if (turns >= MAX_TURNS) {
      return await escalate("We've covered a lot here — let me get a person onto this.", "conversation length");
    }

    // ── Rule 2, checked BEFORE the model: forbidden topics never get an answer ─
    const lower = text.toLowerCase();
    const hit = (list: string[]) => (list || []).find((k) => k && lower.includes(k.toLowerCase()));
    const urgent = hit(pb.always_escalate || []);
    if (urgent) {
      return await escalate(
        "That sounds urgent — I'm raising this with our support team right now so someone can call you back.",
        `urgent keyword: ${urgent}`,
      );
    }
    const forbidden = hit(pb.never_answer || []);
    if (forbidden) {
      return await escalate(pb.unknown_reply, `restricted topic: ${forbidden}`);
    }

    // ── Rule 1: no venue, no answer ─────────────────────────────────────────
    let location: any = null;
    if (session.location_id) {
      const { data } = await supabase.from("locations").select("id, name, city").eq("id", session.location_id).maybeSingle();
      location = data;
    }
    if (!location && pb.ask_location) {
      // Try to recognise the venue from what they just typed before asking again.
      const { data: locs } = await supabase.from("locations").select("id, name, city").limit(500);
      const match = (locs || []).find((l) => l.name && lower.includes(String(l.name).toLowerCase()));
      if (match) {
        await supabase.from("chat_sessions").update({ location_id: match.id }).eq("id", session.id);
        session.location_id = match.id;
        location = match;
      } else if (turns <= 2) {
        const ask = "Happy to help — which site am I helping with today?";
        await supabase.from("chat_messages").insert({ session_id: session.id, role: "bot", content: ask });
        return json({ session_id: session.id, reply: ask, escalated: false, needs: "location" });
      }
    }

    // ── Answer ──────────────────────────────────────────────────────────────
    const { data: cfg } = await supabase.from("ai_settings").select("*").eq("id", 1).maybeSingle();
    if (!cfg?.enabled || !cfg?.api_key) {
      return await escalate(pb.unknown_reply, "AI not configured");
    }

    const names = (pb.persona_names || []).filter(Boolean);
    const persona = names.length ? names[Math.floor(Math.random() * names.length)] : null;

    let venueContext = "";
    if (location) {
      const { data: mods } = await supabase.from("location_modules")
        .select("status, module:modules(name)").eq("location_id", location.id);
      const live = (mods || []).filter((m: any) => m.status === "live").map((m: any) => m.module?.name).filter(Boolean);
      venueContext = `The customer is at ${location.name}${location.city ? `, ${location.city}` : ""}.` +
        (live.length ? ` Modules live at this site: ${live.join(", ")}.` : "");
    }

    const system =
      `You are ${persona || "a member"} of the ServOS customer support team. ServOS is a restaurant ` +
      `point-of-sale company. You are talking to a customer over live chat.\n\n` +
      `TONE: ${pb.tone}. Short sentences. Sound like a real person typing, not a manual. ` +
      `Never use bullet-point essays. Never say you are an AI model — but if the customer directly ` +
      `asks whether they are talking to a bot or a human, tell them the truth plainly and offer to ` +
      `get a colleague.\n\n` +
      `RULES:\n` +
      `- Only state things you are confident are true about ServOS. Never invent prices, dates, ` +
      `refunds, contract terms or promises about fixes.\n` +
      `- If you are not sure, do NOT guess. Reply with exactly: NEEDS_HUMAN\n` +
      `- If the customer needs something actioned that you cannot do, reply: NEEDS_HUMAN\n` +
      `- Keep replies under 90 words.\n\n` +
      (venueContext ? `CONTEXT: ${venueContext}\n` : "");

    const messages = (history || []).slice(-HISTORY_TURNS).map((m) => ({
      role: m.role === "visitor" ? "user" : "assistant",
      content: m.content,
    }));

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": cfg.api_key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: cfg.chat_model || "claude-sonnet-5",
        max_tokens: 400,
        system,
        messages: messages.length ? messages : [{ role: "user", content: text }],
      }),
    });

    if (!aiRes.ok) {
      console.error("chat: anthropic error", aiRes.status, await aiRes.text());
      return await escalate(pb.unknown_reply, "AI request failed");
    }
    const ai = await aiRes.json();
    const reply = (ai?.content?.[0]?.text || "").trim();

    // The model's own escape hatch — treated as a hard escalation, not a message.
    if (!reply || reply.includes("NEEDS_HUMAN")) {
      return await escalate(pb.unknown_reply, "assistant was not confident");
    }

    await supabase.from("chat_messages").insert({ session_id: session.id, role: "bot", content: reply });
    await supabase.from("chat_sessions").update({ last_at: new Date().toISOString() }).eq("id", session.id);
    return json({ session_id: session.id, reply, escalated: false });
  } catch (e) {
    console.error("chat error:", (e as Error).message);
    return json({ error: "Something went wrong." }, 500);
  }
});
