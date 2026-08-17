import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { GROUPS, sectionsIn, visibleFields } from '../../lib/onboardingForm';

// The onboarding pack, from our side: send it, chase it, read it.
//
// Deliberately shows the state of the thing rather than just a button — sent
// when, opened or not, completed when — because "have they filled it in yet" is
// the question this card exists to answer.

export default function OnboardingPackCard({ onboarding, company, location, contacts = [], profile, onChanged }) {
  const [req, setReq] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [sending, setSending] = useState(false);
  const [email, setEmail] = useState('');
  const [open, setOpen] = useState(false);
  const [reveal, setReveal] = useState(false);   // the WiFi password stays hidden until asked for
  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  const load = async () => {
    const { data } = await supabase.from('onboarding_form_requests')
      .select('*').eq('onboarding_id', onboarding.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    setReq(data || null);
    setLoaded(true);
  };
  useEffect(() => { load(); }, [onboarding.id]);

  useEffect(() => {
    if (email) return;
    const c = contacts.find(x => x.email);
    if (c?.email) setEmail(c.email);
  }, [contacts]);

  const send = async () => {
    if (!email.includes('@')) { alert('Add the email address to send it to.'); return; }
    setSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/onboarding-form-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          onboarding_id: onboarding.id,
          location_id: onboarding.location_id || location?.id || null,
          company_id: onboarding.company_id || null,
          contact_id: contacts.find(c => c.email === email)?.id || null,
          contact_name: contacts.find(c => c.email === email)?.first_name || '',
          venue: location?.name || company?.name || '',
          to: email,
          app_url: window.location.origin,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Could not send');
      await load();
      onChanged?.();
      alert(`Onboarding pack sent to ${d.sent_to}.`);
    } catch (e) { alert(e.message); }
    setSending(false);
  };

  const link = req ? `${window.location.origin}/onboarding/${req.token}` : '';
  const answers = req?.answers || {};
  const done = !!req?.submitted_at;
  const fmt = (d) => d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-bdr flex items-center gap-2">
        <h3 className="text-sm font-bold text-paper">Onboarding pack</h3>
        {req && (
          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
            done ? 'bg-emerald-100 text-emerald-700' : req.opened_at ? 'bg-blue-100 text-blue-700' : 'bg-amber/15 text-amber'}`}>
            {done ? 'Completed' : req.opened_at ? 'Opened' : 'Sent'}
          </span>
        )}
        {done && <button onClick={() => setOpen(v => !v)} className="ml-auto text-xs text-ember hover:text-ember-deep font-medium">{open ? 'Hide' : 'View answers'}</button>}
      </div>

      <div className="p-4 space-y-3">
        {!loaded ? <div className="text-xs text-dim italic">Loading…</div> : !req ? (
          <>
            <div className="text-xs text-muted">
              Send the customer everything we need to build their till: company and trading details, VAT, receipt logo,
              menu, users, discounts, table plan and how their kitchen tickets should print. Uploads land on this venue.
            </div>
            {canWrite && (
              <div className="flex gap-2">
                <input className="flex-1 px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper" placeholder="customer@venue.co.uk"
                  value={email} onChange={e => setEmail(e.target.value)} />
                <button disabled={sending} onClick={send} className="btn-glass px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50 whitespace-nowrap">
                  {sending ? 'Sending…' : 'Send pack'}
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="space-y-1 text-xs">
              <Row k="Sent to" v={req.sent_to} />
              <Row k="Sent" v={fmt(req.sent_at)} />
              <Row k="Opened" v={fmt(req.opened_at) || 'not yet'} />
              <Row k="Completed" v={fmt(req.submitted_at) || 'not yet'} />
            </div>

            <div className="flex items-center gap-2">
              <input readOnly value={link} onFocus={e => e.target.select()}
                className="flex-1 px-2 py-1.5 bg-card border border-bdr rounded-lg text-[10px] font-mono text-muted" />
              <button onClick={() => { navigator.clipboard.writeText(link); alert('Link copied'); }}
                className="btn-ghost px-2 py-1.5 rounded-lg text-xs shrink-0">Copy</button>
            </div>

            {!done && canWrite && (
              <button disabled={sending} onClick={send} className="btn-ghost px-3 py-1.5 rounded-xl text-xs font-semibold disabled:opacity-50">
                {sending ? 'Sending…' : 'Send the link again'}
              </button>
            )}

            {done && open && (
              <div className="space-y-4 pt-2 border-t border-bdr max-h-[460px] overflow-y-auto">
                {GROUPS.map(g => {
                  const secs = sectionsIn(g.key).filter(sec => {
                    const a = answers[sec.key] || {};
                    return visibleFields(sec, answers).some(f => !empty(f, a[f.key]));
                  });
                  if (!secs.length) return null;
                  return (
                    <div key={g.key}>
                      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-ember mb-1.5">{g.title}</div>
                      <div className="space-y-3">
                        {secs.map(sec => {
                          const a = answers[sec.key] || {};
                          const rows = visibleFields(sec, answers).filter(f => !empty(f, a[f.key]));
                          return (
                            <div key={sec.key}>
                              <div className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-dim mb-1">{sec.title}</div>
                              <div className="space-y-1.5">
                                {rows.map(f => {
                                  const v = a[f.key];
                                  if (f.type === 'confirm') {
                                    return (
                                      <div key={f.key} className="text-xs flex gap-1.5">
                                        <span className="text-emerald-600 font-bold shrink-0">✓</span>
                                        <span className="text-paper">{f.label}</span>
                                      </div>
                                    );
                                  }
                                  if (f.type === 'file') {
                                    const files = Array.isArray(v) ? v : [v];
                                    return (
                                      <div key={f.key} className="text-xs">
                                        <div className="text-muted">{f.label}</div>
                                        <div className="space-y-0.5 mt-0.5">
                                          {files.map(file => (
                                            <div key={file.path} className="text-paper">📎 {file.name}
                                              <span className="text-dim ml-1 font-mono text-[10px]">{(file.size / 1048576).toFixed(1)}MB</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    );
                                  }
                                  return (
                                    <div key={f.key} className="text-xs">
                                      <div className="text-muted">{f.label}</div>
                                      {f.sensitive ? (
                                        <div className="text-paper font-mono flex items-center gap-2">
                                          <span>{reveal ? String(v) : '••••••••••'}</span>
                                          <button onClick={() => setReveal(r => !r)} className="text-[10px] text-ember hover:underline">
                                            {reveal ? 'hide' : 'show'}
                                          </button>
                                        </div>
                                      ) : <div className="text-paper whitespace-pre-wrap">{String(v)}</div>}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                <div className="text-[10px] text-dim pt-1">All uploaded files are on this venue's Attachments.</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Mirrors the definition's own idea of "answered" so the card never shows an
// empty heading for a question the customer skipped.
function empty(f, v) {
  if (f.type === 'file') return !(Array.isArray(v) ? v.length : v);
  if (f.type === 'confirm') return v !== true;
  return !String(v ?? '').trim();
}

function Row({ k, v }) {
  return <div className="flex justify-between gap-3"><span className="text-dim">{k}</span><span className="text-paper text-right truncate">{v || '—'}</span></div>;
}
