import { describe, expect, it } from 'vitest';
import { missingToEnter } from './arrival.ts';
import { DEFAULTS, type Settings } from './settings.ts';

const settings = (change: (s: Settings) => void = () => {}) => {
  const s = structuredClone(DEFAULTS);
  change(s);
  return s;
};

describe('what entering waits for', () => {
  it('linked: a token, and nothing else', () => {
    const linked = settings((s) => (s.brain = 'linked'));
    expect(missingToEnter(linked, null)).toBe('Il manque le code d’appairage.');
    expect(missingToEnter(linked, 'jeton')).toBeNull();
  });

  it('alone: the model’s address and its name; the key stays optional', () => {
    expect(missingToEnter(settings(), null)).toBe('Il manque le nom du modèle.');
    expect(
      missingToEnter(
        settings((s) => (s.model.url = ' ')),
        null,
      ),
    ).toBe('Il manque l’adresse du modèle.');
    expect(
      missingToEnter(
        settings((s) => (s.model.name = 'qwen3:8b')),
        null,
      ),
    ).toBeNull();
  });
});
