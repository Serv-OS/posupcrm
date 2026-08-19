import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

// Your booking page, from the inside: the link to share, the hours you are
// bookable, and who has booked.
//
// Working hours are held in YOUR timezone and shown as such, because the whole
// point is that a booker in the UK never has to think about it — and you never
// have to either.

const DAYS = [['1','Monday'],['2','Tuesday'],['3','Wednesday'],['4','Thursday'],['5','Friday'],['6','Saturday'],['0','Sunday']];
const ZONES = ['America/Los_Angeles','America/New_York','Europe/London','Europe/Dublin','Australia/Sydney','UTC'];

export default function BookingsPanel({ profile }) {
  const [bt, setBt] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const canWrite = profile.role === 'owner' || profile.role === 'editor';
  const myZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const load = async () => {
    const [t, b] = await Promise.all([
      supabase.from('booking_types').select('*').eq('slug', 'onboarding-call').maybeSingle(),
      supabase.from('bookings').select('*').order('starts_at', { ascending: true }),
    ]);
    setBt(t.data || null);
    setBookings(b.data || []);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    const { id, created_at, updated_at, ...patch } = bt;
    const { error } = await supabase.from('booking_types').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    setSaving(false);
    if (error) { alert('Could not save: ' + error.message); return; }
    setSaved(true); setTimeout(() => setSaved(false), 2000);
    load();
  };

  const setHours = (dow, ranges) => setBt(p => ({ ...p, hours: { ...(p.hours || {}), [dow]: ranges } }));
  const toggleDay = (dow) => {
    const cur = bt.hours?.[dow];
    if (cur?.length) { const h = { ...bt.hours }; delete h[dow]; setBt(p => ({ ...p, hours: h })); }
    else setHours(dow, [['09:00','17:00']]);
  };

  if (!bt) return <div className="h-full flex items-center justify-center text-dim text-sm">Loading…</div>;

  const link = `${window.location.origin}/book/${bt.slug}`;
  const upcoming = bookings.filter(b => b.status === 'confirmed' && new Date(b.starts_at) >= new Date());
  const past = bookings.filter(b => new Date(b.starts_at) < new Date() || b.status === 'cancelled');
  const input = "px-2.5 py-1.5 bg-card border border-bdr rounded-xl text-sm text-paper";

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-bdr flex items-center gap-3 flex-wrap">
        <div>
          <div className="text-lg font-bold text-paper">Booking page</div>
          <div className="text-[10px] text-dim font-mono uppercase tracking-[0.18em]">
            {upcoming.length} upcoming · your hours are in {bt.timezone.replace(/_/g,' ')}
          </div>
        </div>
        {canWrite && (
          <button onClick={save} disabled={saving} className="ml-auto btn-glass px-5 py-2 rounded-xl text-sm font-semibold disabled:opacity-50">
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4 max-w-3xl">
        {/* The link */}
        <div className="glass-card rounded-2xl p-4">
          <div className="text-sm font-bold text-paper mb-1">Share this link</div>
          <div className="text-xs text-muted mb-2">Anyone with it sees your real availability and books straight into your calendar.</div>
          <div className="flex gap-2">
            <input readOnly value={link} onFocus={e => e.target.select()} className={input + ' flex-1 font-mono text-xs'} />
            <button onClick={() => { navigator.clipboard.writeText(link); alert('Link copied'); }} className="btn-ghost px-3 py-1.5 rounded-xl text-xs shrink-0">Copy</button>
            <a href={link} target="_blank" rel="noreferrer" className="btn-ghost px-3 py-1.5 rounded-xl text-xs shrink-0">Preview</a>
          </div>
        </div>

        {/* The call itself */}
        <div className="glass-card rounded-2xl p-4 space-y-3">
          <div className="text-sm font-bold text-paper">The call</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <L label="Name"><input className={input + ' w-full'} value={bt.name} onChange={e => setBt(p => ({ ...p, name: e.target.value }))} disabled={!canWrite} /></L>
            <L label="Length"><select className={input + ' w-full'} value={bt.duration_mins} onChange={e => setBt(p => ({ ...p, duration_mins: +e.target.value }))} disabled={!canWrite}>
              {[15,20,30,45,60].map(n => <option key={n} value={n}>{n} min</option>)}</select></L>
            <L label="Gap either side"><select className={input + ' w-full'} value={bt.buffer_mins} onChange={e => setBt(p => ({ ...p, buffer_mins: +e.target.value }))} disabled={!canWrite}>
              {[0,5,10,15,30].map(n => <option key={n} value={n}>{n} min</option>)}</select></L>
            <L label="Your timezone"><select className={input + ' w-full'} value={bt.timezone} onChange={e => setBt(p => ({ ...p, timezone: e.target.value }))} disabled={!canWrite}>
              {[...new Set([bt.timezone, myZone, ...ZONES])].map(z => <option key={z} value={z}>{z.replace(/_/g,' ')}</option>)}</select></L>
            <L label="Least notice"><select className={input + ' w-full'} value={bt.min_notice_hrs} onChange={e => setBt(p => ({ ...p, min_notice_hrs: +e.target.value }))} disabled={!canWrite}>
              {[1,2,4,12,24,48].map(n => <option key={n} value={n}>{n} hours</option>)}</select></L>
            <L label="How far ahead"><select className={input + ' w-full'} value={bt.max_days_ahead} onChange={e => setBt(p => ({ ...p, max_days_ahead: +e.target.value }))} disabled={!canWrite}>
              {[7,14,30,60,90].map(n => <option key={n} value={n}>{n} days</option>)}</select></L>
            <L label="Slot every"><select className={input + ' w-full'} value={bt.slot_step_mins} onChange={e => setBt(p => ({ ...p, slot_step_mins: +e.target.value }))} disabled={!canWrite}>
              {[15,30,60].map(n => <option key={n} value={n}>{n} min</option>)}</select></L>
            <L label="Calendar"><input className={input + ' w-full'} value={bt.host_email || ''} onChange={e => setBt(p => ({ ...p, host_email: e.target.value }))} disabled={!canWrite} /></L>
          </div>
          <L label="Description"><textarea rows={2} className={input + ' w-full resize-y'} value={bt.description || ''} onChange={e => setBt(p => ({ ...p, description: e.target.value }))} disabled={!canWrite} /></L>
        </div>

        {/* Hours */}
        <div className="glass-card rounded-2xl p-4">
          <div className="text-sm font-bold text-paper">When you're bookable</div>
          <div className="text-xs text-muted mb-3">
            In <span className="text-paper font-semibold">{bt.timezone.replace(/_/g,' ')}</span>. Bookers always see these converted to their own time.
          </div>
          <div className="space-y-2">
            {DAYS.map(([dow, label]) => {
              const ranges = bt.hours?.[dow] || [];
              const on = ranges.length > 0;
              return (
                <div key={dow} className="flex items-center gap-2 flex-wrap">
                  <label className="flex items-center gap-2 w-28 shrink-0 cursor-pointer">
                    <input type="checkbox" checked={on} onChange={() => canWrite && toggleDay(dow)} className="accent-ember" disabled={!canWrite} />
                    <span className={`text-sm ${on ? 'text-paper' : 'text-dim'}`}>{label}</span>
                  </label>
                  {on ? ranges.map((r, i) => (
                    <span key={i} className="flex items-center gap-1">
                      <input type="time" className={input} value={r[0]} disabled={!canWrite}
                        onChange={e => { const n = ranges.map(x => [...x]); n[i][0] = e.target.value; setHours(dow, n); }} />
                      <span className="text-dim text-xs">to</span>
                      <input type="time" className={input} value={r[1]} disabled={!canWrite}
                        onChange={e => { const n = ranges.map(x => [...x]); n[i][1] = e.target.value; setHours(dow, n); }} />
                      {canWrite && ranges.length > 1 && (
                        <button onClick={() => setHours(dow, ranges.filter((_, j) => j !== i))} className="text-red-500 px-1">×</button>
                      )}
                    </span>
                  )) : <span className="text-xs text-dim">Not bookable</span>}
                  {on && canWrite && (
                    <button onClick={() => setHours(dow, [...ranges, ['13:00','17:00']])} className="text-xs text-ember hover:underline">+ split</button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="text-[11px] text-dim mt-3">Anything already in your Google calendar blocks itself. You don't need to mark it here.</div>
        </div>

        {/* Who's booked */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-bdr text-sm font-bold text-paper">Upcoming ({upcoming.length})</div>
          {upcoming.length === 0 ? <div className="p-6 text-center text-xs text-dim italic">Nothing booked yet.</div> : (
            <div className="divide-y divide-bdr">
              {upcoming.map(b => <BookingRow key={b.id} b={b} myZone={myZone} />)}
            </div>
          )}
        </div>

        {past.length > 0 && (
          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-bdr text-sm font-bold text-paper">Past &amp; cancelled ({past.length})</div>
            <div className="divide-y divide-bdr opacity-70">
              {past.slice(-10).reverse().map(b => <BookingRow key={b.id} b={b} myZone={myZone} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BookingRow({ b, myZone }) {
  const when = new Date(b.starts_at);
  return (
    <div className="px-4 py-3 flex items-start gap-3 flex-wrap">
      <div className="min-w-[150px]">
        <div className="text-sm font-semibold text-paper">
          {when.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </div>
        <div className="text-[10px] text-dim">your time ({myZone.split('/').pop().replace(/_/g,' ')})</div>
        {b.booker_timezone && b.booker_timezone !== myZone && (
          <div className="text-[10px] text-muted">
            {when.toLocaleString('en-GB', { timeZone: b.booker_timezone, hour: '2-digit', minute: '2-digit' })} for them ({b.booker_timezone.split('/').pop().replace(/_/g,' ')})
          </div>
        )}
      </div>
      <div className="flex-1 min-w-[180px]">
        <div className="text-sm text-paper">{b.name}{b.company ? ` · ${b.company}` : ''}</div>
        <div className="text-xs text-muted">{b.email}{b.phone ? ` · ${b.phone}` : ''}</div>
        {b.notes && <div className="text-xs text-muted mt-1 whitespace-pre-wrap">{b.notes}</div>}
      </div>
      {b.status === 'cancelled' && <span className="text-[10px] font-bold uppercase text-red-600">Cancelled</span>}
    </div>
  );
}

function L({ label, children }) {
  return (
    <div>
      <label className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block">{label}</label>
      {children}
    </div>
  );
}
