import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../settings.ts';
import { decide, isNoise, saysName } from './filter.ts';

const ctx = { layout: 'small' as const, keyHeld: false, lastSpokeAt: null, now: 100_000 };

describe('whether a sentence leaves the PC', () => {
  it('in the scene, by default, everything goes', () => {
    expect(decide('Bonjour à tous', { ...ctx, layout: 'scene' }, DEFAULTS)).toEqual({
      pass: true,
      by: 'off',
    });
  });

  it('says which rule let the sentence through, the first that holds', () => {
    const all = { ...ctx, keyHeld: true, lastSpokeAt: 99_000 };
    expect(decide('Agent viens', { ...all, layout: 'scene' }, DEFAULTS)).toMatchObject({ by: 'off' });
    expect(decide('Agent viens', all, DEFAULTS)).toMatchObject({ by: 'touche' });
    expect(decide('Agent viens', { ...all, keyHeld: false }, DEFAULTS)).toMatchObject({ by: 'nom' });
    expect(decide('Et demain ?', { ...all, keyHeld: false }, DEFAULTS)).toMatchObject({ by: 'fenetre' });
  });

  it('in small mode, by default, a sentence to someone else stays', () => {
    expect(decide('Tu passes à gauche', ctx, DEFAULTS)).toEqual({ pass: false, reason: 'filtered' });
  });

  it('its name lets it through, even badly written, as do the other words', () => {
    const named = { ...DEFAULTS, agent: { ...DEFAULTS.agent, name: 'Amélie' } };
    for (const heard of ['Amélie, ça va ?', 'dis AMÉLIE', 'Amelia tu es là', 'Amalie'])
      expect(decide(heard, ctx, named).pass).toBe(true);
    const other = { ...DEFAULTS, name: { ...DEFAULTS.name, words: ['Amélie'] } };
    expect(decide('Amélie, ça va ?', ctx, other).pass).toBe(true);
    expect(saysName('Mathieu viens', ['Amélie'], 2)).toBe(false);
  });

  it('15 s after the voice, and not one more', () => {
    expect(decide('Et demain ?', { ...ctx, lastSpokeAt: 85_000 }, DEFAULTS).pass).toBe(true);
    expect(decide('Et demain ?', { ...ctx, lastSpokeAt: 84_999 }, DEFAULTS).pass).toBe(false);
  });

  it('the key held', () => {
    expect(decide('Et demain ?', { ...ctx, keyHeld: true }, DEFAULTS).pass).toBe(true);
  });

  it('each mechanic works on its own and turns off on its own', () => {
    const off = {
      ...DEFAULTS,
      name: { ...DEFAULTS.name, on: false },
      window: { ...DEFAULTS.window, on: false },
      key: { ...DEFAULTS.key, on: false },
    };
    const all = { ...ctx, keyHeld: true, lastSpokeAt: 99_000 };
    expect(decide('Agent', all, off).pass).toBe(false);
    expect(decide('Agent', all, { ...off, key: DEFAULTS.key }).pass).toBe(true);
    expect(decide('Bonjour', all, { ...off, window: DEFAULTS.window }).pass).toBe(true);
    expect(decide('Bonjour', all, { ...off, filter: { scene: false, small: false } }).pass).toBe(true);
  });

  it('what a transcription invents never goes, not even in the scene', () => {
    for (const t of ['Sous-titres réalisés par Amara.org', 'Merci.', '...', ' ']) {
      expect(isNoise(t)).toBe(true);
      expect(decide(t, { ...ctx, layout: 'scene' }, DEFAULTS)).toEqual({ pass: false, reason: 'noise' });
    }
    expect(isNoise('Merci pour hier')).toBe(false);
  });
});
