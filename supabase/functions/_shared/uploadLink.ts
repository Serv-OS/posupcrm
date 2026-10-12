// The photo upload link we text to a customer.
//
// Why this exists: Twilio carries picture messages in the US and Canada only,
// so a photo sent to our +44 number never arrives. Instead the auto reply
// carries a link, the customer taps it, and the photos land on their ticket.
//
// The link has to be safe to text to a stranger: it is only an id and a
// signature, it opens exactly one ticket, and it shows nothing but that
// ticket's number. The signature is an HMAC of the ticket id, so no column and
// no migration are needed, and a guessed or edited link simply fails.
//
// No imports on purpose: vitest in the browser repo imports this file directly.

/** Truncated hex HMAC. 16 hex characters is 64 bits, far past guessing. */
export async function signTicket(ticketId: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`ticket-upload:${ticketId}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

export async function uploadToken(ticketId: string, secret: string): Promise<string> {
  return `${ticketId}.${await signTicket(ticketId, secret)}`;
}

/** The ticket id a token is good for, or null. Compared in full, never by prefix. */
export async function ticketFromToken(token: string, secret: string): Promise<string | null> {
  const raw = String(token || "");
  const dot = raw.lastIndexOf(".");
  if (dot < 1) return null;
  const id = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f]{16}$/i.test(sig)) return null;
  const expect = await signTicket(id, secret);
  // Constant time: a wrong signature must not be detectable by how fast we say no.
  if (sig.length !== expect.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expect.charCodeAt(i);
  return diff === 0 ? id : null;
}

export const uploadUrl = (appUrl: string, token: string) =>
  `${String(appUrl || "").replace(/\/+$/, "")}/u/${token}`;

/**
 * The auto reply with the link in it. {{upload_link}} in the template puts it
 * where the writer wants; otherwise it is added on the end, once. A template
 * that already carries the link is left alone, so nobody gets it twice.
 */
export function replyWithUpload(template: string, link: string): string {
  const text = String(template || "").trim();
  if (!link) return text;
  if (text.includes("{{upload_link}}")) return text.replace(/\{\{\s*upload_link\s*\}\}/g, link).trim();
  if (text.includes(link)) return text;
  return (text ? `${text}\n\n` : "") + `To send us a photo, tap here: ${link}`;
}
