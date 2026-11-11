import { describe, expect, it } from 'vitest';
import type { TraceEvent } from '../trace.ts';
import { juger, passe, type Verdict } from './judge.ts';
import { releve } from './releve.ts';
import type { Attendu, BancEvent, Partie, Scenario } from './scenario.ts';

// One turn, written by hand: the person speaks from 1000 to 2000, the reply 101 sounds at 3424.
const page: TraceEvent[] = [
  { at: 1000, name: 'voix', phrase: 1, son: 1000 },
  { at: 1400, name: 'tenue', phrase: 1 },
  { at: 2704, name: 'fin', phrase: 1, dernier_son: 2000 },
  { at: 2704, name: 'essai', phrase: 1, essai: 1, final: true },
  { at: 2854, name: 'transcrite', phrase: 1, essai: 1, texte: 'Le jardin est mouillé' },
  { at: 2854, name: 'verdict', phrase: 1, essai: 1, resultat: 'pour_elle', par: 'off' },
  { at: 2854, name: 'envoyee', phrase: 1, essai: 1, final: true },
  { at: 2874, name: 'numero', phrase: 1, essai: 1, reponse: 101 },
  { at: 3274, name: 'phrase_recue', phrase: 1, essai: 1, reponse: 101 },
  { at: 3274, name: 'synthese', phrase: 1, essai: 1, reponse: 101, etape: 'debut', rang: 1 },
  { at: 3424, name: 'synthese', phrase: 1, essai: 1, reponse: 101, etape: 'fin', rang: 1 },
  { at: 3424, name: 'son', phrase: 1, essai: 1, reponse: 101, debut: true, rang: 1 },
  { at: 3424, name: 'premier_son', phrase: 1, essai: 1, reponse: 101 },
];
const banc: BancEvent[] = [
  { de: 'banc', at: 1000, name: 'parole', etape: 'debut', parole: 1 },
  { de: 'banc', at: 2000, name: 'parole', etape: 'fin', parole: 1 },
  { de: 'banc', at: 2874, name: 'envoi_recu', texte: 'Le jardin est mouillé' },
  { de: 'banc', at: 3424, name: 'joue', reponse: 101, texte: 'Il a plu cette nuit.' },
  { de: 'banc', at: 4800, name: 'arrete', reponse: 101 },
];
const partie: Partie = { format: 2, page, banc };

const commun = { niveau: 'exact', mecanisme: 'ecoute', dit: 'un essai' } as const;

const scenario = (attendus: Attendu[], s: Partial<Scenario> = {}): Scenario => ({
  nom: 'a-la-main',
  source: 'un point',
  apport: 'rien',
  mecanismes: ['ecoute'],
  personne: [{ a: 1000, dit: 'Le jardin est mouillé', duree: 1000 }],
  attendus,
  ...s,
});

const un = (a: Attendu, s: Partial<Scenario> = {}, p: Partie = partie): Verdict =>
  juger(scenario([a], s), p)[0]!;

const tenue: Attendu = {
  ...commun,
  id: 'tenue',
  evenement: 'tenue',
  ou: { parole: 1 },
  depuis: { parole: 1, bord: 'debut' },
  entre: [380, 420],
};

