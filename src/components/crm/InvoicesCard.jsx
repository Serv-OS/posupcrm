import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Receipt, Repeat } from 'lucide-react';
import { money, invStatus, INV_BADGE, creditMark, CN_BADGE } from './InvoicesPanel.jsx';
import { balanceDue, companyCreditAvailable, creditNoteLabel, creditNoteStatusKind, creditNoteStatusLabel } from '../../lib/creditNotes';
import { toDayISO } from '../../lib/day';

// Invoices associated with a record. Pass exactly one of companyId /
// locationId / contactId. "+ New" raises a draft pre-associated to the record.
export default function InvoicesCard({ companyId, locationId, contactId, profile, onNavigate }) {
  const [invoices, setInvoices] = useState([]);
  const [recurringCount, setRecurringCount] = useState(0);
  const [credits, setCredits] = useState([]);   // credit notes on the invoices shown
  // note id -> the invoices its credit was applied to, for "Used on INV-1050".
  const [usedOn, setUsedOn] = useState({});
  // Credit available across ALL this record's credit notes, not just those on
  // the invoices shown: what they can have refunded or use on an invoice.
  const [creditLeft, setCreditLeft] = useState(0);
  const canWrite = profile?.role === 'owner' || profile?.role === 'editor';

  const field = locationId ? 'location_id' : contactId ? 'contact_id' : 'company_id';
  const value = locationId || contactId || companyId;

  useEffect(() => {
    if (!value) return;
    supabase.from('invoices').select('*').eq(field, value).order('created_at', { ascending: false }).limit(8)
      .then(async r => {
        const rows = r.data || [];
        setInvoices(rows);
        // Fetched by invoice, not by this record: a credit note sits under the
        // invoice it was raised from. No table yet (migration not applied)
        // just means no credit notes to show.
        if (!rows.length) { setCredits([]); setUsedOn({}); return; }
        const ids = rows.map(i => i.id);
        // amount_allocated tells Available from Part used. Before the credit
        // allocations migration it is not there, so the notes are read without it.
        let cn = await supabase.from('credit_notes').select('id, credit_number, invoice_id, total, status, refund_status, refund_due, amount_allocated, refunded_amount, issue_date')
          .in('invoice_id', ids).order('credit_number');
        if (cn.error) {
          cn = await supabase.from('credit_notes').select('id, credit_number, invoice_id, total, status, refund_status, issue_date')
            .in('invoice_id', ids).order('credit_number');
        }
        const notes = cn.error ? [] : (cn.data || []);
        setCredits(notes);
        // Only a note whose credit went to other invoices needs their numbers.
        const usedIds = notes.filter(c => c.status === 'issued' && c.refund_status === 'allocated').map(c => c.id);
        if (!usedIds.length) { setUsedOn({}); return; }
        const al = await supabase.from('credit_allocations').select('credit_note_id, invoice_id, removed_at').in('credit_note_id', usedIds).is('removed_at', null);
        const active = al.error ? [] : (al.data || []).filter(a => !a.removed_at);
        const targetIds = [...new Set(active.map(a => a.invoice_id))];
        const inv = targetIds.length ? await supabase.from('invoices').select('id, invoice_number').in('id', targetIds) : { data: [] };
        const numberOf = new Map((inv.data || []).map(x => [x.id, x.invoice_number]));
        const map = {};
        active.forEach(a => { if (numberOf.has(a.invoice_id)) (map[a.credit_note_id] = map[a.credit_note_id] || []).push(numberOf.get(a.invoice_id)); });
        setUsedOn(map);
      });
    // Credit notes copy the company, site and contact from their invoice, so
    // they can be read by the same field. Nothing shows before the migration.
    supabase.from('credit_notes').select('id, status, refund_status, refund_due, amount_allocated, refunded_amount')
      .eq(field, value).eq('status', 'issued').eq('refund_status', 'owed')
      .then(r => setCreditLeft(r.error ? 0 : companyCreditAvailable(r.data || [])));
    supabase.from('recurring_invoices').select('id', { count: 'exact', head: true }).eq(field, value).eq('active', true)
      .then(r => setRecurringCount(r.count || 0));
  }, [field, value]);

  const newInvoice = async () => {
    const seed = { status: 'draft', created_by: profile.id, [field]: value, due_date: toDayISO(new Date(Date.now() + 14 * 86400000)) };
    // location implies its company for clean rollups
    if (locationId) {
      const { data: loc } = await supabase.from('locations').select('company_id').eq('id', locationId).maybeSingle();
      if (loc?.company_id) seed.company_id = loc.company_id;
    }
    const { data, error } = await supabase.from('invoices').insert(seed).select('id').single();
    if (error) { alert(error.message); return; }
    onNavigate?.('invoice', data.id);
  };

  // What is still owed after payments, credit notes and credit applied, not the face value.
  const outstanding = invoices.filter(i => !['paid', 'void', 'draft'].includes(i.status)).reduce((s, i) => s + balanceDue(i), 0);

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-bdr flex items-center gap-2">
        <Receipt size={15} className="text-ember" />
        <h3 className="text-sm font-bold text-paper">Invoices</h3>
        <span className="text-xs text-dim font-mono">({invoices.length})</span>
        {recurringCount > 0 && <span className="text-[10px] text-uv flex items-center gap-0.5"><Repeat size={10} /> {recurringCount}</span>}
        {canWrite && <button onClick={newInvoice} className="ml-auto text-xs text-ember hover:text-ember-deep font-medium">+ New</button>}
      </div>
      <div className="divide-y divide-bdr">
        {invoices.length === 0 ? (
          <div className="px-4 py-4 text-xs text-dim italic text-center">No invoices yet</div>
        ) : invoices.map(inv => {
          const st = invStatus(inv);
          const mark = creditMark(inv);
          const notes = credits.filter(c => c.invoice_id === inv.id);
          return (
            <div key={inv.id} onClick={() => onNavigate?.('invoice', inv.id)} className="hover:bg-card/50 cursor-pointer">
              <div className="px-4 py-2.5 flex items-center gap-2">
                <span className="font-mono text-[11px] text-dim shrink-0">INV-{inv.invoice_number}</span>
                {inv.recurring_id && <Repeat size={10} className="text-uv shrink-0" />}
                {mark && <span className="text-[9px] font-semibold text-purple-700 truncate">{mark}</span>}
                <span className="text-sm text-paper tabular-nums ml-auto shrink-0">{money(inv.total)}</span>
                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ${INV_BADGE[st]}`}>{st}</span>
              </div>
              {notes.map(c => {
                // Plain words ("Used on INV-1036", "£224.00 to use"); the colour keys on the kind.
                const chip = creditNoteStatusLabel(c, { invoiceNumber: inv.invoice_number, usedOn: usedOn[c.id], money });
                const cancelled = c.status === 'cancelled';
                return (
                  <div key={c.id} className="pl-8 pr-4 pb-2 -mt-1 flex items-center gap-2 min-w-0">
                    <span className={`font-mono text-[10px] text-dim shrink-0 ${cancelled ? 'line-through' : ''}`}>{creditNoteLabel(c)}</span>
                    <span className={`text-xs tabular-nums ml-auto shrink-0 ${cancelled ? 'line-through text-dim' : 'text-muted'}`}>-{money(c.total)}</span>
                    <span title={chip} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded min-w-0 truncate ${CN_BADGE[creditNoteStatusKind(c)]}`}>{chip}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
        {outstanding > 0 && (
          <div className="px-4 py-2 text-[11px] text-muted flex justify-between">
            <span>Outstanding</span><span className="font-semibold text-paper tabular-nums">{money(outstanding)}</span>
          </div>
        )}
        {creditLeft > 0 && (
          <div className="px-4 py-2 text-[11px] text-amber-deep flex justify-between" title="Credit from credit notes that can be refunded or used on one of their invoices">
            <span>Credit to use</span><span className="font-semibold tabular-nums">{money(creditLeft)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
