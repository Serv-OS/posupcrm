import { useEffect, useRef, useState } from 'react';

/* "Send us a photo", for a customer with no login.
 *
 * A picture texted to a UK number never reaches us: Twilio carries MMS in the
 * US and Canada only. So the auto reply texts a link to this page instead, and
 * what they add here lands on their ticket like an emailed attachment.
 *
 * Built for a phone held one handed in a kitchen: one big button that opens the
 * camera roll, each file uploading as it is chosen, and a plain list of what has
 * landed. Nothing to submit at the end, so there is nothing to forget.
 */

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const MAX_MB = 12;

const call = async (payload) => {
  const r = await fetch(`${FN}/ticket-upload`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Something went wrong. Please try again.');
  return d;
};

const readAsBase64 = (file) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
  fr.onerror = () => reject(new Error('That file could not be read.'));
  fr.readAsDataURL(file);
});

export default function TicketUpload({ token }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState([]);   // [{ name, ok, note }]
  const fileRef = useRef(null);

  useEffect(() => { (async () => {
    try { setInfo(await call({ action: 'info', token })); }
    catch (e) { setError(e.message); }
    setLoading(false);
  })(); }, [token]);

  const add = async (files) => {
    const list = [...files];
    if (!list.length) return;
    setBusy(true); setError('');
    for (const f of list) {
      try {
        if (f.size > MAX_MB * 1024 * 1024) throw new Error(`Too big, ${MAX_MB} MB is the limit.`);
        const data = await readAsBase64(f);
        const res = await call({ action: 'upload', token, name: f.name, mime: f.type || 'image/jpeg', data });
        setDone(d => [...d, { name: f.name, ok: true }]);
        setInfo(i => ({ ...i, count: res.count }));
      } catch (e) {
        setDone(d => [...d, { name: f.name, ok: false, note: e.message }]);
      }
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const wrap = (children) => (
    <div className="min-h-screen w-full bg-slate-100 py-8 px-4 flex justify-center">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );

  if (loading) return wrap(<div className="text-center text-slate-400 text-sm py-16">Loading…</div>);
  if (!info) return wrap(
    <div className="bg-white rounded-2xl shadow-sm p-7 text-center">
      <div className="text-lg font-bold text-slate-800 mb-1">Link not valid</div>
      <div className="text-sm text-slate-500">{error || 'Please ask us for a new link.'}</div>
    </div>,
  );

  const full = info.count >= info.max;

  return wrap(
    <div className="bg-white rounded-2xl shadow-sm p-6">
      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
        {info.business_name || 'Support'}
      </div>
      <h1 className="text-xl font-bold text-slate-900 mt-1">Send us a photo</h1>
      <p className="text-sm text-slate-500 mt-1">
        For ticket #{info.ticket_number}. Pictures go straight to the person handling it.
      </p>

      {/* The label IS the button: tapping it opens the camera roll on a phone. */}
      <label className={`mt-5 block text-center rounded-xl px-4 py-4 text-sm font-semibold cursor-pointer transition
        ${busy || full ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-emerald-500 text-white hover:bg-emerald-600'}`}>
        {busy ? 'Sending…' : full ? 'Maximum files reached' : 'Choose photos'}
        <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple className="hidden"
          disabled={busy || full} onChange={e => add(e.target.files)} />
      </label>
      <div className="text-[11px] text-slate-400 text-center mt-2">
        Photos or PDFs, up to {MAX_MB} MB each.
      </div>

      {error && <div className="mt-4 text-sm text-red-600">{error}</div>}

      {done.length > 0 && (
        <ul className="mt-5 space-y-2">
          {done.map((d, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className={d.ok ? 'text-emerald-600' : 'text-red-500'}>{d.ok ? '✓' : '✕'}</span>
              <span className="min-w-0">
                <span className="block text-slate-700 break-words">{d.name}</span>
                {!d.ok && <span className="block text-xs text-red-500">{d.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {done.some(d => d.ok) && !busy && (
        <div className="mt-5 rounded-xl bg-emerald-50 text-emerald-800 text-sm px-4 py-3">
          Thanks, that has reached us. You can close this page, or add more.
        </div>
      )}
    </div>,
  );
}
