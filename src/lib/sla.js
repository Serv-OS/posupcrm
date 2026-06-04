// Computes the live SLA status for a ticket from its stored due dates.
// No server round-trip — uses response_due_at / resolution_due_at /
// first_response_at / resolved_at / closed_at already on the ticket.

const OPEN = (stage) => !['resolved', 'closed'].includes(stage);

function fmtDuration(ms) {
  const abs = Math.abs(ms);
  const m = Math.round(abs / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return rem ? `${h}h ${rem}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const hr = h % 24;
  return hr ? `${d}d ${hr}h` : `${d}d`;
}

// Returns { phase, tone, label, detail }
//   phase: 'response' | 'resolution' | 'done' | 'none'
//   tone:  'breach' | 'warn' | 'ok' | 'met' | 'muted'
export function computeSla(ticket, now = Date.now()) {
  if (!ticket) return { phase: 'none', tone: 'muted', label: '—' };

  const open = OPEN(ticket.stage);
  const respDue = ticket.response_due_at ? new Date(ticket.response_due_at).getTime() : null;
  const resDue = ticket.resolution_due_at ? new Date(ticket.resolution_due_at).getTime() : null;
  const firstResp = ticket.first_response_at ? new Date(ticket.first_response_at).getTime() : null;
  const resolvedAt = ticket.resolved_at ? new Date(ticket.resolved_at).getTime()
                   : ticket.closed_at ? new Date(ticket.closed_at).getTime() : null;

  if (!respDue && !resDue) return { phase: 'none', tone: 'muted', label: 'No SLA' };

  // --- Phase 1: first response ---
  if (!firstResp) {
    if (open && respDue) {
      const remaining = respDue - now;
      if (remaining < 0) return { phase: 'response', tone: 'breach', label: 'Response overdue', detail: `${fmtDuration(remaining)} late` };
      const warn = remaining < 30 * 60000; // <30m left
      return { phase: 'response', tone: warn ? 'warn' : 'ok', label: `Respond in ${fmtDuration(remaining)}`, detail: 'First response due' };
    }
    // closed without ever responding
    if (!open) return { phase: 'done', tone: 'muted', label: 'Closed, no reply logged' };
  }

  // First response happened — was it on time?
  const responseMet = firstResp && respDue ? firstResp <= respDue : true;

  // --- Phase 2: resolution ---
  if (open) {
    if (resDue) {
      const remaining = resDue - now;
      if (remaining < 0) return { phase: 'resolution', tone: 'breach', label: 'Resolution overdue', detail: `${fmtDuration(remaining)} late` };
      const warn = remaining < 60 * 60000; // <1h left
      return { phase: 'resolution', tone: warn ? 'warn' : 'ok', label: `Resolve in ${fmtDuration(remaining)}`, detail: responseMet ? 'On track' : 'Response was late' };
    }
  }

  // --- Resolved / closed ---
  const resolutionMet = resolvedAt && resDue ? resolvedAt <= resDue : true;
  const allMet = responseMet && resolutionMet;
  return {
    phase: 'done',
    tone: allMet ? 'met' : 'breach',
    label: allMet ? 'SLA met' : 'SLA breached',
    detail: !responseMet ? 'Response was late' : !resolutionMet ? 'Resolution was late' : 'Within targets',
  };
}

export const SLA_TONE_STYLES = {
  breach: 'bg-red-100 text-red-700 border border-red-200',
  warn: 'bg-amber-100 text-amber-700 border border-amber-200',
  ok: 'bg-blue-100 text-blue-700 border border-blue-200',
  met: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  muted: 'bg-slate-100 text-slate-500 border border-slate-200',
};

export function fmtMinutes(mins) {
  if (mins == null) return '';
  if (mins < 60) return `${mins}m`;
  const h = mins / 60;
  if (h < 24) return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
  const d = h / 24;
  return Number.isInteger(d) ? `${d}d` : `${d.toFixed(1)}d`;
}
