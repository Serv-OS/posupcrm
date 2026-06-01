import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';

const STATUS_STYLES = {
  new: 'bg-blue-500/20 text-blue-300',
  under_review: 'bg-purple-500/20 text-purple-300',
  planned: 'bg-orange-500/20 text-orange-300',
  in_progress: 'bg-yellow-500/20 text-yellow-300',
  shipped: 'bg-green-500/20 text-green-300',
  declined: 'bg-red-500/20 text-red-300',
};
const STATUS_LABELS = {
  new:'New', under_review:'Under Review', planned:'Planned',
  in_progress:'In Progress', shipped:'Shipped', declined:'Declined',
};

export default function FeatureRequestList({ profile, onSelect }) {
  const [requests, setRequests] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [members, setMembers] = useState([]);
  const [associations, setAssociations] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('open');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('P2');

  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const [r, c, m, a, co] = await Promise.all([
      supabase.from('feature_requests').select('*').order('created_at', { ascending: false }),
      supabase.from('contacts').select('id, first_name, last_name, email'),
      supabase.from('profiles').select('id, email, display_name'),
      supabase.from('associations').select('*').eq('from_type', 'feature_request'),
      supabase.from('companies').select('id, name'),
    ]);
    setRequests(r.data || []);
    setContacts(c.data || []);
    setMembers(m.data || []);
    setAssociations(a.data || []);
    setCompanies(co.data || []);
    setLoading(false);
  };

  const filtered = useMemo(() => {
    let result = requests;
    if (filter === 'open') result = result.filter(r => !['shipped','declined'].includes(r.status));
    else if (filter !== 'all') result = result.filter(r => r.status === filter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(r => r.title.toLowerCase().includes(q));
    }
    return result;
  }, [requests, filter, search]);

  const contactName = (id) => {
    const c = contacts.find(x => x.id === id);
    return c ? [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email : '';
  };

  const getLinkedCompanies = (frId) => {
    return associations
      .filter(a => a.from_id === frId && a.to_type === 'company')
      .map(a => companies.find(c => c.id === a.to_id)?.name)
      .filter(Boolean)
      .join(', ');
  };

  const demandCount = (frId) => {
    return associations.filter(a => a.from_id === frId && (a.to_type === 'company' || a.to_type === 'deal')).length;
  };

  const create = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    const { data } = await supabase.from('feature_requests').insert({
      title: title.trim(),
      description: description.trim() || null,
      priority,
      owner_id: profile.id,
    }).select().single();
    setTitle(''); setDescription(''); setPriority('P2'); setShowCreate(false);
    if (data) onSelect(data.id);
    else load();
  };

  const input = "w-full px-3 py-2 bg-card border border-bdr rounded text-sm text-paper placeholder-dim focus:outline-none focus:border-ember";

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-bdr flex items-center justify-between">
        <div>
          <div className="text-lg font-bold text-paper">Feature Requests</div>
          <div className="text-[10px] text-dim font-mono uppercase tracking-[0.18em]">
            {requests.filter(r => !['shipped','declined'].includes(r.status)).length} open / {requests.filter(r => r.status === 'shipped').length} shipped
          </div>
        </div>
        {canWrite && (
          <button onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 bg-ember text-ink text-sm font-semibold rounded hover:bg-ember-deep transition">+ New request</button>
        )}
      </div>

      <div className="px-6 py-3 border-b border-bdr flex items-center gap-2">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
          className="px-3 py-1.5 bg-card border border-bdr rounded text-sm text-paper placeholder-dim focus:outline-none focus:border-ember w-56" />
        <select value={filter} onChange={e => setFilter(e.target.value)}
          className="px-2 py-1.5 bg-card border border-bdr rounded text-sm text-paper focus:outline-none focus:border-ember">
          <option value="open">Open</option>
          <option value="all">All</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {showCreate && (
        <div className="px-6 py-3 border-b border-bdr">
          <form onSubmit={create} className="space-y-2">
            <input className={input} value={title} onChange={e => setTitle(e.target.value)} placeholder="Feature request title" autoFocus />
            <div className="flex gap-2">
              <input className={input + ' flex-1'} value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (optional)" />
              <select className="px-2 py-2 bg-card border border-bdr rounded text-sm text-paper" value={priority} onChange={e => setPriority(e.target.value)}>
                <option value="P0">P0</option><option value="P1">P1</option><option value="P2">P2</option><option value="P3">P3</option>
              </select>
              <button type="submit" className="px-4 py-2 bg-ember text-ink text-sm font-semibold rounded shrink-0">Create</button>
              <button type="button" onClick={() => setShowCreate(false)} className="px-3 py-2 text-sm text-muted border border-bdr rounded shrink-0">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-bdr text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim">
              <th className="px-6 py-2.5 text-left">Request</th>
              <th className="px-3 py-2.5 text-center">Priority</th>
              <th className="px-3 py-2.5 text-left">Status</th>
              <th className="px-3 py-2.5 text-center">Demand</th>
              <th className="px-3 py-2.5 text-left">Companies</th>
              <th className="px-3 py-2.5 text-left">Requested by</th>
              <th className="px-3 py-2.5 text-left">Created</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="px-6 py-8 text-center text-dim text-sm">Loading...</td></tr>}
            {!loading && filtered.map(r => (
              <tr key={r.id} onClick={() => onSelect(r.id)} className="border-b border-bdr hover:bg-card/50 cursor-pointer transition">
                <td className="px-6 py-3">
                  <div className="text-sm text-paper">{r.title}</div>
                  {r.description && <div className="text-xs text-dim truncate max-w-xs">{r.description}</div>}
                </td>
                <td className="px-3 py-3 text-xs font-bold text-center">{r.priority}</td>
                <td className="px-3 py-3">
                  <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase rounded ${STATUS_STYLES[r.status]}`}>
                    {STATUS_LABELS[r.status]}
                  </span>
                </td>
                <td className="px-3 py-3 text-xs text-ember text-center font-bold">{demandCount(r.id) || ''}</td>
                <td className="px-3 py-3 text-xs text-muted truncate max-w-[120px]">{getLinkedCompanies(r.id)}</td>
                <td className="px-3 py-3 text-xs text-muted">{contactName(r.requested_by)}</td>
                <td className="px-3 py-3 text-xs text-dim">{new Date(r.created_at).toLocaleDateString('en-GB', { day:'numeric', month:'short' })}</td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-dim text-sm">No feature requests.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
