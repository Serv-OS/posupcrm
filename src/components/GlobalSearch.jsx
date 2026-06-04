import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';

const GROUPS = [
  { type: 'company',  icon: '\u{1F3E2}', label: 'Companies' },
  { type: 'contact',  icon: '\u{1F464}', label: 'Contacts' },
  { type: 'location', icon: '\u{1F4CD}', label: 'Locations' },
  { type: 'deal',     icon: '\u{1F4B0}', label: 'Deals' },
  { type: 'lead',     icon: '\u{1F3AF}', label: 'Leads' },
  { type: 'ticket',   icon: '\u{1F3AB}', label: 'Tickets' },
];

export default function GlobalSearch({ onNavigate }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState({});
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setResults({}); return; }
    setLoading(true);
    const id = setTimeout(() => runSearch(query), 250);
    return () => clearTimeout(id);
  }, [q]);

  const runSearch = async (query) => {
    const like = `%${query}%`;
    const numeric = /^\d+$/.test(query) ? parseInt(query) : null;
    const ticketOr = numeric ? `subject.ilike.${like},ticket_number.eq.${numeric}` : `subject.ilike.${like}`;

    const [co, ct, loc, d, l, t] = await Promise.all([
      supabase.from('companies').select('id, name, domain').or(`name.ilike.${like},domain.ilike.${like}`).limit(5),
      supabase.from('contacts').select('id, first_name, last_name, email').or(`first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like},phone.ilike.${like}`).limit(5),
      supabase.from('locations').select('id, name, city').or(`name.ilike.${like},city.ilike.${like}`).limit(5),
      supabase.from('deals').select('id, name, stage').ilike('name', like).limit(5),
      supabase.from('leads').select('id, name, stage').ilike('name', like).limit(5),
      supabase.from('tickets').select('id, subject, ticket_number').or(ticketOr).limit(5),
    ]);

    setResults({
      company: (co.data || []).map(x => ({ id: x.id, label: x.name, sub: x.domain })),
      contact: (ct.data || []).map(x => ({ id: x.id, label: [x.first_name, x.last_name].filter(Boolean).join(' ') || x.email, sub: x.email })),
      location: (loc.data || []).map(x => ({ id: x.id, label: x.name, sub: x.city })),
      deal: (d.data || []).map(x => ({ id: x.id, label: x.name, sub: (x.stage || '').replace(/_/g, ' ') })),
      lead: (l.data || []).map(x => ({ id: x.id, label: x.name, sub: (x.stage || '').replace(/_/g, ' ') })),
      ticket: (t.data || []).map(x => ({ id: x.id, label: x.subject, sub: x.ticket_number ? `#${x.ticket_number}` : '' })),
    });
    setLoading(false);
    setOpen(true);
  };

  const pick = (type, id) => {
    setOpen(false); setQ('');
    onNavigate?.(type, id);
  };

  const total = Object.values(results).reduce((n, arr) => n + (arr?.length || 0), 0);

  return (
    <div className="relative" ref={ref}>
      <div className="flex items-center">
        <span className="absolute left-2.5 text-dim text-sm pointer-events-none">{'\u{1F50D}'}</span>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          onFocus={() => { if (total > 0) setOpen(true); }}
          placeholder="Search…"
          className="w-28 sm:w-44 lg:w-64 pl-8 pr-3 py-1.5 bg-card border border-bdr rounded-xl text-sm text-paper placeholder-dim focus:outline-none focus:border-ember sm:focus:w-72 transition-all" />
      </div>

      {open && q.trim().length >= 2 && (
        <div className="absolute right-0 top-full mt-2 w-80 max-h-[70vh] overflow-y-auto glass-card rounded-2xl shadow-xl z-50">
          {loading && total === 0 && <div className="px-4 py-6 text-center text-dim text-sm">Searching…</div>}
          {!loading && total === 0 && <div className="px-4 py-6 text-center text-dim text-sm">No matches for "{q}"</div>}
          {GROUPS.map(g => {
            const items = results[g.type] || [];
            if (!items.length) return null;
            return (
              <div key={g.type} className="border-b border-bdr last:border-b-0">
                <div className="px-3 pt-2 pb-1 text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim">{g.label}</div>
                {items.map(it => (
                  <button key={it.id} onClick={() => pick(g.type, it.id)}
                    className="w-full px-3 py-2 text-left hover:bg-card/60 flex items-center gap-2">
                    <span className="text-sm shrink-0">{g.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-paper truncate">{it.label}</div>
                      {it.sub && <div className="text-[10px] text-dim truncate">{it.sub}</div>}
                    </div>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
