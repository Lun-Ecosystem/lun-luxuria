import { describe, expect, it } from 'vitest';
import { charger, type Scenario } from '../scenario.ts';

const scenarios = import.meta.glob<Scenario>(['./*.ts', '!./*.test.ts'], { eager: true, import: 'default' });

describe('les scénarios de départ', () => {
  it('sont quinze', () => {
    expect(Object.keys(scenarios)).toHaveLength(15);
  });

  it.each(Object.entries(scenarios))('%s : chargé, données seules, nommé comme son fichier', (file, s) => {
    expect(charger(s)).toBe(s);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(`./${s.nom}.ts`).toBe(file);
  });
});
