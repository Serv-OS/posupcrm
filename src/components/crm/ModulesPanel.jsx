import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';

const STATUS_STYLES = {
  quoted: 'bg-slate-500/20 text-slate-300',
  included: 'bg-blue-500/20 text-blue-300',
  enabling: 'bg-orange-500/20 text-orange-300',
  live: 'bg-green-500/20 text-green-300',
  disabled: 'bg-red-500/20 text-red-300',
};

export default function ModulesPanel({ profile }) {
  const [modules, setModules] = useState([]);
  const [locations, setLocations] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [locationModules, setLocationModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedLocation, setSelectedLocation] = useState('all');

  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const [m, l, c, lm] = await Promise.all([
      supabase.from('modules').select('*').order('sort_order'),
      supabase.from('locations').select('id, name, company_id, status').order('name'),
      supabase.from('companies').select('id, name'),
      supabase.from('location_modules').select('*'),
    ]);
    setModules(m.data || []);
    setLocations(l.data || []);
    setCompanies(c.data || []);
    setLocationModules(lm.data || []);
    setLoading(false);
  };

  const companyName = (id) => companies.find(c => c.id === id)?.name || '';

  const moduleStats = useMemo(() => {
    const map = {};
    modules.forEach(m => {
      const lms = locationModules.filter(lm => lm.module_id === m.id);
      map[m.id] = {
        total: lms.length,
        live: lms.filter(lm => lm.status === 'live').length,
        enabling: lms.filter(lm => lm.status === 'enabling').length,
      };
    });
    return map;
  }, [modules, locationModules]);

  const filteredLM = useMemo(() => {
    if (selectedLocation === 'all') return locationModules;
    return locationModules.filter(lm => lm.location_id === selectedLocation);
  }, [locationModules, selectedLocation]);

  const getLocationModuleStatus = (locationId, moduleId) => {
    return locationModules.find(lm => lm.location_id === locationId && lm.module_id === moduleId);
  };

  const toggleModule = async (locationId, moduleId, currentLM) => {
    if (!canWrite) return;
    if (currentLM) {
      // Cycle: quoted -> included -> enabling -> live -> disabled -> (remove)
      const cycle = ['quoted', 'included', 'enabling', 'live', 'disabled'];
      const idx = cycle.indexOf(currentLM.status);
      if (idx === cycle.length - 1) {
        await supabase.from('location_modules').delete().eq('id', currentLM.id);
      } else {
        const newStatus = cycle[idx + 1];
        const patch = { status: newStatus };
        if (newStatus === 'live') patch.enabled_at = new Date().toISOString();
        if (newStatus === 'disabled') patch.disabled_at = new Date().toISOString();
        await supabase.from('location_modules').update(patch).eq('id', currentLM.id);
      }
    } else {
      await supabase.from('location_modules').insert({
        location_id: locationId, module_id: moduleId, status: 'quoted',
      });
    }
    load();
  };

  const liveLocations = locations.filter(l => l.status === 'live' || l.status === 'onboarding');

  const label = "text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim";

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-bdr">
        <div className="text-lg font-bold text-paper">Product Modules</div>
        <div className="text-[10px] text-dim font-mono uppercase tracking-[0.18em]">
          {modules.length} modules / {locations.length} locations
        </div>
      </div>

      {/* Module catalogue overview */}
      <div className="px-6 py-4 border-b border-bdr">
        <div className={label + ' mb-3'}>Module Catalogue</div>
        <div className="grid grid-cols-2 gap-2">
          {modules.map(m => {
            const s = moduleStats[m.id] || { total: 0, live: 0, enabling: 0 };
            return (
              <div key={m.id} className="bg-card/50 border border-bdr rounded-lg px-3 py-2 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-paper">{m.name}</div>
                  <div className="text-xs text-dim">{m.description}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm text-paper font-mono">{s.live}</div>
                  <div className="text-[9px] text-dim">live</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Location x Module matrix */}
      <div className="px-6 py-3 border-b border-bdr flex items-center gap-2">
        <div className={label}>Location enablement</div>
        <select value={selectedLocation} onChange={e => setSelectedLocation(e.target.value)}
          className="ml-auto px-2 py-1 bg-card border border-bdr rounded text-xs text-paper focus:outline-none focus:border-ember">
          <option value="all">All locations</option>
          {locations.map(l => (
            <option key={l.id} value={l.id}>{l.name} ({companyName(l.company_id)})</option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="px-6 py-8 text-center text-dim text-sm">Loading...</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-bdr text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim">
                <th className="px-4 py-2.5 text-left sticky left-0 bg-ink z-10">Location</th>
                {modules.map(m => (
                  <th key={m.id} className="px-2 py-2.5 text-center whitespace-nowrap">
                    <div className="w-16 truncate" title={m.name}>{m.name.split(' ')[0]}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(selectedLocation === 'all' ? locations : locations.filter(l => l.id === selectedLocation)).map(loc => (
                <tr key={loc.id} className="border-b border-bdr hover:bg-card/30">
                  <td className="px-4 py-2.5 sticky left-0 bg-ink z-10">
                    <div className="text-sm font-medium text-paper">{loc.name}</div>
                    <div className="text-xs text-ember">{companyName(loc.company_id)}</div>
                  </td>
                  {modules.map(mod => {
                    const lm = getLocationModuleStatus(loc.id, mod.id);
                    return (
                      <td key={mod.id} className="px-2 py-2 text-center">
                        {lm ? (
                          <button onClick={() => toggleModule(loc.id, mod.id, lm)}
                            className={`px-1.5 py-0.5 text-[8px] font-bold uppercase rounded cursor-pointer ${STATUS_STYLES[lm.status]}`}
                            title={`Click to advance status (currently: ${lm.status})`}>
                            {lm.status}
                          </button>
                        ) : (
                          canWrite ? (
                            <button onClick={() => toggleModule(loc.id, mod.id, null)}
                              className="w-5 h-5 rounded border border-bdr hover:border-ember text-dim hover:text-paper text-[10px] mx-auto flex items-center justify-center"
                              title="Enable module">+</button>
                          ) : (
                            <span className="text-dim text-[10px]">-</span>
                          )
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
