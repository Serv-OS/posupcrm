// Global click-to-call dispatcher.
// Any component can call callNumber('+447...') to start an outbound call.
// PhoneBar listens for the 'servos:call' event and places the call,
// auto-connecting the Twilio device first if the agent is offline.
export function callNumber(number) {
  if (!number) return;
  const trimmed = String(number).trim();
  if (!trimmed) return;
  window.dispatchEvent(new CustomEvent('servos:call', { detail: { number: trimmed } }));
}