describe('judging a game', () => {
  it('holds an event found in its bounds, with the time from its anchor and what wrote around it', () => {
    expect(un(tenue)).toEqual({
      id: 'tenue',
      niveau: 'exact',
      mecanisme: 'ecoute',
      dit: 'un essai',
      etat: 'tenue',
      trouve: 400,
      borne: [380, 420],
      couverture: ['ecoute'],
      extrait: [],
    });
  });

  it('gives absent when nothing fits, hors_bornes with the value when found out of its bounds', () => {
    expect(un({ ...commun, id: 'c', evenement: 'coupee' })).toMatchObject({
      etat: 'ratee',
      espece: 'absent',
    });
    const v = un({ ...tenue, entre: [0, 300] });
    expect(v).toMatchObject({ etat: 'ratee', espece: 'hors_bornes', trouve: 400 });
    // The second around its window [1000, 1300].
    expect(v.extrait).toEqual([
      '1000  voix  phrase=1 son=1000',
      '1000  banc parole  etape=debut parole=1',
      '1400  tenue  phrase=1',
    ]);
  });

  it('matches the values an event must carry, and the reply by the n-th sentence sent', () => {
    const verdict = { ...commun, id: 'v', evenement: 'verdict' } as const;
    expect(un({ ...verdict, ou: { valeurs: { resultat: 'pour_elle', par: 'off' } } }).etat).toBe('tenue');
    expect(un({ ...verdict, ou: { valeurs: { par: 'nom' } } }).espece).toBe('absent');
    expect(un({ ...commun, id: 'j', evenement: 'joue', ou: { reponse: 1 } }).etat).toBe('tenue');
    expect(un({ ...commun, id: 'j', evenement: 'joue', ou: { reponse: 2 } }).etat).toBe('non_jouee');
  });

  it('gives en_trop when an absent finds one, and its window runs to the end of the game', () => {
    expect(un({ ...tenue, absent: true })).toMatchObject({ espece: 'en_trop', trouve: 400 });
    expect(un({ ...commun, id: 'a', evenement: 'arrete', absent: true })).toMatchObject({
      espece: 'en_trop',
      trouve: 4800,
    });
    expect(un({ ...commun, id: 'a', evenement: 'coupee', absent: true }).etat).toBe('tenue');
    expect(un({ ...tenue, absent: true, entre: [500, 900] }).etat).toBe('tenue');
  });

  it('reads a delay in delays(), and a missing end is delai_manquant, never zero', () => {
    const delai = {
      ...commun,
      id: 'd',
      tour: { parole: 1 },
      entre: [700, 736] as [number, number],
    } as const;
    expect(un({ ...delai, delai: 'attente_fin' })).toMatchObject({ etat: 'tenue', trouve: 704 });
    expect(un({ ...delai, delai: 'blanc_de_tour' })).toMatchObject({
      espece: 'hors_bornes',
      trouve: 1424,
    });
    const v = un({ ...delai, delai: 'arret_coupure' });
    expect(v).toMatchObject({ etat: 'ratee', espece: 'delai_manquant' });
    expect(v.trouve).toBeUndefined();
  });

  it('gives non_jouee to an expectation anchored on a failed one, or on a speech that never came', () => {
    const coupee: Attendu = { ...commun, id: 'coupee', evenement: 'coupee' };
    const apres: Attendu = { ...commun, id: 'apres', evenement: 'son', depuis: { attendu: 'coupee' } };
    const [a, b] = juger(scenario([apres, coupee]), partie);
    expect(a).toMatchObject({ id: 'apres', etat: 'non_jouee', espece: 'non_jouee' });
    expect(b).toMatchObject({ id: 'coupee', espece: 'absent' });
    // One anchored on a held one counts from its event.
    const son = { ...apres, depuis: { attendu: 'tenue' }, entre: [2024, 2024] } as Attendu;
    expect(juger(scenario([tenue, son]), partie)[1]!.etat).toBe('tenue');
    expect(un({ ...tenue, depuis: { parole: 3, bord: 'fin' } }).espece).toBe('non_jouee');
  });

  it('finds the source: the first link of the chain silent in the window, or its own link when all wrote', () => {
    const coupee: Attendu = { ...commun, id: 'c', mecanisme: 'coupure', evenement: 'coupee' };
    const chaine: Partial<Scenario> = { mecanismes: ['ecoute', 'transcription', 'coupure', 'voix'] };
    const sans = { ...partie, page: page.filter((e) => e.name !== 'transcrite') };
    expect(un(coupee, chaine, sans)).toMatchObject({
      source: 'transcription',
      couverture: ['ecoute', 'essai', 'filtre', 'serveur', 'voix'],
    });
    expect(un(coupee, chaine)).toMatchObject({ source: 'coupure' });
    expect(un({ ...tenue, entre: [0, 300] })).toMatchObject({ source: 'ecoute' });
  });

  it('measures the overlap of a speech and a sentence that sounds', () => {
    const mesure = { ...commun, id: 'm', mecanisme: 'voix', mesure: 'chevauchement' } as const;
    expect(un({ ...mesure, entre: [0, 0] })).toMatchObject({ etat: 'tenue', trouve: 0 });
    const tot: BancEvent[] = [
      ...banc.slice(0, 2),
      { de: 'banc', at: 1800, name: 'joue', reponse: 101, texte: 'Il a plu cette nuit.' },
      { de: 'banc', at: 2300, name: 'arrete', reponse: 101 },
    ];
    expect(un({ ...mesure, entre: [0, 432] }, {}, { ...partie, banc: tot })).toMatchObject({
      etat: 'tenue',
      trouve: 200,
    });
  });

  it('passes a known defect only while it gives its species and its value', () => {
    const hors = { ...tenue, entre: [0, 300] } as Attendu;
    const connu = (c: Partial<NonNullable<Scenario['connus']>[number]>, a: Attendu = hors) =>
      un(a, { connus: [{ issue: 'lun-luxuria#0', attendu: 'tenue', espece: 'hors_bornes', ...c }] });
    const garde = connu({ trouve: 400 });
    expect(garde.connu).toEqual({ issue: 'lun-luxuria#0', conforme: true });
    expect(passe(garde)).toBe(true);
    expect(passe(connu({ trouve: 390 }))).toBe(false);
    expect(passe(connu({ espece: 'absent', trouve: 400 }))).toBe(false);
    // Fixed: it holds, and the CI says so.
    expect(passe(connu({ trouve: 400 }, tenue))).toBe(false);
    expect(passe(un(tenue))).toBe(true);
    expect(passe(un(hors))).toBe(false);
  });

  it('refuses a trace older than format 2', () => {
    expect(() => juger(scenario([tenue]), { ...partie, format: 1 })).toThrow(/format 1/);
  });

  it('gives scenario to every expectation of a scenario refused, joueur to a game that threw', () => {
    expect(juger(scenario([tenue, tenue]), partie)[0]).toMatchObject({
      etat: 'ratee',
      espece: 'scenario',
      trouve: 'deux attendus « tenue »',
    });
    expect(juger(scenario([tenue]), new Error('la sortie a cassé'))[0]).toMatchObject({
      etat: 'ratee',
      espece: 'joueur',
      trouve: 'la sortie a cassé',
    });
  });
});

