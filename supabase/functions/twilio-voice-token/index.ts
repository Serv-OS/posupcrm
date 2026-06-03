// Twilio Voice Token Generator
// Generates a capability token so the browser can connect to Twilio Voice SDK
// Called by frontend when agent goes "online"
//
// Required secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_TWIML_APP_SID

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Twilio JWT generation for Voice
function createAccessToken(
  accountSid: string,
  apiKey: string,
  apiSecret: string,
  identity: string,
  twimlAppSid: string
): string {
  // Header
  const header = { alg: "HS256", typ: "JWT", cty: "twilio-fpa;v=1" };

  // Payload
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    jti: `${apiKey}-${now}`,
    iss: apiKey,
    sub: accountSid,
    exp: now + 3600, // 1 hour
    grants: {
      identity: identity,
      voice: {
        incoming: { allow: true },
        outgoing: { application_sid: twimlAppSid },
      },
    },
  };

  // Encode
  const encode = (obj: any) => {
    const json = JSON.stringify(obj);
    return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };

  const headerB64 = encode(header);
  const payloadB64 = encode(payload);
  const signingInput = `${headerB64}.${payloadB64}`;

  // HMAC-SHA256 sign
  const encoder = new TextEncoder();
  const keyData = encoder.encode(apiSecret);
  const data = encoder.encode(signingInput);

  // Use Web Crypto API for HMAC
  return crypto.subtle.importKey(
    "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  ).then(async (key) => {
    const signature = await crypto.subtle.sign("HMAC", key, data);
    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return `${signingInput}.${sigB64}`;
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify JWT
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get user profile for identity
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, email")
      .eq("id", user.id)
      .single();

    const identity = (profile?.display_name || profile?.email || user.id).replace(/[^a-zA-Z0-9_-]/g, "_");

    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
    const apiKey = Deno.env.get("TWILIO_API_KEY") || accountSid;
    const apiSecret = Deno.env.get("TWILIO_API_SECRET") || Deno.env.get("TWILIO_AUTH_TOKEN")!;
    const twimlAppSid = Deno.env.get("TWILIO_TWIML_APP_SID") || "";

    const token = await createAccessToken(accountSid, apiKey, apiSecret, identity, twimlAppSid);

    // Update agent status to online
    await supabase.from("agent_status").upsert({
      profile_id: user.id,
      status: "online",
      last_seen_at: new Date().toISOString(),
      twilio_identity: identity,
    }, { onConflict: "profile_id" });

    return new Response(
      JSON.stringify({ token, identity }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Token error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
