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
  { de: 'banc', at: 2854, name: 'envoi_recu', texte: 'Le jardin est mouillé', reponse: 101 },
  { de: 'banc', at: 3424, name: 'joue', reponse: 101, texte: 'Il a plu cette nuit.' },
  { de: 'banc', at: 4800, name: 'arrete', reponse: 101 },
];
const partie: Partie = { format: 2, page, banc, fin: 6000 };

const commun = { niveau: 'exact', mecanisme: 'ecoute', dit: 'un essai' } as const;

const scenario = (attendus: Attendu[], s: Partial<Scenario> = {}): Scenario => ({
  nom: 'a-la-main',
  source: 'un point',
  apport: 'rien',
  mecanismes: ['ecoute', 'voix'],
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

  it("runs « until the end » to the game's end, not to its last line", () => {
    // A speech and a sentence still going when the game stops, at 6000.
    const ouverts: BancEvent[] = [
      { de: 'banc', at: 5000, name: 'parole', etape: 'debut', parole: 2 },
      { de: 'banc', at: 5500, name: 'joue', reponse: 102, texte: 'Encore.' },
    ];
    const mesure = { ...commun, id: 'm', mecanisme: 'voix', mesure: 'chevauchement' } as const;
    expect(un({ ...mesure, entre: [0, 0] }, {}, { ...partie, banc: [...banc, ...ouverts] })).toMatchObject({
      espece: 'hors_bornes',
      trouve: 500,
    });
  });

  it('resolves a reply by the number the false server gave, a try withdrawn included', () => {
    // Two texts received: the first withdrawn (101), the second answered (102).
    const deux: Partie = {
      ...partie,
      page: [...page, { at: 3000, name: 'numero', phrase: 2, essai: 1, reponse: 102 }],
      banc: [
        { de: 'banc', at: 2800, name: 'envoi_recu', texte: 'Le jardin', reponse: 101 },
        { de: 'banc', at: 2980, name: 'envoi_recu', texte: 'Le jardin est mouillé', reponse: 102 },
        { de: 'banc', at: 3424, name: 'joue', reponse: 102, texte: 'Il a plu.' },
      ],
    };
    const joue = { ...commun, id: 'j', evenement: 'joue' } as const;
    expect(un({ ...joue, ou: { reponse: 2 } }, {}, deux).etat).toBe('tenue');
    expect(un({ ...joue, ou: { reponse: 1 } }, {}, deux).espece).toBe('absent');
    expect(un({ ...joue, ou: { reponse: 3 } }, {}, deux).etat).toBe('non_jouee');
  });

  it('finds the sentence a speech goes on when it opens none, and none for a speech after its close', () => {
    // The speech 2 from 2100, before sentence 1 closes (its `fin` at 2704): it goes on sentence 1.
    const suite: Partie = {
      ...partie,
      banc: [
        ...banc,
        { de: 'banc', at: 2100, name: 'parole', etape: 'debut', parole: 2 },
        { de: 'banc', at: 2500, name: 'parole', etape: 'fin', parole: 2 },
      ],
    };
    const fin2 = { ...commun, id: 'f', evenement: 'fin', ou: { parole: 2 } } as const;
    expect(un(fin2, {}, suite).etat).toBe('tenue');
    // Begun after the sentence's end (its last sound at 2000 + 704): heard by nothing.
    const apres: Partie = {
      ...suite,
      banc: [
        ...banc,
        { de: 'banc', at: 2800, name: 'parole', etape: 'debut', parole: 2 },
        { de: 'banc', at: 3000, name: 'parole', etape: 'fin', parole: 2 },
      ],
    };
    expect(un(fin2, {}, apres).etat).toBe('non_jouee');
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

  describe('the source of a failure', () => {
    const chaine: Partial<Scenario> = {
      mecanismes: ['ecoute', 'essai', 'transcription', 'filtre', 'suspension', 'coupure', 'serveur', 'voix'],
    };
    const suspendue: Attendu = {
      ...commun,
      id: 's',
      mecanisme: 'suspension',
      evenement: 'suspendue',
      depuis: { parole: 1, bord: 'debut' },
      entre: [400, 400],
    };

    it('is its own link when a link before it wrote in its window, even if others did not', () => {
      // At 1400 only the listening wrote (its tenue): the try, the transcription, the filter had nothing to write.
      expect(un(suspendue, chaine)).toMatchObject({
        espece: 'absent',
        source: 'suspension',
        couverture: ['ecoute'],
      });
      expect(un({ ...tenue, entre: [0, 300] }, { mecanismes: ['ecoute'] })).toMatchObject({
        source: 'ecoute',
      });
    });

    it('is the first link when nothing before it wrote in its window: the chain never started there', () => {
      expect(un({ ...suspendue, entre: [100, 200] }, chaine)).toMatchObject({
        source: 'ecoute',
        couverture: [],
      });
    });

    it('is its own link in an empty window anchored on another expectation: that anchor came late', () => {
      // The tenue held at 1400; nothing is written 50 ms later.
      const apres = { ...suspendue, depuis: { attendu: 'tenue' }, entre: [50, 60] } as Attendu;
      expect(juger(scenario([tenue, apres], chaine), partie)[1]).toMatchObject({
        couverture: [],
        source: 'suspension',
      });
    });

    it('is, for every failure of the game, the first link of the chain one of them names', () => {
      const nom: Attendu = {
        ...commun,
        id: 'n',
        mecanisme: 'filtre',
        evenement: 'verdict',
        ou: { valeurs: { par: 'nom' } },
      };
      const joue: Attendu = {
        ...commun,
        id: 'j',
        mecanisme: 'voix',
        evenement: 'joue',
        ou: { valeurs: { texte: 'x' } },
      };
      const [v, j] = juger(scenario([nom, joue], chaine), partie);
      expect([v!.source, j!.source]).toEqual(['filtre', 'filtre']);
      // A known defect as known names nothing for the others.
      const connu = { connus: [{ issue: 'lun-luxuria#0', attendu: 'n', espece: 'absent' as const }] };
      expect(juger(scenario([nom, joue], { ...chaine, ...connu }), partie)[1]!.source).toBe('voix');
    });

    it("of one not played is its anchor's, with no window of its own", () => {
      const coupee: Attendu = { ...commun, id: 'coupee', mecanisme: 'coupure', evenement: 'coupee' };
      const apres: Attendu = {
        ...commun,
        id: 'apres',
        mecanisme: 'voix',
        evenement: 'son',
        depuis: { attendu: 'coupee' },
      };
      const [a] = juger(scenario([apres, coupee], chaine), partie);
      expect(a).toMatchObject({ etat: 'non_jouee', source: 'coupure', couverture: [], extrait: [] });
      // A speech that never came: the listening; a reply that never came: the server.
      expect(un({ ...apres, depuis: { parole: 3, bord: 'debut' } }, chaine).source).toBe('ecoute');
      const reponse9: Attendu = {
        ...commun,
        id: 'r',
        mecanisme: 'voix',
        evenement: 'son',
        ou: { reponse: 9 },
      };
      expect(un(reponse9, chaine).source).toBe('serveur');
    });

    it('of a delay looks in its turn only: a turn without a reply owns no event without one', () => {
      const seul: Partie = {
        ...partie,
        page: [
          { at: 1000, name: 'voix', phrase: 1, son: 1000 },
          { at: 2704, name: 'fin', phrase: 1, dernier_son: 2000 },
          { at: 5000, name: 'silence', coupee: false },
        ],
      };
      const d: Attendu = { ...commun, id: 'd', delai: 'attente_fin', tour: { parole: 1 }, entre: [0, 0] };
      expect(un(d, chaine, seul)).toMatchObject({
        espece: 'hors_bornes',
        trouve: 704,
        couverture: ['ecoute'],
      });
    });
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
    expect(juger(scenario([tenue]), { ...partie, erreur: 'la sortie a cassé' })[0]).toMatchObject({
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
