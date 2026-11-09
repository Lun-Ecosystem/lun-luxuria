import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../settings.ts';
import { PRESETS, presetOf, withPreset } from './presets.ts';

describe('the room presets', () => {
  it('« Normal » is today’s defaults', () => {
    const { silenceMs, pauseMs, minSpeechMs, floorDb } = DEFAULTS.endOfSpeech;
    expect(PRESETS.normal).toEqual({ silenceMs, pauseMs, minSpeechMs, floorDb });
    expect(presetOf(DEFAULTS.endOfSpeech)).toBe('normal');
  });

  it('a preset fills the four values, and only them', () => {
    const next = withPreset(DEFAULTS.endOfSpeech, 'bruit');
    expect(next).toEqual({ ...DEFAULTS.endOfSpeech, ...PRESETS.bruit });
    expect(next.speculate).toBe(DEFAULTS.endOfSpeech.speculate);
    expect(presetOf(next)).toBe('bruit');
  });

  it('one value touched by hand: none of them, « Personnalisé »', () => {
    expect(presetOf({ ...DEFAULTS.endOfSpeech, silenceMs: 900 })).toBeNull();
  });

  it('the three differ', () => {
    expect(new Set(Object.values(PRESETS).map((p) => JSON.stringify(p))).size).toBe(3);
  });
});
