import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { readPresence } from '../lib/presence.js';

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

// Relative time, because "3 days ago" is the thing you actually read.
const ago = (ts) => {
  if (!ts) return 'never';
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d} days ago`;
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
};
const stamp = (ts) => ts ? new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const dayKey = (d) => d.toISOString().slice(0, 10);

// The last 14 calendar days, oldest first — the strip everyone reads first.
const lastDays = (n = 14) => {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(dayKey(new Date(Date.now() - i * 86400000)));
  return out;
};

export default function TeamActivity({ profile }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [focus, setFocus] = useState(null); // person id to filter the feed by

  const load = async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${FN}/team-activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ days: 14 }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not load team activity');
      setData(d);
    } catch (e) { setError(e.message); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // "Right now" is only true if it keeps refreshing. Poll while the owner is
  // actually looking: a hidden tab would just burn a query every 30s to redraw
  // something nobody can see.
  useEffect(() => {
    let t;
    const tick = () => {
      t = setTimeout(async () => {
        if (document.visibilityState === 'visible') await load({ quiet: true });
        tick();
      }, 30_000);
    };
    tick();
    return () => clearTimeout(t);
  }, []);

  if (profile.role !== 'owner') {
    return <div className="p-8 text-muted text-sm">Only owners can see team activity.</div>;
  }
  if (loading) return <div className="p-8 text-dim text-sm">Loading team activity…</div>;
  if (error) {
    return (
      <div className="p-8">
        <div className="text-sm text-red-500 mb-2">{error}</div>
        <button onClick={load} className="text-xs text-ember hover:text-ember-deep font-medium">Try again</button>
      </div>
    );
  }

  const days = lastDays(14);
  const people = [...(data.people || [])];
  // Quietest first: the person you are worried about should be at the top,
  // not buried under whoever happens to be busiest.
  people.sort((a, b) => (a.active_days_7d - b.active_days_7d) || (a.actions_30d - b.actions_30d));

  // Which days each person actually did something, from the feed we already have.
  const activeByPerson = {};
  for (const e of data.feed || []) {
    (activeByPerson[e.who] ||= new Set()).add(String(e.at).slice(0, 10));
  }

  const feed = (data.feed || []).filter(e => !focus || e.who === focus);
  const focusName = people.find(p => p.id === focus)?.name;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl space-y-5">

        <div className="flex items-end justify-between">
          <div>
            <div className="text-sm font-semibold text-paper">Who is doing what</div>
            <div className="text-[11px] text-muted mt-0.5">
              Logins, last actions, and the days each person was active. Quietest first.
            </div>
          </div>
          <button onClick={load} className="text-xs text-ember hover:text-ember-deep font-medium">Refresh</button>
        </div>

        {/* People */}
        <div className="bg-card border border-bdr rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] font-mono uppercase tracking-wider text-dim border-b border-bdr">
                  <th className="text-left px-4 py-2.5 font-medium">Person</th>
                  <th className="text-left px-3 py-2.5 font-medium">Right now</th>
                  <th className="text-left px-3 py-2.5 font-medium">Last action</th>
                  <th className="text-left px-3 py-2.5 font-medium">Last 14 days</th>
                  <th className="text-right px-3 py-2.5 font-medium">Active days</th>
                  <th className="text-right px-4 py-2.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {people.map(p => {
                  const active = activeByPerson[p.id] || new Set();
                  // Nothing at all in a week, on an account that has logged in
                  // at some point, is the pattern worth a conversation.
                  const quiet = p.active_days_7d === 0;
                  return (
                    <tr key={p.id}
                      onClick={() => setFocus(focus === p.id ? null : p.id)}
                      className={`border-b border-bdr last:border-0 cursor-pointer transition hover:bg-ember/5 ${focus === p.id ? 'bg-ember/10' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-paper font-medium">{p.name}</span>
                          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-ink-soft text-dim border border-bdr">{p.role}</span>
                          {quiet && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">quiet</span>}
                        </div>
                        <div className="text-[11px] text-dim">{p.email}</div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {(() => {
                          const pr = readPresence(p.presence);
                          const dot = pr.tone === 'green' ? 'bg-emerald-500'
                            : pr.tone === 'amber' ? 'bg-amber-500' : 'bg-slate-300';
                          return (
                            <>
                              <div className="flex items-center gap-1.5">
                                <span className={`w-2 h-2 rounded-full ${dot} ${pr.tone === 'green' ? 'animate-pulse' : ''}`} />
                                <span className={`text-xs ${pr.open ? 'text-paper font-medium' : 'text-muted'}`}>{pr.label}</span>
                              </div>
                              {/* Which screen they are on, when they are actually on one. */}
                              {pr.open && p.presence?.page && (
                                <div className="text-[10px] text-dim ml-3.5">on {String(p.presence.page).replace(/_/g, ' ')}</div>
                              )}
                              {!pr.open && p.last_password_sign_in && (
                                <div className="text-[10px] text-dim ml-3.5" title={stamp(p.last_password_sign_in)}>
                                  signed in {ago(p.last_password_sign_in)}
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-3 max-w-[280px]">
                        <div className="text-xs text-paper truncate" title={p.last_action || ''}>{p.last_action || '—'}</div>
                        <div className="text-[11px] text-dim">{p.last_action_at ? ago(p.last_action_at) : 'no activity in 30 days'}</div>
                      </td>
                      <td className="px-3 py-3">
                        {/* One dot per day: filled = they did something that day. */}
                        <div className="flex items-center gap-[3px]">
                          {days.map(d => (
                            <span key={d} title={`${new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} — ${active.has(d) ? 'active' : 'nothing'}`}
                              className={`w-2 h-4 rounded-sm ${active.has(d) ? 'bg-ember' : 'bg-bdr'}`} />
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        <span className={`text-sm font-semibold tabular-nums ${quiet ? 'text-amber-600' : 'text-paper'}`}>{p.active_days_7d}</span>
                        <span className="text-[11px] text-dim">/7</span>
                        <div className="text-[11px] text-dim tabular-nums">{p.active_days_30d}/30</div>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="text-sm text-paper tabular-nums">{p.actions_7d}</div>
                        <div className="text-[11px] text-dim tabular-nums">{p.actions_30d} in 30d</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="text-[11px] text-dim">
          <span className="text-muted">Right now</span> is a heartbeat from their browser, every 30 seconds while the
          CRM is open. It stops the moment a laptop sleeps or the tab is closed, so
          <span className="text-muted"> asleep or closed</span> means nothing has been heard for 8 minutes rather than
          that they pressed anything. <span className="text-muted">Open but idle</span> means the CRM is in front of
          them but untouched. Signed in is when they last typed their password, which can be months ago on a session
          that never expired, so it is not a sign of absence.
        </div>
        <div className="text-[11px] text-dim">
          <span className="text-muted">Active day</span> = they logged a note, call, email, SMS or chat, logged time,
          moved something's stage, completed a task, wrote a handover, or raised a quote or invoice.
          Work done outside the CRM will not show here — and owning a record is not an action, so a company
          assigned to someone says nothing about whether they did anything.
        </div>

        {/* Feed */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="text-sm font-semibold text-paper">
              {focus ? `What ${focusName} did` : 'Everything, most recent first'}
            </div>
            <span className="text-[11px] text-dim">last {data.feed_days} days</span>
            {focus && (
              <button onClick={() => setFocus(null)} className="ml-auto text-xs text-ember hover:text-ember-deep font-medium">
                Show everyone
              </button>
            )}
          </div>
          <div className="bg-card border border-bdr rounded-xl divide-y divide-bdr max-h-[420px] overflow-y-auto">
            {feed.length === 0 && (
              <div className="px-4 py-6 text-center text-xs text-dim italic">
                Nothing recorded in this window.
              </div>
            )}
            {feed.map((e, i) => (
              <div key={i} className="px-4 py-2.5 flex items-baseline gap-3">
                <span className="text-xs font-medium text-paper w-28 shrink-0 truncate">{e.who_name}</span>
                <span className="text-xs text-muted flex-1 min-w-0 truncate" title={e.what}>{e.what}</span>
                <span className="text-[11px] text-dim shrink-0 tabular-nums" title={stamp(e.at)}>{ago(e.at)}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
