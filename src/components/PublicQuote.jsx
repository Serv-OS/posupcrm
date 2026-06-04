import { useEffect, useRef, useState } from 'react';

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const money = (v) => `£${Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const CAT = { hardware: 'Hardware', services: 'Services', saas: 'SaaS plan', payments: 'Payments' };

export default function PublicQuote({ token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const paid = new URLSearchParams(window.location.search).get('paid') === '1';

  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const hasSig = useRef(false);

  useEffect(() => { (async () => {
    try {
      const res = await fetch(`${FN}/quote-public?token=${encodeURIComponent(token)}`);
      const d = await res.json();
      if (!res.ok) setError(d.error || 'Quote not found.');
      else setData(d);
    } catch { setError('Could not load this quote.'); }
    setLoading(false);
  })(); }, [token]);

  // Canvas drawing
  const pos = (e) => {
    const c = canvasRef.current; const r = c.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  };
  const startDraw = (e) => { e.preventDefault(); drawing.current = true; const ctx = canvasRef.current.getContext('2d'); const { x, y } = pos(e); ctx.beginPath(); ctx.moveTo(x, y); };
  const moveDraw = (e) => {
    if (!drawing.current) return; e.preventDefault();
    const ctx = canvasRef.current.getContext('2d'); const { x, y } = pos(e);
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#1a1a1a';
    ctx.lineTo(x, y); ctx.stroke(); hasSig.current = true;
  };
  const endDraw = () => { drawing.current = false; };
  const clearSig = () => { const c = canvasRef.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); hasSig.current = false; };

  const submit = async () => {
    if (!name.trim()) { setError('Please type your full name.'); return; }
    if (!hasSig.current) { setError('Please draw your signature.'); return; }
    setSubmitting(true); setError('');
    const signature = canvasRef.current.toDataURL('image/png');
    try {
      const res = await fetch(`${FN}/quote-public`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name: name.trim(), signature }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Could not submit.'); setSubmitting(false); return; }
      if (d.executed) { setDone(true); setSubmitting(false); return; }
      if (d.needs_payment) {
        const cs = await fetch(`${FN}/quote-checkout`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, origin: window.location.origin }),
        });
        const cd = await cs.json();
        if (cs.ok && cd.url) { window.location.href = cd.url; return; }
        setError(cd.error || 'Payment could not be started. Your signature was saved — we\'ll be in touch.');
        setSubmitting(false);
      }
    } catch { setError('Could not submit. Please try again.'); setSubmitting(false); }
  };

  const wrap = (children) => (
    <div className="min-h-screen w-full bg-slate-50 py-6 px-4 flex justify-center">
      <div className="w-full max-w-2xl">{children}</div>
    </div>
  );

  if (loading) return wrap(<div className="text-center text-slate-400 text-sm py-16">Loading quote…</div>);
  if (error && !data) return wrap(<div className="text-center text-slate-600 text-sm py-16">{error}</div>);

  const q = data.quote;
  const accepted = paid || done || ['signed', 'paid', 'won'].includes(q.status);

  return wrap(
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-slate-200 flex items-center justify-between">
        <div>
          <div className="text-lg font-bold text-slate-800">Quote #{q.number}</div>
          <div className="text-sm text-slate-500">{data.company_name}</div>
        </div>
        <div className="text-right text-orange-500 font-bold text-xl">ServOS</div>
      </div>

      {/* Line items */}
      <div className="px-6 py-4">
        {(data.items || []).map(it => (
          <div key={it.id} className="flex items-start gap-3 py-2 border-b border-slate-100 last:border-0">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-800">{it.name}</div>
              {it.description && <div className="text-xs text-slate-500 mt-0.5">{it.description}</div>}
              <div className="text-[11px] text-slate-400 mt-0.5">
                {CAT[it.category]} · {it.qty} × {money(it.unit_price)}{it.discount > 0 ? ` · ${it.discount}% off` : ''}
                {it.billing_type === 'monthly' ? ' · monthly' : it.billing_type === 'annual' ? ' · annual' : ''}
              </div>
            </div>
            <div className="text-sm font-mono text-slate-700 shrink-0">
              {money(it.line_total)}{it.billing_type === 'monthly' ? '/mo' : it.category === 'payments' ? '/yr' : ''}
            </div>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="px-6 py-4 bg-slate-50 border-y border-slate-200 space-y-1">
        <Row k="One-off subtotal" v={money(q.one_off_subtotal)} />
        <Row k="VAT" v={money(q.tax_amount)} />
        <Row k="One-off total" v={money(q.one_off_total)} bold />
        {q.recurring_arr > 0 && <Row k="Ongoing (per year)" v={money(q.recurring_arr)} sub />}
        {q.go_live_date && <div className="text-xs text-slate-500 pt-1">Planned go-live: {new Date(q.go_live_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</div>}
        {q.valid_until && <div className="text-xs text-slate-500">Valid until: {new Date(q.valid_until).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</div>}
      </div>

      {/* Terms */}
      {q.terms && (
        <div className="px-6 py-4 border-b border-slate-200">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Terms &amp; conditions</div>
          <div className="text-xs text-slate-600 whitespace-pre-wrap">{q.terms}</div>
        </div>
      )}

      {/* Accept / sign */}
      <div className="px-6 py-5">
        {accepted ? (
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-2xl mx-auto mb-2">✓</div>
            <div className="text-lg font-bold text-slate-800">{paid || q.status === 'paid' || q.status === 'won' ? 'Accepted & paid' : 'Accepted'}</div>
            <div className="text-sm text-slate-500">Thank you — we'll be in touch to get you started.</div>
          </div>
        ) : q.expired ? (
          <div className="text-center text-slate-500 text-sm py-4">This quote has expired. Please contact us for an updated quote.</div>
        ) : (
          <>
            <div className="text-sm font-semibold text-slate-700 mb-2">Accept this quote</div>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Type your full name"
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-orange-400" />
            <div className="text-xs text-slate-500 mb-1">Draw your signature below</div>
            <div className="border border-slate-300 rounded-lg bg-white">
              <canvas ref={canvasRef} width={560} height={150} className="w-full touch-none"
                onMouseDown={startDraw} onMouseMove={moveDraw} onMouseUp={endDraw} onMouseLeave={endDraw}
                onTouchStart={startDraw} onTouchMove={moveDraw} onTouchEnd={endDraw} />
            </div>
            <button onClick={clearSig} className="text-xs text-slate-400 mt-1 hover:text-slate-600">Clear signature</button>
            {error && <div className="text-sm text-red-600 mt-2">{error}</div>}
            <button onClick={submit} disabled={submitting}
              className="w-full mt-3 py-3 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50">
              {submitting ? 'Processing…'
                : q.payment_terms === 'invoice_later' ? 'Accept & sign'
                : q.payment_terms === 'deposit' ? `Accept, sign & pay ${q.deposit_percent}% deposit`
                : 'Accept, sign & pay'}
            </button>
            <div className="text-center text-[10px] text-slate-300 pt-2">Powered by ServOS</div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ k, v, bold, sub }) {
  return (
    <div className="flex justify-between text-sm">
      <span className={sub ? 'text-slate-400 text-xs' : 'text-slate-500'}>{k}</span>
      <span className={`font-mono ${bold ? 'text-slate-900 font-bold' : sub ? 'text-slate-400 text-xs' : 'text-slate-700'}`}>{v}</span>
    </div>
  );
}
