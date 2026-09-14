import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, RotateCcw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { creditNotePdf } from '../../lib/invoicePdf';
import { money } from './InvoicesPanel.jsx';
import { round2 } from '../../lib/money';
import {
  REASON_MAX, REFUND_METHODS, amountPaid, cancelCreditEffect, creditIssueDate, creditTotals, creditableLeft,
  creditNoteLabel, lineCreditLeft, lineNet, lineTax, linesFromInvoice, refundFor, taxRatesFor, validateCredit,
} from '../../lib/creditNotes';

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

// ── Helpers shared with the invoice screen ──────────────────────────────────

/** Today on the user's own calendar. The database's current_date is the UTC
 *  date, which is a day out late in the evening, so the screen sends its own. */
export function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The database functions raise plain sentences, so those are shown as they
 *  come. Anything else (no signal, the migration not applied yet) is put into
 *  words a person can act on. */
export function creditErrorText(error) {
  const msg = error?.message || '';
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return 'Could not reach the server. Check your connection and try again.';
  if (error?.code === 'PGRST202' || /could not find the function/i.test(msg)) return 'Credit notes are not switched on yet. The database update has to be applied first.';
  return msg || 'Something went wrong. Please try again.';
}

const looksLikeEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s || '').trim());

/** What a credit is raised against, read fresh: the invoice, its lines, and
 *  the lines of its issued credit notes (what earlier credits already used, so
 *  no line is credited twice). Resolves to { invoice, lines, creditedLines }
 *  or { error }. */
export async function loadCreditBasis(invoiceId) {
  const [i, li, cn] = await Promise.all([
    supabase.from('invoices').select('*').eq('id', invoiceId).single(),
    supabase.from('invoice_line_items').select('*').eq('invoice_id', invoiceId).order('sort'),
    supabase.from('credit_notes').select('id').eq('invoice_id', invoiceId).eq('status', 'issued'),
  ]);
  const error = i.error || li.error || cn.error;
  if (error) return { error };
  const ids = (cn.data || []).map(c => c.id);
  let creditedLines = [];
  if (ids.length) {
    const cl = await supabase.from('credit_note_lines').select('invoice_line_id, qty, unit_price, tax_rate').in('credit_note_id', ids);
    if (cl.error) return { error: cl.error };
    creditedLines = cl.data || [];
  }
  return { invoice: i.data, lines: li.data || [], creditedLines };
}

/** Emails a credit note through the credit-note-send function. Resolves to the
 *  function's reply ({ to }); throws with its error message. */
export async function sendCreditNoteEmail(creditNoteId, to) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${FN}/credit-note-send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify({ credit_note_id: creditNoteId, to: (to || '').trim() || undefined }),
  });
  let d = {};
  try { d = await res.json(); } catch { /* not JSON, e.g. the function is not deployed */ }
  if (!res.ok) throw new Error(d.error || 'The email could not be sent.');
  return d;
}

/**
 * Downloads one credit note as a PDF (creditNotePdf saves it as CN-1001.pdf).
 * The lines are fetched here, when asked, so listing credit notes stays cheap.
 * `invoice`, `seller` and `billTo` take the same shapes the invoice PDF uses.
 */
export async function downloadCreditNotePdf({ note, invoice, seller, billTo }) {
  const { data: lines, error } = await supabase.from('credit_note_lines').select('*').eq('credit_note_id', note.id).order('sort');
  if (error) throw new Error(error.message);
  await creditNotePdf({
    note, lines: lines || [], invoice, seller, billTo,
    fmt: money, taxLabel: 'VAT', dateLocale: 'en-GB',
  });
}

