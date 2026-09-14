import { useCallback, useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { money } from './InvoicesPanel.jsx';
import { Sheet, Problems, creditErrorText } from './CreditNoteModal.jsx';
import {
  ALLOCATABLE_STATUSES, ALLOCATION_NOTE_MAX, REASON_MAX, REASON_MIN, allocationDefault, allocationEffect, allocationProblems,
  balanceDue, creditAvailable, creditNoteLabel, creditUse, removeAllocationEffect,
} from '../../lib/creditNotes';

/* Applying credit from a credit note to another invoice, and taking it off
 * again. A credit note on a paid invoice leaves credit available (money the
 * customer overpaid once the credit came off). The customer can have that
 * refunded, or use it on another invoice and pay that much less. Applying it
 * is a settlement, not a payment: the invoice's cash and revenue stay as they
 * were, only its balance due comes down.
 *
 * allocate_credit and remove_credit_allocation (migration 111) make the real
 * checks. src/lib/creditNotes.js makes the same checks with the same words,
 * so the screens below show a problem, and what will change, before anyone
 * presses the button. */

// 16px on a phone: iPhone Safari zooms the page in on any field under 16px.
const field = 'w-full r-field !text-[16px] sm:!text-sm disabled:opacity-60';
const lbl = 'text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-muted mb-1 block';

const dayOf = (d) => {
  if (!d) return '';
  const date = new Date(String(d).length <= 10 ? `${d}T00:00:00` : d);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
const invLabel = (i) => (i?.invoice_number != null ? `INV-${i.invoice_number}` : 'the invoice');
const partyOf = (x) => [x?.company?.name, x?.location?.name].filter(Boolean).join(' · ');
const byCreated = (a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''));

/** The allocation functions raise plain sentences, shown as they come. A
 *  database without them yet gets words a person can act on. */
export function allocationErrorText(error) {
  const msg = error?.message || '';
  if (error?.code === 'PGRST202' || /could not find the function/i.test(msg)) {
    return 'Applying credit is not switched on yet. The database update has to be applied first.';
  }
  return creditErrorText(error);
}

/** Same customer: the same company, or with no company on the fixed side, the same contact. */
export const sameCustomer = (a, b) => {
  if (!a || !b) return false;
  if (a.company_id) return a.company_id === b.company_id;
  if (a.contact_id) return a.contact_id === b.contact_id;
  return false;
};

/**
 * The credit applied to one invoice and from its credit notes, read fresh,
 * with the numbers to show beside each row. Resolves to
 *   { ready, into, from }
 * ready  false when the credit_allocations table is not there yet (the
 *        migration not applied), and then nothing about applied credit shows
 * into   rows applied TO this invoice, each with credit_note { id,
 *        credit_number, invoice_id, company_id } and source_invoice { id,
 *        invoice_number }
 * from   rows applied FROM noteIds (this invoice's credit notes), each with
 *        invoice { id, invoice_number, company_id, status }
 * Removed rows are included (they stay on record); oldest first.
 */
export async function loadInvoiceAllocations(invoiceId, noteIds = []) {
  const none = { data: [], error: null };
  const [a, b] = await Promise.all([
    supabase.from('credit_allocations').select('*').eq('invoice_id', invoiceId).order('created_at'),
    noteIds.length ? supabase.from('credit_allocations').select('*').in('credit_note_id', noteIds).order('created_at') : Promise.resolve(none),
  ]);
  if (a.error) return { ready: false, into: [], from: [] };
  const into = [...(a.data || [])].sort(byCreated);
  const from = [...(b.error ? [] : (b.data || []))].sort(byCreated);

  const noteIdsNeeded = [...new Set(into.map(r => r.credit_note_id))];
  const n = noteIdsNeeded.length
    ? await supabase.from('credit_notes').select('id, credit_number, invoice_id, company_id').in('id', noteIdsNeeded)
    : none;
  const notes = new Map((n.data || []).map(x => [x.id, x]));
  const invIds = [...new Set([...from.map(r => r.invoice_id), ...(n.data || []).map(x => x.invoice_id)])];
  const i = invIds.length
    ? await supabase.from('invoices').select('id, invoice_number, company_id, status').in('id', invIds)
    : none;
  const invoices = new Map((i.data || []).map(x => [x.id, x]));

  return {
    ready: true,
    into: into.map(r => {
      const note = notes.get(r.credit_note_id) || null;
      return { ...r, credit_note: note, source_invoice: note ? invoices.get(note.invoice_id) || null : null };
    }),
    from: from.map(r => ({ ...r, invoice: invoices.get(r.invoice_id) || null })),
  };
}

/** Every issued credit note with credit available, any customer, newest last.
 *  [] when the columns are not there yet. */
export async function loadCreditToUse() {
  const r = await supabase.from('credit_notes')
    .select('id, credit_number, invoice_id, company_id, contact_id, status, refund_status, refund_due, amount_allocated, refunded_amount')
    .eq('status', 'issued').eq('refund_status', 'owed').order('credit_number');
  if (r.error) return [];
  return (r.data || []).filter(c => creditAvailable(c) > 0);
}

// "224", "£224.00" and "1,000" all read as the number typed.
const cleanAmount = (v) => String(v ?? '').replace(/[£,\s]/g, '');

// ── Apply credit ────────────────────────────────────────────────────────────

/**
 * The apply screen, from either side.
 *   note     a credit note with credit available: pick the invoice it goes to
 *   invoice  an unpaid invoice: pick the credit note to use
 * Pass exactly one. The candidates are the SAME customer's by default; "Show
 * other customers" lists the rest, each saying it is for a different customer
 * (a group like Coffee Boy spans several companies). The amount starts at the
 * credit available or the balance due, whichever is less, and can be lowered.
 *   preselectId  a candidate to start on (the banner's one credit note)
 *   onApplied(allocation, { note, invoice, effect })
 */
export default function ApplyCreditModal({ note: startNote = null, invoice: startInvoice = null, preselectId = null, onClose, onApplied }) {
  const fromNote = !!startNote;
  const [note, setNote] = useState(startNote);
  const [invoice, setInvoice] = useState(startInvoice);
  const [candidates, setCandidates] = useState(null);   // null while loading
  const [sourceNumbers, setSourceNumbers] = useState({}); // invoice id -> number, for the credit notes listed
  const [loadError, setLoadError] = useState('');
  const [others, setOthers] = useState(false);
  const [pickedId, setPickedId] = useState(null);
  const [amount, setAmount] = useState('');
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const problemsRef = useRef(null);
  const showProblems = () => requestAnimationFrame(() => problemsRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  const startId = startNote?.id ?? startInvoice?.id;

  const load = useCallback(async () => {
    setLoadError('');
    if (fromNote) {
      const [n, inv] = await Promise.all([
        supabase.from('credit_notes').select('*').eq('id', startId).single(),
        supabase.from('invoices').select('*, company:companies(name), location:locations(name)')
          .in('status', ALLOCATABLE_STATUSES).order('due_date'),
      ]);
      const err = n.error || inv.error;
      if (err || !n.data) { setLoadError(allocationErrorText(err || { message: 'Credit note not found.' })); setCandidates([]); return null; }
      setNote(p => ({ ...p, ...n.data }));
      const list = (inv.data || []).filter(i => ALLOCATABLE_STATUSES.includes(i.status) && i.id !== n.data.invoice_id && balanceDue(i) > 0);
      setCandidates(list);
      return { fixed: n.data, list };
    }
    const [i, cn] = await Promise.all([
      supabase.from('invoices').select('*').eq('id', startId).single(),
      supabase.from('credit_notes').select('*, invoice:invoices(invoice_number), company:companies(name), location:locations(name)')
        .eq('status', 'issued').eq('refund_status', 'owed').order('credit_number'),
    ]);
    const err = i.error || cn.error;
    if (err || !i.data) { setLoadError(allocationErrorText(err || { message: 'Invoice not found.' })); setCandidates([]); return null; }
    setInvoice(p => ({ ...p, ...i.data }));
    const list = (cn.data || []).filter(c => c.status === 'issued' && c.invoice_id !== i.data.id && creditAvailable(c) > 0);
    // The invoice each note was raised on, when the join did not bring it.
    const missing = [...new Set(list.filter(c => c.invoice?.invoice_number == null).map(c => c.invoice_id))];
    if (missing.length) {
      const src = await supabase.from('invoices').select('id, invoice_number').in('id', missing);
      setSourceNumbers(Object.fromEntries((src.data || []).map(x => [x.id, x.invoice_number])));
    }
    setCandidates(list);
    return { fixed: i.data, list };
  }, [fromNote, startId]);

  const pairFor = useCallback((cand, fixed) => (fromNote
    ? { note: fixed ?? note, invoice: cand }
    : { note: cand, invoice: fixed ?? invoice }), [fromNote, note, invoice]);

  const pick = useCallback((cand, fixed) => {
    setPickedId(cand ? cand.id : null);
    setTouched(false); setError('');
    if (!cand) { setAmount(''); return; }
    const start = allocationDefault(pairFor(cand, fixed));
    setAmount(start > 0 ? start.toFixed(2) : '');
  }, [pairFor]);

  useEffect(() => {
    let live = true;
    load().then((got) => {
      if (!live || !got) return;
      const { fixed, list } = got;
      const own = list.filter(c => sameCustomer(fixed, c));
      const wanted = preselectId ? list.find(c => c.id === preselectId) : null;
      if (wanted) {
        if (!sameCustomer(fixed, wanted)) setOthers(true);
        pick(wanted, fixed);
      } else if (own.length === 1) {
        pick(own[0], fixed);
      }
    });
    return () => { live = false; };
    // Loaded once when the screen opens; after a refused apply load() runs again.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fixed = fromNote ? note : invoice;
  const all = candidates || [];
  const own = all.filter(c => sameCustomer(fixed, c));
  const otherCount = all.length - own.length;
  const shown = (others ? [...own, ...all.filter(c => !sameCustomer(fixed, c))] : own);
  const picked = all.find(c => c.id === pickedId) || null;
  const pair = picked ? pairFor(picked) : null;
  const typed = cleanAmount(amount);
  const problems = pair ? allocationProblems({ ...pair, amount: typed, allocationNote: text }) : [];
  const effect = pair && !problems.length ? allocationEffect({ ...pair, amount: typed, allocationNote: text }) : null;
  const noteLength = [...text.trim()].length;

  // The fixed side itself may have nothing to give or take any more.
  // Unticking hides the other customers' rows, so a pick among them is
  // cleared with them: Apply must never send credit to a row nobody can see.
  const toggleOthers = (show) => {
    setOthers(show);
    if (!show && picked && !sameCustomer(fixed, picked)) pick(null);
  };

  const fixedProblem = !fixed || candidates === null ? null
    : fromNote
      ? (fixed.status !== 'issued' ? 'This credit note is cancelled.' : creditAvailable(fixed) <= 0 ? 'There is no credit left to use on this credit note.' : null)
      : (!ALLOCATABLE_STATUSES.includes(fixed.status) ? 'Credit can only be applied to a sent or viewed invoice.' : balanceDue(fixed) <= 0 ? 'This invoice has nothing left to pay.' : null);

  const apply = async () => {
    setTouched(true); setError('');
    if (!pair) { setError(fromNote ? 'Pick the invoice to apply the credit to.' : 'Pick the credit note to use.'); showProblems(); return; }
    if (problems.length) { showProblems(); return; }
    setBusy(true);
    const { data, error: err } = await supabase.rpc('allocate_credit', {
      p_credit_note_id: pair.note.id,
      p_invoice_id: pair.invoice.id,
      // Sent as typed (less any £ or commas), so the database reads the exact figure checked above.
      p_amount: typed,
      p_note: text.trim() || null,
    });
    setBusy(false);
    if (err || !data) {
      setError(allocationErrorText(err));
      showProblems();
      // Someone may have used the credit, or paid the invoice, since this opened.
      load();
      return;
    }
    onApplied?.(data, { note: pair.note, invoice: pair.invoice, effect });
  };

  const title = fromNote ? `Apply ${creditNoteLabel(note)} to an invoice` : `Use credit on ${invLabel(invoice)}`;
  const sub = !fixed ? '' : fromNote
    ? `${money(creditAvailable(note))} credit available${note?.invoice?.invoice_number != null ? `, from INV-${note.invoice.invoice_number}` : ''}`
    : `${money(balanceDue(invoice))} left to pay${partyOf(invoice) ? ` · ${partyOf(invoice)}` : ''}`;

  const footer = (
    <>
      <button type="button" onClick={onClose} disabled={busy} className="btn-ghost px-4 py-2 rounded-xl text-sm disabled:opacity-50">Cancel</button>
      <button type="button" onClick={apply} disabled={busy || candidates === null || !!fixedProblem}
        className="btn-glass ml-auto px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50">
        {busy ? 'Applying…' : effect ? `Apply ${money(effect.amount)}` : 'Apply credit'}
      </button>
    </>
  );

  return (
    <Sheet wide keepOpen title={title} sub={sub} busy={busy} onClose={onClose} footer={footer}>
      <div className="text-xs text-muted">
        {fromNote
          ? 'The customer pays this much less on the invoice you pick. It is not a payment or new revenue: it moves credit they already have onto that invoice.'
          : 'The customer pays this much less on this invoice. It is not a payment or new revenue: it moves credit they already have onto it.'}
      </div>

      {loadError && <Problems list={[loadError]} />}
      {fixedProblem && <Problems list={[fixedProblem]} />}

      {/* Candidates */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={lbl + ' !mb-0'}>{fromNote ? 'Apply it to' : 'Use credit from'}</span>
          {candidates !== null && (otherCount > 0 || others) && (
            <label className="ml-auto flex items-center gap-2 text-xs text-paper cursor-pointer select-none py-1">
              <input type="checkbox" checked={others} disabled={busy} onChange={e => toggleOthers(e.target.checked)} className="w-4 h-4 accent-emerald-600" />
              Show other customers{otherCount > 0 ? ` (${otherCount})` : ''}
            </label>
          )}
        </div>

        {candidates === null && <div className="glass-inner rounded-xl px-3 py-4 text-xs text-dim italic text-center">{fromNote ? 'Loading invoices…' : 'Loading credit notes…'}</div>}
        {candidates !== null && !loadError && shown.length === 0 && (
          <div className="glass-inner rounded-xl px-3 py-4 text-xs text-dim italic text-center">
            {fromNote
              ? (others ? 'No other sent or viewed invoice has anything left to pay.' : 'This customer has no sent or viewed invoice with anything left to pay.')
              : (others ? 'No other credit note has credit available.' : 'This customer has no other credit note with credit available.')}
            {!others && otherCount > 0 && ' Tick Show other customers to see the rest.'}
          </div>
        )}

        <div role="radiogroup" aria-label={fromNote ? 'Invoice to apply the credit to' : 'Credit note to use'} className="space-y-2">
          {shown.map(c => {
            const on = c.id === pickedId;
            const different = !sameCustomer(fixed, c);
            const base = `w-full text-left rounded-xl border px-3 py-2.5 min-h-[48px] flex items-start gap-2.5 transition ${on ? 'border-ember bg-ember/10' : 'border-bdr glass-inner hover:border-ember/50'}`;
            const dot = (
              <span className={`mt-0.5 w-4 h-4 rounded-full border shrink-0 flex items-center justify-center ${on ? 'border-ember bg-ember text-white' : 'border-dim/60 bg-white/60'}`}>
                {on && <Check size={10} strokeWidth={3} />}
              </span>
            );
            if (fromNote) {
              const due = balanceDue(c);
              const late = c.due_date && String(c.due_date).slice(0, 10) < new Date().toISOString().slice(0, 10);
              return (
                <button key={c.id} type="button" role="radio" aria-checked={on} onClick={() => pick(c)} className={base}>
                  {dot}
                  <span className="flex-1 min-w-0">
                    <span className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-mono text-sm font-semibold text-paper">{invLabel(c)}</span>
                      <span className="ml-auto text-sm font-semibold tabular-nums text-paper">{money(due)} <span className="text-xs font-normal text-muted">left to pay</span></span>
                    </span>
                    <span className="block text-xs text-muted break-words">
                      {[partyOf(c) || null, c.due_date ? `Due ${dayOf(c.due_date)}` : null].filter(Boolean).join(' · ')}
                      {late && <span className="text-red-600 font-semibold"> · Overdue</span>}
                    </span>
                    {different && <span className="block text-xs text-amber-deep mt-0.5">This invoice is for a different customer.</span>}
                  </span>
                </button>
              );
            }
            const use = creditUse(c);
            const srcNo = c.invoice?.invoice_number ?? sourceNumbers[c.invoice_id];
            return (
              <button key={c.id} type="button" role="radio" aria-checked={on} onClick={() => pick(c)} className={base}>
                {dot}
                <span className="flex-1 min-w-0">
                  <span className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-mono text-sm font-semibold text-paper">{creditNoteLabel(c)}</span>
                    <span className="ml-auto text-sm font-semibold tabular-nums text-paper">{money(use.left)} <span className="text-xs font-normal text-muted">available</span></span>
                  </span>
                  <span className="block text-xs text-muted break-words">
                    {[srcNo != null ? `From INV-${srcNo}` : null, c.issue_date ? dayOf(c.issue_date) : null, partyOf(c) || null].filter(Boolean).join(' · ')}
                  </span>
                  {(use.used > 0 || use.refunded > 0) && (
                    <span className="block text-xs text-muted">{[use.used > 0 ? `${money(use.used)} used` : null, use.refunded > 0 ? `${money(use.refunded)} refunded` : null].filter(Boolean).join(', ')}</span>
                  )}
                  {different && <span className="block text-xs text-amber-deep mt-0.5">This credit note is for a different customer.</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Amount, note and what it does */}
      {pair && (
        <div className="space-y-3">
          <div>
            <label className={lbl} htmlFor="alloc-amount">Amount to apply</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted">£</span>
              <input id="alloc-amount" type="text" inputMode="decimal" autoComplete="off" className={field} value={amount}
                onChange={e => { setAmount(e.target.value); setTouched(true); }} placeholder="0.00" />
            </div>
            <div className="text-[11px] text-dim mt-1">
              Up to {money(allocationDefault(pair))}: {creditNoteLabel(pair.note)} has {money(creditAvailable(pair.note))} credit available and {invLabel(pair.invoice)} has {money(balanceDue(pair.invoice))} left to pay.
            </div>
          </div>

          <div>
            <label className={lbl} htmlFor="alloc-note">Note (optional)</label>
            <textarea id="alloc-note" className={field + ' resize-none'} rows={2} value={text} onChange={e => setText(e.target.value)}
              placeholder="e.g. Customer paid £224 less on this invoice" />
            <div className={`text-[10px] text-right mt-0.5 ${noteLength > ALLOCATION_NOTE_MAX ? 'text-red-600' : 'text-dim'}`}>{noteLength}/{ALLOCATION_NOTE_MAX}</div>
          </div>

          {effect && (
            <div className="glass-inner rounded-xl p-3 space-y-1.5 text-sm">
              <div className="flex justify-between text-muted"><span>{invLabel(pair.invoice)} left to pay now</span><span className="tabular-nums">{money(balanceDue(pair.invoice))}</span></div>
              <div className="flex justify-between text-purple-700 font-semibold"><span>Credit applied {creditNoteLabel(pair.note)}</span><span className="tabular-nums">-{money(effect.amount)}</span></div>
              <div className="flex justify-between font-bold text-paper pt-1.5 border-t border-bdr"><span>Left to pay after</span><span className="tabular-nums">{money(effect.invoice.balance_due)}</span></div>
              {effect.invoice.settles && (
                <div className="text-xs text-emerald-700">{invLabel(pair.invoice)} is then marked paid. No money is recorded as received.</div>
              )}
              <div className="text-xs text-muted">
                {effect.note.credit_available > 0
                  ? `${creditNoteLabel(pair.note)} then has ${money(effect.note.credit_available)} credit left.`
                  : `${creditNoteLabel(pair.note)} is then used up.`}
              </div>
            </div>
          )}
        </div>
      )}

      <div ref={problemsRef} className="space-y-2 empty:hidden">
        {touched && pair && <Problems list={problems} />}
        {error && <Problems list={[error]} />}
      </div>
    </Sheet>
  );
}

// ── Remove applied credit ───────────────────────────────────────────────────

/**
 * Owner only (the database checks too). The applied credit stays on record,
 * struck through with the reason, and the credit goes back on its note. The
 * sheet reads both sides fresh and says, before anyone presses Remove, what
 * else changes by the rules remove_credit_allocation applies.
 *   allocation  the credit_allocations row (credit_note_id, invoice_id, amount)
 *   onDone(row)
 */
export function RemoveCreditModal({ allocation, onClose, onDone }) {
  const [basis, setBasis] = useState(null);   // { allocation, note, invoice, invoiceNotes } or { error }
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const length = [...reason.trim()].length;

  useEffect(() => {
    let live = true;
    (async () => {
      const [a, n, i, ns] = await Promise.all([
        supabase.from('credit_allocations').select('*').eq('id', allocation.id).single(),
        supabase.from('credit_notes').select('*').eq('id', allocation.credit_note_id).single(),
        supabase.from('invoices').select('*').eq('id', allocation.invoice_id).single(),
        supabase.from('credit_notes').select('*').eq('invoice_id', allocation.invoice_id),
      ]);
      if (!live) return;
      const err = a.error || n.error || i.error || ns.error;
      if (err || !a.data || !n.data || !i.data) { setBasis({ error: allocationErrorText(err || { message: 'Applied credit not found.' }) }); return; }
      setBasis({ allocation: a.data, note: n.data, invoice: i.data, invoiceNotes: ns.data || [] });
    })();
    return () => { live = false; };
  }, [allocation.id, allocation.credit_note_id, allocation.invoice_id]);

  const ready = basis && !basis.error;
  const effect = ready ? removeAllocationEffect(basis) : null;
  const noteName = creditNoteLabel(ready ? basis.note : allocation.credit_note);
  const invName = invLabel(ready ? basis.invoice : allocation.invoice);
  const amount = Number((ready ? basis.allocation : allocation).amount) || 0;

  const save = async () => {
    setError('');
    if (length < REASON_MIN || length > REASON_MAX) { setError(`Give a reason of ${REASON_MIN} to ${REASON_MAX} characters.`); return; }
    setBusy(true);
    const { data, error: err } = await supabase.rpc('remove_credit_allocation', { p_allocation_id: allocation.id, p_reason: reason.trim() });
    setBusy(false);
    if (err) { setError(allocationErrorText(err)); return; }
    onDone?.(data);
  };

  return (
    <Sheet title="Remove credit applied?" sub={`${money(amount)} from ${noteName || 'a credit note'} on ${invName}`} busy={busy} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} className="btn-ghost px-4 py-2 rounded-xl text-sm disabled:opacity-50">Keep it</button>
        <button type="button" onClick={save} disabled={busy || !ready || !!effect?.problem}
          className="ml-auto px-4 py-2 rounded-xl text-sm font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 disabled:opacity-50">{busy ? 'Removing…' : 'Remove credit applied'}</button>
      </>}>
      {!basis && <div className="text-xs text-dim italic">Checking what this changes…</div>}
      {basis?.error && <Problems list={[basis.error]} />}
      {ready && (
        <ul className="text-sm text-muted list-disc pl-4 space-y-1">
          <li>It stays on record, struck through, with your reason.</li>
          {!effect.problem && (
            <>
              {creditUse(basis.note).refunded > 0
                ? <li>{money(amount)} goes back on {noteName} as credit available{effect.note.credit_available > 0 ? `, so it has ${money(effect.note.credit_available)} to use` : ''}. {noteName} has already been refunded once, so this credit can be applied to another invoice but not refunded.</li>
                : <li>{money(amount)} goes back on {noteName} as credit available{effect.note.credit_available > 0 ? `, so it has ${money(effect.note.credit_available)} to use or refund` : ''}.</li>}
              {effect.invoice.reopen
                ? <li className="text-amber-deep font-semibold">{invName} was marked paid with this credit counted, so it goes back to Sent with {money(effect.invoice.balance_due)} to pay.</li>
                : <li>{invName} then has {money(effect.invoice.balance_due)} left to pay.</li>}
              {(effect.refunds || []).map(r => {
                const other = basis.invoiceNotes.find(c => c.id === r.id);
                const left = creditAvailable({ ...other, refund_due: r.refund_due, refund_status: r.refund_status });
                return (
                  <li key={r.id}>{left > 0
                    ? `The credit available on ${creditNoteLabel(other)} drops to ${money(left)}, as less has now been paid on ${invName}.`
                    : `${creditNoteLabel(other)} no longer has credit available, as less has now been paid on ${invName}.`}</li>
                );
              })}
            </>
          )}
        </ul>
      )}
      {effect?.problem && <Problems list={[effect.problem]} />}
      <div>
        <label className={lbl} htmlFor="alloc-remove">Reason for removing it</label>
        <textarea id="alloc-remove" className={field + ' resize-none'} rows={3} value={reason} onChange={e => setReason(e.target.value)}
          placeholder="e.g. Applied to the wrong invoice" />
        <div className={`text-[10px] text-right mt-0.5 ${length > REASON_MAX ? 'text-red-600' : 'text-dim'}`}>{length}/{REASON_MAX}</div>
      </div>
      {error && <Problems list={[error]} />}
    </Sheet>
  );
}
