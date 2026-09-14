import { useEffect, useState, useCallback } from 'react';
import { MobileTable, MobileDock, DockField, Mono, Segmented } from './ui.jsx';
import { supabase } from '../../lib/supabase';
import { Receipt, Plus, Repeat, X, Trash2, FileDown, Download, FileMinus, ArrowRightLeft } from 'lucide-react';
import { useStickyState } from '../../lib/stickyState';
import { downloadListPdf } from '../../lib/listPdf';
import { amountPaid, balanceDue, creditAvailable, creditState, creditNoteLabel, creditNoteStatusKind, creditNoteStatusLabel, creditUse, issuedTotal, overpaidNotOnCredit } from '../../lib/creditNotes';
import ApplyCreditModal from './ApplyCreditModal.jsx';

const SYMBOL = { GBP: '£', USD: '$', EUR: '€' };
// The currency argument is optional: every existing `money(x)` call still reads
// as sterling. A row that carries its own currency passes it, so a list can
// never relabel a document's money as £ just because this CRM is the UK one.
export const money = (v, currency) =>
  `${SYMBOL[currency || 'GBP'] || `${currency} `}${Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtD = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '—';
export const curOf = (x) => x?.currency || 'GBP';

// Effective display status: sent/viewed past due = overdue.
// A credit note lowers what is owed without touching the status column, so
// the status is worked out here: an unpaid invoice credited in full reads
// "credited", and one whose balance credit has brought to 0 is not overdue
// (nobody should chase a customer who owes nothing). Credit applied from
// another invoice's credit note counts the same way (allocate_credit marks the
// invoice paid once nothing is left, so this only catches a row read part way).
export const invStatus = (inv) => {
  if (['paid', 'void', 'draft'].includes(inv.status)) return inv.status;
  const credit = creditState(inv);
  if (credit === 'full' && amountPaid(inv) === 0) return 'credited';
  if ((credit !== 'none' || Number(inv.amount_allocated) > 0) && balanceDue(inv) === 0) return inv.status;
  if (inv.due_date && new Date(inv.due_date) < new Date(new Date().toDateString())) return 'overdue';
  return inv.status;
};
export const INV_BADGE = {
  draft: 'bg-slate-200 text-slate-600', sent: 'bg-blue-100 text-blue-700', viewed: 'bg-indigo-100 text-indigo-700',
  paid: 'bg-emerald-100 text-emerald-700', overdue: 'bg-red-100 text-red-700', void: 'bg-slate-100 text-slate-400',
  credited: 'bg-purple-100 text-purple-700',
};
// The small marker shown beside the normal status once any credit note is
// issued, or credit from another invoice's credit note has been applied. An
// unpaid invoice credited in full already says "credited" as its status, so it
// gets no credit note marker.
export const creditMark = (inv) => {
  const credit = creditState(inv);
  const marks = [];
  if (credit !== 'none' && invStatus(inv) !== 'credited') marks.push(credit === 'full' ? 'Credited' : 'Part credited');
  if (Number(inv?.amount_allocated) > 0) marks.push('Credit applied');
  return marks.length ? marks.join(' · ') : null;
};
// Credit note chip colours, keyed by creditNoteStatusKind (the chip's words
// come from creditNoteStatusLabel and carry amounts and invoice numbers).
export const CN_BADGE = {
  Issued: 'bg-blue-100 text-blue-700', Available: 'bg-amber/15 text-amber-deep', 'Part used': 'bg-amber/15 text-amber-deep',
  Used: 'bg-purple-100 text-purple-700', Refunded: 'bg-emerald-100 text-emerald-700', Cancelled: 'bg-slate-100 text-slate-500',
};
// The same chip colours on the phone list, keyed by creditNoteStatusKind.
const CN_TONE = { Available: 'amber', 'Part used': 'amber', Used: 'uv', Refunded: 'primary', Cancelled: 'ink', Issued: 'uv' };
/**
 * The amounts behind a credit note's status, where its label does not already
 * give them, or null: "£224.00 used" beside "Used on INV-1050", and
 * "£224.00 refunded" or "£100.00 used, £124.00 refunded" beside "Refunded".
 * A note with credit to use already says how much in its label.
 */
export const creditUseText = (c) => {
  if (!c || c.status !== 'issued') return null;
  const { used, refunded } = creditUse(c);
  if (c.refund_status === 'allocated') return used > 0 ? `${money(used)} used` : null;
  if (c.refund_status === 'refunded') return [used > 0 ? `${money(used)} used` : null, `${money(refunded)} refunded`].filter(Boolean).join(', ');
  return null;
};
const FIELD_LABEL = { all: 'all fields', company: 'customer', location: 'location', number: 'invoice number', po: 'PO number' };

// One printed figure across mixed currencies would be a fiction, so a total is
// only offered when every row on the page shares a currency.
const totalNote = (label, pairs) => {
  const curs = [...new Set(pairs.map(p => p[0]))];
  if (curs.length > 1) return `Mixed currencies (${curs.join(', ')}) — not totalled.`;
  return `${label} (${curs[0] || 'GBP'}): ${money(pairs.reduce((s, p) => s + p[1], 0), curs[0])}`;
};

export default function InvoicesPanel({ profile, onNavigate }) {
  const [invoices, setInvoices] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [locations, setLocations] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [products, setProducts] = useState([]);
  // Chasing payment means opening an invoice and coming back over and over, so
  // which tab, filter and search you were on survives the round trip.
  const [filters, setFilters] = useStickyState('invoices', {
    tab: 'invoices', statusFilter: 'all', search: '', searchField: 'all',
    // Per-column filters. Sticky too, so a chase filtered to one customer
    // survives opening each invoice in turn.
    cols: { num: '', company: '', location: '', dueFrom: '', dueTo: '', min: '', max: '' },
  });
  const { tab, statusFilter, search, searchField } = filters;
  const cols = filters.cols || { num: '', company: '', location: '', dueFrom: '', dueTo: '', min: '', max: '' };
  const setFilter = (k, v) => setFilters(p => ({ ...p, [k]: v }));
  const [editSched, setEditSched] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  // Credit notes for the Credit notes tab. creditsReady stays false when the
  // table is not there yet (the migration not applied), so the tab hides
  // rather than showing an error.
  const [credits, setCredits] = useState([]);
  const [creditsReady, setCreditsReady] = useState(false);
  const [creditFilter, setCreditFilter] = useState('all');
  const [creditSearch, setCreditSearch] = useState('');
  // Active credit applied from credit notes, to name the invoices a used note
  // went to. allocReady is false before the credit allocations migration, and
  // then no Apply button shows.
  const [allocations, setAllocations] = useState([]);
  const [allocReady, setAllocReady] = useState(false);
  const [applying, setApplying] = useState(null);   // credit note being applied to an invoice
  const [flash, setFlash] = useState('');
  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  const load = useCallback(async () => {
    setLoading(true);
    const [i, r, c, l, ct, pr, cn, al] = await Promise.all([
      supabase.from('invoices').select('*, company:companies(name), location:locations(name)').order('created_at', { ascending: false }),
      supabase.from('recurring_invoices').select('*, company:companies(name), location:locations(name)').order('created_at', { ascending: false }),
      supabase.from('companies').select('id, name').order('name'),
      supabase.from('locations').select('id, name, company_id').order('name'),
      supabase.from('contacts').select('id, first_name, last_name, email').order('last_name'),
      supabase.from('products').select('id, name, description, default_price').eq('active', true).order('name'),
      supabase.from('credit_notes').select('*, invoice:invoices(invoice_number), company:companies(name), location:locations(name)').order('credit_number', { ascending: false }),
      supabase.from('credit_allocations').select('id, credit_note_id, invoice_id, removed_at').is('removed_at', null),
    ]);
    setInvoices(i.data || []); setSchedules(r.data || []); setCompanies(c.data || []);
    setLocations(l.data || []); setContacts(ct.data || []); setProducts(pr.data || []);
    setCredits(cn.error ? [] : (cn.data || [])); setCreditsReady(!cn.error);
    setAllocations(al.error ? [] : (al.data || []).filter(a => !a.removed_at)); setAllocReady(!cn.error && !al.error);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const newInvoice = async () => {
    const { data, error } = await supabase.from('invoices').insert({
      status: 'draft', created_by: profile.id,
      due_date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    }).select('id').single();
    if (error) { alert(error.message); return; }
    onNavigate?.('invoice', data.id);
  };

  const [pdfFor, setPdfFor] = useState(null);   // invoice id currently rendering

  // One invoice → its own PDF, straight from the list. Fetches the pieces the
  // document needs (lines, seller, bill-to) only when asked, so opening the
  // list stays cheap.
  const downloadOne = async (inv, e) => {
    e.stopPropagation();                        // the row navigates; the button must not
    setPdfFor(inv.id);
    try {
      const [{ data: lines }, { data: seller }, { data: contact }, applied] = await Promise.all([
        supabase.from('invoice_line_items').select('*').eq('invoice_id', inv.id).order('sort'),
        supabase.from('support_settings')
          .select('business_name, business_address, business_email, business_phone, logo_url, quote_accent, invoice_terms')
          .eq('id', 1).maybeSingle(),
        inv.contact_id
          ? supabase.from('contacts').select('first_name, last_name, email').eq('id', inv.contact_id).maybeSingle()
          : Promise.resolve({ data: null }),
        // Credit applied to it from other invoices' credit notes. None to
        // print when there is none, or before that migration is applied.
        Number(inv.amount_allocated) > 0
          ? supabase.from('credit_allocations').select('*').eq('invoice_id', inv.id).is('removed_at', null).order('created_at')
          : Promise.resolve({ data: [] }),
      ]);
      const appliedRows = applied.error ? [] : (applied.data || []).filter(a => !a.removed_at)
        .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
      const noteNumber = new Map(credits.map(c => [c.id, c.credit_number]));
      const company = companies.find(c => c.id === inv.company_id);
      const location = locations.find(l => l.id === inv.location_id);
      const addr = (o) => o ? [o.address, o.city, o.postcode].filter(Boolean).join(', ') : '';
      const rows = lines || [];
      const subtotal = rows.reduce((t, l) => t + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0);
      const tax = rows.reduce((t, l) => t + (Number(l.qty) || 0) * (Number(l.unit_price) || 0) * (Number(l.tax_rate) || 0) / 100, 0);
      const { downloadInvoicePdf } = await import('../../lib/invoicePdf');
      await downloadInvoicePdf({
        inv: { ...inv, terms: inv.terms || seller?.invoice_terms },
        lines: rows,
        // Totals come from the saved header, falling back to the lines — an
        // invoice already sent must print the figure the customer was given.
        totals: { subtotal: inv.subtotal ?? subtotal, tax: inv.tax_amount ?? tax,
                  total: inv.total ?? (subtotal + tax), paid: inv.amount_paid, allocated: Number(inv.amount_allocated) || 0 },
        allocations: appliedRows.map(a => ({ credit_number: noteNumber.get(a.credit_note_id) ?? null, amount: Number(a.amount) || 0, allocated_on: a.allocated_on, note: a.note || null })),
        seller: {
          name: seller?.business_name, address: seller?.business_address,
          email: seller?.business_email, phone: seller?.business_phone,
          logo_url: seller?.logo_url, accent: seller?.quote_accent,
        },
        billTo: {
          companyName: company?.name, companyAddress: addr(company),
          contactName: contact ? [contact.first_name, contact.last_name].filter(Boolean).join(' ') : '',
          contactEmail: contact?.email,
          locationName: location?.name, locationAddress: addr(location),
        },
        fmt: (v) => money(v, curOf(inv)), taxLabel: 'VAT', dateLocale: 'en-GB',
      });
    } catch (err) { alert('Could not build that PDF: ' + err.message); }
    setPdfFor(null);
  };

  const custName = (x) => x.location?.name || x.company?.name || x.label || '—';
  // The invoice is TO a company, FOR a site. Showing only one of them meant
  // "Coffee Boy - Preston" never said whose account it belongs to, and
  // "Lightspeed Netherlands B.V." never said which of their 24 sites it was.
  const partiesOf = (x) => ({
    company: x.company?.name || null,
    site: x.location?.name || null,
  });

  // What is still owed, not the face value: part payments and credit notes
  // both come off, and an invoice with nothing left to pay is not open.
  const open = invoices.filter(i => ['sent', 'viewed'].includes(i.status) && balanceDue(i) > 0);
  const outstanding = open.reduce((s, i) => s + balanceDue(i), 0);
  const overdueList = invoices.filter(i => invStatus(i) === 'overdue');
  const overdueSum = overdueList.reduce((s, i) => s + balanceDue(i), 0);
  const mStart = new Date(); mStart.setDate(1);
  // Money in this month, less refunds marked on credit notes this month: that
  // money went back out, so counting only the payment overstates what came in.
  // Cash only: credit applied from another invoice's credit note settles an
  // invoice without any money coming in, so it counts for nothing here.
  const paidThisMonth = invoices.filter(i => i.status === 'paid' && i.paid_at && new Date(i.paid_at) >= mStart)
    .reduce((s, i) => s + amountPaid(i), 0)
    - credits.filter(c => c.status === 'issued' && c.refunded_at && new Date(c.refunded_at) >= mStart)
      .reduce((s, c) => s + creditUse(c).refunded, 0);
  // Paid more than it asks for with no credit note owing it back (a card
  // payment that landed after a credit, or paid twice): flagged on the row so
  // it is refunded, not kept.
  const notesByInvoice = new Map();
  credits.forEach(c => notesByInvoice.set(c.invoice_id, [...(notesByInvoice.get(c.invoice_id) || []), c]));
  const overpaidOf = (inv) => (creditsReady ? overpaidNotOnCredit(inv, notesByInvoice.get(inv.id) || []) : 0);

  const matchesTab = (inv) => {
    const st = invStatus(inv);
    if (statusFilter === 'all') return true;
    if (statusFilter === 'sent') return st === 'sent' || st === 'viewed';
    return st === statusFilter; // draft, overdue, paid, credited
  };
  // Every column filters independently and they AND together — the old single
  // search box could only ever ask about one field at a time.
  const colMatch = (inv) => {
    const c = cols;
    // Match against what the row actually SHOWS, including the label fallback
    // in the company column. A filter that hides a row you can read is worse
    // than no filter, because it looks like the invoice does not exist.
    const { company, site } = partiesOf(inv);
    if (c.num) {
      const digits = c.num.replace(/\D/g, '');
      const full = `inv-${inv.invoice_number}`.toLowerCase();
      // Bare digits match the number; anything else matches the printed form.
      const hit = digits ? String(inv.invoice_number).includes(digits) : full.includes(c.num.toLowerCase());
      if (!hit) return false;
    }
    if (c.company && !(company || inv.label || '').toLowerCase().includes(c.company.toLowerCase())) return false;
    if (c.location && !(site || '').toLowerCase().includes(c.location.toLowerCase())) return false;
    if (c.dueFrom && (!inv.due_date || inv.due_date < c.dueFrom)) return false;
    if (c.dueTo && (!inv.due_date || inv.due_date > c.dueTo)) return false;
    if (c.min && !(Number(inv.total) >= Number(c.min))) return false;
    if (c.max && !(Number(inv.total) <= Number(c.max))) return false;
    return true;
  };
  const q = search.trim().toLowerCase();
  const matchesSearch = (inv) => {
    if (!q) return true;
    const comp = (inv.company?.name || '').toLowerCase();
    const loc = (inv.location?.name || '').toLowerCase();
    const num = `inv-${inv.invoice_number}`.toLowerCase();
    const label = (inv.label || '').toLowerCase();
    const po = (inv.po_number || '').toLowerCase();
    if (searchField === 'company') return comp.includes(q);
    if (searchField === 'location') return loc.includes(q);
    if (searchField === 'number') return num.includes(q) || String(inv.invoice_number || '').includes(q);
    if (searchField === 'po') return po.includes(q);
    return comp.includes(q) || loc.includes(q) || num.includes(q) || label.includes(q) || po.includes(q);
  };
  const filtered = invoices.filter(i => matchesTab(i) && matchesSearch(i) && colMatch(i));

  // A remembered "credits" tab is only honoured once the credit notes table
  // answers, so a database without it simply shows the invoices.
  const view = tab === 'credits' && !creditsReady ? 'invoices' : tab;
  // Notes with credit still to refund or apply to another invoice.
  const withCredit = credits.filter(c => creditAvailable(c) > 0);
  // Each note's status in plain words: "Used on INV-1036" (it reduced its own
  // invoice), "£224.00 to use", "Used on INV-1050" (every invoice its credit
  // went to), Refunded or Cancelled.
  const invoiceById = new Map(invoices.map(i => [i.id, i]));
  const usedOnOf = (c) => allocations.filter(a => a.credit_note_id === c.id).map(a => invoiceById.get(a.invoice_id)).filter(Boolean);
  const cnLabel = (c) => creditNoteStatusLabel(c, { usedOn: usedOnOf(c), money });
  const canApply = (c) => canWrite && allocReady && creditAvailable(c) > 0;
  const notify = (msg) => { setFlash(msg); setTimeout(() => setFlash(''), 3000); };
  const creditApplied = (row, { note, invoice }) => {
    setApplying(null);
    load();
    notify(`${money(row.amount)} from ${creditNoteLabel(note)} applied to INV-${invoice.invoice_number}`);
  };
  // Apply straight from the list, without opening the invoice first.
  const applyButton = (c, size = 'sm') => (
    <button type="button" onClick={(e) => { e.stopPropagation(); setApplying(c); }}
      title={`Use ${money(creditAvailable(c))} of ${creditNoteLabel(c)} on another invoice`}
      className={`rounded-lg font-semibold bg-purple-600 text-white hover:bg-purple-700 inline-flex items-center justify-center gap-1 ${size === 'lg' ? 'px-3 min-h-[34px] text-[13px]' : 'px-2.5 py-1.5 text-xs'}`}>
      <ArrowRightLeft size={size === 'lg' ? 13 : 12} /> Apply
    </button>
  );
  // One search box over what each credit note row shows. The phone list has
  // the search only; the desk list adds the status filters.
  const cq = creditSearch.trim().toLowerCase();
  const searchedCredits = credits.filter(c => {
    if (!cq) return true;
    const { company, site } = partiesOf(c);
    const invNo = c.invoice?.invoice_number ? `INV-${c.invoice.invoice_number}` : '';
    return [creditNoteLabel(c), invNo, company, site, c.reason].some(v => String(v || '').toLowerCase().includes(cq));
  });
  // Filters by the kind of status each row shows.
  const CREDIT_FILTERS = { available: ['Available', 'Part used'], used: ['Used'], refunded: ['Refunded'], cancelled: ['Cancelled'] };
  const shownCredits = CREDIT_FILTERS[creditFilter]
    ? searchedCredits.filter(c => CREDIT_FILTERS[creditFilter].includes(creditNoteStatusKind(c)))
    : searchedCredits;
  const creditFilterName = { available: 'Credit to use', used: 'Used on other invoices', refunded: 'Refunded', cancelled: 'Cancelled' };
  const statusText = (inv) => [invStatus(inv), creditMark(inv), overpaidOf(inv) > 0 ? 'Overpaid' : null].filter(Boolean).join(' · ');

  // What a schedule bills each run. Shared with the row below so the printed
  // list and the screen can never quietly disagree about the number.
  const schedAmount = (s) => (Array.isArray(s.lines) ? s.lines : [])
    .reduce((sum, l) => sum + (Number(l.qty) || 1) * (Number(l.unit_price) || 0), 0) * (1 + Number(s.tax_rate || 0) / 100);

  const exportPdf = async () => {
    setPdfBusy(true);
    try {
      if (view === 'invoices') {
        const active = [];
        if (statusFilter !== 'all') active.push(`Status: ${statusFilter === 'sent' ? 'sent or viewed' : statusFilter}`);
        if (q) active.push(`Search: "${search.trim()}" in ${FIELD_LABEL[searchField]}`);
        await downloadListPdf({
          title: 'Invoices',
          columns: ['Invoice', 'Customer', 'Issued', 'Due', 'Status', 'Currency', 'Total'],
          // `filtered` is the exact array the list maps over, so the PDF can
          // never include an invoice the current filter is hiding.
          rows: filtered.map(inv => [
            `INV-${inv.invoice_number}`, custName(inv), fmtD(inv.issue_date), fmtD(inv.due_date),
            statusText(inv), curOf(inv), money(inv.total, curOf(inv)),
          ]),
          filters: active,
          footNote: totalNote('Total', filtered.map(inv => [curOf(inv), Number(inv.total || 0)])),
        });
      } else if (view === 'credits') {
        await downloadListPdf({
          title: 'Credit notes',
          columns: ['Credit note', 'Invoice', 'Customer', 'Date', 'Status', 'Total'],
          rows: shownCredits.map(c => [
            creditNoteLabel(c), c.invoice?.invoice_number ? `INV-${c.invoice.invoice_number}` : '', custName(c),
            fmtD(c.issue_date), [cnLabel(c), creditUseText(c)].filter(Boolean).join(': '), money(c.total),
          ]),
          filters: [
            creditFilterName[creditFilter] || null,
            cq ? `Search: "${creditSearch.trim()}"` : null,
          ].filter(Boolean),
          // Cancelled notes are listed but count for nothing.
          footNote: `Issued (GBP): ${money(issuedTotal(shownCredits))}`,
        });
      } else {
        await downloadListPdf({
          title: 'Recurring invoice schedules',
          columns: ['Schedule', 'Customer', 'Frequency', 'Day', 'Next run', 'Sending', 'State', 'Currency', 'Amount'],
          rows: schedules.map(s => [
            s.label || custName(s), custName(s), s.frequency, s.day_of_month, fmtD(s.next_run),
            s.auto_send ? 'Auto-send' : 'Draft only', s.active ? 'Active' : 'Paused',
            curOf(s), money(schedAmount(s), curOf(s)),
          ]),
          footNote: totalNote('Per run', schedules.map(s => [curOf(s), schedAmount(s)])),
        });
      }
    } finally { setPdfBusy(false); }
  };

  const input = "px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper focus:outline-none focus:border-ember";
  // One definition for header, filters and rows so the columns cannot drift.
  const GRID = 'grid items-center gap-3 px-5 grid-cols-[96px_minmax(0,1.4fr)_minmax(0,1.4fr)_178px_108px_84px_34px]';
  // Apply sits under the status chip rather than in a column of its own: at
  // 1024px wide (iPad landscape) one more column left Customer with no room.
  const CN_GRID = 'grid items-center gap-3 px-5 grid-cols-[84px_84px_minmax(0,2fr)_96px_108px_170px]';
  const colInput = 'w-full px-2 py-1 bg-card border border-bdr rounded-lg text-[11px] text-paper placeholder-dim focus:outline-none focus:border-ember';
  // Safari draws an EMPTY date box with today's date greyed in, so an untouched
  // filter looks like it is already narrowing the list. Never let the browser's
  // empty state decide whether a filter reads as on: an active one is outlined.
  const colCls = (v) => `${colInput}${v ? ' border-ember bg-ember/10' : ''}`;
  const setCol = (k, v) => setFilter('cols', { ...cols, [k]: v });
  const colsActive = Object.values(cols).some(Boolean);

  return (
    <div className="h-full flex flex-col">
      <div className="lg:hidden flex-1 min-h-0 flex flex-col">
        <div className="px-[18px] pt-3 pb-2.5">
          <div className="font-display text-[23px] font-extrabold text-paper">{view === 'credits' ? 'Credit notes' : 'Invoices'}</div>
          {view === 'credits'
            ? <Mono className="!tracking-[.18em] uppercase">{credits.length} credit note{credits.length === 1 ? '' : 's'} · {withCredit.length} with credit to use</Mono>
            : <Mono className="!tracking-[.18em] uppercase">{filtered.length} shown · {invoices.filter(i => invStatus(i) === 'overdue').length} overdue</Mono>}
          {flash && <div className="mt-1 text-[13px] text-emerald-600 font-semibold">✓ {flash}</div>}
          {creditsReady && (
            <div className="mt-2">
              <Segmented value={view === 'credits' ? 'credits' : 'invoices'} options={[['invoices', 'Invoices'], ['credits', 'Credit notes']]}
                onChange={(k) => setFilter('tab', k)} />
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-[14px] pb-[calc(70px+env(safe-area-inset-bottom))]">
          {view === 'credits' ? (
            <div className="flex flex-col gap-2.5">
            <input className={input + ' w-full !text-[16px]'} value={creditSearch} onChange={e => setCreditSearch(e.target.value)}
              placeholder="Search credit notes" aria-label="Search credit notes" />
            {/* Keyed apart from the invoices table so each keeps its own column choice. */}
            <MobileTable key="credits" storageKey="creditnotes.mobile" rows={searchedCredits} onRow={(c) => onNavigate?.('invoice', c.invoice_id)}
              empty={cq ? 'Nothing matches that search.' : 'No credit notes yet. Raise one from a sent, viewed or paid invoice.'}
              columns={[
                { key: 'customer', label: 'Customer', pinned: true, render: (c) => partiesOf(c).company || partiesOf(c).site || '—' },
                { key: 'number', label: 'Number', mono: true, render: (c) => creditNoteLabel(c) },
                { key: 'invoice', label: 'Invoice', mono: true, render: (c) => (c.invoice?.invoice_number ? `INV-${c.invoice.invoice_number}` : '—') },
                { key: 'date', label: 'Date', render: (c) => fmtD(c.issue_date) },
                { key: 'total', label: 'Total', align: 'right', mono: true, render: (c) => money(c.total) },
                { key: 'status', label: 'Status', render: (c) => cnLabel(c) },
                // Credit to use: what is left to refund or apply to another invoice.
                { key: 'left', label: 'Credit to use', align: 'right', mono: true, render: (c) => (c.status === 'issued' && ['owed', 'allocated', 'refunded'].includes(c.refund_status) ? money(creditAvailable(c)) : null) },
                { key: 'site', label: 'Site', render: (c) => partiesOf(c).site || '—' },
                { key: 'apply', label: 'Apply', render: (c) => (canApply(c) ? applyButton(c) : null) },
              ]}
              card={(c) => {
                // The label already carries the credit to use, so the chip is just the label.
                const chip = { text: cnLabel(c), tone: CN_TONE[creditNoteStatusKind(c)] || 'uv' };
                return {
                  title: partiesOf(c).company || partiesOf(c).site || '—', amount: money(c.total), chip,
                  tone: creditAvailable(c) > 0 ? 'amber' : undefined,
                  action: canApply(c) ? applyButton(c, 'lg') : null,
                  meta: [creditNoteLabel(c), c.invoice?.invoice_number ? `for INV-${c.invoice.invoice_number}` : null, fmtD(c.issue_date), creditUseText(c)].filter(Boolean).join(' · '),
                };
              }} />
            </div>
          ) : (
          <MobileTable key="invoices" storageKey="invoices.mobile" rows={filtered} onRow={(inv) => onNavigate?.('invoice', inv.id)} empty="No invoices yet — raise your first one."
            columns={[
              { key: 'customer', label: 'Customer', pinned: true, render: (inv) => partiesOf(inv).company || inv.label || '—' },
              { key: 'number', label: 'Number', mono: true, render: (inv) => `INV-${inv.invoice_number}` },
              { key: 'site', label: 'Site', render: (inv) => partiesOf(inv).site || '—' },
              { key: 'due', label: 'Due', render: (inv) => fmtD(inv.due_date) },
              { key: 'total', label: 'Total', align: 'right', mono: true, render: (inv) => money(inv.total, inv.currency) },
              { key: 'status', label: 'Status', render: (inv) => statusText(inv) },
              { key: 'issued', label: 'Issued', render: (inv) => fmtD(inv.issue_date) },
              { key: 'currency', label: 'Currency', render: (inv) => curOf(inv) },
              { key: 'po', label: 'PO', render: (inv) => inv.po_number || '—' },
              { key: 'recurring', label: 'Recurring', render: (inv) => (inv.recurring_id ? 'yes' : '—') },
              // What is still owed after payments and credit notes. Nothing for
              // a draft or void invoice, which ask for nothing yet or at all.
              { key: 'balance', label: 'Balance due', align: 'right', mono: true, render: (inv) => (['draft', 'void'].includes(inv.status) ? null : money(balanceDue(inv))) },
            ]}
            card={(inv) => {
              const st = invStatus(inv); const { company, site } = partiesOf(inv);
              const chip = st === 'overdue' ? { text: 'Overdue', tone: 'coral' } : st === 'paid' ? { text: 'Paid', tone: 'primary' } : st === 'draft' ? { text: 'Draft', tone: 'muted' } : st === 'credited' ? { text: 'Credited', tone: 'uv' } : { text: `Due ${fmtD(inv.due_date)}`, tone: 'amber' };
              // In the chip, because the chosen columns replace meta on a card.
              const mark = creditMark(inv);
              if (mark) chip.text = `${chip.text} · ${mark}`;
              if (overpaidOf(inv) > 0) chip.text = `${chip.text} · Overpaid`;
              return { title: company || inv.label || '—', amount: money(inv.total, inv.currency), chip, tone: st === 'overdue' ? 'coral' : undefined, meta: [`INV-${inv.invoice_number}`, site, inv.recurring_id ? 'recurring' : null].filter(Boolean).join(' · ') };
            }} />
          )}
        </div>
        {canWrite && view !== 'credits' && <MobileDock><DockField onClick={() => (typeof newInvoice === 'function' ? newInvoice() : null)}>New invoice</DockField></MobileDock>}
      </div>
      <div className="hidden lg:flex px-6 py-5 border-b border-bdr items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <Receipt size={20} className="text-ember" />
          <div>
            <div className="text-xl font-bold text-paper">Invoices</div>
            <div className="text-xs text-muted">Raise, send and track payment</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 bg-card rounded-xl p-0.5">
            <button onClick={() => setFilter('tab', 'invoices')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${view === 'invoices' ? 'bg-ember text-white' : 'text-muted'}`}>Invoices</button>
            <button onClick={() => setFilter('tab', 'recurring')} className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold ${view === 'recurring' ? 'bg-ember text-white' : 'text-muted'}`}><Repeat size={12} /> Recurring</button>
            {creditsReady && <button onClick={() => setFilter('tab', 'credits')} className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold ${view === 'credits' ? 'bg-ember text-white' : 'text-muted'}`}><FileMinus size={12} /> Credit notes</button>}
          </div>
          <button onClick={exportPdf} disabled={pdfBusy || !(view === 'invoices' ? filtered.length : view === 'credits' ? shownCredits.length : schedules.length)}
            title="Download the list you are looking at as a PDF"
            className="btn-ghost px-3 py-2 rounded-xl text-sm flex items-center gap-1.5 disabled:opacity-50">
            <FileDown size={14} /> {pdfBusy ? 'Preparing…' : 'PDF'}
          </button>
          {/* A credit note is always raised from its invoice, so that tab has no New button. */}
          {canWrite && view !== 'credits' && (view === 'recurring'
            ? <button onClick={() => setEditSched({})} className="btn-glass px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5"><Plus size={15} /> New schedule</button>
            : <button onClick={newInvoice} className="btn-glass px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5"><Plus size={15} /> New invoice</button>)}
        </div>
      </div>

      <div className="hidden lg:block flex-1 overflow-y-auto p-6">
        <div className="max-w-[1100px] mx-auto space-y-5">

          {/* Headline */}
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Outstanding" value={money(outstanding)} sub={`${open.length} open invoice${open.length !== 1 ? 's' : ''}`} />
            <Stat label="Overdue" value={money(overdueSum)} sub={`${overdueList.length} overdue`} tone={overdueList.length ? 'red' : null} />
            <Stat label="Paid this month" value={money(paidThisMonth)} tone="emerald" />
          </div>

          {view === 'invoices' ? (
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-bdr space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-[13px] font-bold text-paper">Invoices</h3>
                  <span className="text-xs text-dim font-mono">({filtered.length})</span>
                  <div className="ml-auto flex items-center gap-1 flex-wrap">
                    {[['all', 'All'], ['draft', 'Draft'], ['sent', 'Sent'], ['overdue', 'Overdue'], ['paid', 'Paid'], ...(creditsReady ? [['credited', 'Credited']] : [])].map(([k, lbl]) => (
                      <button key={k} onClick={() => setFilter('statusFilter', k)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${statusFilter === k ? 'bg-ember text-white' : 'text-muted hover:text-paper'}`}>{lbl}</button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select className={input + ' !py-1.5 text-xs shrink-0'} value={searchField} onChange={e => setFilter('searchField', e.target.value)}>
                    <option value="all">All fields</option>
                    <option value="company">Customer</option>
                    <option value="location">Location</option>
                    <option value="number">Invoice #</option>
                    <option value="po">PO number</option>
                  </select>
                  <input className={input + ' !py-1.5 text-xs flex-1'} value={search} onChange={e => setFilter('search', e.target.value)}
                    placeholder="Search invoices…" />
                  {search && <button onClick={() => setFilter('search', '')} className="text-xs text-dim hover:text-paper px-2 shrink-0">Clear</button>}
                </div>
              </div>
              {/* Column headings, then a filter under each one. The filters
                  combine, so "Coffee Boy" + overdue + due-before is a single
                  question instead of three passes through the list. */}
              <div className={`${GRID} py-2 border-b border-bdr`}>
                <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-ember">Inv #</div>
                <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-ember">Company name</div>
                <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-ember">Location name</div>
                <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-ember text-right">Due date</div>
                <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-ember text-right">Amount</div>
                <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-ember text-center">Status</div>
                <div />
              </div>
              <div className={`${GRID} py-2 border-b border-bdr bg-card/40`}>
                <input className={colCls(cols.num)} value={cols.num} onChange={e => setCol('num', e.target.value)} placeholder="1085" />
                <input className={colCls(cols.company)} value={cols.company} onChange={e => setCol('company', e.target.value)} placeholder="Filter company…" />
                <input className={colCls(cols.location)} value={cols.location} onChange={e => setCol('location', e.target.value)} placeholder="Filter location…" />
                {/* Two boxes because a due date is a RANGE. They were unlabelled
                    and read as one date repeated. A date input cannot carry a
                    placeholder, so the words have to be on the page. */}
                <div className="flex flex-col gap-1">
                  <label className="flex items-center gap-1">
                    <span className="text-[9px] font-mono uppercase text-dim w-7 shrink-0">From</span>
                    <input type="date" className={colCls(cols.dueFrom)} value={cols.dueFrom} onChange={e => setCol('dueFrom', e.target.value)} />
                  </label>
                  <label className="flex items-center gap-1">
                    <span className="text-[9px] font-mono uppercase text-dim w-7 shrink-0">To</span>
                    <input type="date" className={colCls(cols.dueTo)} value={cols.dueTo} onChange={e => setCol('dueTo', e.target.value)} />
                  </label>
                </div>
                <div className="flex flex-col gap-1">
                  <input className={colCls(cols.min) + ' text-right'} value={cols.min} onChange={e => setCol('min', e.target.value)} placeholder="min" inputMode="decimal" />
                  <input className={colCls(cols.max) + ' text-right'} value={cols.max} onChange={e => setCol('max', e.target.value)} placeholder="max" inputMode="decimal" />
                </div>
                <select className={colCls(statusFilter !== 'all')} value={statusFilter} onChange={e => setFilter('statusFilter', e.target.value)}>
                  <option value="all">All</option><option value="draft">Draft</option>
                  <option value="sent">Sent</option><option value="overdue">Overdue</option><option value="paid">Paid</option>
                  {creditsReady && <option value="credited">Credited</option>}
                </select>
                <div className="flex justify-center">
                  {colsActive && (
                    <button onClick={() => setFilter('cols', { num: '', company: '', location: '', dueFrom: '', dueTo: '', min: '', max: '' })}
                      title="Clear column filters" className="text-dim hover:text-red-600 text-xs">&times;</button>
                  )}
                </div>
              </div>
              <div className="divide-y divide-bdr">
                {loading ? <div className="p-6 text-center text-dim text-sm">Loading…</div>
                  : filtered.length === 0 ? <div className="p-8 text-center text-dim text-sm italic">
                      {colsActive || search ? 'Nothing matches those filters.' : 'No invoices yet — raise your first one.'}
                    </div>
                  : filtered.map(inv => {
                    const st = invStatus(inv);
                    const { company, site } = partiesOf(inv);
                    return (
                      <div key={inv.id} onClick={() => onNavigate?.('invoice', inv.id)}
                        className={`${GRID} py-3 hover:bg-card/50 cursor-pointer`}>
                        <div className="font-mono text-xs text-dim">INV-{inv.invoice_number}</div>
                        <div className="min-w-0">
                          <div className="text-sm text-paper font-medium truncate">{company || inv.label || '—'}</div>
                          {inv.po_number && <div className="text-[10px] text-muted font-mono truncate">PO {inv.po_number}</div>}
                          {inv.recurring_id && <div className="text-[10px] text-uv flex items-center gap-1"><Repeat size={10} /> recurring</div>}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm text-muted truncate">{site || '—'}</div>
                          {inv.viewed_at && <div className="text-[10px] text-emerald-600 truncate">{'\u{1F441}'} Viewed {new Date(inv.viewed_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>}
                        </div>
                        <div className="text-xs text-muted text-right">Due {fmtD(inv.due_date)}</div>
                        <div className="text-sm font-semibold text-paper tabular-nums text-right">{money(inv.total, curOf(inv))}</div>
                        <div className="flex flex-col items-stretch gap-0.5 min-w-0">
                          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-lg text-center ${INV_BADGE[st]}`}>{st}</span>
                          {creditMark(inv) && <span className="text-[9px] font-semibold text-purple-700 text-center truncate">{creditMark(inv)}</span>}
                          {overpaidOf(inv) > 0 && <span className="text-[9px] font-semibold text-amber-deep text-center truncate" title={`${money(overpaidOf(inv))} more was paid than this invoice asks for`}>Overpaid</span>}
                        </div>
                        <button onClick={(e) => downloadOne(inv, e)} disabled={pdfFor === inv.id}
                          title={`Download INV-${inv.invoice_number} as a PDF`}
                          className="p-1.5 rounded-lg text-dim hover:text-ember hover:bg-ember/10 transition disabled:opacity-40">
                          <Download size={15} />
                        </button>
                      </div>
                    );
                  })}
              </div>
            </div>
          ) : view === 'credits' ? (
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-bdr space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-[13px] font-bold text-paper">Credit notes</h3>
                  <span className="text-xs text-dim font-mono">({shownCredits.length})</span>
                  <span className="text-[11px] text-dim">Newest first. Open one to see its invoice.</span>
                  {flash && <span className="text-xs text-emerald-600 font-semibold">✓ {flash}</span>}
                  <div className="ml-auto flex items-center gap-1">
                    {[['all', 'All'], ['available', `To use${withCredit.length ? ` (${withCredit.length})` : ''}`], ['used', 'Used on other invoices'], ['refunded', 'Refunded'], ['cancelled', 'Cancelled']].map(([k, lbl]) => (
                      <button key={k} onClick={() => setCreditFilter(k)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${creditFilter === k ? 'bg-ember text-white' : 'text-muted hover:text-paper'}`}>{lbl}</button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input className={input + ' !py-1.5 text-xs flex-1'} value={creditSearch} onChange={e => setCreditSearch(e.target.value)}
                    placeholder="Search by credit note, invoice, customer or reason" aria-label="Search credit notes" />
                  {creditSearch && <button onClick={() => setCreditSearch('')} className="text-xs text-dim hover:text-paper px-2 shrink-0">Clear</button>}
                </div>
              </div>
              <div className={`${CN_GRID} py-2 border-b border-bdr`}>
                {['Credit #', 'Invoice', 'Customer', 'Date', 'Total', 'Status'].map((h, i) => (
                  <div key={h} className={`text-[10px] font-mono font-bold uppercase tracking-wider text-ember ${i >= 3 && i <= 4 ? 'text-right' : ''} ${i === 5 ? 'text-center' : ''}`}>{h}</div>
                ))}
              </div>
              <div className="divide-y divide-bdr">
                {loading ? <div className="p-6 text-center text-dim text-sm">Loading…</div>
                  : shownCredits.length === 0 ? <div className="p-8 text-center text-dim text-sm italic">
                      {cq ? 'Nothing matches that search.' : creditFilter !== 'all' ? 'Nothing matches that filter.' : 'No credit notes yet. Raise one from a sent, viewed or paid invoice.'}
                    </div>
                  : shownCredits.map(c => {
                    const label = cnLabel(c);
                    const kind = creditNoteStatusKind(c);
                    const cancelled = c.status === 'cancelled';
                    const { company, site } = partiesOf(c);
                    return (
                      <div key={c.id} onClick={() => onNavigate?.('invoice', c.invoice_id)}
                        title={`Open INV-${c.invoice?.invoice_number ?? ''}`}
                        className={`${CN_GRID} py-3 hover:bg-card/50 cursor-pointer`}>
                        <div className={`font-mono text-xs text-dim ${cancelled ? 'line-through' : ''}`}>{creditNoteLabel(c)}</div>
                        <div className="font-mono text-xs text-muted">{c.invoice?.invoice_number ? `INV-${c.invoice.invoice_number}` : '—'}</div>
                        <div className="min-w-0">
                          <div className="text-sm text-paper font-medium truncate">{company || site || '—'}</div>
                          <div className="text-[10px] text-muted truncate">{[company ? site : null, c.reason].filter(Boolean).join(' · ')}</div>
                        </div>
                        <div className="text-xs text-muted text-right">{fmtD(c.issue_date)}</div>
                        <div className={`text-sm font-semibold tabular-nums text-right ${cancelled ? 'line-through text-dim' : 'text-paper'}`}>{money(c.total)}</div>
                        <div className="flex flex-col items-center gap-1 min-w-0">
                          <span className={`w-full text-[11px] font-semibold px-2 py-0.5 rounded-lg text-center leading-snug ${CN_BADGE[kind]}`}>{label}</span>
                          {creditUseText(c) && <span className="w-full text-[10px] text-muted text-center truncate" title={creditUseText(c)}>{creditUseText(c)}</span>}
                          {canApply(c) && applyButton(c)}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          ) : (
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-bdr">
                <h3 className="text-[13px] font-bold text-paper">Recurring schedules</h3>
                <div className="text-[11px] text-dim">Invoices are generated and emailed automatically on the day they're due to go out (daily run at 6am).</div>
              </div>
              <div className="divide-y divide-bdr">
                {schedules.length === 0 ? <div className="p-8 text-center text-dim text-sm italic">No recurring invoices yet.</div>
                  : schedules.map(s => {
                    const amount = schedAmount(s);
                    return (
                      <div key={s.id} onClick={() => canWrite && setEditSched(s)}
                        className="px-5 py-3 flex items-center gap-4 hover:bg-card/50 cursor-pointer">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${s.active ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-paper font-medium truncate">{s.label || custName(s)}</div>
                          <div className="text-[11px] text-muted">{custName(s)} · {s.frequency} on day {s.day_of_month}{s.auto_send ? ' · auto-send' : ' · draft only'}</div>
                        </div>
                        <div className="text-xs text-muted shrink-0">Next: {fmtD(s.next_run)}</div>
                        <div className="text-sm font-semibold text-paper tabular-nums shrink-0 w-24 text-right">{money(amount, curOf(s))}</div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      </div>

      {applying && <ApplyCreditModal note={applying} onClose={() => setApplying(null)} onApplied={creditApplied} />}
      {editSched && <ScheduleModal schedule={editSched} companies={companies} locations={locations} contacts={contacts}
        products={products} profile={profile} onClose={() => setEditSched(null)} onSaved={() => { setEditSched(null); load(); }} />}
    </div>
  );
}

function Stat({ label, value, sub, tone }) {
  const color = tone === 'red' ? 'text-red-600' : tone === 'emerald' ? 'text-emerald-600' : 'text-paper';
  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-dim mb-1">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-dim mt-0.5">{sub}</div>}
    </div>
  );
}

// Solid, clearly-bordered fields so the boxes are readable on the white modal
// (the translucent bg-card + white border made them blend in). Theme-aware.
// Solid, always-readable fields (.r-field lives in index.css) — palette-independent,
// so the recurring-invoice modal stays readable on the white modal and matches the
// normal invoice editor's look.
const input = "w-full r-field";
const label = "text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-muted mb-1 block";

function ScheduleModal({ schedule, companies, locations, contacts, products = [], profile, onClose, onSaved }) {
  const s = schedule || {};
  const [f, setF] = useState({
    label: s.label || '', company_id: s.company_id || '', location_id: s.location_id || '', contact_id: s.contact_id || '',
    email_to: s.email_to || '', frequency: s.frequency || 'monthly', day_of_month: s.day_of_month ?? 1,
    next_run: s.next_run || new Date().toISOString().slice(0, 10), due_days: s.due_days ?? 14,
    tax_rate: s.tax_rate ?? 20, terms: s.terms || '', notes: s.notes || '',
    auto_send: s.auto_send ?? true, active: s.active ?? true,
  });
  const [lines, setLines] = useState(Array.isArray(s.lines) && s.lines.length
    ? s.lines.map(l => ({ ...l, unit_price: l.list_price ?? l.unit_price ?? 0, discount: l.discount ?? 0 }))
    : [{ name: '', description: '', qty: 1, unit_price: 0, discount: 0 }]);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const setLine = (i, k, v) => setLines(p => p.map((l, j) => j === i ? { ...l, [k]: v } : l));
  const locs = locations.filter(l => !f.company_id || l.company_id === f.company_id);

  const subtotal = lines.reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(l.unit_price) || 0) * (1 - (Number(l.discount) || 0) / 100), 0);
  const total = subtotal * (1 + Number(f.tax_rate || 0) / 100);

  const save = async () => {
    if (!f.company_id && !f.contact_id) { alert('Pick a customer (company or contact)'); return; }
    const cleanLines = lines.filter(l => (l.name || '').trim());
    if (!cleanLines.length) { alert('Add at least one line item'); return; }
    const row = {
      label: f.label.trim() || null, company_id: f.company_id || null, location_id: f.location_id || null,
      contact_id: f.contact_id || null, email_to: f.email_to.trim() || null,
      frequency: f.frequency, day_of_month: Math.min(28, Math.max(1, Number(f.day_of_month) || 1)),
      next_run: f.next_run, due_days: Number(f.due_days) || 14, tax_rate: Number(f.tax_rate) || 0,
      lines: cleanLines.map(l => {
        const list = Number(l.unit_price) || 0;
        const disc = Math.min(100, Math.max(0, Number(l.discount) || 0));
        // Store the discounted price the generator charges, plus list price + % for editing.
        return { name: l.name.trim(), description: (l.description || '').trim() || null, qty: Number(l.qty) || 1, unit_price: +(list * (1 - disc / 100)).toFixed(4), list_price: list, discount: disc };
      }),
      terms: f.terms.trim() || null, notes: f.notes.trim() || null,
      auto_send: f.auto_send, active: f.active, created_by: s.created_by || profile.id,
    };
    const { error } = s.id
      ? await supabase.from('recurring_invoices').update(row).eq('id', s.id)
      : await supabase.from('recurring_invoices').insert(row);
    if (error) { alert(error.message); return; }
    onSaved();
  };

  const del = async () => {
    if (!confirm('Delete this recurring schedule? Already-generated invoices are kept.')) return;
    await supabase.from('recurring_invoices').delete().eq('id', s.id);
    onSaved();
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-card rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-bdr flex items-center justify-between sticky top-0 glass-card z-10">
          <div className="text-base font-bold text-paper">{s.id ? 'Edit recurring invoice' : 'New recurring invoice'}</div>
          <button onClick={onClose} className="text-muted hover:text-paper"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Label (optional)</label><input className={input} value={f.label} onChange={e => set('label', e.target.value)} placeholder="e.g. Monthly SaaS plan" /></div>
            <div><label className={label}>Send to (email)</label><input className={input} value={f.email_to} onChange={e => set('email_to', e.target.value)} placeholder="defaults to contact's email" /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className={label}>Company</label>
              <select className={input} value={f.company_id} onChange={e => { set('company_id', e.target.value); set('location_id', ''); }}>
                <option value="">—</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label className={label}>Location</label>
              <select className={input} value={f.location_id} onChange={e => set('location_id', e.target.value)}>
                <option value="">—</option>{locs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
            <div><label className={label}>Contact</label>
              <select className={input} value={f.contact_id} onChange={e => set('contact_id', e.target.value)}>
                <option value="">—</option>{contacts.map(c => <option key={c.id} value={c.id}>{[c.first_name, c.last_name].filter(Boolean).join(' ') || c.email}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div><label className={label}>Frequency</label>
              <select className={input} value={f.frequency} onChange={e => set('frequency', e.target.value)}>
                <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option></select></div>
            <div><label className={label}>Day of month</label><input type="number" min="1" max="28" className={input} value={f.day_of_month} onChange={e => set('day_of_month', e.target.value)} /></div>
            <div><label className={label}>First / next run</label><input type="date" className={input} value={f.next_run} onChange={e => set('next_run', e.target.value)} /></div>
            <div><label className={label}>Due (days)</label><input type="number" className={input} value={f.due_days} onChange={e => set('due_days', e.target.value)} /></div>
          </div>

          {/* Lines */}
          <div className="glass-inner rounded-xl p-3 space-y-2">
            <div className="flex items-center gap-3">
              <span className={label + ' !mb-0'}>Line items</span>
              <div className="ml-auto flex items-center gap-3">
                {products.length > 0 && (
                  <select className={input + ' !w-48 !py-1.5 text-xs'} value=""
                    onChange={e => {
                      const p = products.find(x => x.id === e.target.value);
                      if (p) setLines(prev => {
                        const blank = prev.length === 1 && !(prev[0].name || '').trim();
                        const line = { name: p.name, description: p.description || '', qty: 1, unit_price: Number(p.default_price) || 0, discount: 0 };
                        return blank ? [line] : [...prev, line];
                      });
                    }}>
                    <option value="">+ From products…</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.name} — £{Number(p.default_price).toLocaleString('en-GB')}</option>)}
                  </select>
                )}
                <button onClick={() => setLines(p => [...p, { name: '', description: '', qty: 1, unit_price: 0, discount: 0 }])}
                  className="text-xs text-ember hover:text-ember-deep font-medium">+ Blank line</button>
              </div>
            </div>
            {lines.map((l, i) => (
              <div key={i} className="glass-inner rounded-xl p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input className={input + ' flex-1'} value={l.name} onChange={e => setLine(i, 'name', e.target.value)} placeholder="Item name — e.g. Monthly subscription" />
                  <button onClick={() => setLines(p => p.filter((_, j) => j !== i))} title="Remove line" className="text-red-500 hover:text-red-600 text-lg leading-none shrink-0 px-1">&times;</button>
                </div>
                <input className={input + ' text-xs'} value={l.description || ''} onChange={e => setLine(i, 'description', e.target.value)} placeholder="Description (optional, shown on the invoice)" />
                <div className="grid grid-cols-3 gap-2">
                  <div><span className="text-[9px] text-muted block mb-0.5">Qty</span>
                    <input type="number" className={input} value={l.qty} onChange={e => setLine(i, 'qty', e.target.value)} placeholder="1" /></div>
                  <div><span className="text-[9px] text-muted block mb-0.5">Unit £ (ex VAT)</span>
                    <input type="number" className={input} value={l.unit_price} onChange={e => setLine(i, 'unit_price', e.target.value)} placeholder="0.00" /></div>
                  <div><span className="text-[9px] text-muted block mb-0.5">Disc %</span>
                    <input type="number" className={input} value={l.discount ?? 0} onChange={e => setLine(i, 'discount', e.target.value)} placeholder="0" /></div>
                </div>
                <div className="text-right text-xs text-muted">
                  {(Number(l.discount) || 0) > 0 && <span className="text-dim line-through mr-1.5">{money((Number(l.qty) || 0) * (Number(l.unit_price) || 0))}</span>}
                  Line total: <span className="text-paper font-mono font-semibold">{money((Number(l.qty) || 0) * (Number(l.unit_price) || 0) * (1 - (Number(l.discount) || 0) / 100))}</span></div>
              </div>
            ))}
            <div className="flex justify-end gap-4 text-sm pt-1">
              <span className="text-muted">VAT <input className={input + ' !w-16 !py-1 inline-block text-right ml-1'} value={f.tax_rate} onChange={e => set('tax_rate', e.target.value)} />%</span>
              <span className="font-bold text-paper tabular-nums">Total {money(total)}</span>
            </div>
          </div>

          <div className="flex items-center gap-5">
            <Toggle checked={f.auto_send} onChange={v => set('auto_send', v)} label="Auto-send by email" />
            <Toggle checked={f.active} onChange={v => set('active', v)} label="Active" />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button onClick={save} className="btn-glass px-5 py-2 rounded-xl text-sm font-semibold">Save schedule</button>
            <button onClick={onClose} className="btn-ghost px-4 py-2 rounded-xl text-sm">Cancel</button>
            {s.id && <button onClick={del} className="ml-auto text-red-600 hover:bg-red-50 p-2 rounded-xl"><Trash2 size={16} /></button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, label: lbl }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex items-center gap-2">
      <span className={`relative w-9 h-5 rounded-full transition ${checked ? 'bg-emerald-500' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
      <span className="text-sm text-paper">{lbl}</span>
    </button>
  );
}
