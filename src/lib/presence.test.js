import { describe, it, expect } from 'vitest';
import { readPresence } from './presence.js';

const NOW = new Date('2026-09-02T12:00:00Z').getTime();
const agoSecs = (s) => new Date(NOW - s * 1000).toISOString();

describe('readPresence', () => {
  it('shows a fresh active beat as open', () => {
    const r = readPresence({ state: 'active', last_seen_at: agoSecs(10) }, NOW);
    expect(r.label).toBe('Open now');
    expect(r.open).toBe(true);
    expect(r.tone).toBe('green');
  });

  // The distinction Peter actually asked for: at their desk vs left it open.
  it('separates idle from active, and counts idle from the last real input', () => {
    const r = readPresence({
      state: 'idle', last_seen_at: agoSecs(20),
      last_active_at: new Date(NOW - 12 * 60_000).toISOString(),
    }, NOW);
    expect(r.label).toBe('Open but idle 12m');
    expect(r.open).toBe(true);
  });

  it('reports a backgrounded tab as still open', () => {
    const r = readPresence({ state: 'hidden', last_seen_at: agoSecs(45) }, NOW);
    expect(r.label).toBe('Open, in another tab');
    expect(r.open).toBe(true);
  });

  // A sleeping laptop cannot send anything, so silence has to be the signal.
  it('treats silence as asleep, not as whatever the last state claimed', () => {
    const r = readPresence({ state: 'active', last_seen_at: agoSecs(20 * 60) }, NOW);
    expect(r.open).toBe(false);
    expect(r.label).toMatch(/asleep or closed/i);
    expect(r.label).toMatch(/20m ago/);
  });

  it('survives one missed beat on a throttled background tab', () => {
    // Hidden tabs beat every 2 min; 4 min must not yet read as gone.
    const r = readPresence({ state: 'hidden', last_seen_at: agoSecs(4 * 60) }, NOW);
    expect(r.open).toBe(true);
  });

  it('believes a clean close immediately', () => {
    const r = readPresence({ state: 'closed', last_seen_at: agoSecs(5 * 60) }, NOW);
    expect(r.open).toBe(false);
    expect(r.label).toMatch(/^Closed/);
  });

  it('does not claim someone is present when nothing was ever recorded', () => {
    expect(readPresence(null, NOW).open).toBe(false);
    expect(readPresence({}, NOW).label).toBe('Never seen');
  });

  it('scales the age past an hour and a day', () => {
    expect(readPresence({ state: 'active', last_seen_at: agoSecs(3 * 3600) }, NOW).label).toMatch(/3h ago/);
    expect(readPresence({ state: 'active', last_seen_at: agoSecs(2 * 86400) }, NOW).label).toMatch(/2d ago/);
  });
});
