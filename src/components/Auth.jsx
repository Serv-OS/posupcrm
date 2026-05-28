import { useState } from 'react';
import { supabase, APP_URL } from '../lib/supabase';
import { LogoMark, Wordmark } from './ServOSLogo.jsx';

export default function Auth() {
  const [email, setEmail]     = useState('');
  const [sent, setSent]       = useState(false);
  const [error, setError]     = useState('');
  const [sending, setSending] = useState(false);

  const send = async (e) => {
    e.preventDefault();
    setSending(true); setError('');
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: APP_URL },
    });
    setSending(false);
    if (error) setError(error.message); else setSent(true);
  };

  return (
    <div className="h-full flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8 flex flex-col items-center">
          <LogoMark size={56}/>
          <div className="mt-4">
            <Wordmark className="!text-4xl"/>
          </div>
          <div className="text-sm text-muted mt-2 font-mono text-[10px] uppercase tracking-[0.18em]">Posupject</div>
        </div>

        {sent ? (
          <div className="bg-ink-soft border border-bdr rounded-xl p-6 text-center">
            <div className="text-2xl mb-3">&#x2709;&#xFE0F;</div>
            <div className="text-sm text-paper font-semibold mb-1">Check your email</div>
            <div className="text-xs text-muted">We sent a magic link to <span className="text-paper">{email}</span></div>
          </div>
        ) : (
          <form onSubmit={send} className="space-y-3">
            <input
              type="email" required autoFocus
              value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-4 py-3 bg-ink-soft border border-bdr rounded-lg text-paper placeholder-dim text-sm focus:outline-none focus:border-ember"
            />
            <button
              type="submit" disabled={sending || !email}
              className="w-full px-4 py-3 bg-ember text-ink font-semibold rounded-lg text-sm disabled:opacity-50 hover:bg-ember-deep transition"
            >
              {sending ? 'Sending…' : 'Send magic link'}
            </button>
            {error && <div className="text-xs text-red-400 text-center">{error}</div>}
            <div className="text-xs text-dim text-center pt-2">
              First user becomes owner. Subsequent users must be invited by an owner.
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
