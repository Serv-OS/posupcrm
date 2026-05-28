import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export default function UsersPanel({ profile }) {
  const [users, setUsers]       = useState([]);
  const [invites, setInvites]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [inviting, setInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole]   = useState('editor');
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const [u, i] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at'),
      supabase.from('invited_emails').select('*').is('accepted_at', null).order('invited_at', { ascending: false }),
    ]);
    setUsers(u.data || []);
    setInvites(i.data || []);
    setLoading(false);
  };

  const invite = async (e) => {
    e.preventDefault();
    setError('');
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) { setError('Please enter a valid email address.'); return; }
    if (users.some(u => u.email.toLowerCase() === email)) {
      setError('That email is already an active user.');
      return;
    }
    const { error: err } = await supabase.from('invited_emails').upsert({
      email, role: inviteRole, invited_by: profile.id, invited_at: new Date().toISOString(),
    }, { onConflict: 'email' });
    if (err) { setError(err.message); return; }
    setInviteEmail(''); setInviteRole('editor'); setInviting(false);
    load();
  };

  const revokeInvite = async (email) => {
    if (!confirm(`Revoke invite for ${email}?`)) return;
    await supabase.from('invited_emails').delete().eq('email', email);
    load();
  };

  const changeInviteRole = async (email, role) => {
    await supabase.from('invited_emails').update({ role }).eq('email', email);
    load();
  };

  const changeRole = async (id, role) => {
    await supabase.from('profiles').update({ role }).eq('id', id);
    load();
  };

  const removeUser = async (u) => {
    if (!confirm(`Remove ${u.email}? They'll lose access immediately. Their items and comments stay, but they'll need a new invite to return.`)) return;
    await supabase.from('profiles').delete().eq('id', u.id);
    load();
  };

  const copyInviteUrl = () => {
    navigator.clipboard.writeText(window.location.origin);
    alert('Sign-up URL copied to clipboard');
  };

  if (profile.role !== 'owner') {
    return <div className="p-8 text-muted text-sm">Only owners can manage users.</div>;
  }

  const input = "bg-card border border-bdr rounded text-sm text-paper placeholder-dim focus:outline-none focus:border-ember";

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-bdr flex items-center justify-between">
        <div>
          <div className="text-lg font-bold text-paper">Users</div>
          <div className="text-[10px] text-dim font-mono uppercase tracking-[0.18em]">Invite-only access. Only emails on the invite list can sign up.</div>
        </div>
        {!inviting && (
          <button onClick={() => setInviting(true)}
            className="px-3 py-1.5 bg-ember text-ink text-sm font-semibold rounded hover:bg-ember-deep transition">
            + Invite user
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl space-y-4">

          {inviting && (
            <div className="bg-card border border-bdr rounded-xl p-4">
              <div className="text-sm font-semibold text-paper mb-3">Invite a user</div>
              <form onSubmit={invite} className="space-y-3">
                <div className="grid grid-cols-12 gap-2">
                  <input type="email" required value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                    placeholder="email@example.com" autoFocus
                    className={`col-span-7 px-3 py-2 ${input}`}/>
                  <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}
                    className={`col-span-3 px-2 py-2 ${input}`}>
                    <option value="owner">Owner</option>
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button type="submit"
                    className="col-span-2 px-3 py-2 bg-ember text-ink rounded text-sm font-semibold hover:bg-ember-deep transition">
                    Invite
                  </button>
                </div>
                {error && <div className="text-xs text-red-400">{error}</div>}
                <div className="flex items-center justify-between">
                  <div className="text-xs text-muted leading-relaxed">
                    Once invited, share <button type="button" onClick={copyInviteUrl} className="text-ember hover:underline">{window.location.origin}</button> with them.
                  </div>
                  <button type="button" onClick={() => { setInviting(false); setError(''); setInviteEmail(''); }}
                    className="text-xs text-muted hover:text-paper shrink-0 ml-3">Cancel</button>
                </div>
              </form>
            </div>
          )}

          {invites.length > 0 && (
            <div className="bg-card border border-bdr rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-bdr flex items-center gap-2">
                <div className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim">Pending invites</div>
                <div className="text-xs text-dim">{invites.length}</div>
              </div>
              {invites.map(inv => (
                <div key={inv.email} className="px-4 py-3 border-b border-bdr last:border-b-0 grid grid-cols-12 gap-3 items-center">
                  <div className="col-span-6 flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-full bg-muted/20 text-muted text-xs flex items-center justify-center shrink-0">&#x2709;</div>
                    <div className="min-w-0">
                      <div className="text-sm text-paper truncate">{inv.email}</div>
                      <div className="text-xs text-dim">invited {new Date(inv.invited_at).toLocaleDateString('en-GB', { day:'numeric', month:'short' })}</div>
                    </div>
                  </div>
                  <div className="col-span-3">
                    <select value={inv.role} onChange={e => changeInviteRole(inv.email, e.target.value)}
                      className={`w-full px-2 py-1 ${input} text-xs`}>
                      <option value="owner">Owner</option>
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  </div>
                  <div className="col-span-3 flex justify-end">
                    <button onClick={() => revokeInvite(inv.email)}
                      className="px-2 py-1 text-xs text-red-400 hover:text-red-300 border border-red-500/30 hover:bg-red-500/10 rounded">
                      Revoke
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="bg-card border border-bdr rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-bdr grid grid-cols-12 gap-3 text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim">
              <div className="col-span-5">User</div>
              <div className="col-span-3">Role</div>
              <div className="col-span-2">Joined</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>
            {loading && <div className="px-4 py-8 text-center text-dim text-sm">Loading…</div>}
            {!loading && users.map(u => (
              <div key={u.id} className="px-4 py-3 border-b border-bdr last:border-b-0 grid grid-cols-12 gap-3 items-center">
                <div className="col-span-5 flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-full bg-ember text-ink text-xs font-bold flex items-center justify-center shrink-0">
                    {(u.display_name || u.email)[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm text-paper truncate">{u.display_name || u.email.split('@')[0]}</div>
                    <div className="text-xs text-dim truncate">{u.email}</div>
                  </div>
                </div>
                <div className="col-span-3">
                  {u.id === profile.id ? (
                    <span className="px-2 py-0.5 bg-ember/20 text-ember text-[10px] font-bold uppercase rounded">{u.role} (you)</span>
                  ) : (
                    <select value={u.role} onChange={e => changeRole(u.id, e.target.value)}
                      className={`px-2 py-1 ${input} text-xs`}>
                      <option value="owner">Owner</option>
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  )}
                </div>
                <div className="col-span-2 text-xs text-dim">
                  {new Date(u.created_at).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'2-digit' })}
                </div>
                <div className="col-span-2 flex justify-end">
                  {u.id !== profile.id && (
                    <button onClick={() => removeUser(u)}
                      className="px-2 py-1 text-xs text-red-400 hover:text-red-300 border border-red-500/30 hover:bg-red-500/10 rounded">
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
            {!loading && users.length === 0 && (
              <div className="px-4 py-8 text-center text-dim text-sm">No users yet.</div>
            )}
          </div>

          <div className="bg-card/60 border border-bdr rounded-xl p-4 text-xs text-muted leading-relaxed">
            <div className="text-sm font-semibold text-paper mb-2">How it works</div>
            <ul className="space-y-1 ml-4 list-disc">
              <li>Add someone's email to the invite list above with a pre-assigned role.</li>
              <li>Share <span className="text-paper font-mono">{window.location.origin}</span> with them.</li>
              <li>They sign up with the same email you invited. Other emails are rejected at sign-up.</li>
              <li>Once they sign up, they appear in the Users list below with the role you assigned.</li>
            </ul>
            <div className="text-sm font-semibold text-paper mt-4 mb-2">Role permissions</div>
            <ul className="space-y-1 ml-4 list-disc">
              <li><span className="text-paper">Owner:</span> manage users, invites, roles + all editor permissions</li>
              <li><span className="text-paper">Editor:</span> create / edit / delete projects, buckets, items, comments</li>
              <li><span className="text-paper">Viewer:</span> read-only</li>
            </ul>
          </div>

        </div>
      </div>
    </div>
  );
}
