import { supabase } from './supabase';

// Per-instance Google OAuth client ID. Resolution order: support_settings row
// (set per instance, no rebuild needed) -> VITE env (baked at build) -> the
// original dev instance's client as a last resort.
const FALLBACK = import.meta.env.VITE_GOOGLE_CLIENT_ID || '836252293153-ekl6o41r2kra549aqnjr9bvpiq2t4nfg.apps.googleusercontent.com';

let cached = null;
export async function getGoogleClientId() {
  if (cached) return cached;
  try {
    const { data } = await supabase
      .from('support_settings')
      .select('google_client_id')
      .eq('id', 1)
      .maybeSingle();
    cached = data?.google_client_id || FALLBACK;
  } catch {
    cached = FALLBACK;
  }
  return cached;
}
