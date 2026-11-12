// @vitest-environment node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { juger, passe } from './judge.ts';
import { jouer } from './player.ts';
import { releve, type Juge } from './releve.ts';
import { charger, choisir, type Partie, type Scenario } from './scenario.ts';

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
  it('sont dix-huit', () => {
    expect(Object.keys(scenarios)).toHaveLength(18);
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

/**
 * What the chain's transcription gave for each spoken line (12/11, one run of eleven by Hortense, one by each other
 * voice): the false model must choose the reply of the `dit` for each text, as a model that understands it would.
 * `echec`: a text that never matches, written as an expected failure (source `transcription`), not as a pass.
 */
const vus: { scenario: string; parole: number; entendus: string[]; echec?: string[] }[] = [
  {
    scenario: 'arrete-net',
    parole: 2,
    entendus: ['Arrête ?', 'Arret.', 'Arret ?', 'Arrête.', 'Arrête !'],
    echec: ['Allez !'],
  },
  {
    scenario: 'couper-le-blanc',
    parole: 2,
    entendus: ['Arrête ?', 'Arret.', 'Arret ?', 'Arrête.', 'Arrête !'],
    echec: ['Allez !'],
  },
  { scenario: 'non-court', parole: 2, entendus: ['Non.', 'Non !'] },
  { scenario: 'oui-puis-reparler', parole: 1, entendus: ['Oui ?', 'Oui?', 'Oui.', 'Louis.'] },
  {
    scenario: 'phrase-attente',
    parole: 1,
    entendus: [
      "J'ai dit mec.",
      "J'ai dit mai.",
      "J'ai des mails.",
      "J'ai des mains.",
      "J'ai des mecs.",
      "J'ai des milles.",
      "J'ai démètes.",
      "J'ai démilsé.",
    ],
  },
  ...['arrete-net', 'non-court', 'faire-taire', 'toux-parole', 'toux-courte'].map((scenario) => ({
    scenario,
    parole: 1,
    entendus: [
      'Recondement à la journée de demain.',
      'Reconte-moi la journée de demain.',
      'Racconte-moi la journée de demain.',
      'Raccontons à la journée de demain.',
      'Reconté moi la journée de demain.',
      'Recondo-moi la journée de demain.',
      'Raccont moi la journée de demain.',
    ],
  })),
  ...['delai-de-reponse', 'delai-a-l-essai'].map((scenario) => ({
    scenario,
    parole: 1,
    entendus: [
      'Tu peux me lire la liste des courses.',
      'Tu peux me dire la liste des courses.',
      'Tu peux nous lire la liste des courses.',
    ],
  })),
  {
    scenario: 'deux-phrases',
    parole: 1,
    entendus: [
      'Tu peux me rappeler le film de ce soir.',
      'Tu peux nous rappeler le film de ce soir.',
      'Suppe me rappelée le film de ce soir.',
    ],
  },
];

describe('le faux modèle devant ce que la chaîne a entendu', () => {
  it.each(
    vus.flatMap((v) => [
      ...v.entendus.map((e) => [v, e, false] as const),
      ...(v.echec ?? []).map((e) => [v, e, true] as const),
    ]),
  )('%# %j : %j', ({ scenario, parole }, entendu, echec) => {
    const s = Object.values(scenarios).find((x) => x.nom === scenario)!;
    const voulue = choisir(s.modele.reponses ?? [], s.personne[parole - 1]!.dit);
    expect(voulue).toBeGreaterThanOrEqual(0);
    const choisie = choisir(s.modele.reponses ?? [], entendu);
    if (echec) expect(choisie).not.toBe(voulue);
    else expect(choisie).toBe(voulue);
  });
});

afterAll(() => {
  if (!ecrire) return;
  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, 'releve-scenarios.md'), releve(juges));
  for (const [nom, p] of parties) writeFileSync(join(DIR, `deroule-${nom}.jsonl`), deroule(p));
  console.log(`Relevé et déroulés écrits dans ${DIR}.`);
});
