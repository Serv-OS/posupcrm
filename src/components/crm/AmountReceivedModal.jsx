import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { round2 } from '../../lib/money';
import { money } from './InvoicesPanel.jsx';
import { Sheet, Problems, creditErrorText } from './CreditNoteModal.jsx';
import {
  PAYMENT_REASON, REASON_MAX, amountPaid, amountReceivedEffect, balanceDue, canRaiseCredit, creditAvailable, creditNoteLabel,
  creditableLeft, markPaymentTotal, overpaidAdvice,
} from '../../lib/creditNotes';

/* The amount received on an invoice: the cash the customer has actually paid.
 *
 * One sheet, two ways in:
 *   correction  Change on the Amount received row: "How much has the customer
 *               paid in total on this invoice?" A reason is required.
 *   payment     Mark paid: "How much did they pay?" This payment is added to
 *               the cash already received (markPaymentTotal). The reason may be
 *               left blank and is then "Payment received".
 * Both go through set_invoice_amount_received (migration 112), which moves any
 * overpayment onto or off the invoice's credit notes. amountReceivedEffect
 * makes the same checks with the same words, so the sheet shows what will
 * happen, and any problem, before anyone saves. Card payments still go through
 * record_invoice_payment and never open this sheet.
 *
 * The call carries p_expected_from, the amount received this sheet worked
 * from. A card payment or a colleague's payment that lands in the moment
 * between the last read and the save is refused by the database rather than
 * swallowed, and the sheet reads the invoice again. A payment on an invoice
 * that is already paid, or has nothing left to pay, is refused too (the same
 * bank transfer recorded twice); Change corrects those. */

// 16px on a phone: iPhone Safari zooms the page in on any field under 16px.
const field = 'w-full r-field !text-[16px] sm:!text-sm disabled:opacity-60';
const lbl = 'text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-muted mb-1 block';
// The question itself is a sentence, so it reads as one rather than as a code.
const question = 'text-sm font-semibold text-paper mb-1.5 block';

// "1344", "£1,344.00" and " 1 344 " all read as the number typed.
const cleanAmount = (v) => String(v ?? '').replace(/[£,\s]/g, '');
const invLabel = (i) => (i?.invoice_number != null ? `INV-${i.invoice_number}` : 'The invoice');

/** The database raises plain sentences, shown as they come. A database without
 *  the function yet gets words a person can act on. */
export function receivedErrorText(error) {
  const msg = error?.message || '';
  if (error?.code === 'PGRST202' || /could not find the function/i.test(msg)) {
    return 'Recording what the customer paid needs a database update that has not been applied yet.';
  }
  return creditErrorText(error);
}

/**
 * An invoice's payment history, oldest first, each row with `who` (a name or
 * email). Resolves to { ready, rows }; ready is false when the history table
 * is not there yet (the migration not applied), and then Change is not offered.
 */
export async function loadPaymentHistory(invoiceId) {
  const h = await supabase.from('invoice_payment_adjustments').select('*').eq('invoice_id', invoiceId).order('created_at');
  if (h.error) return { ready: false, rows: [] };
  const rows = [...(h.data || [])].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const ids = [...new Set(rows.map(r => r.created_by).filter(Boolean))];
  const p = ids.length ? await supabase.from('profiles').select('id, display_name, email').in('id', ids) : { data: [] };
  const names = new Map((p.data || []).map(x => [x.id, x.display_name || x.email || '']));
  return { ready: true, rows: rows.map(r => ({ ...r, who: names.get(r.created_by) || '' })) };
}

// The money fields a payment is added to. If any of them moved while the sheet
// was open, the figures are read again before anything is saved.
const moneyKey = (inv) => [inv?.amount_paid, inv?.total, inv?.amount_credited, inv?.amount_allocated, inv?.status === 'paid']
  .map(v => (v == null ? '' : String(v))).join('|');

