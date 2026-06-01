import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { handleClosedWon } from '../../lib/dealHelpers';
import AssociationManager from './AssociationManager.jsx';
import ActivityTimeline from './ActivityTimeline.jsx';

const STAGES = [
  'new_lead','contacted','qualified','demo_booked','demo_done',
  'proposal_sent','negotiation','closed_won','closed_lost'
];
const STAGE_LABELS = {
  new_lead:'New Lead', contacted:'Contacted', qualified:'Qualified',
  demo_booked:'Demo Booked', demo_done:'Demo Done', proposal_sent:'Proposal Sent',
  negotiation:'Negotiation', closed_won:'Closed Won', closed_lost:'Closed Lost',
};

export default function DealDetail({ dealId, profile, onClose, onNavigate }) {
  const [deal, setDeal] = useState(null);
  const [company, setCompany] = useState(null);
  const [members, setMembers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [history, setHistory] = useState([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [tab, setTab] = useState('overview');

  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  useEffect(() => { load(); }, [dealId]);

  const load = async () => {
    const [d, m, c, h] = await Promise.all([
      supabase.from('deals').select('*').eq('id', dealId).single(),
      supabase.from('profiles').select('id, email, display_name'),
      supabase.from('companies').select('id, name').order('name'),
      supabase.from('stage_history').select('*').eq('object_type', 'deal').eq('object_id', dealId).order('changed_at', { ascending: false }),
    ]);
    setDeal(d.data);
    setMembers(m.data || []);
    setCompanies(c.data || []);
    setHistory(h.data || []);
    if (d.data?.company_id) {
      setCompany(c.data?.find(co => co.id === d.data.company_id) || null);
    }
  };

  const startEdit = () => { setDraft({ ...deal }); setEditing(true); };

  const save = async () => {
    const oldStage = deal.stage;
    const { id, created_at, updated_at, ...patch } = draft;
    if (patch.stage === 'closed_won' || patch.stage === 'closed_lost') {
      patch.closed_at = patch.closed_at || new Date().toISOString();
    } else {
      patch.closed_at = null;
    }
    await supabase.from('deals').update(patch).eq('id', dealId);
    if (patch.stage !== oldStage) {
      await supabase.from('stage_history').insert({
        object_type: 'deal', object_id: dealId,
        from_stage: oldStage, to_stage: patch.stage, changed_by: profile.id,
      });
      if (patch.stage === 'closed_won') {
        const ob = await handleClosedWon(dealId, profile.id);
        if (ob) alert('Onboarding created automatically for this deal.');
      }
    }
    setEditing(false);
    load();
  };

  const set = (k, v) => setDraft({ ...draft, [k]: v });

  const changeStage = async (newStage) => {
    if (newStage === deal.stage) return;
    const patch = { stage: newStage };
    if (newStage === 'closed_won' || newStage === 'closed_lost') patch.closed_at = new Date().toISOString();
    else patch.closed_at = null;
    await supabase.from('deals').update(patch).eq('id', dealId);
    await supabase.from('stage_history').insert({
      object_type: 'deal', object_id: dealId,
      from_stage: deal.stage, to_stage: newStage, changed_by: profile.id,
    });
    if (newStage === 'closed_won') {
      const ob = await handleClosedWon(dealId, profile.id);
      if (ob) alert('Onboarding created automatically for this deal.');
    }
    load();
  };

  if (!deal) return <div className="h-full flex items-center justify-center text-dim text-sm">Loading...</div>;

  const ownerName = (id) => {
    const m = members.find(u => u.id === id);
    return m ? (m.display_name || m.email.split('@')[0]) : 'Unassigned';
  };
  const formatCurrency = (v) => v ? `£${Number(v).toLocaleString('en-GB', { minimumFractionDigits: 2 })}` : '';

  const input = "w-full px-3 py-2 bg-card border border-bdr rounded text-sm text-paper placeholder-dim focus:outline-none focus:border-ember";
  const label = "text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block";
  const tabBtn = (t, lbl) => (
    <button onClick={() => setTab(t)}
      className={`px-3 py-1.5 text-xs font-medium rounded transition ${tab === t ? 'bg-card text-paper' : 'text-muted hover:text-paper'}`}>
      {lbl}
    </button>
  );

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-bdr flex items-center gap-3">
        <button onClick={onClose} className="text-muted hover:text-paper text-sm">&larr;</button>
        <div className="flex-1 min-w-0">
          <div className="text-lg font-bold text-paper truncate">{deal.name}</div>
          <div className="text-[10px] text-dim font-mono uppercase tracking-[0.18em]">
            <span className="text-ember cursor-pointer hover:underline" onClick={() => onNavigate?.('company', deal.company_id)}>
              {company?.name || 'Unknown'}
            </span>
            {deal.value ? ` / ${formatCurrency(deal.value)}` : ''}
            {' / '}{STAGE_LABELS[deal.stage] || deal.stage}
          </div>
        </div>
        {canWrite && !editing && (
          <button onClick={startEdit} className="px-3 py-1.5 bg-card border border-bdr rounded text-xs text-muted hover:text-paper">Edit</button>
        )}
      </div>

      {/* Stage progress bar */}
      {canWrite && (
        <div className="px-6 py-2 border-b border-bdr flex gap-0.5 overflow-x-auto">
          {STAGES.map((s, i) => {
            const isActive = deal.stage === s;
            const isPast = STAGES.indexOf(deal.stage) > i;
            return (
              <button key={s} onClick={() => changeStage(s)}
                className={`px-2 py-1 text-[9px] font-bold uppercase rounded transition whitespace-nowrap ${
                  isActive ? 'bg-ember text-ink' : isPast ? 'bg-ember/20 text-ember' : 'bg-card text-dim hover:text-paper'
                }`}>
                {STAGE_LABELS[s]}
              </button>
            );
          })}
        </div>
      )}

      <div className="px-6 py-2 border-b border-bdr flex gap-1">
        {tabBtn('overview', 'Overview')}
        {tabBtn('contacts', 'Contacts')}
        {tabBtn('locations', 'Locations')}
        {tabBtn('history', 'Stage History')}
        {tabBtn('activity', 'Activity')}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl">
          {tab === 'overview' && !editing && (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Value" value={formatCurrency(deal.value)} />
              <Field label="Currency" value={deal.currency} />
              <Field label="Stage" value={STAGE_LABELS[deal.stage]} />
              <Field label="Source" value={deal.source} />
              <Field label="Expected close" value={deal.expected_close_date ? new Date(deal.expected_close_date).toLocaleDateString('en-GB') : null} />
              <Field label="Owner" value={ownerName(deal.owner_id)} />
              {deal.lost_reason && <Field label="Lost reason" value={deal.lost_reason} />}
              {deal.notes && (
                <div className="col-span-2">
                  <div className={label}>Notes</div>
                  <div className="text-sm text-paper whitespace-pre-wrap">{deal.notes}</div>
                </div>
              )}
            </div>
          )}

          {tab === 'overview' && editing && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Name</label><input className={input} value={draft.name || ''} onChange={e => set('name', e.target.value)} /></div>
                <div>
                  <label className={label}>Company</label>
                  <select className={input} value={draft.company_id || ''} onChange={e => set('company_id', e.target.value)}>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div><label className={label}>Value</label><input className={input} type="number" step="0.01" value={draft.value || ''} onChange={e => set('value', e.target.value ? parseFloat(e.target.value) : null)} /></div>
                <div>
                  <label className={label}>Stage</label>
                  <select className={input} value={draft.stage} onChange={e => set('stage', e.target.value)}>
                    {STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
                  </select>
                </div>
                <div><label className={label}>Source</label><input className={input} value={draft.source || ''} onChange={e => set('source', e.target.value)} /></div>
                <div><label className={label}>Expected close</label><input className={input} type="date" value={draft.expected_close_date || ''} onChange={e => set('expected_close_date', e.target.value || null)} /></div>
                <div>
                  <label className={label}>Owner</label>
                  <select className={input} value={draft.owner_id || ''} onChange={e => set('owner_id', e.target.value || null)}>
                    <option value="">Unassigned</option>
                    {members.map(m => <option key={m.id} value={m.id}>{m.display_name || m.email}</option>)}
                  </select>
                </div>
                {(draft.stage === 'closed_lost') && (
                  <div><label className={label}>Lost reason</label><input className={input} value={draft.lost_reason || ''} onChange={e => set('lost_reason', e.target.value)} /></div>
                )}
              </div>
              <div><label className={label}>Notes</label><textarea className={input + ' resize-none'} rows={3} value={draft.notes || ''} onChange={e => set('notes', e.target.value)} /></div>
              <div className="flex gap-2 pt-1">
                <button onClick={save} className="px-4 py-2 bg-ember text-ink text-sm font-semibold rounded">Save</button>
                <button onClick={() => setEditing(false)} className="px-4 py-2 text-sm text-muted border border-bdr rounded">Cancel</button>
              </div>
            </div>
          )}

          {tab === 'contacts' && (
            <AssociationManager subjectType="deal" subjectId={dealId} targetType="contact" profile={profile} onNavigate={onNavigate} />
          )}

          {tab === 'locations' && (
            <AssociationManager subjectType="deal" subjectId={dealId} targetType="location" profile={profile} onNavigate={onNavigate} />
          )}

          {tab === 'history' && (
            <div>
              <div className={label + ' mb-3'}>Stage history ({history.length})</div>
              <div className="space-y-2">
                {history.map(h => (
                  <div key={h.id} className="flex items-center gap-3 text-xs py-2 border-b border-bdr last:border-b-0">
                    <span className="text-muted">{ownerName(h.changed_by)}</span>
                    <span className="text-dim">
                      {h.from_stage ? STAGE_LABELS[h.from_stage] : 'Created'} &rarr; {STAGE_LABELS[h.to_stage]}
                    </span>
                    <span className="text-dim ml-auto">
                      {new Date(h.changed_at).toLocaleDateString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}
                    </span>
                  </div>
                ))}
                {history.length === 0 && <div className="text-xs text-dim italic py-3">No stage changes recorded.</div>}
              </div>
            </div>
          )}

          {tab === 'activity' && (
            <ActivityTimeline subjectType="deal" subjectId={dealId} profile={profile} />
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <div className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-0.5">{label}</div>
      <div className="text-sm text-paper">{value || <span className="text-dim italic">--</span>}</div>
    </div>
  );
}
