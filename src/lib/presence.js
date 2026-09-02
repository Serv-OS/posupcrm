// Reading a presence row. Pure on purpose: no Supabase client, so the rules
// can be unit tested and reused anywhere without needing env vars or a session.
//
// How to read a presence row. Shared so the table, any badge and the edge
// function cannot disagree about what "open" means.
export function readPresence(p, now = Date.now()) {
  if (!p?.last_seen_at) return { label: 'Never seen', tone: 'dim', open: false };
  const secs = Math.round((now - new Date(p.last_seen_at).getTime()) / 1000);
  const mins = Math.round(secs / 60);

  // Beats stop dead when a laptop sleeps, so silence is the signal. The windows
  // are generous enough to survive one missed beat on a throttled background tab.
  if (p.state === 'closed' && secs > 60) return { label: `Closed ${rel(mins)}`, tone: 'dim', open: false };
  if (secs > 8 * 60) return { label: `Asleep or closed · last seen ${rel(mins)}`, tone: 'dim', open: false };
  if (p.state === 'hidden') return { label: 'Open, in another tab', tone: 'amber', open: true };
  if (p.state === 'idle') {
    const idleM = p.last_active_at ? Math.round((now - new Date(p.last_active_at).getTime()) / 60000) : mins;
    return { label: `Open but idle ${idleM}m`, tone: 'amber', open: true };
  }
  return { label: 'Open now', tone: 'green', open: true };
}

function rel(mins) {
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