// The figures the sheet works from, read fresh: the invoice, its credit notes
// and the credit applied from those notes (active rows only, as the database
// sums them). Resolves to { invoice, notes, allocations } or { error }.
async function loadBasis(invoiceId) {
  const [i, cn] = await Promise.all([
    supabase.from('invoices').select('*').eq('id', invoiceId).single(),
    supabase.from('credit_notes').select('*').eq('invoice_id', invoiceId).order('credit_number'),
  ]);
  if (i.error || !i.data) return { error: i.error || { message: 'Invoice not found.' } };
  const notes = cn.error ? [] : (cn.data || []);
  let allocations;
  if (notes.length) {
    const a = await supabase.from('credit_allocations').select('id, credit_note_id, invoice_id, amount, removed_at')
      .in('credit_note_id', notes.map(c => c.id));
    // No table yet: each note's own amount_allocated is used instead.
    if (!a.error) allocations = (a.data || []).filter(r => !r.removed_at);
  }
  // The money fields as read, kept as text so nothing can change them later.
  return { invoice: i.data, notes, allocations, key: moneyKey(i.data) };
}

/**
 * invoiceId  the invoice (sent, viewed or paid)
 * mode       'correction' (Change) or 'payment' (Mark paid)
 * onDone(result, { mode, payment })  result is what the database returned:
 *            { status, amount_paid, balance_due, overpaid, credit_moved, not_on_a_credit_note }
 */
