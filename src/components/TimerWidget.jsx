import { useEffect, useState } from 'react';
import { Square } from 'lucide-react';
import { getRunning, stopTimer, fmtClock } from '../lib/timer';

// Always-visible running-timer pill in the top bar. Hidden when nothing runs.
export default function TimerWidget({ profile, onNavigate }) {
  const [running, setRunning] = useState(null);
  const [now, setNow] = useState(Date.now());

  const refresh = () => getRunning(profile.id).then(setRunning);

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    window.addEventListener('timer-changed', onChange);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { window.removeEventListener('timer-changed', onChange); clearInterval(tick); };
  }, [profile.id]);

  if (!running) return null;

  const elapsed = (now - new Date(running.started_at).getTime()) / 1000;
  const open = () => running.subject_type && running.subject_id && onNavigate?.(running.subject_type, running.subject_id);

  return (
    <div className="flex items-center gap-2 pl-2.5 pr-1.5 py-1 rounded-xl bg-emerald-500/15 border border-emerald-500/30 shrink-0">
      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
      <button onClick={open} className="min-w-0 max-w-[140px] text-left" title={running.label || 'Tracking'}>
        <div className="text-[11px] text-emerald-700 leading-tight truncate">{running.label || 'Tracking…'}</div>
        <div className="text-xs font-mono font-bold text-emerald-800 tabular-nums leading-tight">{fmtClock(elapsed)}</div>
      </button>
      <button onClick={() => stopTimer(profile.id)} title="Stop timer"
        className="w-7 h-7 rounded-lg bg-red-500 text-white flex items-center justify-center hover:bg-red-600 shrink-0">
        <Square size={12} fill="currentColor" />
      </button>
    </div>
  );
}
