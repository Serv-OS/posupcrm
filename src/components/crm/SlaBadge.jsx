import { computeSla, SLA_TONE_STYLES } from '../../lib/sla';

export default function SlaBadge({ ticket, className = '' }) {
  const sla = computeSla(ticket);
  if (sla.phase === 'none') return <span className="text-dim text-xs">—</span>;
  return (
    <span title={sla.detail || ''}
      className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold uppercase rounded ${SLA_TONE_STYLES[sla.tone]} ${className}`}>
      {sla.label}
    </span>
  );
}