export default function AmountReceivedModal({ invoiceId, mode = 'correction', onClose, onDone }) {
  const payment = mode === 'payment';
  const [basis, setBasis] = useState(null);   // { invoice, notes, allocations } or { error }
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const problemsRef = useRef(null);
  const amountRef = useRef(null);
  // On a phone the Save button is pinned below the form, so a refused tap
  // scrolls the reason into view: the amount's own problem, or the list at the end.
  const showProblems = (ref = problemsRef) => requestAnimationFrame(() => ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));

  const reload = useCallback(async () => {
    const b = await loadBasis(invoiceId);
    setBasis(b);
    return b;
  }, [invoiceId]);

  // Change starts at what is recorded now; Mark paid at what is left to pay.
  const startAt = useCallback((b) => {
    const start = payment ? balanceDue(b.invoice) : amountPaid(b.invoice);
    setAmount(payment && start <= 0 ? '' : start.toFixed(2));
  }, [payment]);

  useEffect(() => {
    let live = true;
    loadBasis(invoiceId).then((b) => {
      if (!live) return;
      setBasis(b);
      if (!b.error) startAt(b);
    });
    return () => { live = false; };
  }, [invoiceId, startAt]);

  const ready = basis && !basis.error;
  const inv = ready ? basis.invoice : null;
  const typed = cleanAmount(amount);
  // What the database is sent: the TOTAL cash received afterwards.
  const total = !ready ? null : payment ? markPaymentTotal(inv, typed) : typed;
  const args = ready ? { invoice: inv, notes: basis.notes, allocationsFromNotes: basis.allocations, amount: total, kind: mode } : null;
  // The preview leaves the reason out, so it shows as soon as the amount works.
  const preview = ready ? amountReceivedEffect(args) : null;
  const effect = ready ? amountReceivedEffect({ ...args, reason }) : null;
  const reasonLength = [...reason.trim()].length;
  const thisPayment = preview && !preview.problem ? round2(preview.amount_paid - preview.from_amount) : 0;
  const name = invLabel(inv);
  // Mark paid on an invoice someone has just paid (or that has nothing left to
  // pay): say so straight away rather than wait for an amount.
  const nothingToPay = payment && ready && (inv.status === 'paid' || balanceDue(inv) <= 0);

  // An amount problem shows once the amount has been changed (Change starts on
  // the amount already recorded, which is not something to save) or Save pressed.
  const amountProblem = preview?.problem && (touched || tried || nothingToPay) ? preview.problem : null;
  const reasonProblem = tried && effect?.problem && !preview?.problem ? effect.problem : null;

  const save = async () => {
    setTried(true); setError('');
    if (!ready) return;
    if (effect.problem) { showProblems(preview.problem ? amountRef : problemsRef); return; }
    setBusy(true);
    // A card payment, credit applied or a colleague's change while this was
    // open would make the total below wrong, so the figures are checked first.
    const now = await supabase.from('invoices').select('*').eq('id', invoiceId).single();
    if (now.error || !now.data || moneyKey(now.data) !== basis.key) {
      const b = await reload();
      // An amount nobody typed was only the starting figure, so it starts again from the new one.
      if (!b.error && !touched) startAt(b);
      setBusy(false);
      setError(now.error ? receivedErrorText(now.error) : `${name} changed while this was open, so its figures have been read again. Check them and save again.`);
      showProblems();
      return;
    }
    const { data, error: err } = await supabase.rpc('set_invoice_amount_received', {
      p_invoice_id: invoiceId,
      // A payment is sent as the exact total worked out above; a correction as
      // typed (less any £ or commas), so the database checks the same figure.
      p_amount: total,
      p_reason: reason.trim(),
      p_kind: mode,
      // The amount received the total above was worked out from: if a card
      // payment lands in the moment before this arrives, nothing is written.
      p_expected_from: effect.from_amount,
    });
    setBusy(false);
    if (err || !data) {
      setError(receivedErrorText(err));
      showProblems();
      // What was on screen may be out of date (a payment that landed just
      // before), so it is read again; an amount nobody typed starts again too.
      const b = await reload();
      if (!b.error && !touched) startAt(b);
      return;
    }
    onDone?.(data, { mode, payment: thisPayment });
  };

  const credited = Number(inv?.amount_credited) > 0;
  const applied = Number(inv?.amount_allocated) || 0;
  const asks = inv ? creditableLeft(inv) : 0;
  // The total to the penny by the library's rounding rule, as the database rounds it.
  const invoiceTotal = inv ? creditableLeft({ total: inv.total }) : 0;

  const title = payment ? `Record a payment on ${name}` : `Amount received on ${name}`;
  const sub = !inv ? '' : [
    `Total ${money(inv.total)}`,
    credited ? `credit notes ${money(inv.amount_credited)}` : null,
    applied > 0 ? `credit applied ${money(applied)}` : null,
    `received ${money(amountPaid(inv))}`,
  ].filter(Boolean).join(' · ');

  const footer = (
    <>
      <button type="button" onClick={onClose} disabled={busy} className="btn-ghost px-4 py-2 rounded-xl text-sm disabled:opacity-50">Cancel</button>
      <button type="button" onClick={save} disabled={busy || !ready}
        className="btn-glass ml-auto px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50">
        {busy ? 'Saving…' : payment ? (thisPayment > 0 ? `Record ${money(thisPayment)}` : 'Record payment') : 'Save amount received'}
      </button>
    </>
  );

  // What happens to each credit note whose credit to use changes.
  const moveText = (m) => {
    const note = basis.notes.find(c => c.id === m.id);
    const before = note ? creditAvailable(note) : 0;
    const after = Number(m.credit_available) || 0;
    const label = creditNoteLabel(note || m);
    if (after > before) return { tone: 'amber', text: `${money(round2(after - before))} becomes credit on ${label} to use on another invoice.` };
    if (after > 0) return { tone: 'muted', text: `The credit to use on ${label} drops to ${money(after)}.` };
    return { tone: 'muted', text: `${label} no longer has credit to use.` };
  };

  return (
    <Sheet keepOpen title={title} sub={sub} busy={busy} onClose={onClose} footer={footer}>
      {!basis && <div className="text-xs text-dim italic">Reading the invoice…</div>}
      {basis?.error && <Problems list={[receivedErrorText(basis.error)]} />}

      {ready && (
        <>
          <div className="text-xs text-muted">
            {payment
              ? 'Record money that came in outside the card payment link, such as a bank transfer. It is added to what has already been received.'
              : 'Put right what has been recorded as received. Enter the total the customer has paid on this invoice, not the difference.'}
          </div>

          <div>
            <label className={question} htmlFor="received-amount">{payment ? 'How much did they pay?' : 'How much has the customer paid in total on this invoice?'}</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted">£</span>
              <input id="received-amount" type="text" inputMode="decimal" autoComplete="off" className={field} value={amount}
                disabled={busy} onChange={e => { setAmount(e.target.value); setTouched(true); }} placeholder="0.00" />
            </div>
            {payment ? (
              <div className="text-[11px] text-dim mt-1">
                {amountPaid(inv) > 0 ? `${money(amountPaid(inv))} already received. ` : ''}{money(balanceDue(inv))} is left to pay.
              </div>
            ) : (
              // One tap for the two totals people most often mean.
              <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                <span className="text-[11px] text-dim">Fill in:</span>
                <button type="button" disabled={busy} onClick={() => { setAmount(invoiceTotal.toFixed(2)); setTouched(true); }}
                  className="btn-ghost px-2.5 py-1.5 rounded-lg text-xs disabled:opacity-50">Invoice total {money(invoiceTotal)}</button>
                {credited && asks !== invoiceTotal && (
                  <button type="button" disabled={busy} onClick={() => { setAmount(asks.toFixed(2)); setTouched(true); }}
                    className="btn-ghost px-2.5 py-1.5 rounded-lg text-xs disabled:opacity-50">After credit notes {money(asks)}</button>
                )}
              </div>
            )}
          </div>

          <div ref={amountRef} className="empty:hidden">{amountProblem && <Problems list={[amountProblem]} />}</div>

          {preview && !preview.problem && (
            <div className="glass-inner rounded-xl p-3 space-y-1.5 text-sm">
              {payment ? (
                <>
                  <div className="flex justify-between gap-3 text-muted"><span>Left to pay now</span><span className="tabular-nums">{money(balanceDue(inv))}</span></div>
                  <div className="flex justify-between gap-3 text-emerald-700 font-semibold"><span>This payment</span><span className="tabular-nums">-{money(thisPayment)}</span></div>
                </>
              ) : (
                <>
                  <div className="flex justify-between gap-3 text-muted"><span>Recorded now</span><span className="tabular-nums">{money(preview.from_amount)}</span></div>
                  <div className="flex justify-between gap-3 text-emerald-700 font-semibold"><span>Amount received after</span><span className="tabular-nums">{money(preview.amount_paid)}</span></div>
                  {(credited || applied > 0) && (
                    <div className="flex justify-between gap-3 text-muted"><span>{credited ? 'Total less credit notes' : 'Total'}</span><span className="tabular-nums">{money(asks)}</span></div>
                  )}
                  {applied > 0 && <div className="flex justify-between gap-3 text-purple-700"><span>Credit applied to it</span><span className="tabular-nums">-{money(applied)}</span></div>}
                </>
              )}
              <div className="flex justify-between gap-3 font-bold text-paper pt-1.5 border-t border-bdr"><span>Balance after</span><span className="tabular-nums">{money(preview.balance_due)}</span></div>
              {payment && <div className="flex justify-between gap-3 text-xs text-muted"><span>Amount received in total</span><span className="tabular-nums">{money(preview.amount_paid)}</span></div>}
              {preview.overpaid > 0 && (
                <div className="flex justify-between text-amber-deep font-semibold"><span>Paid more than it asks for</span><span className="tabular-nums">{money(preview.overpaid)}</span></div>
              )}
              <ul className="text-xs space-y-1 pt-1">
                {preview.status === 'paid'
                  ? <li className="text-emerald-700">{inv.status === 'paid' ? `${name} stays paid.` : `${name} is then marked paid.`}</li>
                  : inv.status === 'paid'
                    ? <li className="text-amber-deep font-semibold">{name} goes back to Sent with {money(preview.balance_due)} to pay.</li>
                    : <li className="text-muted">{name} then has {money(preview.balance_due)} left to pay.</li>}
                {preview.credit_moved.map(m => {
                  const t = moveText(m);
                  return <li key={m.id || m.credit_number} className={t.tone === 'amber' ? 'text-amber-deep' : 'text-muted'}>{t.text}</li>;
                })}
                {preview.not_on_a_credit_note > 0 && (
                  <li className="text-amber-deep font-semibold">
                    Overpaid {money(preview.not_on_a_credit_note)}. {overpaidAdvice({
                      invoice: { ...inv, amount_paid: preview.amount_paid, status: preview.status },
                      overpaid: preview.not_on_a_credit_note,
                      canCredit: canRaiseCredit(inv),
                    })}
                  </li>
                )}
              </ul>
            </div>
          )}

          <div>
            <label className={lbl} htmlFor="received-reason">{payment ? 'Note (optional)' : 'Reason'}</label>
            <textarea id="received-reason" className={field + ' resize-none'} rows={payment ? 2 : 3} value={reason} disabled={busy}
              onChange={e => setReason(e.target.value)}
              placeholder={payment ? PAYMENT_REASON : 'e.g. Customer paid the full £1,344.00 by bank transfer'} />
            <div className={`text-[10px] text-right mt-0.5 ${reasonLength > REASON_MAX ? 'text-red-600' : 'text-dim'}`}>
              {payment && reasonLength === 0 ? `Saved as "${PAYMENT_REASON}"` : `${reasonLength}/${REASON_MAX}`}
            </div>
          </div>
        </>
      )}

      <div ref={problemsRef} className="space-y-2 empty:hidden">
        {reasonProblem && <Problems list={[reasonProblem]} />}
        {error && <Problems list={[error]} />}
      </div>
    </Sheet>
  );
}
