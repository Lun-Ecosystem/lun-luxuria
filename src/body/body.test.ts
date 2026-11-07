import { describe, expect, it } from 'vitest';
import { Mouth, stateOf } from './body.ts';

const base = {
  linked: true,
  capped: false,
  speaking: false,
  thinking: false,
  micOn: true,
  busy: false,
  silenced: false,
  hearing: false,
};

describe('the body', () => {
  it('the mouth does not flicker between its two thresholds', () => {
    const m = new Mouth(0.04, 0.02);
    expect([0.01, 0.03, 0.05, 0.03, 0.021, 0.019, 0.03].map((l) => m.next(l))).toEqual([
      false,
      false,
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it('shows what is true, the worst first', () => {
    expect(stateOf(base)).toBe('present');
    expect(stateOf({ ...base, hearing: true })).toBe('listening');
    expect(stateOf({ ...base, micOn: false })).toBe('muted');
    expect(stateOf({ ...base, thinking: true, micOn: false })).toBe('thinking');
    expect(stateOf({ ...base, busy: true, micOn: false })).toBe('busy');
    expect(stateOf({ ...base, speaking: true, thinking: true })).toBe('speaking');
    expect(stateOf({ ...base, linked: false, speaking: true })).toBe('unreachable');
    expect(stateOf({ ...base, capped: true })).toBe('capped');
    expect(stateOf({ ...base, silenced: true, micOn: false, busy: true })).toBe('silenced');
    expect(stateOf({ ...base, silenced: true, speaking: true })).toBe('speaking');
    expect(stateOf({ ...base, silenced: true, linked: false })).toBe('unreachable');
    expect(stateOf({ ...base, silenced: true, capped: true })).toBe('capped');
  });
});
