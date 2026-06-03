// Twilio Voice Incoming Call Handler
// Webhook called when someone dials the support number
// Routes to online agents via Twilio Client, or plays voicemail message
//
// Required secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Parse Twilio webhook (form-urlencoded)
    const formData = await req.formData();
    const from = formData.get("From") as string;
    const to = formData.get("To") as string;
    const callSid = formData.get("CallSid") as string;
    const callStatus = formData.get("CallStatus") as string;

    console.log(`Incoming call from ${from} to ${to}, SID: ${callSid}`);

    // Try to match caller to a contact
    let callerName = from;
    const normalizedFrom = from?.replace(/\s/g, "") || "";

    if (normalizedFrom) {
      const { data: contacts } = await supabase
        .from("contacts")
        .select("first_name, last_name, phone")
        .or(`phone.eq.${normalizedFrom},phone.eq.${normalizedFrom.replace("+44", "0")}`)
        .limit(1);

      if (contacts && contacts.length > 0) {
        callerName = [contacts[0].first_name, contacts[0].last_name].filter(Boolean).join(" ") || from;
      }
    }

    // Find online agents
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: onlineAgents } = await supabase
      .from("agent_status")
      .select("profile_id, twilio_identity, status")
      .eq("status", "online")
      .gte("last_seen_at", fiveMinAgo)
      .order("last_seen_at", { ascending: true }); // Least recently used first

    // Log the incoming call
    // Find or create a ticket for this caller
    let ticketId: string | null = null;
    if (normalizedFrom) {
      const { data: openTickets } = await supabase
        .from("tickets")
        .select("id")
        .eq("customer_phone", normalizedFrom)
        .not("stage", "in", '("closed")')
        .order("updated_at", { ascending: false })
        .limit(1);

      if (openTickets && openTickets.length > 0) {
        ticketId = openTickets[0].id;
      } else {
        // Create a new ticket for this call
        const { data: newTicket } = await supabase
          .from("tickets")
          .insert({
            subject: `Call from ${callerName}`,
            channel: "phone",
            customer_phone: normalizedFrom,
            source: "phone",
          })
          .select()
          .single();

        if (newTicket) {
          ticketId = newTicket.id;
          await supabase.from("stage_history").insert({
            object_type: "ticket", object_id: ticketId,
            from_stage: null, to_stage: "new",
          });
        }
      }
    }

    // Store call SID for status callback tracking
    if (ticketId) {
      await supabase.from("crm_activities").insert({
        type: "call",
        subject: `Incoming call from ${callerName}`,
        subject_type: "ticket",
        subject_id: ticketId,
        direction: "inbound",
        message_id: callSid,
        is_internal: false,
        channel_metadata: {
          from_number: from,
          to_number: to,
          call_sid: callSid,
          status: "ringing",
        },
      });
    }

    // Build TwiML response
    let twiml = '<?xml version="1.0" encoding="UTF-8"?><Response>';

    if (onlineAgents && onlineAgents.length > 0) {
      // Ring online agents (try first available)
      twiml += `<Say voice="alice">Please hold while we connect you to an agent.</Say>`;
      twiml += `<Dial timeout="30" action="${Deno.env.get("SUPABASE_URL")}/functions/v1/twilio-voice-status"`;
      twiml += ` callerId="${to}">`;

      for (const agent of onlineAgents.slice(0, 3)) {
        // Ring up to 3 agents simultaneously
        twiml += `<Client>`;
        twiml += `<Identity>${agent.twilio_identity}</Identity>`;
        twiml += `<Parameter name="callerName" value="${callerName}"/>`;
        twiml += `<Parameter name="callerNumber" value="${from}"/>`;
        twiml += `</Client>`;
      }

      twiml += `</Dial>`;
    } else {
      // No agents online - leave a message
      twiml += `<Say voice="alice">Thank you for calling ServOS support. All agents are currently offline. Please leave a message after the beep, or send us a text message.</Say>`;
      twiml += `<Record maxLength="120" action="${Deno.env.get("SUPABASE_URL")}/functions/v1/twilio-voice-status" />`;
    }

    twiml += '</Response>';

    return new Response(twiml, {
      headers: { "Content-Type": "text/xml" },
    });
  } catch (error) {
    console.error("Voice incoming error:", error);
    // Fallback TwiML
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, we are experiencing technical difficulties. Please try again later.</Say></Response>',
      { headers: { "Content-Type": "text/xml" } }
    );
  }
});
