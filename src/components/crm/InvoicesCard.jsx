import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Receipt, Repeat } from 'lucide-react';
import { money, invStatus, INV_BADGE, creditMark, CN_BADGE } from './InvoicesPanel.jsx';
import { balanceDue, creditNoteLabel, creditNoteStatusLabel } from '../../lib/creditNotes';

// Invoices associated with a record. Pass exactly one of companyId /
// locationId / contactId. "+ New" raises a draft pre-associated to the record.
export default function InvoicesCard({ companyId, locationId, contactId, profile, onNavigate }) {
  const [invoices, setInvoices] = useState([]);
  const [recurringCount, setRecurringCount] = useState(0);
  const [credits, setCredits] = useState([]);   // credit notes on the invoices shown
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
        if (!rows.length) { setCredits([]); return; }
        const cn = await supabase.from('credit_notes').select('id, credit_number, invoice_id, total, status, refund_status, issue_date')
          .in('invoice_id', rows.map(i => i.id)).order('credit_number');
        setCredits(cn.error ? [] : (cn.data || []));
      });
    supabase.from('recurring_invoices').select('id', { count: 'exact', head: true }).eq(field, value).eq('active', true)
      .then(r => setRecurringCount(r.count || 0));
  }, [field, value]);

  const newInvoice = async () => {
    const seed = { status: 'draft', created_by: profile.id, [field]: value, due_date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10) };
    // location implies its company for clean rollups
    if (locationId) {
      const { data: loc } = await supabase.from('locations').select('company_id').eq('id', locationId).maybeSingle();
      if (loc?.company_id) seed.company_id = loc.company_id;
    }
    const { data, error } = await supabase.from('invoices').insert(seed).select('id').single();
    if (error) { alert(error.message); return; }
    onNavigate?.('invoice', data.id);
  };

  // What is still owed after payments and credit notes, not the face value.
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
                const chip = creditNoteStatusLabel(c);
                const cancelled = c.status === 'cancelled';
                return (
                  <div key={c.id} className="pl-8 pr-4 pb-2 -mt-1 flex items-center gap-2">
                    <span className={`font-mono text-[10px] text-dim shrink-0 ${cancelled ? 'line-through' : ''}`}>{creditNoteLabel(c)}</span>
                    <span className={`text-xs tabular-nums ml-auto shrink-0 ${cancelled ? 'line-through text-dim' : 'text-muted'}`}>-{money(c.total)}</span>
                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ${CN_BADGE[chip]}`}>{chip}</span>
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
      </div>
    </div>
  );
}