// ── Shell ───────────────────────────────────────────────────────────────────
// Full screen on a phone, a centred card from the sm breakpoint up. Portalled
// to <body>: the invoice screen's glass cards use backdrop-filter, which would
// otherwise trap a fixed overlay inside the card. keepOpen stops a stray click
// outside the card, or an Escape pressed to dismiss autocorrect, from throwing
// away a half built credit note; the Close button still closes it.
function Sheet({ title, sub, onClose, busy, children, footer, wide, keepOpen }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy && !keepOpen) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy, keepOpen]);
  return createPortal(
    <div className="fixed inset-x-0 top-0 z-[70] bg-black/40 flex sm:items-center sm:justify-center sm:p-4"
      style={{ height: 'var(--app-vh, 100%)' }} onClick={() => !busy && !keepOpen && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}
        className={`glass-raised w-full h-full sm:h-auto sm:max-h-[90vh] ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'} sm:rounded-2xl flex flex-col overflow-hidden`}
        style={{ background: 'var(--surface-solid)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="px-4 sm:px-5 py-3.5 border-b border-bdr flex items-start gap-3 shrink-0">
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold text-paper">{title}</div>
            {sub && <div className="text-xs text-muted mt-0.5">{sub}</div>}
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="text-muted hover:text-paper p-1 -m-1 disabled:opacity-40"><X size={18} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 py-4 space-y-4">{children}</div>
        {footer && <div className="px-4 sm:px-5 py-3 border-t border-bdr flex items-center gap-2 shrink-0">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// 16px on a phone: iPhone Safari zooms the page in on any field under 16px.
const field = 'w-full r-field !text-[16px] sm:!text-sm disabled:opacity-60';
const lbl = 'text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-muted mb-1 block';

function Problems({ list }) {
  if (!list.length) return null;
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
      {list.length === 1 ? list[0] : (
        <ul className="list-disc pl-4 space-y-0.5">{list.map((p, i) => <li key={i}>{p}</li>)}</ul>
      )}
    </div>
  );
}

// ── Raise a credit note ─────────────────────────────────────────────────────

let keySeq = 0;
const withKey = (l) => ({ ...l, _key: `l${++keySeq}` });
const rateText = (r) => `${Number(r) || 0}%`;

/**
 * The raise screen. Starts with every line of the invoice at what is left on
 * it (full value when nothing is credited yet); the user lowers a quantity or
 * price, removes lines or adds a free line, gives a reason, and issues.
 * issue_credit_note does the real checks and the sums; the same library runs
 * here so the totals and problems shown are the ones the database will agree
 * with.
 *
 * invoice:       the invoice row as saved (amount_credited included)
 * invoiceLines:  its saved invoice_line_items rows (with ids)
 * creditedLines: the lines of its issued credit notes (loadCreditBasis)
 * defaultEmail:  who the Email tick sends to unless changed
 * onIssued(note, { emailed, emailError })
 */
export default function CreditNoteModal({ invoice, invoiceLines = [], creditedLines = [], defaultEmail = '', onClose, onIssued }) {
  const fresh = () => linesFromInvoice(invoiceLines, creditedLines).map(withKey);
  const [lines, setLines] = useState(fresh);
  const [reason, setReason] = useState('');
  const [emailIt, setEmailIt] = useState(false);
  const [emailTo, setEmailTo] = useState(defaultEmail || '');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The problems list sits at the end of a long form; on a phone the Issue
  // button is pinned below it, so a refused tap scrolls the reasons into view.
  const problemsRef = useRef(null);
  const showProblems = () => requestAnimationFrame(() => problemsRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));

  const setLine = (key, k, v) => setLines(p => p.map(l => (l._key === key ? { ...l, [k]: v } : l)));
  const removeLine = (key) => setLines(p => p.filter(l => l._key !== key));
  const freeRates = taxRatesFor({ line: {}, invoiceLines, invoice });
  const addLine = () => setLines(p => [...p, withKey({
    invoice_line_id: null, name: '', description: '', qty: 1, unit_price: '',
    // A goodwill credit on a VAT invoice normally carries the VAT back too.
    tax_rate: Math.max(0, ...freeRates),
  })]);

  const totals = creditTotals(lines);
  const left = creditableLeft(invoice);
  const paid = amountPaid(invoice);
  const refund = refundFor({ invoice, creditTotal: totals.total });
  // The database only limits the whole credit. "Lower a quantity or price" is
  // the rule on screen too (as on posupject), so a copied line cannot go above
  // the invoice line it came from; otherwise a credit could quietly re-price
  // the invoice.
  const sourceOf = (l) => (l.invoice_line_id ? invoiceLines.find(s => s.id === l.invoice_line_id) : null);
  const aboveInvoice = (l) => {
    const src = sourceOf(l);
    return !!src && ((Number(l.qty) || 0) > (Number(src.qty) || 0) || (Number(l.unit_price) || 0) > (Number(src.unit_price) || 0));
  };
  const lineLimits = [];
  lines.forEach((l, i) => {
    const src = sourceOf(l);
    if (!src) return;
    if ((Number(l.qty) || 0) > (Number(src.qty) || 0)) lineLimits.push(`Line ${i + 1}: the quantity is more than on the invoice.`);
    if ((Number(l.unit_price) || 0) > (Number(src.unit_price) || 0)) lineLimits.push(`Line ${i + 1}: the unit price is more than on the invoice.`);
  });
  // Dated today, or the invoice's own date if that is later.
  const today = localToday();
  const issueDate = creditIssueDate(invoice, today);
  const problems = [...validateCredit({ invoice, lines, reason, invoiceLines, creditedLines, issueDate, today }), ...lineLimits];
  const overLimit = problems.includes('This credit is more than is left on the invoice.');
  // refundFor assumes a credit the database would accept, so the refund line
  // only shows once the credit fits what is left.
  const refundShown = refund.refund_status === 'owed' && !overLimit && totals.total > 0;
  const reasonLength = [...reason.trim()].length;
  const invLabel = `INV-${invoice.invoice_number}`;

  const issue = async () => {
    setTried(true); setError('');
    if (problems.length) { showProblems(); return; }
    if (emailIt && !looksLikeEmail(emailTo)) { setError('Enter the email address to send it to, or untick Email it.'); showProblems(); return; }
    if (!confirm(`Issue a credit note for ${money(totals.total)} against ${invLabel}? It cannot be edited once issued.`)) return;
    setBusy(true);
    const trim = (v) => (typeof v === 'string' ? v.trim() : v);
    const p_lines = lines.map(l => ({
      invoice_line_id: l.invoice_line_id || null,
      name: String(l.name ?? '').trim(),
      description: String(l.description ?? '').trim() || null,
      // Sent as typed, so the database reads the exact figures the totals
      // above were worked out from.
      qty: trim(l.qty), unit_price: trim(l.unit_price), tax_rate: trim(l.tax_rate),
    }));
    const { data: note, error: err } = await supabase.rpc('issue_credit_note', {
      p_invoice_id: invoice.id, p_reason: reason.trim(), p_lines, p_issue_date: issueDate,
    });
    if (err || !note) { setBusy(false); setError(creditErrorText(err)); showProblems(); return; }
    // The credit note exists from here on. A failed email must not read as a
    // failed credit, so it is reported separately.
    let emailed = null, emailError = null;
    if (emailIt) {
      try { const d = await sendCreditNoteEmail(note.id, emailTo); emailed = d.to || emailTo.trim(); }
      catch (e) { emailError = e.message; }
    }
    setBusy(false);
    onIssued?.(note, { emailed, emailError });
  };

  const footer = (
    <>
      <button type="button" onClick={onClose} disabled={busy} className="btn-ghost px-4 py-2 rounded-xl text-sm disabled:opacity-50">Cancel</button>
      <button type="button" onClick={issue} disabled={busy}
        className="btn-glass ml-auto px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50">
        {busy ? 'Issuing…' : `Issue credit note ${money(totals.total)}`}
      </button>
    </>
  );

  return (
    <Sheet wide keepOpen title={`Credit note for ${invLabel}`} busy={busy} onClose={onClose} footer={footer}
      sub={`Invoice total ${money(invoice.total)}${Number(invoice.amount_credited) > 0 ? ` · already credited ${money(invoice.amount_credited)}` : ''}${paid > 0 ? ` · paid ${money(paid)}` : ''}`}>

      {/* Lines */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={lbl + ' !mb-0'}>What to credit</span>
          <button type="button" onClick={() => { setLines(fresh()); setError(''); }}
            className="ml-auto text-xs text-ember hover:text-ember-deep font-medium flex items-center gap-1">
            <RotateCcw size={12} /> Credit the whole invoice
          </button>
        </div>

        {lines.length === 0 && (
          <div className="glass-inner rounded-xl px-3 py-4 text-xs text-dim italic text-center">
            No lines. Add a line, or credit the whole invoice.
          </div>
        )}

        {lines.map((l, i) => {
          const src = sourceOf(l);
          const rates = taxRatesFor({ line: l, invoiceLines, invoice });
          const rateOptions = rates.some(r => Number(r) === Number(l.tax_rate)) ? rates : [...rates, Number(l.tax_rate) || 0];
          const moreThanInvoice = aboveInvoice(l);
          return (
            <div key={l._key} className="glass-inner rounded-xl p-3 space-y-2">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  {src ? (
                    <>
                      <div className="text-sm font-medium text-paper break-words">{l.name}</div>
                      {l.description && <div className="text-xs text-muted break-words">{l.description}</div>}
                    </>
                  ) : (
                    <div className="space-y-1.5">
                      <input className={field} value={l.name} onChange={e => setLine(l._key, 'name', e.target.value)}
                        placeholder="What it is for, e.g. Goodwill credit" aria-label={`Line ${i + 1} name`} />
                      <input className={field + ' text-xs'} value={l.description || ''} onChange={e => setLine(l._key, 'description', e.target.value)}
                        placeholder="Description (optional)" aria-label={`Line ${i + 1} description`} />
                    </div>
                  )}
                </div>
                <button type="button" onClick={() => removeLine(l._key)} title="Remove this line" aria-label={`Remove line ${i + 1}`}
                  className="text-red-500 hover:text-red-600 text-lg leading-none shrink-0 px-1">&times;</button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="block min-w-0"><span className="text-[9px] text-muted block mb-0.5">Qty</span>
                  <input type="number" inputMode="decimal" min="0" step="any" className={field} value={l.qty}
                    onChange={e => setLine(l._key, 'qty', e.target.value)} /></label>
                <label className="block min-w-0"><span className="text-[9px] text-muted block mb-0.5">Unit £ (ex VAT)</span>
                  <input type="number" inputMode="decimal" min="0" step="any" className={field} value={l.unit_price}
                    onChange={e => setLine(l._key, 'unit_price', e.target.value)} placeholder="0.00" /></label>
                <label className="block min-w-0"><span className="text-[9px] text-muted block mb-0.5">VAT</span>
                  <select className={field} value={String(Number(l.tax_rate) || 0)}
                    onChange={e => setLine(l._key, 'tax_rate', Number(e.target.value))}>
                    {rateOptions.map(r => <option key={r} value={String(r)}>{rateText(r)}</option>)}
                  </select></label>
              </div>
              <div className="flex items-center gap-2 flex-wrap text-xs text-muted">
                {src && <span className="text-dim">On the invoice: {Number(src.qty) || 0} × {money(src.unit_price)} at {rateText(src.tax_rate)}{lineCreditLeft(src, creditedLines) < lineNet(src) ? `, ${money(lineCreditLeft(src, creditedLines))} left to credit before VAT` : ''}</span>}
                <span className="ml-auto">
                  Net <span className="text-paper font-mono font-semibold">{money(lineNet(l))}</span>
                  <span className="mx-1.5 text-dim">·</span>
                  VAT <span className="text-paper font-mono font-semibold">{money(lineTax(l))}</span>
                </span>
              </div>
              {moreThanInvoice && <div className="text-[11px] text-red-600">This is more than this line on the invoice. Lower the quantity or price.</div>}
            </div>
          );
        })}

        <button type="button" onClick={addLine} className="text-xs text-ember hover:text-ember-deep font-medium flex items-center gap-1">
          <Plus size={13} /> Add a line
        </button>
      </div>

      {/* Totals */}
      <div className="glass-inner rounded-xl p-3 space-y-1.5 text-sm">
        <div className="flex justify-between text-muted"><span>Subtotal</span><span className="tabular-nums">{money(totals.subtotal)}</span></div>
        <div className="flex justify-between text-muted"><span>VAT</span><span className="tabular-nums">{money(totals.tax_amount)}</span></div>
        <div className="flex justify-between font-bold text-paper pt-1.5 border-t border-bdr"><span>Credit total</span><span className="tabular-nums">{money(totals.total)}</span></div>
        <div className="flex justify-between text-muted"><span>Left to credit on {invLabel}</span><span className="tabular-nums">{money(left)}</span></div>
        <div className={`flex justify-between ${overLimit ? 'text-red-600 font-semibold' : 'text-muted'}`}>
          <span>Left after this credit</span><span className="tabular-nums">{overLimit ? 'Over the limit' : money(Math.max(0, round2(left - totals.total)))}</span>
        </div>
        {overLimit && <div className="text-xs text-red-600">This credit is more than is left on the invoice. Lower a quantity or price, or remove a line.</div>}
        {refundShown && (
          <div className="text-xs text-amber-deep bg-amber/10 border border-amber/30 rounded-lg px-2.5 py-2 mt-1">
            {money(paid)} has already been paid, so {money(refund.refund_due)} will be owed back to the customer. Use Mark refunded once it has been paid back.
          </div>
        )}
      </div>

      {/* Reason */}
      <div>
        <label className={lbl} htmlFor="cn-reason">Reason (the customer sees this)</label>
        <textarea id="cn-reason" className={field + ' resize-none'} rows={3} maxLength={REASON_MAX + 50} value={reason}
          onChange={e => setReason(e.target.value)} placeholder="e.g. Card reader returned unused" />
        <div className={`text-[10px] text-right mt-0.5 ${reasonLength > REASON_MAX ? 'text-red-600' : 'text-dim'}`}>{reasonLength}/{REASON_MAX}</div>
      </div>

      {/* Email */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-2 text-sm text-paper cursor-pointer">
          <input type="checkbox" checked={emailIt} onChange={e => setEmailIt(e.target.checked)} className="w-4 h-4 accent-emerald-600" />
          {looksLikeEmail(emailTo) ? `Email it to ${emailTo.trim()}` : 'Email it to the customer'}
        </label>
        {emailIt && (
          <input type="email" inputMode="email" autoComplete="email" className={field} value={emailTo}
            onChange={e => setEmailTo(e.target.value)} placeholder="name@example.com" aria-label="Send the credit note to" />
        )}
      </div>

      <div ref={problemsRef} className="space-y-2 empty:hidden">
        {tried && <Problems list={problems} />}
        {error && <Problems list={[error]} />}
      </div>
    </Sheet>
  );
}

// ── Mark refunded ───────────────────────────────────────────────────────────

/** Records a refund paid outside the app. Nothing is sent to Stripe. */
export function RefundCreditModal({ note, onClose, onDone }) {
  const [method, setMethod] = useState(REFUND_METHODS[0]);
  const [on, setOn] = useState(localToday());
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setError('');
    if (!on) { setError('Pick the date it was refunded.'); return; }
    if ([...text.trim()].length > 500) { setError('Keep the refund note to 500 characters or fewer.'); return; }
    setBusy(true);
    const { data, error: err } = await supabase.rpc('mark_credit_note_refunded', {
      p_id: note.id, p_method: method, p_note: text.trim() || null, p_refunded_on: on,
    });
    setBusy(false);
    if (err) { setError(creditErrorText(err)); return; }
    onDone?.(data);
  };

  return (
    <Sheet title={`Mark ${creditNoteLabel(note)} refunded`} sub={`Refund owed: ${money(note.refund_due)}`} busy={busy} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} className="btn-ghost px-4 py-2 rounded-xl text-sm disabled:opacity-50">Cancel</button>
        <button type="button" onClick={save} disabled={busy} className="btn-glass ml-auto px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50">{busy ? 'Saving…' : 'Mark refunded'}</button>
      </>}>
      <div className="text-xs text-muted">Record a refund you have already paid back, by bank transfer or on the card machine. This does not move any money.</div>
      <div>
        <label className={lbl} htmlFor="cn-method">How it was refunded</label>
        <select id="cn-method" className={field} value={method} onChange={e => setMethod(e.target.value)}>
          {REFUND_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <div>
        <label className={lbl} htmlFor="cn-on">Date refunded</label>
        <input id="cn-on" type="date" className={field} value={on} max={localToday()} onChange={e => setOn(e.target.value)} />
      </div>
      <div>
        <label className={lbl} htmlFor="cn-note">Note (optional)</label>
        <textarea id="cn-note" className={field + ' resize-none'} rows={2} value={text} onChange={e => setText(e.target.value)} placeholder="e.g. Bank reference" />
      </div>
      {error && <Problems list={[error]} />}
    </Sheet>
  );
}

// ── Cancel ──────────────────────────────────────────────────────────────────

/** Owner only (the database checks too). The note keeps its number and stays
 *  on the invoice, struck through, and stops reducing what the invoice asks for.
 *  invoice and notes (all its credit notes) let the sheet say, before anyone
 *  presses Cancel, what else changes, by the rules cancel_credit_note applies. */
export function CancelCreditModal({ note, invoice, notes = [], onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const length = [...reason.trim()].length;
  const effect = invoice ? cancelCreditEffect({ invoice, notes, noteId: note.id }) : { problem: null, refunds: [] };

  const save = async () => {
    setError('');
    if (length < 3 || length > REASON_MAX) { setError(`Give a reason of 3 to ${REASON_MAX} characters.`); return; }
    setBusy(true);
    const { data, error: err } = await supabase.rpc('cancel_credit_note', { p_id: note.id, p_reason: reason.trim() });
    setBusy(false);
    if (err) { setError(creditErrorText(err)); return; }
    onDone?.(data);
  };

  return (
    <Sheet title={`Cancel ${creditNoteLabel(note)}?`} sub={`Credit of ${money(note.total)}`} busy={busy} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} className="btn-ghost px-4 py-2 rounded-xl text-sm disabled:opacity-50">Keep it</button>
        <button type="button" onClick={save} disabled={busy || !!effect.problem}
          className="ml-auto px-4 py-2 rounded-xl text-sm font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 disabled:opacity-50">{busy ? 'Cancelling…' : 'Cancel credit note'}</button>
      </>}>
      <ul className="text-sm text-muted list-disc pl-4 space-y-1">
        <li>It keeps its number and stays on the invoice, struck through.</li>
        <li>It no longer reduces the invoice by {money(note.total)}.</li>
        {note.refund_status === 'owed' && <li>The refund owed on it ({money(note.refund_due)}) is cleared.</li>}
        {(effect.refunds || []).map(r => (
          <li key={r.id}>{r.refund_due > 0
            ? `The refund owed on ${creditNoteLabel(notes.find(c => c.id === r.id))} drops to ${money(r.refund_due)}.`
            : `${creditNoteLabel(notes.find(c => c.id === r.id))} no longer owes a refund.`}</li>
        ))}
        {effect.reopen && (
          <li className="text-amber-deep font-semibold">INV-{invoice.invoice_number} was paid for what was left after this credit, so it goes back to Sent with {money(effect.balance_due)} to pay.</li>
        )}
        <li>This cannot be undone. Raise a new credit note if you need one again.</li>
      </ul>
      {effect.problem && <Problems list={[effect.problem]} />}
      <div>
        <label className={lbl} htmlFor="cn-cancel">Reason for cancelling</label>
        <textarea id="cn-cancel" className={field + ' resize-none'} rows={3} value={reason} onChange={e => setReason(e.target.value)}
          placeholder="e.g. Raised against the wrong invoice" />
        <div className={`text-[10px] text-right mt-0.5 ${length > REASON_MAX ? 'text-red-600' : 'text-dim'}`}>{length}/{REASON_MAX}</div>
      </div>
      {error && <Problems list={[error]} />}
    </Sheet>
  );
}
