import { useEffect, useState } from 'react';
import { creditNoteLabel } from '../lib/creditNotes';
import { creditNotePdf } from '../lib/invoicePdf';

// Public hosted credit note page (/c/<token>), the link in the credit note
// email. Same look as the hosted invoice (PublicInvoice.jsx), read from
// credit-note-public, which answers 404 for a cancelled note: a credit that no
// longer applies must not be shown to the customer from an old email.
// The PDF is built here in the browser by the same code the staff screens use,
// so the customer's copy and ours are the same document.
// A static import on purpose: a click-time import() of the PDF code breaks
// after a redeploy on this app's catch-all rewrite.

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const money = (v) => `£${Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => {
  if (!d) return '';
  // A bare date is the day it names, not midnight UTC shown a day early in the US.
  const date = new Date(String(d).length <= 10 ? `${d}T00:00:00` : d);
  return isNaN(date) ? String(d) : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
};
// 'CN-1001' from a number, or the label as sent if it already is one.
const cnLabel = (n) => (typeof n === 'string' && /^CN-/i.test(n) ? n : creditNoteLabel(n));

export default function PublicCreditNote({ token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState('');

  useEffect(() => { (async () => {
    try {
      const res = await fetch(`${FN}/credit-note-public?token=${encodeURIComponent(token)}`);
      const d = await res.json();
      if (!res.ok) setError(d.error ? `${String(d.error).replace(/\.$/, '')}.` : 'Credit note not found.');
      else setData(d);
    } catch { setError('Could not load this credit note.'); }
    setLoading(false);
  })(); }, [token]);

  if (loading) return <Page><div className="text-center text-slate-400 py-20">Loading credit note…</div></Page>;
  if (error || !data) return <Page><div className="text-center text-slate-600 py-20">{error || 'Credit note not found.'}</div></Page>;

  const note = data.credit_note || data.note || {};
  const invoice = data.invoice || {};
  const seller = data.seller || {};
  const { company, contact, location } = data;
  const items = data.items || data.lines || note.lines || [];
  const accent = seller.accent || '#15C26A';
  const label = cnLabel(note.number ?? note.credit_number);
  const invNumber = invoice.number ?? invoice.invoice_number;
  const refund = note.refund_status;
  const balance = invoice.balance_due != null ? Math.max(0, Number(invoice.balance_due) || 0) : null;

  const downloadPdf = async () => {
    setPdfBusy(true); setPdfError('');
    try {
      await creditNotePdf({
        note,
        lines: items,
        invoice: { number: invNumber, issue_date: invoice.issue_date },
        seller,
        billTo: {
          companyName: company?.name, companyAddress: company?.address,
          contactName: contact?.name, contactEmail: contact?.email,
          locationName: location?.name, locationAddress: location?.address,
        },
        fmt: money, taxLabel: 'VAT', dateLocale: 'en-GB',
      });
    } catch { setPdfError('Could not make the PDF. Please try again.'); }
    setPdfBusy(false);
  };

  return (
    <Page>
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="px-5 sm:px-8 py-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 border-b border-slate-100">
          <div className="min-w-0">
            {seller.logo_url
              ? <img src={seller.logo_url} alt={seller.name} className="h-12 object-contain mb-2" />
              : <div className="text-2xl font-bold text-slate-900 mb-1">{seller.name}</div>}
            <div className="text-xs text-slate-500 whitespace-pre-line break-words">{[seller.address, seller.email, seller.phone].filter(Boolean).join('\n')}</div>
          </div>
          <div className="sm:text-right shrink-0">
            <div className="text-xs font-bold uppercase tracking-widest text-slate-400">Credit note</div>
            <div className="text-xl font-bold text-slate-900">{label}</div>
            <div className="text-xs text-slate-500 mt-1">Issued {fmtDate(note.issue_date)}</div>
            {invNumber != null && invNumber !== '' && <div className="text-xs text-slate-500">For invoice INV-{invNumber}</div>}
            <div className="mt-2">
              {refund === 'owed'
                ? <Badge bg="#fef3c7" color="#92400e">Refund due</Badge>
                : refund === 'refunded'
                  ? <Badge bg="#d1fae5" color="#065f46">Refunded</Badge>
                  : <Badge bg="#e0e7ff" color="#3730a3">Issued</Badge>}
            </div>
          </div>
        </div>

        {/* Credit to */}
        {(company || contact || location) && (
          <div className="px-5 sm:px-8 py-4 border-b border-slate-100">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Credit to</div>
            <div className="text-sm text-slate-800 font-semibold">{company?.name || contact?.name}</div>
            {location && <div className="text-xs text-slate-500">{location.name}{location.address ? ` · ${location.address}` : ''}</div>}
            {company?.address && <div className="text-xs text-slate-500">{company.address}</div>}
            {contact && company && <div className="text-xs text-slate-500">Attn: {contact.name}</div>}
          </div>
        )}

        {/* Reason */}
        {note.reason && (
          <div className="px-5 sm:px-8 py-4 border-b border-slate-100">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Reason</div>
            <div className="text-sm text-slate-700 whitespace-pre-wrap break-words">{note.reason}</div>
          </div>
        )}

        {/* Lines. On a phone the price and VAT move under the item name so the
            amount column never gets squeezed off the screen. */}
        <div className="px-5 sm:px-8 py-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] font-bold uppercase tracking-widest text-slate-400 border-b border-slate-100">
                <th className="text-left py-2 font-bold">Item</th>
                <th className="text-right py-2 font-bold w-12 sm:w-14">Qty</th>
                <th className="hidden sm:table-cell text-right py-2 font-bold w-24">Price</th>
                <th className="hidden sm:table-cell text-right py-2 font-bold w-14">VAT</th>
                <th className="text-right py-2 font-bold w-24">Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={it.id || i} className="border-b border-slate-50 align-top">
                  <td className="py-2.5 pr-2">
                    <div className="text-slate-800 font-medium break-words">{it.name}</div>
                    {it.description && <div className="text-xs text-slate-500 break-words">{it.description}</div>}
                    <div className="sm:hidden text-xs text-slate-500 tabular-nums">{money(it.unit_price)} each · {Number(it.tax_rate ?? 0)}% VAT</div>
                  </td>
                  <td className="py-2.5 text-right text-slate-600 tabular-nums">{Number(it.qty)}</td>
                  <td className="hidden sm:table-cell py-2.5 text-right text-slate-600 tabular-nums">{money(it.unit_price)}</td>
                  <td className="hidden sm:table-cell py-2.5 text-right text-slate-600 tabular-nums">{Number(it.tax_rate ?? 0)}%</td>
                  <td className="py-2.5 text-right text-slate-800 font-medium tabular-nums">{money(Number(it.qty) * Number(it.unit_price))}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals: as stored on the credit note, never added up again here */}
          <div className="flex justify-end mt-4">
            <div className="w-full sm:w-60 space-y-1.5 text-sm">
              <div className="flex justify-between text-slate-500"><span>Subtotal</span><span className="tabular-nums">{money(note.subtotal)}</span></div>
              <div className="flex justify-between text-slate-500"><span>VAT</span><span className="tabular-nums">{money(note.tax_amount)}</span></div>
              <div className="flex justify-between text-base font-bold text-slate-900 pt-1.5 border-t border-slate-200"><span>Total credited</span><span className="tabular-nums">{money(note.total)}</span></div>
            </div>
          </div>
        </div>

        {/* What it means for the customer: a refund, or what is left on the invoice */}
        <div className="px-5 sm:px-8 pb-6 space-y-3">
          {refund === 'owed' && (
            <div className="rounded-xl p-4 text-center" style={{ background: '#fffbeb', color: '#92400e' }}>
              <div className="font-semibold">A refund of {money(note.refund_due)} is due to you</div>
              <div className="text-xs mt-0.5">You had already paid more than the invoice now asks for.</div>
            </div>
          )}
          {refund === 'refunded' && (
            <div className="rounded-xl p-4 text-center font-semibold" style={{ background: '#ecfdf5', color: '#065f46' }}>
              ✓ {money(note.refund_due)} refunded
              {note.refunded_at ? ` on ${fmtDate(note.refunded_at)}` : ''}
              {note.refund_method && note.refund_method !== 'Other' ? ` by ${note.refund_method.toLowerCase()}` : ''}
            </div>
          )}

          {invNumber != null && invNumber !== '' && (
            <div className="rounded-xl border border-slate-200 px-4 py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
              <div className="min-w-0">
                <div className="font-semibold text-slate-800">Invoice INV-{invNumber}</div>
                {invoice.issue_date && <div className="text-xs text-slate-500">Issued {fmtDate(invoice.issue_date)}</div>}
              </div>
              <div className="flex items-center gap-4">
                {balance != null && (
                  <span className="text-slate-600">
                    {balance > 0 ? <>Left to pay <span className="font-semibold text-slate-900 tabular-nums">{money(balance)}</span></> : 'Nothing left to pay'}
                  </span>
                )}
                {invoice.public_token && (
                  <a href={`/i/${encodeURIComponent(invoice.public_token)}`} className="text-xs font-semibold" style={{ color: accent }}>View invoice</a>
                )}
              </div>
            </div>
          )}

          <button onClick={downloadPdf} disabled={pdfBusy}
            className="w-full py-3.5 rounded-xl text-white font-bold text-base transition hover:opacity-90 disabled:opacity-50"
            style={{ background: accent }}>
            {pdfBusy ? 'Making PDF…' : 'Download PDF'}
          </button>
          {pdfError && <div className="text-sm text-red-600 text-center">{pdfError}</div>}
        </div>
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
