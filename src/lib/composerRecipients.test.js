import { describe, it, expect } from 'vitest';
import { finalRecipients, MAX_RECIPIENTS } from './composerRecipients.js';
import { isSubmitKey } from './submitKey.js';

const a = (email, name = '') => ({ name, email });

describe('finalRecipients', () => {
  it('sends the chips as they are', () => {
    const r = finalRecipients({ to: [a('dan@venue.com')], cc: [a('kate@venue.com')] });
    expect(r.problem).toBeNull();
    expect(r.to.map((x) => x.email)).toEqual(['dan@venue.com']);
    expect(r.cc.map((x) => x.email)).toEqual(['kate@venue.com']);
  });
  it('adds a valid address still typed in a box', () => {
    const r = finalRecipients({ to: [a('dan@venue.com')], ccPending: 'Ops <OPS@venue.com>' });
    expect(r.problem).toBeNull();
    expect(r.cc.map((x) => x.email)).toEqual(['ops@venue.com']);
  });
  it('refuses to send while a box holds text that is not an address', () => {
    const r = finalRecipients({ to: [a('dan@venue.com')], ccPending: 'kate at venue' });
    expect(r.problem).toMatch(/Cc line/);
    expect(r.to).toEqual([]);
  });
  it('needs someone on To', () => {
    expect(finalRecipients({ cc: [a('kate@venue.com')] }).problem).toMatch(/To line/);
    expect(finalRecipients({}).problem).toMatch(/To line/);
  });
  it('never lists anyone twice, and To wins over Cc', () => {
    const r = finalRecipients({ to: [a('dan@venue.com')], toPending: 'dan@venue.com', cc: [a('dan@venue.com'), a('kate@venue.com')] });
    expect(r.to.map((x) => x.email)).toEqual(['dan@venue.com']);
    expect(r.cc.map((x) => x.email)).toEqual(['kate@venue.com']);
  });
  it('stops at the same recipient cap as the send functions', () => {
    const many = Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => a(`p${i}@x.com`));
    expect(finalRecipients({ to: many }).problem).toMatch(/Too many/);
  });
});

describe('isSubmitKey', () => {
  const key = (over) => ({ key: 'Enter', metaKey: false, ctrlKey: false, shiftKey: false, nativeEvent: { isComposing: false }, ...over });
  it('sends on Cmd+Enter and Ctrl+Enter', () => {
    expect(isSubmitKey(key({ metaKey: true }))).toBe(true);
    expect(isSubmitKey(key({ ctrlKey: true }))).toBe(true);
  });
  it('leaves Enter and Shift+Enter as new lines', () => {
    expect(isSubmitKey(key())).toBe(false);
    expect(isSubmitKey(key({ shiftKey: true }))).toBe(false);
  });
  it('does nothing while an IME is composing', () => {
    expect(isSubmitKey(key({ metaKey: true, nativeEvent: { isComposing: true } }))).toBe(false);
  });
});

describe('mixed good and bad typed addresses', () => {
  it('refuses the whole line rather than sending to the good one only', () => {
    const r = finalRecipients({ toPending: 'kate@venue.com, dan@venue' });
    expect(r.problem).toMatch(/dan@venue/);
    expect(r.to).toEqual([]);
  });
});
