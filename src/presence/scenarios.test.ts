// @vitest-environment node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { juger, passe } from './judge.ts';
import { jouer } from './player.ts';
import { releve, type Juge } from './releve.ts';
import { charger, type Partie, type Scenario } from './scenario.ts';

/**
 * The scenarios, played and judged: any expectation failed or not played fails, and so does a known defect that no
 * longer gives its species and its value. `npm run scenarios` also writes the report and each game's trace in
 * `BANC_DIR/scenarios`, out of the repository: a trace holds what was said.
 */
const scenarios = import.meta.glob<Scenario>('./scenarios/*.ts', { eager: true, import: 'default' });
const ecrire = import.meta.env.MODE === 'scenarios';
const DIR = join(process.env['BANC_DIR'] ?? '../banc-sons', 'scenarios');

const juges: Juge[] = [];
const parties = new Map<string, Partie>();

/** The page's trace and the player's log in one file, on one clock, after a line that says the format. */
const deroule = (p: Partie) =>
  [{ format: p.format }, ...[...p.page, ...p.banc].sort((x, y) => x.at - y.at)]
    .map((e) => JSON.stringify(e))
    .join('\n') + '\n';

describe('les scénarios de départ', () => {
  it('sont dix-sept', () => {
    expect(Object.keys(scenarios)).toHaveLength(17);
  });

  it.each(Object.entries(scenarios))("%s : chargé, joué deux fois à l'identique, tenu", async (file, s) => {
    expect(charger(s)).toBe(s);
    // Petit mode, jamais joué dans la chaîne : son « rien-ne-part » a des bornes sur une ligne du serveur.
    if (s.nom === 'phrase-ecartee') expect(() => charger(s, 'chaine')).toThrow(/« rien-ne-part »/);
    else expect(charger(s, 'chaine')).toBe(s);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(`./scenarios/${s.nom}.ts`).toBe(file);
    const partie = await jouer(s);
    expect(await jouer(s)).toEqual(partie);
    const juge: Juge = { nom: s.nom, verdicts: juger(s, partie) };
    juges.push(juge);
    parties.set(s.nom, partie);
    expect(juge.verdicts.every(passe), releve([juge])).toBe(true);
  });
});

afterAll(() => {
  if (!ecrire) return;
  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, 'releve-scenarios.md'), releve(juges));
  for (const [nom, p] of parties) writeFileSync(join(DIR, `deroule-${nom}.jsonl`), deroule(p));
  console.log(`Relevé et déroulés écrits dans ${DIR}.`);
});
