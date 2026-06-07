import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { applyBrandingValues } from '../../lib/branding';

// White-label branding for this instance: app name + brand colours.
// Logos live in the existing Quote branding card (support_settings.logo_url*).
export default function BrandingCard({ profile }) {
  const [appName, setAppName] = useState('');
  const [primary, setPrimary] = useState('#15C26A');
  const [secondary, setSecondary] = useState('#7C5CFF');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const isOwner = profile.role === 'owner';

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const { data } = await supabase.from('support_settings')
        .select('app_name, primary_color, secondary_color').eq('id', 1).maybeSingle();
      if (data) {
        setAppName(data.app_name || '');
        if (data.primary_color) setPrimary(data.primary_color);
        if (data.secondary_color) setSecondary(data.secondary_color);
      }
    } catch { /* columns may not exist yet */ }
    setLoaded(true);
  };

  // live preview
  useEffect(() => {
    if (loaded) applyBrandingValues({ primary_color: primary, secondary_color: secondary });
  }, [primary, secondary, loaded]);

  const save = async () => {
    setError(''); setSaving(true); setSaved(false);
    const { error: e } = await supabase.from('support_settings').upsert({
      id: 1,
      app_name: appName.trim() || null,
      primary_color: primary,
      secondary_color: secondary,
    }, { onConflict: 'id' });
    setSaving(false);
    if (e) { setError(e.message); return; }
    applyBrandingValues({ app_name: appName, primary_color: primary, secondary_color: secondary });
    setSaved(true); setTimeout(() => setSaved(false), 2500);
  };

  const input = "w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper placeholder-dim focus:outline-none focus:border-ember";
  const label = "text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block";

  if (!loaded) return null;

  const Swatch = ({ value, onChange, name }) => (
    <div>
      <label className={label}>{name}</label>
      <div className="flex items-center gap-2">
        <input type="color" value={value} onChange={e => onChange(e.target.value)}
          className="w-10 h-10 rounded-lg border border-bdr bg-card cursor-pointer shrink-0" />
        <input className={input} value={value} onChange={e => onChange(e.target.value)} placeholder="#15C26A" />
      </div>
    </div>
  );

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-bdr flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg"
          style={{ background: `linear-gradient(135deg, ${primary}, ${secondary})` }}>🎨</div>
        <div className="flex-1">
          <div className="text-base font-bold text-paper">Branding &amp; white-label</div>
          <div className="text-xs text-muted">App name and brand colours for this workspace</div>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {!isOwner ? (
          <div className="text-sm text-muted">An owner manages branding.</div>
        ) : (
          <>
            <div>
              <label className={label}>App name</label>
              <input className={input} value={appName} onChange={e => setAppName(e.target.value)} placeholder="ServOS" />
              <div className="text-[11px] text-dim mt-1">Shown in the browser tab and as the fallback wordmark.</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Swatch name="Primary colour" value={primary} onChange={setPrimary} />
              <Swatch name="Secondary colour" value={secondary} onChange={setSecondary} />
            </div>
            <div className="text-[11px] text-dim">Colours preview live across the app. Logos are set in the Quote branding card below.</div>

            {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>}

            <div className="flex items-center gap-3">
              <button onClick={save} disabled={saving} className="btn-glass px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
                {saving ? 'Saving…' : 'Save branding'}
              </button>
              {saved && <span className="text-sm text-emerald-600 font-medium">✓ Saved</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
