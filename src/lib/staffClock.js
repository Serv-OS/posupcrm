/* A punch belongs to the person who made it, not to whoever is reading it.
 *
 * clock_in / clock_out are stored as instants. Rendering one with no timeZone
 * uses the VIEWER's device clock, so the same shift reads 09:00 in London and
 * 01:00 in California, and a manager on holiday sees everyone's day shift.
 *
 * The zone to show, in order:
 *   1. the person's own profiles.timezone, if it is set
 *   2. the company's support_settings.business_timezone
 *   3. Europe/London, so a missing settings row still beats the device clock
 *
 * There is no better source available: shift_punches carries no site, shifts
 * carry an area rather than a location, and locations have no timezone column.
 */

export const DEFAULT_TZ = 'Europe/London';

/** The zone a person's punches should be read in. */
export const zoneFor = (person, businessTz) => person?.timezone || businessTz || DEFAULT_TZ;

/** True when we are falling back rather than using the person's own zone. */
export const isFallbackZone = (person) => !person?.timezone;

/** 'Los Angeles' from 'America/Los_Angeles'. */
export const zoneLabel = (tz) => String(tz || '').split('/').pop().replace(/_/g, ' ') || tz;

/** HH:MM in the given zone. Never falls back to the device clock. */
export function punchTime(ts, tz) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz || DEFAULT_TZ });
  } catch {
    // An unknown zone string should not blank the timesheet.
    return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: DEFAULT_TZ });
  }
}

/** 'YYYY-MM-DD HH:MM' in the given zone — the shape the punch editor expects. */
export function punchInput(ts, tz) {
  if (!ts) return '';
  const opt = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz || DEFAULT_TZ };
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-CA', opt).formatToParts(new Date(ts));
  } catch {
    parts = new Intl.DateTimeFormat('en-CA', { ...opt, timeZone: DEFAULT_TZ }).formatToParts(new Date(ts));
  }
  const p = parts.reduce((a, x) => (a[x.type] = x.value, a), {});
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** A short, honest list of zones to choose from, business zone first. */
export function zoneOptions(businessTz = DEFAULT_TZ) {
  const common = [
    'Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Madrid',
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'Australia/Sydney', 'Asia/Dubai', 'Asia/Kolkata',
  ];
  const all = [businessTz, ...common].filter(Boolean);
  return [...new Set(all)];
}
