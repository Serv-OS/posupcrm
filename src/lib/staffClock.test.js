import { describe, it, expect } from 'vitest';
import { punchTime, punchInput, zoneFor, isFallbackZone, zoneLabel, zoneOptions, DEFAULT_TZ } from './staffClock.js';

// 16:30 UTC on a British Summer Time day: 17:30 in London, 09:30 in Los Angeles.
const PUNCH = '2026-07-15T16:30:00Z';

describe('zoneFor', () => {
  it('prefers the person, then the business, then London', () => {
    expect(zoneFor({ timezone: 'America/Los_Angeles' }, 'Europe/London')).toBe('America/Los_Angeles');
    expect(zoneFor({ timezone: null }, 'America/New_York')).toBe('America/New_York');
    expect(zoneFor(null, null)).toBe(DEFAULT_TZ);
  });
  it('says when it is falling back', () => {
    expect(isFallbackZone({ timezone: 'Europe/London' })).toBe(false);
    expect(isFallbackZone({ timezone: null })).toBe(true);
    expect(isFallbackZone(undefined)).toBe(true);
  });
});

describe('punchTime', () => {
  it('reads the punch in the given zone, not the machine running this', () => {
    expect(punchTime(PUNCH, 'Europe/London')).toBe('17:30');
    expect(punchTime(PUNCH, 'America/Los_Angeles')).toBe('09:30');
  });
  it('falls back to the business clock rather than the device when no zone is given', () => {
    expect(punchTime(PUNCH, null)).toBe('17:30');
  });
  it('survives a nonsense zone instead of blanking the row', () => {
    expect(punchTime(PUNCH, 'Not/AZone')).toBe('17:30');
  });
  it('renders nothing for an open punch', () => {
    expect(punchTime(null, 'Europe/London')).toBe('—');
  });
});

describe('punchInput', () => {
  it('gives the editor the date and time as that person saw it', () => {
    expect(punchInput(PUNCH, 'Europe/London')).toBe('2026-07-15 17:30');
    expect(punchInput(PUNCH, 'America/Los_Angeles')).toBe('2026-07-15 09:30');
  });
  it('rolls the date back when the zone is behind midnight', () => {
    // 03:00 UTC is still the previous evening in Los Angeles
    expect(punchInput('2026-07-15T03:00:00Z', 'America/Los_Angeles')).toBe('2026-07-14 20:00');
  });
});

describe('presentation', () => {
  it('labels a zone the way a person says it', () => {
    expect(zoneLabel('America/Los_Angeles')).toBe('Los Angeles');
    expect(zoneLabel('Europe/London')).toBe('London');
  });
  it('offers the business zone first and never repeats it', () => {
    const o = zoneOptions('America/New_York');
    expect(o[0]).toBe('America/New_York');
    expect(o.filter(x => x === 'America/New_York')).toHaveLength(1);
  });
});
