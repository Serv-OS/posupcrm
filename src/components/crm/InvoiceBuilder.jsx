import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { ArrowLeft, Send, Link2, Trash2, Plus, Check, Ban, Repeat, FileDown, FileMinus, Mail, ArrowRightLeft, Undo2 } from 'lucide-react';
import { money, invStatus, INV_BADGE, creditMark, CN_BADGE } from './InvoicesPanel.jsx';
import { downloadInvoicePdf } from '../../lib/invoicePdf';
import {
  ALLOCATABLE_STATUSES, amountPaid, balanceDue, canRaiseCredit, companyCreditAvailable, creditAvailable, creditState,
  creditNoteLabel, creditNoteStatusLabel, creditUse, markPaidAmount, overpaidNotOnCredit, refundProblem,
} from '../../lib/creditNotes';
import CreditNoteModal, { CancelCreditModal, RefundCreditModal, creditErrorText, downloadCreditNotePdf, loadCreditBasis, sendCreditNoteEmail } from './CreditNoteModal.jsx';
import ApplyCreditModal, { RemoveCreditModal, loadCreditToUse, loadInvoiceAllocations, sameCustomer } from './ApplyCreditModal.jsx';

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

export default function InvoiceBuilder({ invoiceId, profile, onClose, onNavigate }) {
  const [inv, setInv] = useState(null);
  const [lines, setLines] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [locations, setLocations] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [products, setProducts] = useState([]);
  const [stockCounts, setStockCounts] = useState({});
  const [globalTerms, setGlobalTerms] = useState('');
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [seller, setSeller] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [flash, setFlash] = useState('');
  // Credit notes against this invoice, oldest first so they read as a history.
  // creditsReady is false when the table is not there yet (the migration not
  // applied), and then nothing about credit notes is shown.
  const [creditNotes, setCreditNotes] = useState([]);
  const [creditsReady, setCreditsReady] = useState(false);
  const [raise, setRaise] = useState(null);          // { invoice, lines, creditedLines } while the raise screen is open
  const [refunding, setRefunding] = useState(null);  // credit note being marked refunded
  const [cancelling, setCancelling] = useState(null); // credit note being cancelled
  const [cnBusy, setCnBusy] = useState(null);        // credit note id with a PDF or email in flight
  // Credit applied TO this invoice from other invoices' credit notes (into),
  // and FROM this invoice's credit notes to other invoices (from). ready is
  // false until the credit allocations migration is applied, and then none of
  // it shows. creditToUse is every other invoice's credit note with credit
  // available, for the "credit available" banner.
  const [allocs, setAllocs] = useState({ ready: false, into: [], from: [] });
  const [creditToUse, setCreditToUse] = useState([]);
  const [applying, setApplying] = useState(null);    // { note } or { invoice, preselectId } while the apply screen is open
  const [removing, setRemoving] = useState(null);    // allocation row being removed
  const canWrite = profile.role === 'owner' || profile.role === 'editor';
  const isOwner = profile.role === 'owner';

  const loadAllocs = useCallback(async (noteIds) => {
    const a = await loadInvoiceAllocations(invoiceId, noteIds);
    setAllocs(a);
    setCreditToUse(a.ready ? (await loadCreditToUse()).filter(c => c.invoice_id !== invoiceId) : []);
  }, [invoiceId]);

  const load = useCallback(async () => {
    const [i, li, c, l, ct, st, pr, sk, cn] = await Promise.all([
      supabase.from('invoices').select('*').eq('id', invoiceId).single(),
      supabase.from('invoice_line_items').select('*').eq('invoice_id', invoiceId).order('sort'),
      supabase.from('companies').select('id, name, address, city, postcode').order('name'),
      supabase.from('locations').select('id, name, company_id, address, city, postcode').order('name'),
      supabase.from('contacts').select('id, first_name, last_name, email').order('last_name'),
      supabase.from('support_settings').select('invoice_terms, business_name, business_address, business_email, business_phone, logo_url, quote_accent').eq('id', 1).maybeSingle(),
      supabase.from('products').select('id, name, description, default_price, category').eq('active', true).order('name'),
      supabase.from('inv_serials').select('product_id').eq('status', 'in_stock'),
      supabase.from('credit_notes').select('*').eq('invoice_id', invoiceId).order('credit_number'),
    ]);
    setInv(i.data);
    setCreditNotes(cn.error ? [] : (cn.data || [])); setCreditsReady(!cn.error);
    if (cn.error) { setAllocs({ ready: false, into: [], from: [] }); setCreditToUse([]); }
    else loadAllocs((cn.data || []).map(c => c.id));
    setLines((li.data || []).length ? li.data : [{ _new: true, name: '', description: '', qty: 1, unit_price: 0, tax_rate: 20 }]);
    setCompanies(c.data || []); setLocations(l.data || []); setContacts(ct.data || []);
    setProducts(pr.data || []);
    const counts = {};
    (sk.data || []).forEach(r => { counts[r.product_id] = (counts[r.product_id] || 0) + 1; });
    setStockCounts(counts);
    setGlobalTerms(st.data?.invoice_terms || '');
    setSeller(st.data || {});
  }, [invoiceId, loadAllocs]);
  useEffect(() => { load(); }, [load]);

  // After a credit note is issued, emailed, refunded or cancelled, or credit is
  // applied or removed, only the credit lists and the invoice's credited and
  // applied figures change, plus the status and payment when the invoice is
  // settled or reopened. So unsaved edits on the page are kept (load() would
  // put every field back as saved).
  const refreshCredits = useCallback(async () => {
    const [cn, i] = await Promise.all([
      supabase.from('credit_notes').select('*').eq('invoice_id', invoiceId).order('credit_number'),
      supabase.from('invoices').select('*').eq('id', invoiceId).single(),
    ]);
    if (!cn.error) { setCreditNotes(cn.data || []); setCreditsReady(true); loadAllocs((cn.data || []).map(c => c.id)); }
    if (i.data) {
      const { amount_credited, amount_allocated, status, amount_paid, paid_at, updated_at } = i.data;
      setInv(p => (p ? { ...p, amount_credited, amount_allocated, status, amount_paid, paid_at, updated_at } : i.data));
    }
  }, [invoiceId, loadAllocs]);

  if (!inv) return <div className="h-full flex items-center justify-center text-dim text-sm">Loading invoice…</div>;

  const st = invStatus(inv);
  const locked = ['paid', 'void'].includes(inv.status);
  // Once a credit note is issued, its lines point at this invoice's lines and
  // its total was checked against this invoice's total. save() deletes and
  // re-inserts every line, which would cut those links and could drop the
  // total below what has been credited, so the lines and totals are frozen.
  // So is the customer: each credit note copied the company and site from the
  // invoice, and the two must keep agreeing. The rest of the header (dates,
  // email, PO, contact) can still be edited.
  const issuedCredits = creditNotes.filter(c => c.status === 'issued');
  // Credit applied to this invoice was checked against its balance, so it
  // freezes the totals, lines and customer the same way, until it is removed.
  const activeInto = allocs.into.filter(a => !a.removed_at);
  const activeFrom = allocs.from.filter(a => !a.removed_at);
  const appliedTotal = Number(inv.amount_allocated) || 0;
  const allocLocked = activeInto.length > 0 || appliedTotal > 0;
  const noteLocked = issuedCredits.length > 0 || creditState(inv) !== 'none';
  const creditLocked = noteLocked || allocLocked;
  const linesLocked = locked || creditLocked;
  const balance = balanceDue(inv);
  const paidSoFar = amountPaid(inv);
  // Credit available on this invoice's own notes: owed back, or to use on another invoice.
  const creditHeld = companyCreditAvailable(issuedCredits);
  const canCredit = canWrite && creditsReady && canRaiseCredit(inv);
  // Taken beyond what the invoice asks for and not on any credit note as a
  // refund (a card payment that landed after a credit, or paid twice).
  const overpaid = creditsReady ? overpaidNotOnCredit(inv, creditNotes) : 0;
  const showBalance = !['draft', 'void'].includes(inv.status) && (creditState(inv) !== 'none' || appliedTotal > 0 || (paidSoFar > 0 && balance > 0));
  // Credit from other invoices' notes that could come off this one: the banner
  // names the same customer's; others are one tap further, on the apply screen.
  const canTakeCredit = allocs.ready && ALLOCATABLE_STATUSES.includes(inv.status) && balance > 0;
  const ownCredit = creditToUse.filter(c => sameCustomer(inv, c));
  const ownCreditSum = companyCreditAvailable(ownCredit);
  const otherCredit = creditToUse.length > ownCredit.length;
  const ownCreditFrom = ownCredit.length === 1 ? creditNoteLabel(ownCredit[0])
    : ownCredit.length === 2 ? `${creditNoteLabel(ownCredit[0])} and ${creditNoteLabel(ownCredit[1])}`
      : `${ownCredit.length} credit notes`;
  const set = (k, v) => setInv(p => ({ ...p, [k]: v }));
  const setLine = (i, k, v) => setLines(p => p.map((l, j) => j === i ? { ...l, [k]: v } : l));
  const locs = locations.filter(l => !inv.company_id || l.company_id === inv.company_id);

  const subtotal = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0);
  const taxAmount = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_price) || 0) * (Number(l.tax_rate) || 0) / 100, 0);
  const total = subtotal + taxAmount;

  const notify = (msg) => { setFlash(msg); setTimeout(() => setFlash(''), 2500); };

  // guard.updatedAt (Mark paid): the write only lands if the invoice is still
  // exactly as it was read, so nothing recorded by a colleague or by Stripe
  // while a confirm box was open is written over. When it has changed nothing
  // is saved and save() returns null (false for any other failure, true once
  // saved), so the caller can read the invoice again and ask again.
  const save = async (extra = {}, guard = null) => {
    setSaving(true);
    // Checked again at the moment of saving, not just when the screen loaded:
    // someone else may have issued a credit note on this invoice since.
    let keepLines = creditLocked;
    if (!keepLines && creditsReady) {
      const [cn, al] = await Promise.all([
        supabase.from('credit_notes').select('id', { count: 'exact', head: true }).eq('invoice_id', invoiceId).eq('status', 'issued'),
        allocs.ready
          ? supabase.from('credit_allocations').select('id', { count: 'exact', head: true }).eq('invoice_id', invoiceId).is('removed_at', null)
          : Promise.resolve({ count: 0 }),
      ]);
      keepLines = (cn.count || 0) + (al.count || 0) > 0;
    }
    const patch = {
      company_id: inv.company_id || null, location_id: inv.location_id || null, contact_id: inv.contact_id || null,
      email_to: (inv.email_to || '').trim() || null, issue_date: inv.issue_date, due_date: inv.due_date || null,
      ...(keepLines ? {} : { subtotal, tax_amount: taxAmount, total }),
      terms: (inv.terms || '').trim() || null, notes: (inv.notes || '').trim() || null,
      po_number: (inv.po_number || '').trim() || null, ...extra,
    };
    let write = supabase.from('invoices').update(patch).eq('id', invoiceId);
    if (guard?.updatedAt) write = write.eq('updated_at', guard.updatedAt).select('id');
    const written = await write;
    let { error } = written;
    if (!error && guard?.updatedAt && !(written.data || []).length) {
      setSaving(false);
      refreshCredits();
      return null;
    }
    if (!error && !keepLines) {
      ({ error } = await supabase.from('invoice_line_items').delete().eq('invoice_id', invoiceId));
      const clean = lines.filter(l => (l.name || '').trim());
      if (!error && clean.length) {
        ({ error } = await supabase.from('invoice_line_items').insert(clean.map((l, i) => ({
          invoice_id: invoiceId, name: l.name.trim(), description: (l.description || '').trim() || null,
          qty: Number(l.qty) || 1, unit_price: Number(l.unit_price) || 0,
          tax_rate: Number(l.tax_rate) || 0, sort: i,
        }))));
      }
    }
    setSaving(false);
    // The database refuses new totals or lines once a credit note is issued
    // or credit is applied, even when it landed after the check above. Its
    // message says so; the page then shows the invoice as it really stands.
    if (error) { alert(error.message); load(); return false; }
    load();
    return true;
  };

  const sendInvoice = async () => {
    let to = inv.email_to || contacts.find(c => c.id === inv.contact_id)?.email || '';
    to = prompt('Send invoice to:', to);
    if (!to) return;
    if (!(await save())) return;
    setSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${FN}/invoice-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ invoice_id: invoiceId, to: to.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Send failed');
      notify(`Sent to ${d.to}`);
      load();
    } catch (e) { alert('Send failed: ' + e.message); }
    setSending(false);
  };

  const copyLink = async () => {
    await save();
    const url = `${window.location.origin}/i/${inv.public_token}`;
    try { await navigator.clipboard.writeText(url); notify('Link copied'); } catch { prompt('Invoice link:', url); }
  };

  // Seller and bill-to blocks for a PDF, shared by the invoice and its credit
  // notes. A credit note bills whoever it copied from the invoice when issued.
  const sellerInfo = () => ({
    name: seller?.business_name, address: seller?.business_address,
    email: seller?.business_email, phone: seller?.business_phone,
    logo_url: seller?.logo_url, accent: seller?.quote_accent,
  });
  const billToFor = (rec) => {
    const company = companies.find(c => c.id === rec.company_id);
    const location = locations.find(l => l.id === rec.location_id);
    const contact = contacts.find(c => c.id === rec.contact_id);
    const addr = (o) => o ? [o.address, o.city, o.postcode].filter(Boolean).join(', ') : '';
    return {
      companyName: company?.name, companyAddress: addr(company),
      contactName: contact ? [contact.first_name, contact.last_name].filter(Boolean).join(' ') : '',
      contactEmail: contact?.email,
      locationName: location?.name, locationAddress: addr(location),
    };
  };

  // One-click PDF. Persists edits first (unless locked) so the file matches the
  // saved invoice, then renders client-side via the lazy-loaded generator.
  const downloadPdf = async () => {
    setPdfBusy(true);
    try {
      if (!locked && !(await save())) { setPdfBusy(false); return; }
      await downloadInvoicePdf({
        inv: { ...inv, terms: inv.terms || globalTerms }, lines,
        totals: { subtotal, tax: taxAmount, total, paid: inv.amount_paid, allocated: appliedTotal },
        // Each credit applied, for a "Credit applied CN-1001" line above the balance.
        allocations: activeInto.map(a => ({ credit_number: a.credit_note?.credit_number ?? null, amount: Number(a.amount) || 0, allocated_on: a.allocated_on, note: a.note || null })),
        seller: sellerInfo(),
        billTo: billToFor(inv),
        fmt: money, taxLabel: 'VAT', dateLocale: 'en-GB',
      });
      notify('PDF downloaded');
    } catch (e) { alert('PDF failed: ' + e.message); }
    setPdfBusy(false);
  };

  const markPaid = async (changed = false) => {
    // What came in is the balance due after payments, credit notes and credit
    // applied, on top of the cash already taken: credit is never recorded as
    // cash. The figures are read fresh, as someone may have applied credit
    // since this page loaded. With nothing credited the total is the one on
    // screen, which save() is about to store; once credited it cannot change.
    const { data: fresh } = await supabase.from('invoices').select('*').eq('id', invoiceId).single();
    if (fresh?.status === 'paid') { alert('This invoice is already marked paid.'); refreshCredits(); return; }
    const figures = fresh
      ? { ...inv, status: fresh.status, amount_paid: fresh.amount_paid, amount_credited: fresh.amount_credited, amount_allocated: fresh.amount_allocated }
      : inv;
    const settledByCredit = creditLocked || Number(figures.amount_credited) > 0 || Number(figures.amount_allocated) > 0;
    const basis = settledByCredit ? { ...figures, total: fresh?.total ?? inv.total } : { ...figures, total };
    const due = balanceDue(basis);
    const received = markPaidAmount(basis);
    const question = settledByCredit || amountPaid(basis) > 0
      ? `Mark this invoice as paid? This records the balance of ${money(due)} as received outside Stripe.`
      : 'Mark this invoice as paid (received outside Stripe)?';
    if (!confirm(`${changed ? `INV-${inv.invoice_number} changed while the last box was open, so nothing was saved and the figures are read again.\n\n` : ''}${question}`)) return;
    // Written only if the invoice is still as read above: credit applied or a
    // payment recorded while the box was open would otherwise be counted as
    // cash on top. If it changed, it is read again and the question asked again.
    const saved = await save({ status: 'paid', paid_at: new Date().toISOString(), amount_paid: received }, { updatedAt: fresh?.updated_at });
    if (saved === null) { markPaid(true); return; }
    if (saved) notify('Marked paid');
  };
  const voidInvoice = async () => {
    if (issuedCredits.length) { alert('This invoice has credit notes issued against it. Cancel them before voiding it.'); return; }
    if (activeInto.length || activeFrom.length) { alert('Credit has been applied to or from this invoice. Remove the credit applied before voiding it.'); return; }
    if (!confirm('Void this invoice? The public link will stop working.')) return;
    await save({ status: 'void' });
  };
  const del = async () => {
    const noDelete = `INV-${inv.invoice_number} has credit notes against it, so it cannot be deleted. Void it instead once they are cancelled.`;
    // Applied credit stays on record even once removed, so it always blocks a delete.
    const noDeleteApplied = `INV-${inv.invoice_number} has had credit applied to it, so it cannot be deleted. Void it instead${activeInto.length ? ' once the credit applied is removed' : ''}.`;
    if (creditNotes.length) { alert(noDelete); return; }
    if (allocs.into.length) { alert(noDeleteApplied); return; }
    if (!confirm(`Delete invoice INV-${inv.invoice_number}? This cannot be undone.`)) return;
    const { error } = await supabase.from('invoices').delete().eq('id', invoiceId);
    // 23503: a credit note or applied credit still points at this invoice (on delete restrict).
    if (error) { alert(error.code === '23503' ? (creditNotes.length ? noDelete : noDeleteApplied) : `Could not delete the invoice: ${creditErrorText(error)}`); return; }
    onClose();
  };

  // ── Credit notes ──
  const creditEmail = (rec) => rec?.email_to || inv.email_to || contacts.find(c => c.id === inv.contact_id)?.email || '';

  // The raise screen works from the invoice as SAVED. Unsaved edits are saved
  // first, as Send and PDF do, on a credited invoice too: its header (dates,
  // email, PO, notes) can still change, and would otherwise be lost. Because
  // save() re-creates the lines with new ids, the lines (and what earlier
  // credit notes used of them) are read back afterwards, not taken from here.
  const openCredit = async () => {
    if (!locked && !(await save())) return;
    const basis = await loadCreditBasis(invoiceId);
    if (basis.error) { alert('Could not load the invoice: ' + creditErrorText(basis.error)); return; }
    if (!canRaiseCredit(basis.invoice)) { alert('Nothing is left to credit on this invoice.'); refreshCredits(); return; }
    setRaise(basis);
  };
  const creditIssued = (note, { emailed, emailError }) => {
    setRaise(null);
    refreshCredits();
    const name = creditNoteLabel(note);
    if (emailError) alert(`${name} is issued, but the email did not send: ${emailError} Use Email on the credit note to try again.`);
    else notify(emailed ? `${name} issued and sent to ${emailed}` : `${name} issued`);
  };
  const emailCredit = async (note) => {
    const to = prompt(`Email ${creditNoteLabel(note)} to:`, creditEmail(note));
    if (!to) return;
    setCnBusy(note.id);
    try {
      const d = await sendCreditNoteEmail(note.id, to);
      notify(`Sent to ${d.to || to.trim()}`);
      refreshCredits();
    } catch (e) { alert('Send failed: ' + e.message); }
    setCnBusy(null);
  };
  const pdfCredit = async (note) => {
    setCnBusy(note.id);
    try {
      await downloadCreditNotePdf({ note, invoice: { ...inv, terms: inv.terms || globalTerms }, seller: sellerInfo(), billTo: billToFor(note) });
      notify('PDF downloaded');
    } catch (e) { alert('PDF failed: ' + e.message); }
    setCnBusy(null);
  };
  // ── Applied credit ──
  // From this invoice's side the invoice is saved first, as for a credit note:
  // applied credit freezes the totals, so unsaved line edits would be lost.
  const openUseCredit = async (preselectId = null) => {
    if (!locked && !(await save())) return;
    setApplying({ invoice: inv, preselectId });
  };
  const creditApplied = (row, { note, invoice }) => {
    setApplying(null);
    refreshCredits();
    notify(`${money(row.amount)} from ${creditNoteLabel(note)} applied to INV-${invoice.invoice_number}`);
  };
  const creditRemoved = () => {
    setRemoving(null);
    refreshCredits();
    notify('Credit applied removed');
  };
  const openInvoice = (id) => { if (id && id !== invoiceId) onNavigate?.('invoice', id); };

  const dayOf = (d) => {
    if (!d) return '';
    const date = new Date(String(d).length <= 10 ? `${d}T00:00:00` : d);
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const input = "w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper placeholder-dim focus:outline-none focus:border-ember disabled:opacity-60";
  const cell = "px-2 py-1.5 bg-card border border-bdr rounded-lg text-sm text-paper placeholder-dim focus:outline-none focus:border-ember disabled:opacity-60";
  const label = "text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block";

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-bdr flex items-center gap-3 flex-wrap">
        <button onClick={onClose} className="text-muted hover:text-paper"><ArrowLeft size={18} /></button>
        <div className="text-xl font-bold text-paper">INV-{inv.invoice_number}</div>
        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-lg ${INV_BADGE[st]}`}>{st}</span>
        {creditMark(inv) && <span className="text-[10px] font-semibold text-purple-700">{creditMark(inv)}</span>}
        {inv.viewed_at
          ? <span className="text-[10px] font-semibold text-emerald-600" title={`Customer opened the invoice ${new Date(inv.viewed_at).toLocaleString('en-GB')}`}>👁 Viewed {new Date(inv.viewed_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
          : inv.sent_at && <span className="text-[10px] text-muted">Sent {new Date(inv.sent_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · not opened yet</span>}
        {inv.recurring_id && <span className="text-[10px] text-uv flex items-center gap-1"><Repeat size={11} /> from recurring schedule</span>}
        {flash && <span className="text-xs text-emerald-600 font-semibold">✓ {flash}</span>}
        {canWrite && (
          <div className="flex gap-2 ml-auto flex-wrap">
            {!locked && <button onClick={() => save().then(ok => ok && notify('Saved'))} disabled={saving} className="btn-ghost px-4 py-2 rounded-xl text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>}
            <button onClick={copyLink} className="btn-ghost px-3 py-2 rounded-xl text-sm flex items-center gap-1.5"><Link2 size={14} /> Copy link</button>
            <button onClick={downloadPdf} disabled={pdfBusy} title="Download this invoice as a PDF" className="btn-ghost px-3 py-2 rounded-xl text-sm flex items-center gap-1.5 disabled:opacity-50"><FileDown size={14} /> {pdfBusy ? 'Preparing…' : 'PDF'}</button>
            {canCredit && <button onClick={openCredit} disabled={saving} title="Raise a credit note against this invoice" className="btn-ghost px-3 py-2 rounded-xl text-sm flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"><FileMinus size={14} /> Raise credit note</button>}
            {!locked && <button onClick={sendInvoice} disabled={sending} className="btn-glass px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50"><Send size={14} /> {sending ? 'Sending…' : inv.sent_at ? 'Resend' : 'Send'}</button>}
            {!locked && !(creditLocked && balance === 0) && <button onClick={() => markPaid()} className="px-3 py-2 rounded-xl text-sm font-semibold bg-emerald-500/15 text-emerald-700 border border-emerald-500/30 flex items-center gap-1.5"><Check size={14} /> Mark paid</button>}
            {!locked && <button onClick={voidInvoice} title="Void" className="btn-ghost px-3 py-2 rounded-xl text-sm flex items-center gap-1.5 text-muted"><Ban size={14} /></button>}
            {isOwner && <button onClick={del} title="Delete" className="px-3 py-2 text-red-600 border border-red-200 rounded-xl hover:bg-red-50"><Trash2 size={14} /></button>}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[900px] mx-auto space-y-5">

          {/* The customer has credit from another invoice's credit note that
              could come off this one. */}
          {canTakeCredit && ownCreditSum > 0 && (
            <div className="rounded-2xl border border-purple-200 bg-purple-50 px-4 py-3 flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-[180px]">
                <div className="text-sm font-semibold text-purple-800">{money(ownCreditSum)} credit available from {ownCreditFrom}</div>
                <div className="text-xs text-purple-700">This customer can use it to pay less on this invoice.</div>
              </div>
              {canWrite && (
                <button onClick={() => openUseCredit(ownCredit.length === 1 ? ownCredit[0].id : null)} disabled={saving}
                  className="px-4 py-2 rounded-xl text-sm font-semibold bg-purple-600 text-white hover:bg-purple-700 flex items-center gap-1.5 disabled:opacity-50">
                  <ArrowRightLeft size={14} /> Use credit
                </button>
              )}
            </div>
          )}

          {/* Customer + dates */}
          <div className="glass-card rounded-2xl p-5 grid grid-cols-2 md:grid-cols-3 gap-3">
            <div><label className={label}>Company</label>
              <select className={input} disabled={linesLocked} value={inv.company_id || ''} onChange={e => { set('company_id', e.target.value || null); set('location_id', null); }}>
                <option value="">—</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label className={label}>Location</label>
              <select className={input} disabled={linesLocked} value={inv.location_id || ''} onChange={e => set('location_id', e.target.value || null)}>
                <option value="">—</option>{locs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
            <div><label className={label}>Contact</label>
              <select className={input} disabled={locked} value={inv.contact_id || ''} onChange={e => set('contact_id', e.target.value || null)}>
                <option value="">—</option>{contacts.map(c => <option key={c.id} value={c.id}>{[c.first_name, c.last_name].filter(Boolean).join(' ') || c.email}</option>)}</select></div>
            <div><label className={label}>Send to (email)</label><input className={input} disabled={locked} value={inv.email_to || ''} onChange={e => set('email_to', e.target.value)} placeholder="defaults to contact" /></div>
            <div><label className={label}>PO number</label><input className={input} disabled={locked} value={inv.po_number || ''} onChange={e => set('po_number', e.target.value)} placeholder="Customer purchase order ref" /></div>
            <div><label className={label}>Issue date</label><input type="date" className={input} disabled={locked} value={inv.issue_date || ''} onChange={e => set('issue_date', e.target.value)} /></div>
            <div><label className={label}>Due date</label><input type="date" className={input} disabled={locked} value={inv.due_date || ''} onChange={e => set('due_date', e.target.value)} /></div>
          </div>

          {/* Lines */}
          <div className="glass-card rounded-2xl p-5 space-y-2">
            <div className="flex items-center gap-3">
              <span className={label + ' !mb-0'}>Line items</span>
              {!linesLocked && (
                <div className="ml-auto flex items-center gap-3">
                  {products.length > 0 ? (
                    <select className={input + ' !w-60 !py-1.5 text-xs'} value=""
                      onChange={e => {
                        const p = products.find(x => x.id === e.target.value);
                        if (p) setLines(prev => {
                          const blank = prev.length === 1 && !(prev[0].name || '').trim();
                          const line = { _new: true, name: p.name, description: p.description || '', qty: 1, unit_price: Number(p.default_price) || 0, tax_rate: 20 };
                          return blank ? [line] : [...prev, line];
                        });
                      }}>
                      <option value="">+ Add from products…</option>
                      {products.map(p => <option key={p.id} value={p.id}>
                        {p.name} — £{Number(p.default_price).toLocaleString('en-GB')}{stockCounts[p.id] != null ? ` (${stockCounts[p.id]} in stock)` : ''}
                      </option>)}
                    </select>
                  ) : (
                    <span className="text-[11px] text-dim italic">No products in the catalogue yet — add them under Inventory → Products</span>
                  )}
                  <button onClick={() => setLines(p => [...p, { _new: true, name: '', description: '', qty: 1, unit_price: 0, tax_rate: 20 }])}
                    className="text-xs text-ember hover:text-ember-deep font-medium flex items-center gap-1"><Plus size={13} /> Blank line</button>
                </div>
              )}
            </div>
            {creditLocked && !locked && (
              <div className="text-[11px] text-muted">{noteLocked
                ? 'The lines are locked because a credit note has been issued on this invoice. To change what is owed, raise another credit note.'
                : 'The lines are locked because credit has been applied to this invoice. Remove the credit applied to change them.'}</div>
            )}
            {lines.length === 0 && <div className="text-xs text-dim italic py-4 text-center">No line items yet. Add from products or start a blank line.</div>}
            {lines.map((l, i) => (
              <div key={l.id || `n${i}`} className="glass-inner rounded-xl p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input className={cell + ' flex-1'} disabled={linesLocked} value={l.name} onChange={e => setLine(i, 'name', e.target.value)} placeholder="Item name — e.g. Card terminal" />
                  {!linesLocked && <button onClick={() => setLines(p => p.filter((_, j) => j !== i))} title="Remove line" className="text-red-500 hover:text-red-600 text-sm shrink-0">&times;</button>}
                </div>
                <input className={cell + ' w-full text-xs'} disabled={linesLocked} value={l.description || ''} onChange={e => setLine(i, 'description', e.target.value)} placeholder="Description (shown on the invoice)" />
                <div className="grid grid-cols-3 gap-2">
                  <div><span className="text-[9px] text-dim block">Qty</span>
                    <input type="number" className={cell + ' w-full'} disabled={linesLocked} value={l.qty} onChange={e => setLine(i, 'qty', e.target.value)} placeholder="1" /></div>
                  <div><span className="text-[9px] text-dim block">Unit £ (ex VAT)</span>
                    <input type="number" className={cell + ' w-full'} disabled={linesLocked} value={l.unit_price} onChange={e => setLine(i, 'unit_price', e.target.value)} placeholder="0.00" /></div>
                  <div><span className="text-[9px] text-dim block">VAT %</span>
                    <input type="number" className={cell + ' w-full'} disabled={linesLocked} value={l.tax_rate ?? 20} onChange={e => setLine(i, 'tax_rate', e.target.value)} placeholder="20" /></div>
                </div>
                <div className="text-right text-xs text-muted">
                  Net: <span className="text-paper font-mono font-semibold">{money((Number(l.qty) || 0) * (Number(l.unit_price) || 0))}</span>
                  <span className="mx-1.5 text-dim">·</span>
                  VAT: <span className="text-paper font-mono font-semibold">{money((Number(l.qty) || 0) * (Number(l.unit_price) || 0) * (Number(l.tax_rate) || 0) / 100)}</span>
                </div>
              </div>
            ))}
            <div className="flex justify-end pt-2 border-t border-bdr">
              <div className="w-64 space-y-1.5 text-sm">
                <div className="flex justify-between text-muted"><span>Subtotal</span><span className="tabular-nums">{money(subtotal)}</span></div>
                <div className="flex justify-between text-muted"><span>VAT (per line)</span><span className="tabular-nums">{money(taxAmount)}</span></div>
                <div className="flex justify-between text-base font-bold text-paper pt-1.5 border-t border-bdr"><span>Total</span><span className="tabular-nums">{money(total)}</span></div>
                {/* Paid is the cash taken. A paid invoice settled only by credit took none, so it shows no Paid line. */}
                {(inv.status === 'paid' ? (paidSoFar > 0 || appliedTotal === 0) : showBalance && paidSoFar > 0) && (
                  <div className="flex justify-between text-emerald-600 font-semibold"><span>Paid</span><span className="tabular-nums">{money(paidSoFar)}</span></div>
                )}
                {creditState(inv) !== 'none' && <div className="flex justify-between text-purple-700 font-semibold"><span>Credited</span><span className="tabular-nums">-{money(inv.amount_credited)}</span></div>}
                {activeInto.length > 0
                  ? activeInto.map(a => (
                    <div key={a.id} className="flex justify-between gap-2 text-purple-700 font-semibold"><span className="truncate">Credit applied {creditNoteLabel(a.credit_note)}</span><span className="tabular-nums shrink-0">-{money(a.amount)}</span></div>
                  ))
                  : appliedTotal > 0 && <div className="flex justify-between text-purple-700 font-semibold"><span>Credit applied</span><span className="tabular-nums">-{money(appliedTotal)}</span></div>}
                {showBalance && <div className="flex justify-between text-base font-bold text-paper pt-1.5 border-t border-bdr"><span>Balance due</span><span className="tabular-nums">{money(balance)}</span></div>}
                {creditHeld > 0 && <div className="flex justify-between text-amber-deep font-semibold"><span>Credit available</span><span className="tabular-nums">{money(creditHeld)}</span></div>}
                {canWrite && canTakeCredit && ownCreditSum === 0 && otherCredit && (
                  <button onClick={() => openUseCredit()} disabled={saving} className="w-full text-right text-xs text-ember hover:text-ember-deep font-medium disabled:opacity-50">Use credit from another customer's credit note</button>
                )}
                {overpaid > 0 && (
                  <div className="text-amber-deep">
                    <div className="flex justify-between font-semibold"><span>Overpaid</span><span className="tabular-nums">{money(overpaid)}</span></div>
                    <div className="text-[11px]">More was paid than this invoice asks for and no credit note shows it as a refund owed. Refund it to the customer.</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Credit applied to this invoice from other invoices' credit notes.
              Removed rows stay, struck through, with the reason. */}
          {allocs.ready && allocs.into.length > 0 && (
            <div className="glass-card rounded-2xl p-5 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={label + ' !mb-0'}>Credit applied</span>
                <span className="text-xs text-dim font-mono">({activeInto.length})</span>
                {activeInto.length > 0 && <span className="ml-auto text-sm font-semibold tabular-nums text-purple-700">-{money(appliedTotal)}</span>}
              </div>
              <div className="text-[11px] text-muted">Credit the customer had on other invoices, taken off what they owe here. It is not a payment and not revenue.</div>
              {allocs.into.map(a => {
                const gone = !!a.removed_at;
                return (
                  <div key={a.id} className="glass-inner rounded-xl p-3 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-mono text-sm font-semibold ${gone ? 'line-through text-dim' : 'text-paper'}`}>{creditNoteLabel(a.credit_note) || 'Credit note'}</span>
                      {a.source_invoice && (
                        <button type="button" onClick={() => openInvoice(a.source_invoice.id)} className="text-xs text-ember hover:text-ember-deep font-mono">from INV-{a.source_invoice.invoice_number}</button>
                      )}
                      <span className="text-xs text-muted">{dayOf(a.allocated_on || a.created_at)}</span>
                      <span className={`ml-auto font-mono tabular-nums text-sm font-semibold ${gone ? 'line-through text-dim' : 'text-purple-700'}`}>-{money(a.amount)}</span>
                    </div>
                    {a.note && <div className={`text-xs break-words ${gone ? 'text-dim line-through' : 'text-muted'}`}>{a.note}</div>}
                    {gone && <div className="text-xs text-muted">Removed {dayOf(a.removed_at)}{a.remove_reason ? `: ${a.remove_reason}` : ''}</div>}
                    {isOwner && !gone && (
                      <div className="flex pt-1">
                        <button onClick={() => setRemoving({ ...a, invoice: inv })} className="ml-auto btn-ghost px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1 text-red-600"><Undo2 size={12} /> Remove</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Credit notes: listed even when cancelled (struck through), since a
              credit note keeps its number for good. */}
          {creditsReady && creditNotes.length > 0 && (
            <div className="glass-card rounded-2xl p-5 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={label + ' !mb-0'}>Credit notes</span>
                <span className="text-xs text-dim font-mono">({creditNotes.length})</span>
                {canCredit && <button onClick={openCredit} disabled={saving} className="ml-auto text-xs text-ember hover:text-ember-deep font-medium flex items-center gap-1 disabled:opacity-50"><Plus size={13} /> Raise credit note</button>}
              </div>
              {creditNotes.map(c => {
                const chip = creditNoteStatusLabel(c);
                const cancelled = c.status === 'cancelled';
                const busy = cnBusy === c.id;
                const use = creditUse(c);
                const available = cancelled ? 0 : creditAvailable(c);
                const applied = allocs.from.filter(a => a.credit_note_id === c.id);
                const refundHow = `${c.refund_method ? ` by ${c.refund_method.toLowerCase()}` : ''}${c.refunded_at ? ` on ${dayOf(c.refunded_at)}` : ''}${c.refund_note ? `. ${c.refund_note}` : ''}`;
                const act = 'btn-ghost px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1 disabled:opacity-50';
                return (
                  <div key={c.id} className="glass-inner rounded-xl p-3 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-mono text-sm font-semibold ${cancelled ? 'line-through text-dim' : 'text-paper'}`}>{creditNoteLabel(c)}</span>
                      <span className="text-xs text-muted">{dayOf(c.issue_date)}</span>
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-lg ${CN_BADGE[chip]}`}>{chip}</span>
                      <span className={`ml-auto font-mono tabular-nums text-sm font-semibold ${cancelled ? 'line-through text-dim' : 'text-paper'}`}>-{money(c.total)}</span>
                    </div>
                    <div className={`text-xs break-words ${cancelled ? 'text-dim line-through' : 'text-muted'}`}>{c.reason}</div>
                    {!cancelled && c.refund_status === 'owed' && (use.used > 0 || use.refunded > 0
                      ? <div className="text-xs text-amber-deep">{[use.used > 0 ? `${money(use.used)} used` : null, use.refunded > 0 ? `${money(use.refunded)} refunded` : null, `${money(use.left)} left`].filter(Boolean).join(', ')}</div>
                      : <div className="text-xs text-amber-deep">Credit available to the customer: {money(use.left)}. Refund it, or apply it to another invoice.</div>)}
                    {/* One refund per note: what is left after a refund (credit
                        applied and then removed) can only be applied again. */}
                    {!cancelled && c.refund_status === 'owed' && use.refunded > 0 && use.left > 0 && (
                      <div className="text-[11px] text-muted">{(c.refunded_at || c.refund_method) && <span className="block">Refunded{refundHow}</span>}This note has already been refunded once, so the {money(use.left)} left can be applied to another invoice but not refunded again.</div>
                    )}
                    {!cancelled && c.refund_status === 'allocated' && <div className="text-xs text-purple-700">Used {money(use.used)} on other invoices</div>}
                    {c.refund_status === 'refunded' && (
                      <div className="text-xs text-emerald-700">{use.used > 0 ? `Used ${money(use.used)}, refunded ${money(use.refunded)}` : `Refunded ${money(use.refunded)}`}{refundHow}</div>
                    )}
                    {applied.map(a => {
                      const gone = !!a.removed_at;
                      return (
                        <div key={a.id} className="pl-2 border-l-2 border-purple-200 text-xs space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={gone ? 'line-through text-dim' : 'text-paper'}>
                              Applied to{' '}
                              {a.invoice
                                ? <button type="button" onClick={() => openInvoice(a.invoice.id)} className={`font-mono ${gone ? '' : 'text-ember hover:text-ember-deep'}`}>INV-{a.invoice.invoice_number}</button>
                                : 'an invoice'}
                              {' '}on {dayOf(a.allocated_on || a.created_at)}: <span className="tabular-nums font-semibold">{money(a.amount)}</span>
                            </span>
                            {isOwner && !gone && (
                              <button onClick={() => setRemoving({ ...a, credit_note: c })} className="ml-auto text-red-600 hover:text-red-700 flex items-center gap-1"><Undo2 size={11} /> Remove</button>
                            )}
                          </div>
                          {a.note && <div className={`break-words ${gone ? 'text-dim line-through' : 'text-muted'}`}>{a.note}</div>}
                          {gone && <div className="text-muted">Removed {dayOf(a.removed_at)}{a.remove_reason ? `: ${a.remove_reason}` : ''}</div>}
                        </div>
                      );
                    })}
                    {cancelled && <div className="text-xs text-muted">Cancelled {dayOf(c.cancelled_at)}{c.cancel_reason ? `: ${c.cancel_reason}` : ''}</div>}
                    {c.sent_at && <div className="text-[10px] text-muted">Emailed{c.email_to ? ` to ${c.email_to}` : ''} on {dayOf(c.sent_at)}</div>}
                    <div className="flex items-center gap-1.5 flex-wrap pt-1">
                      <button onClick={() => pdfCredit(c)} disabled={busy} className={act} title={`Download ${creditNoteLabel(c)} as a PDF`}><FileDown size={12} /> PDF</button>
                      {canWrite && !cancelled && <button onClick={() => emailCredit(c)} disabled={busy} className={act}><Mail size={12} /> {c.sent_at ? 'Email again' : 'Email'}</button>}
                      {canWrite && allocs.ready && available > 0 && (
                        <button onClick={() => setApplying({ note: { ...c, invoice: { invoice_number: inv.invoice_number } } })} disabled={busy} className={act + ' text-purple-700'}><ArrowRightLeft size={12} /> Apply to an invoice</button>
                      )}
                      {canWrite && !refundProblem({ note: c }) && <button onClick={() => setRefunding(c)} disabled={busy} className={act + ' text-amber-deep'}><Check size={12} /> Mark refunded</button>}
                      {isOwner && !cancelled && c.refund_status !== 'refunded' && use.refunded === 0 && (
                        <button onClick={() => setCancelling(c)} disabled={busy} className={act + ' ml-auto text-red-600'}><Ban size={12} /> Cancel</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Notes + terms */}
          <div className="glass-card rounded-2xl p-5 space-y-3">
            <div><label className={label}>Notes (shown on the invoice)</label>
              <textarea className={input + ' resize-none'} rows={2} disabled={locked} value={inv.notes || ''} onChange={e => set('notes', e.target.value)} /></div>
            <div><label className={label}>Terms</label>
              <textarea className={input + ' resize-none'} rows={3} disabled={locked} value={inv.terms || ''} onChange={e => set('terms', e.target.value)}
                placeholder={globalTerms ? `Default: ${globalTerms.slice(0, 120)}…` : 'Falls back to the global invoice terms in Settings'} /></div>
          </div>

        </div>
      </div>

      {raise && (
        <CreditNoteModal invoice={raise.invoice} invoiceLines={raise.lines} creditedLines={raise.creditedLines} defaultEmail={creditEmail(raise.invoice)}
          onClose={() => setRaise(null)} onIssued={creditIssued} />
      )}
      {refunding && (
        <RefundCreditModal note={refunding} onClose={() => setRefunding(null)}
          onDone={() => { notify(`${creditNoteLabel(refunding)} marked refunded`); setRefunding(null); refreshCredits(); }} />
      )}
      {cancelling && (
        <CancelCreditModal note={cancelling} invoice={inv} notes={creditNotes} onClose={() => setCancelling(null)}
          onDone={() => { notify(`${creditNoteLabel(cancelling)} cancelled`); setCancelling(null); refreshCredits(); }} />
      )}
      {applying && (
        <ApplyCreditModal note={applying.note} invoice={applying.invoice} preselectId={applying.preselectId}
          onClose={() => setApplying(null)} onApplied={creditApplied} />
      )}
      {removing && <RemoveCreditModal allocation={removing} onClose={() => setRemoving(null)} onDone={creditRemoved} />}
    </div>
  );
}
