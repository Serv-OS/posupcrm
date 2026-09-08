import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { zoneOptions, zoneLabel, DEFAULT_TZ } from '../../lib/staffClock';
import { Plus, X } from 'lucide-react';

export default function StaffView({ profile, onOpenUsers }) {
  const [staff, setStaff] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [areas, setAreas] = useState([]);
  const [edit, setEdit] = useState(null);
  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  useEffect(() => { load(); }, []);
  const load = async () => {
    const [p, d, a] = await Promise.all([
      supabase.from('profiles').select('id, display_name, email, mobile, role, department_id, coverable_area_ids, default_weekly_hours, timezone, leave_entitlement_days').order('display_name'),
      supabase.from('departments').select('*').order('name'),
      supabase.from('areas').select('*').order('name'),
    ]);
    setStaff(p.data || []); setDepartments(d.data || []); setAreas(a.data || []);
  };

  const deptName = (id) => departments.find(d => d.id === id);
  const areaById = (id) => areas.find(a => a.id === id);

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-5 border-b border-bdr flex items-center justify-between">
        <div>
          <div className="text-xl font-bold text-paper">Staff</div>
          <div className="text-xs text-muted">Scheduling details for your team</div>
        </div>
        {canWrite && <button onClick={onOpenUsers} className="btn-glass px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5"><Plus size={15} /> Add user</button>}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[1200px] mx-auto glass-card rounded-2xl overflow-hidden">
          <div className="divide-y divide-bdr">
            {staff.map(s => {
              const dept = deptName(s.department_id);
              const coverable = (s.coverable_area_ids || []).map(areaById).filter(Boolean);
              return (
                <div key={s.id} className="px-5 py-3 flex items-center gap-4">
                  <div className="w-8 h-8 rounded-full bg-ember/15 text-ember-deep text-xs font-bold flex items-center justify-center shrink-0">
                    {(s.display_name || s.email || '?')[0].toUpperCase()}
                  </div>
                  <div className="w-44 min-w-0">
                    <div className="text-sm text-paper truncate">{s.display_name || s.email?.split('@')[0]}</div>
                    <div className="text-[11px] text-dim truncate">{s.email}</div>
                  </div>
                  <div className="w-36 shrink-0">
                    {dept ? <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-lg" style={{ background: dept.colour + '1f', color: dept.colour }}>{dept.name}</span>
                      : <span className="text-xs text-dim italic">No department</span>}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-wrap gap-1">
                    {coverable.length ? coverable.map(a => (
                      <span key={a.id} className="text-[10px] px-1.5 py-0.5 rounded-md" style={{ background: a.colour + '1f', color: a.colour }}>{a.name}</span>
                    )) : <span className="text-[11px] text-dim italic">all areas</span>}
                  </div>
                  <div className="text-xs text-muted shrink-0 w-16 text-right">{s.default_weekly_hours ?? 40}h/wk</div>
                  <div className="text-xs text-muted shrink-0 w-20 text-right">{s.leave_entitlement_days ?? 28}d leave</div>
                  <div className="text-xs text-muted shrink-0 w-28 text-right font-mono">{s.mobile || <span className="text-red-500">no mobile</span>}</div>
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-700 shrink-0">Active</span>
                  {canWrite && <button onClick={() => setEdit(s)} className="btn-ghost px-3 py-1.5 rounded-xl text-xs shrink-0">Edit</button>}
                </div>
              );
            })}
            {staff.length === 0 && <div className="p-6 text-center text-dim text-sm italic">No staff yet — use “Add user” to invite your team.</div>}
          </div>
        </div>
      </div>

      {edit && <StaffEditModal staff={edit} departments={departments} areas={areas} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

function StaffEditModal({ staff, departments, areas, onClose, onSaved }) {
  const [f, setF] = useState({
    department_id: staff.department_id || '',
    coverable_area_ids: staff.coverable_area_ids || [],
    default_weekly_hours: staff.default_weekly_hours ?? 40,
    timezone: staff.timezone || '',
    leave_entitlement_days: staff.leave_entitlement_days ?? 28,
    mobile: staff.mobile || '',
  });
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));
  const toggleArea = (id) => set('coverable_area_ids', f.coverable_area_ids.includes(id) ? f.coverable_area_ids.filter(x => x !== id) : [...f.coverable_area_ids, id]);

  const save = async () => {
    await supabase.from('profiles').update({
      department_id: f.department_id || null,
      coverable_area_ids: f.coverable_area_ids,
      default_weekly_hours: Number(f.default_weekly_hours) || null,
      timezone: f.timezone || null,
      leave_entitlement_days: Number(f.leave_entitlement_days) || null,
      mobile: f.mobile.trim() || null,
    }).eq('id', staff.id);
    onSaved();
  };

  const input = "w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper focus:outline-none focus:border-ember";
  const label = "text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block";

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-card rounded-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-bdr flex items-center justify-between">
          <div className="text-base font-bold text-paper">{staff.display_name || staff.email}</div>
          <button onClick={onClose} className="text-muted hover:text-paper"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div><label className={label}>Department</label>
            <select className={input} value={f.department_id} onChange={e => set('department_id', e.target.value)}>
              <option value="">No department</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select></div>
          <div><label className={label}>Coverable areas</label>
            <div className="flex flex-wrap gap-2">
              {areas.map(a => {
                const on = f.coverable_area_ids.includes(a.id);
                return <button key={a.id} onClick={() => toggleArea(a.id)}
                  className={`text-xs px-2.5 py-1 rounded-lg border transition ${on ? 'border-transparent text-white' : 'border-bdr text-muted'}`}
                  style={on ? { background: a.colour } : {}}>{a.name}</button>;
              })}
            </div>
            <div className="text-[10px] text-dim mt-1">None selected = coverable for all areas.</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Weekly hours</label><input className={input} value={f.default_weekly_hours} onChange={e => set('default_weekly_hours', e.target.value)} /></div>
            <div><label className={label}>Leave entitlement (days)</label><input className={input} value={f.leave_entitlement_days} onChange={e => set('leave_entitlement_days', e.target.value)} /></div>
          </div>
          <div>
            <label className={label}>Timezone</label>
            <select className={input} value={f.timezone} onChange={e => set('timezone', e.target.value)}>
              <option value="">Business default</option>
              {zoneOptions(DEFAULT_TZ).map(z => <option key={z} value={z}>{zoneLabel(z)} ({z})</option>)}
            </select>
            <div className="text-[10px] text-dim mt-1">Their clock-in times are read on this clock, so a shift abroad reads right here.</div>
          </div>
          <div><label className={label}>Mobile (for SMS)</label><input className={input} value={f.mobile} onChange={e => set('mobile', e.target.value)} placeholder="+447…" /></div>
          <div className="flex gap-2 pt-1"><button onClick={save} className="btn-glass px-5 py-2 rounded-xl text-sm font-semibold">Save</button>
            <button onClick={onClose} className="btn-ghost px-4 py-2 rounded-xl text-sm">Cancel</button></div>
        </div>
      </div>
    </div>
  );
}
