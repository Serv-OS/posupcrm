import { useEffect, useRef } from 'react';
import { supabase } from './supabase';
export { readPresence } from './presence.js';

// Is the CRM open, and is it awake?
//
// "Last login" could never answer this. Supabase stamps last_sign_in_at only
// when someone types their password, and a refresh token keeps a session alive
// for months, so an owner using the CRM every day showed as 69 days absent.
//
// A bare heartbeat is not enough either. It cannot separate three very
// different situations that all look identical from the server:
//
//   working        tab visible, keys and clicks landing
//   walked away    tab visible, nothing touched for minutes
//   asleep/closed  no beats at all, because the machine slept or the tab died
//
// So each beat carries the STATE, and the beats are allowed to stop. A stale
// last_seen_at is not a failure of this code, it IS the answer: nothing is
// running there. That is why there is no "offline" write on a timer, and why
// the reader decides "asleep" from silence rather than from a flag.

const BEAT_VISIBLE = 30_000;   // while they are looking at it
const BEAT_HIDDEN  = 120_000;  // background tabs get throttled anyway
const IDLE_AFTER   = 5 * 60_000;

export function usePresence(profileId, currentPage) {
  // Kept in refs so the heartbeat closure always reads the latest value without
  // being torn down and rebuilt on every keystroke or navigation.
  const lastActive = useRef(Date.now());
  const page = useRef(currentPage);
  const sessionStart = useRef(new Date().toISOString());
  const timer = useRef(null);
  const stopped = useRef(false);
  // Captured up front: pagehide is synchronous, so there is no opportunity to
  // await getSession() once the tab is already going away.
  const tokenRef = useRef(null);

  useEffect(() => { page.current = currentPage; }, [currentPage]);

  useEffect(() => {
    if (!profileId || !supabase) return;
    stopped.current = false;

    const stateNow = () => {
      if (document.visibilityState === 'hidden') return 'hidden';
      return Date.now() - lastActive.current > IDLE_AFTER ? 'idle' : 'active';
    };

    supabase.auth.getSession().then(({ data }) => { tokenRef.current = data?.session?.access_token || null; });
    const { data: authSub } = supabase.auth.onAuthStateChange((_e, session) => {
      tokenRef.current = session?.access_token || null;   // keep it fresh across refreshes
    });

    const beat = async (state = stateNow()) => {
      if (stopped.current) return;
      try {
        await supabase.from('user_presence').upsert({
          profile_id: profileId,
          state,
          last_seen_at: new Date().toISOString(),
          last_active_at: new Date(lastActive.current).toISOString(),
          session_started_at: sessionStart.current,
          page: page.current || null,
          user_agent: navigator.userAgent.slice(0, 300),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'profile_id' });
      } catch { /* presence must never break the page it is watching */ }
    };

    const schedule = () => {
      clearTimeout(timer.current);
      const every = document.visibilityState === 'hidden' ? BEAT_HIDDEN : BEAT_VISIBLE;
      timer.current = setTimeout(async () => { await beat(); schedule(); }, every);
    };

    // Any real input counts. Passive so scrolling stays smooth, and we only
    // record the timestamp — no write per event.
    const touched = () => { lastActive.current = Date.now(); };
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'pointermove'];
    for (const e of events) window.addEventListener(e, touched, { passive: true });

    // Switching tabs or locking the screen is worth reporting immediately,
    // rather than up to two minutes later on the next beat.
    const onVisibility = () => { beat(); schedule(); };
    document.addEventListener('visibilitychange', onVisibility);

    // A closed tab is different from a slept machine, and only the browser can
    // tell us which — a slept machine gets no chance to say anything.
    //
    // This uses fetch with keepalive rather than sendBeacon: the row is
    // RLS-protected, so the write needs an Authorization header, and sendBeacon
    // cannot set headers (it would arrive unauthenticated and 401). keepalive
    // gives the same survives-teardown behaviour and does allow them.
    const onLeave = () => {
      try {
        const token = tokenRef.current;
        if (!token) return;
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/user_presence?on_conflict=profile_id`, {
          method: 'POST',
          keepalive: true,
          headers: {
            'Content-Type': 'application/json',
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
            Authorization: `Bearer ${token}`,
            Prefer: 'resolution=merge-duplicates',
          },
          body: JSON.stringify([{
            profile_id: profileId, state: 'closed',
            last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          }]),
        }).catch(() => {});
      } catch { /* best effort — silence still reads as gone */ }
    };
    window.addEventListener('pagehide', onLeave);

    beat('active');
    schedule();

    return () => {
      stopped.current = true;
      clearTimeout(timer.current);
      for (const e of events) window.removeEventListener(e, touched);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onLeave);
      authSub?.subscription?.unsubscribe();
    };
  }, [profileId]);
}
