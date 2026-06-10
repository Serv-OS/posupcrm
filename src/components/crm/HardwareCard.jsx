import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Cpu, Undo2 } from 'lucide-react';
import { recallToServicing, fmtGBP, CONDITIONS } from '../../lib/inventoryOps';

const condLabel = (c) => (CONDITIONS.find(([k]) => k === c)?.[1]) || c || '';
const STATUS_BADGE = {
  deployed: 'bg-purple-100 text-purple-700',
  staged: 'bg-blue-100 text-blue-700',
  servicing: 'bg-orange-100 text-orange-700',
};

// Hardware booked out to a customer (company or specific location), fed live
// from the inventory module. Shows full per-unit detail; hidden when no kit.
export default function HardwareCard({ companyId, locationId, profile }) {
  const [rows, setRows] = useState(null);
  const canWrite = profile && (profile.role === 'owner' || profile.role === 'editor');

  const load = async () => {
    let q = supabase.from('inv_serials')
      .select('*, location:locations(name), warehouse:inv_warehouses(name)')
      .in('status', ['deployed', 'staged', 'servicing']);
    if (locationId) q = q.eq('location_id', locationId);
    else if (companyId) q = q.eq('company_id', companyId);
    else { setRows([]); return; }
    const { data } = await q.order('deployed_at', { ascending: false, nullsFirst: false });
    setRows(data || []);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [companyId, locationId]);

  if (!rows || rows.length === 0) return null;

  const value = rows.reduce((s, r) => s + (Number(r.cost) || 0), 0);
  const groups = {};
  rows.forEach(r => { (groups[r.product_name] = groups[r.product_name] || []).push(r); });

  const doRecall = async (r) => {
    if (!confirm(`Recall ${r.serial} for servicing?`)) return;
    try {
      const { data: wh } = await supabase.from('inv_warehouses').select('id').limit(1);
      await recallToServicing({ serial: r.serial, warehouse: wh?.[0]?.id, byName: profile.display_name || profile.email, actorId: profile.id });
      load();
    } catch (e) { alert(e.message); }
  };

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-bdr flex items-center gap-2">
        <Cpu size={15} className="text-ember" />
        <h3 className="text-sm font-bold text-paper">Hardware on site</h3>
        <span className="text-xs text-dim font-mono">({rows.length})</span>
        {value > 0 && <span className="ml-auto text-xs text-muted">{fmtGBP(value)} value</span>}
      </div>
      <div className="divide-y divide-bdr">
        {Object.entries(groups).map(([product, units]) => (
          <div key={product} className="px-4 py-3">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-sm font-semibold text-paper">{product}</span>
              <span className="text-xs text-dim">× {units.length}</span>
              {units[0].category && <span className="text-[10px] text-dim">· {units[0].category}</span>}
            </div>
            <div className="space-y-1">
              {units.map(u => (
                <div key={u.serial} className="flex items-center gap-2 text-xs flex-wrap">
                  <span className="font-mono text-paper">{u.serial}</span>
                  {u.status !== 'deployed' && (
                    <span className={`text-[9px] font-bold uppercase px-1 py-0.5 rounded ${STATUS_BADGE[u.status]}`}>{u.status}</span>
                  )}
                  {u.condition && <span className="text-amber-600">{condLabel(u.condition)}</span>}
                  {u.used && <span className="text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-slate-200 text-slate-600">used</span>}
                  <span className="text-dim">
                    {u.deployed_at ? `installed ${new Date(u.deployed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}` : 'staged'}
                    {u.dispatch_ref ? ` · ref ${u.dispatch_ref}` : ''}
                    {!locationId && u.location?.name ? ` · ${u.location.name}` : ''}
                  </span>
                  {u.cost != null && <span className="text-dim ml-auto tabular-nums">{fmtGBP(u.cost)}</span>}
                  {canWrite && u.status === 'deployed' && (
                    <button onClick={() => doRecall(u)} title="Recall for servicing"
                      className={`text-dim hover:text-ember ${u.cost != null ? '' : 'ml-auto'}`}><Undo2 size={13} /></button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