describe('the report', () => {
  const v = (x: Partial<Verdict>): Verdict => ({
    id: 'x',
    niveau: 'exact',
    mecanisme: 'ecoute',
    dit: 'un essai',
    etat: 'tenue',
    couverture: [],
    extrait: [],
    ...x,
  });

  it('counts, ranks failures by species and source, and gives each failure its excerpt', () => {
    const texte = releve([
      {
        nom: 'deux-phrases',
        verdicts: [
          v({ id: 'retenue', mecanisme: 'retenue', trouve: 120, borne: [0, 200], couverture: ['ecoute'] }),
          v({
            id: 'oubliee',
            mecanisme: 'retenue',
            etat: 'ratee',
            espece: 'absent',
            source: 'retenue',
            couverture: ['ecoute', 'filtre'],
            extrait: ['1000  voix  phrase=1', '1400  tenue  phrase=1'],
          }),
          v({ id: 'apres', etat: 'non_jouee', espece: 'non_jouee', source: 'ecoute' }),
        ],
      },
      {
        nom: 'toux-puis-parole',
        verdicts: [
          v({
            id: 'chevauchement',
            mecanisme: 'voix',
            etat: 'ratee',
            espece: 'hors_bornes',
            source: 'voix',
            trouve: 0,
            borne: [1, 432],
            connu: { issue: 'lun-luxuria#70', conforme: true },
          }),
        ],
      },
    ]);
    expect(texte.split('\n')).toEqual([
      '# Relevé des scénarios',
      '',
      'Attentes : 1 tenue, 1 ratée, 1 connue, 1 non jouée.',
      '',
      'Échecs par espèce : absent 1, non_jouee 1.',
      '',
      'Échecs par source : retenue 1, ecoute 1.',
      '',
      '## deux-phrases',
      '',
      '| Attendu | État | Espèce | Source | Trouvé | Borne |',
      '|---|---|---|---|---|---|',
      '| retenue | tenue |  |  | 120 | [0, 200] |',
      '| oubliee | ratee | absent | retenue |  |  |',
      '| apres | non_jouee | non_jouee | ecoute |  |  |',
      '',
      '### oubliee : un essai',
      '',
      'Couverture : ecoute, filtre.',
      '',
      '```',
      '1000  voix  phrase=1',
      '1400  tenue  phrase=1',
      '```',
      '',
      '### apres : un essai',
      '',
      'Couverture : aucune.',
      '',
      '## toux-puis-parole',
      '',
      '| Attendu | État | Espèce | Source | Trouvé | Borne |',
      '|---|---|---|---|---|---|',
      '| chevauchement | connue (lun-luxuria#70) | hors_bornes | voix | 0 | [1, 432] |',
      '',
    ]);
  });
});
