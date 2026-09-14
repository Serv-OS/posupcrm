import { useEffect, useState } from 'react';
import { amountPaid, balanceDue, creditableLeft, creditNoteLabel, creditState, settledAmount } from '../lib/creditNotes';

// Public hosted invoice page (/i/<token>). Branded from support_settings,
// customer pays by card via Stripe Checkout. Credit notes raised against the
// invoice are listed with links to their own pages (/c/<token>). Credit applied
// to it from another invoice's credit note shows as a "Credit applied CN-1003"
// row above the balance. The Pay button asks for what is left after all of
// them, never the full total.

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const money = (v) => `£${Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// A real minus sign for the steps down to the balance.
const minus = (v) => `\u2212${money(v)}`;
// A bare date ('2026-09-12') is read as local midnight. new Date() on its own
// reads it as midnight UTC, which shows the day before anywhere west of London.
const fmtDate = (d) => d ? new Date(String(d).length <= 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

export default function PublicInvoice({ token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(false);
  const justPaid = new URLSearchParams(window.location.search).get('paid') === '1';

  useEffect(() => { (async () => {
    try {
      const res = await fetch(`${FN}/invoice-public?token=${encodeURIComponent(token)}`);
      const d = await res.json();
      if (!res.ok) setError(d.error || 'Invoice not found.');
      else setData(d);
    } catch { setError('Could not load this invoice.'); }
    setLoading(false);
  })(); }, [token]);

  const pay = async () => {
    setPaying(true); setError('');
    try {
      const res = await fetch(`${FN}/invoice-checkout`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, origin: window.location.origin }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not start payment.');
      window.location.href = d.url;
      return;
    } catch (e) { setError(e.message); }
    setPaying(false);
  };

  if (loading) return <Page><div className="text-center text-slate-400 py-20">Loading invoice…</div></Page>;
  if (error && !data) return <Page><div className="text-center text-slate-600 py-20">{error}</div></Page>;

  const { invoice: inv, seller, company, contact, location, items } = data;
  const accent = seller.accent || '#15C26A';
  const isPaid = inv.status === 'paid' || justPaid;

  // Credit notes. invoice-public sends balance_due, the figure invoice-checkout
  // charges; the same sum from src/lib/creditNotes.js stands in until that
  // function is redeployed, and gives the old page's figure when there is no
  // credit. A number or 'CN-1001' is accepted for each note.
  const credits = data.credit_notes || inv.credit_notes || [];
  const credited = Number(inv.amount_credited) || 0;
  const hasCredit = credited > 0;
  // Credit applied from other invoices' credit notes: a settlement, not cash,
  // so it is its own step and never part of "Paid". invoice-public sends one
  // row per credit note; if the rows are missing but the invoice carries the
  // sum, that sum shows as one row so the steps still add up.
  const appliedRows = (data.credit_applied || []).filter((a) => Number(a?.amount) > 0);
  const applied = Number(inv.amount_allocated) || appliedRows.reduce((t, a) => t + (Number(a.amount) || 0), 0);
  const hasApplied = applied > 0;
  const appliedShown = appliedRows.length ? appliedRows : hasApplied ? [{ number: null, amount: applied }] : [];
  const state = { ...inv, amount_allocated: applied };
  const balance = inv.balance_due != null ? Math.max(0, Number(inv.balance_due) || 0) : balanceDue(state);
  const paidSoFar = amountPaid(state);
  const creditKind = hasCredit ? creditState(inv) : 'none';
  const fullyCredited = !isPaid && creditKind === 'full' && settledAmount(state) === 0;
  // Credit (with any part payment) has covered the lot: nothing to charge and
  // nothing to chase, though the status is still sent or viewed.
  const nothingToPay = !isPaid && balance <= 0;
  // With credit or a part payment the Pay button asks for less than the total,
  // so the totals show each step down to that figure.
  const showSteps = hasCredit || hasApplied || (!isPaid && paidSoFar > 0);
  // Paid (in cash or applied credit) past what a credit note left to ask for:
  // the balance stops at 0, so say where the rest went (the credit note says
  // whether it has been refunded or used).
  // Both sides in pennies, by the rules in creditNotes.js.
  const overpaid = hasCredit || hasApplied ? settledAmount(state) - creditableLeft(state) : 0;
  const cnLabel = (c) => {
    const n = c.number ?? c.credit_number;
    return typeof n === 'string' && /^CN-/i.test(n) ? n : creditNoteLabel(n);
  };

  return (
    <Page>
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="px-8 py-6 flex items-start justify-between gap-4 border-b border-slate-100">
          <div>
            {seller.logo_url
              ? <img src={seller.logo_url} alt={seller.name} className="h-12 object-contain mb-2" />
              : <div className="text-2xl font-bold text-slate-900 mb-1">{seller.name}</div>}
            <div className="text-xs text-slate-500 whitespace-pre-line">{[seller.address, seller.email, seller.phone].filter(Boolean).join('\n')}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-xs font-bold uppercase tracking-widest text-slate-400">Invoice</div>
            <div className="text-xl font-bold text-slate-900">INV-{inv.number}</div>
            <div className="text-xs text-slate-500 mt-1">Issued {fmtDate(inv.issue_date)}</div>
            {inv.due_date && <div className="text-xs text-slate-500">Due {fmtDate(inv.due_date)}</div>}
            {inv.po_number && <div className="text-xs text-slate-500">PO {inv.po_number}</div>}
            <div className="mt-2">
              {isPaid
                ? <Badge bg="#d1fae5" color="#065f46">Paid</Badge>
                : fullyCredited
                  ? <Badge bg="#e0e7ff" color="#3730a3">Credited</Badge>
                  : nothingToPay
                    ? <Badge bg="#d1fae5" color="#065f46">Nothing to pay</Badge>
                    : inv.overdue
                      ? <Badge bg="#fee2e2" color="#991b1b">Overdue</Badge>
                      : <Badge bg="#fef3c7" color="#92400e">Awaiting payment</Badge>}
            </div>
            {hasCredit && !fullyCredited && (
              <div className="text-[11px] font-semibold text-indigo-700 mt-1">
                {creditKind === 'full' ? 'Credited' : 'Part credited'}
              </div>
            )}
          </div>
        </div>

        {/* Bill to */}
        {(company || contact || location) && (
          <div className="px-8 py-4 border-b border-slate-100">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Billed to</div>
            <div className="text-sm text-slate-800 font-semibold">{company?.name || contact?.name}</div>
            {location && <div className="text-xs text-slate-500">{location.name}{location.address ? ` · ${location.address}` : ''}</div>}
            {company?.address && <div className="text-xs text-slate-500">{company.address}</div>}
            {contact && company && <div className="text-xs text-slate-500">Attn: {contact.name}</div>}
          </div>
        )}

        {/* Lines */}
        <div className="px-8 py-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] font-bold uppercase tracking-widest text-slate-400 border-b border-slate-100">
                <th className="text-left py-2 font-bold">Item</th>
                <th className="text-right py-2 font-bold w-14">Qty</th>
                <th className="text-right py-2 font-bold w-24">Price</th>
                <th className="text-right py-2 font-bold w-14">VAT</th>
                <th className="text-right py-2 font-bold w-24">Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id} className="border-b border-slate-50">
                  <td className="py-2.5">
                    <div className="text-slate-800 font-medium">{it.name}</div>
                    {it.description && <div className="text-xs text-slate-500">{it.description}</div>}
                  </td>
                  <td className="py-2.5 text-right text-slate-600 tabular-nums">{Number(it.qty)}</td>
                  <td className="py-2.5 text-right text-slate-600 tabular-nums">{money(it.unit_price)}</td>
                  <td className="py-2.5 text-right text-slate-600 tabular-nums">{Number(it.tax_rate ?? 0)}%</td>
                  <td className="py-2.5 text-right text-slate-800 font-medium tabular-nums">{money(Number(it.qty) * Number(it.unit_price))}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="flex justify-end mt-4">
            <div className="w-60 space-y-1.5 text-sm">
              <div className="flex justify-between text-slate-500"><span>Subtotal</span><span className="tabular-nums">{money(inv.subtotal)}</span></div>
              <div className="flex justify-between text-slate-500"><span>VAT</span><span className="tabular-nums">{money(inv.tax_amount)}</span></div>
              {showSteps ? (
                <>
                  <div className="flex justify-between font-semibold text-slate-800 pt-1.5 border-t border-slate-200"><span>Total</span><span className="tabular-nums">{money(inv.total)}</span></div>
                  {hasCredit && <div className="flex justify-between text-slate-500"><span>Credited</span><span className="tabular-nums">{minus(credited)}</span></div>}
                  {appliedShown.map((a, i) => {
                    const cn = a.number != null && a.number !== '' ? cnLabel(a) : '';
                    return (
                      <div key={`applied-${i}`} className="flex justify-between gap-3 text-slate-500">
                        <span className="min-w-0">
                          Credit applied{cn ? ' ' : ''}
                          {cn && (a.public_token
                            ? <a href={`/c/${encodeURIComponent(a.public_token)}`} className="font-medium underline underline-offset-2" style={{ color: accent }}>{cn}</a>
                            : cn)}
                        </span>
                        <span className="tabular-nums shrink-0">{minus(a.amount)}</span>
                      </div>
                    );
                  })}
                  {paidSoFar > 0 && <div className="flex justify-between text-slate-500"><span>Paid</span><span className="tabular-nums">{minus(paidSoFar)}</span></div>}
                  <div className="flex justify-between text-base font-bold text-slate-900 pt-1.5 border-t border-slate-200"><span>Balance due</span><span className="tabular-nums">{money(isPaid ? 0 : balance)}</span></div>
                  {overpaid > 0.005 && <div className="text-xs text-slate-500 text-right">{money(overpaid)} more was paid than is now owed</div>}
                </>
              ) : (
                <div className="flex justify-between text-base font-bold text-slate-900 pt-1.5 border-t border-slate-200"><span>Total due</span><span className="tabular-nums">{money(inv.total)}</span></div>
              )}
            </div>
          </div>
        </div>

        {/* Credit notes: issued ones only (invoice-public leaves cancelled ones out) */}
        {credits.length > 0 && (
          <div className="px-8 pb-5">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Credit notes</div>
            <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
              {credits.map((c, i) => {
                const token = c.public_token || c.token;
                const row = (
                  <>
                    <span className="min-w-0">
                      <span className="font-semibold text-slate-800">{cnLabel(c)}</span>
                      {c.issue_date && <span className="block sm:inline text-xs text-slate-500"><span className="hidden sm:inline"> · </span>{fmtDate(c.issue_date)}</span>}
                    </span>
                    <span className="flex items-center gap-3 shrink-0">
                      <span className="tabular-nums text-slate-800">{minus(c.total)}</span>
                      {token && <span className="text-xs font-semibold" style={{ color: accent }}>View</span>}
                    </span>
                  </>
                );
                return token
                  ? <a key={token} href={`/c/${encodeURIComponent(token)}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-slate-50">{row}</a>
                  : <div key={i} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">{row}</div>;
              })}
            </div>
          </div>
        )}

        {/* Pay */}
        <div className="px-8 pb-6">
          {isPaid ? (
            <div className="rounded-xl p-4 text-center font-semibold" style={{ background: '#ecfdf5', color: '#065f46' }}>
              ✓ Paid{inv.paid_at ? ` on ${fmtDate(inv.paid_at.slice(0, 10))}` : ''} — thank you!
            </div>
          ) : nothingToPay ? (
            <div className="rounded-xl p-4 text-center" style={{ background: '#f1f5f9', color: '#334155' }}>
              <div className="font-semibold">Nothing left to pay</div>
              {(hasCredit || hasApplied) && <div className="text-xs text-slate-500 mt-0.5">{fullyCredited ? 'This invoice has been credited in full.' : 'Payments and credit cover this invoice.'}</div>}
            </div>
          ) : (
            <>
              <button onClick={pay} disabled={paying}
                className="w-full py-3.5 rounded-xl text-white font-bold text-base transition hover:opacity-90 disabled:opacity-50"
                style={{ background: accent }}>
                {paying ? 'Redirecting…' : `Pay ${money(balance)} by card`}
              </button>
              {error && <div className="text-sm text-red-600 text-center mt-2">{error}</div>}
              <div className="text-[11px] text-slate-400 text-center mt-2">Secure card payment powered by Stripe</div>
            </>
          )}
        </div>

        {/* Terms */}
        {(inv.terms || inv.notes) && (
          <div className="px-8 py-4 bg-slate-50 border-t border-slate-100">
            {inv.notes && <div className="text-xs text-slate-600 mb-2 whitespace-pre-wrap">{inv.notes}</div>}
            {inv.terms && <>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Terms</div>
              <div className="text-[11px] text-slate-500 whitespace-pre-wrap leading-relaxed">{inv.terms}</div>
            </>}
          </div>
        )}
      </div>
      <div className="text-center text-[10px] text-slate-300 pt-3">Powered by ServOS</div>
    </Page>
  );
}

function Page({ children }) {
  return (
    <div className="min-h-screen w-full bg-slate-100 py-8 px-4">
      <div className="max-w-2xl mx-auto">{children}</div>
    </div>
  );
}
function Badge({ bg, color, children }) {
  return <span className="inline-block px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wide" style={{ background: bg, color }}>{children}</span>;
}
