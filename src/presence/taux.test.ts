// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import type { Verdict } from './judge.ts';
import type { Jouee } from './releve.ts';
import type { Partie, Scenario } from './scenario.ts';
import { echoue, releveBudget, releveTaux, resultat, tenue, type Resultat } from './taux.ts';

type V = Resultat['verdicts'][number];
const v = (x: Partial<V>): V => ({
  id: 'x',
  niveau: 'tous',
  mecanisme: 'voix',
  dit: 'un essai',
  etat: 'tenue',
  ...x,
});
const ligne = (x: Partial<Resultat>): Resultat => ({
  suite: '2026-11-12T10:00:00.000Z',
  scenario: 'non-court',
  partie: 'non-court#1',
  rang: 1,
  voix: 'hortense',
  transcription: 'faster:tiny',
  synthese: 'piper:fr_FR-siwis-medium',
  poste: 'PC (i7)',
  verdicts: [],
  delais: [],
  inattendus: [],
  ...x,
});

describe('a line per game', () => {
  it('takes what the game measured, the extract of its failures only, and the sound of each speech', () => {
    const s: Scenario = {
      nom: 'a-la-main',
      source: 'un point',
      apport: 'rien',
      mecanismes: ['ecoute', 'serveur', 'voix'],
      personne: [
        { a: 1000, dit: 'Le jardin est mouillé', duree: 1000 },
        { apres: { envoi: 1, ms: 0 }, dit: 'Oui', duree: 300 },
      ],
      modele: { reponses: [{ si: 'jardin', phrases: ['Il a plu.'] }] },
      attendus: [],
    };
    const chaine: Partie = {
      format: 2,
      fin: 6000.4,
      page: [
        { at: 1030, name: 'voix', phrase: 1, son: 1025 },
        { at: 2730, name: 'fin', phrase: 1, dernier_son: 2010 },
        { at: 2730, name: 'essai', phrase: 1, essai: 1, final: true },
        { at: 3100, name: 'transcrite', phrase: 1, essai: 1, texte: 'Le jardin est mouille', confiance: 0.7 },
        { at: 3120, name: 'numero', phrase: 1, essai: 1, reponse: 7 },
      ],
      banc: [
        { de: 'banc', at: 1000, name: 'parole', etape: 'debut', parole: 1 },
        { de: 'banc', at: 2000, name: 'parole', etape: 'fin', parole: 1 },
        { de: 'banc', at: 3100, name: 'envoi_recu', texte: 'Le jardin est mouille', reponse: 7 },
        { de: 'banc', at: 3110, name: 'modele_inattendu', sorte: 'stream', extrait: 'Le jardin est mouille' },
      ],
    };
    const verdict = (x: Partial<Verdict>): Verdict => ({
      ...v({}),
      couverture: ['ecoute'],
      extrait: ['1000  voix'],
      ...x,
    });
    const jouee: Jouee = {
      scenario: s,
      verdicts: [
        verdict({ id: 'tenu' }),
        verdict({ id: 'rate', etat: 'ratee', espece: 'absent', source: 'voix' }),
      ],
      chaine,
      exacte: chaine,
      transcription: 'faster:tiny',
      synthese: 'piper:fr_FR-siwis-medium',
      voix: 'hortense',
      sons: [
        { source: 'cache:hortense', duree: 1635 },
        { source: 'pose:oui.wav', duree: 300 },
      ],
    };
    expect(
      resultat(jouee, {
        suite: '2026-11-12T10:00:00.000Z',
        partie: 'a-la-main#2',
        rang: 2,
        poste: 'PC (i7)',
        deroule: 'deroule-chaine-a-la-main-2.jsonl',
      }),
    ).toEqual({
      suite: '2026-11-12T10:00:00.000Z',
      scenario: 'a-la-main',
      partie: 'a-la-main#2',
      rang: 2,
      voix: 'hortense',
      transcription: 'faster:tiny',
      synthese: 'piper:fr_FR-siwis-medium',
      poste: 'PC (i7)',
      dureeMs: 6000,
      verdicts: [
        { id: 'tenu', niveau: 'tous', mecanisme: 'voix', dit: 'un essai', etat: 'tenue' },
        {
          id: 'rate',
          niveau: 'tous',
          mecanisme: 'voix',
          dit: 'un essai',
          etat: 'ratee',
          espece: 'absent',
          source: 'voix',
          extrait: ['1000  voix'],
        },
      ],
      delais: [{ tour: 1, ms: { attente_fin: 720, transcription: 370 }, synthese: [] }],
      // The second speech never sounded: no line of its own.
      phrases: [
        {
          parole: 1,
          dit: 'Le jardin est mouillé',
          entendu: 'Le jardin est mouille',
          confiance: 0.7,
          son: 'cache:hortense',
          dureeMs: 1635,
        },
      ],
      inattendus: [{ texte: 'Le jardin est mouille', source: 'transcription' }],
      deroule: 'deroule-chaine-a-la-main-2.jsonl',
    });
  });
});

describe('a game held', () => {
  it('holds every verdict that passes and no request without a reply', () => {
    expect(tenue(ligne({ verdicts: [v({}), v({ niveau: 'exact', etat: 'ratee', horsNiveau: true })] }))).toBe(
      true,
    );
    expect(tenue(ligne({ verdicts: [v({ etat: 'ratee', espece: 'absent' })] }))).toBe(false);
    expect(tenue(ligne({ inattendus: [{ texte: 'Arret.', source: 'transcription' }] }))).toBe(false);
  });

  it('never holds one not played', () => {
    expect(tenue(ligne({ verdicts: [v({ etat: 'non_jouee', espece: 'non_jouee' })] }))).toBe(false);
  });

  it('leaves a known defect out, whatever its state', () => {
    const connu = (conforme: boolean, x: Partial<V> = {}) =>
      v({ etat: 'ratee', espece: 'en_trop', connu: { issue: 'lun-luxuria#63', conforme }, ...x });
    expect(tenue(ligne({ verdicts: [v({}), connu(false)] }))).toBe(true);
    expect(tenue(ligne({ verdicts: [connu(false, { espece: 'absent' })] }))).toBe(true);
    // Fixed: it holds.
    expect(tenue(ligne({ verdicts: [v({ connu: { issue: 'lun-luxuria#63', conforme: false } })] }))).toBe(
      true,
    );
  });

  it('is not a scenario not played', () => {
    expect(tenue(ligne({ raison: "l'écho passe par un vrai micro" }))).toBe(false);
  });
});

describe('what fails a repeated suite', () => {
  const rate = (x: Partial<V>) => v({ etat: 'ratee', espece: 'absent', source: 'voix', ...x });
  const une = (x: Partial<Resultat>) => echoue([ligne(x)]);

  it('in the race: an expectation `tous` failed or not played, out of the transcription', () => {
    expect(une({ verdicts: [rate({ id: 'pour-de-bon' })] })).toEqual([
      'non-court#1 (hortense) : pour-de-bon ratee, source voix',
    ]);
    // A speech the listening lost fails the race (CrOliX, 12/11).
    expect(une({ verdicts: [rate({ etat: 'non_jouee', espece: 'non_jouee', source: 'ecoute' })] })).toEqual([
      'non-court#1 (hortense) : x non_jouee, source ecoute',
    ]);
    expect(une({ verdicts: [rate({ source: 'transcription' })] })).toEqual([]);
    expect(une({ verdicts: [rate({ connu: { issue: 'lun-luxuria#63', conforme: false } })] })).toEqual([]);
    expect(une({ verdicts: [rate({ niveau: 'exact', horsNiveau: true })] })).toEqual([]);
  });

  it('in the race: a request without a reply that the scenario did not plan', () => {
    expect(une({ inattendus: [{ texte: 'Arret.', source: 'transcription' }] })).toEqual([]);
    expect(une({ inattendus: [{ texte: 'Bonjour', source: 'scenario' }] })).toEqual([
      'non-court#1 (hortense) : demande sans réponse « Bonjour », source scenario',
    ]);
  });

  it('an error of the player, in any voice; nothing else for a voice other than hers', () => {
    const joueur = v({ etat: 'ratee', espece: 'joueur', trouve: 'la page a cassé' });
    expect(une({ verdicts: [joueur, joueur] })).toEqual([
      'non-court#1 (hortense) : erreur du joueur, la page a cassé',
    ]);
    expect(une({ voix: 'julie', verdicts: [joueur] })).toEqual([
      'non-court#1 (julie) : erreur du joueur, la page a cassé',
    ]);
    expect(
      une({ voix: 'julie', verdicts: [rate({})], inattendus: [{ texte: 'Bonjour', source: 'scenario' }] }),
    ).toEqual([]);
    // A scenario not played fails nothing.
    expect(une({ raison: "l'écho passe par un vrai micro" })).toEqual([]);
  });
});

describe('the report of the rates', () => {
  const connu = { issue: 'lun-luxuria#63', conforme: true };

  it('gives a 95th centile from twenty values only', () => {
    const avec = (n: number) =>
      releveTaux(
        Array.from({ length: n }, (_, k) =>
          ligne({
            partie: `non-court#${k + 1}`,
            rang: k + 1,
            delais: [{ tour: 1, ms: { transcription: 300 + k }, synthese: [] }],
          }),
        ),
      )
        .split('\n')
        .find((l) => l.startsWith('| 1 | transcription |'));
    expect(avec(19)).toBe('| 1 | transcription | hortense | 309 |  | 300 | 318 |');
    expect(avec(20)).toBe('| 1 | transcription | hortense | 310 | 318 | 300 | 319 |');
  });

  it('gives the rule of three for the race without a failure only, else how many of its games failed', () => {
    const course = (vs: V[][]) =>
      releveTaux(vs.map((verdicts, k) => ligne({ partie: `non-court#${k + 1}`, rang: k + 1, verdicts })))
        .split('\n')
        .find((l) => l.startsWith('La course'));
    expect(course(Array.from({ length: 30 }, () => [v({})]))).toBe(
      "La course (hortense) : zéro échec sur 30 parties met l'échec sous 10 %, à 95 % (règle de trois).",
    );
    expect(course([[v({})], [v({ etat: 'ratee', espece: 'absent' })], [v({})]])).toBe(
      'La course (hortense) : 1 partie ratée sur 3.',
    );
  });

  it("counts an error of the player once a game, keeps the known defect's line, and leaves it out of the drift", () => {
    const tenues = (k: number, transcription: number) =>
      ligne({
        partie: `non-court#${k}`,
        rang: k,
        verdicts: [v({ id: 'pour-de-bon' }), v({ id: 'nul', etat: 'ratee', espece: 'hors_bornes', connu })],
        delais: [{ tour: 1, ms: { transcription }, synthese: [] }],
      });
    const casse = { etat: 'ratee', espece: 'joueur', trouve: 'la page a cassé' } as const;
    const texte = releveTaux([
      tenues(1, 300),
      tenues(2, 500),
      ligne({
        partie: 'non-court#3',
        rang: 3,
        verdicts: [v({ id: 'pour-de-bon', ...casse }), v({ id: 'nul', ...casse })],
      }),
    ]).split('\n');
    expect(texte).toEqual(
      expect.arrayContaining([
        'Échecs par espèce : joueur 1.',
        'Échecs par source : joueur 1.',
        'Échecs par voix : hortense 1.',
        '| non-court | hortense | 2 | 3 | 67 % |',
        '| pour-de-bon | hortense | 2 | 0 | 0 | 100 % |',
        '| nul | lun-luxuria#63 | hortense | 2 | 0 | 0 |',
        '| Voix | Délai | Premier passage | Dernier passage |',
        '| hortense | transcription | 300 | 500 |',
        '### non-court#3 (hortense)',
        'Erreur du joueur : la page a cassé.',
      ]),
    );
    // Once, not as each expectation's failure.
    expect(texte.filter((l) => l.includes('la page a cassé'))).toHaveLength(1);
  });

  it('says it all, line by line', () => {
    const lignes = [
      ligne({
        dureeMs: 7300,
        verdicts: [
          v({ id: 'pour-de-bon' }),
          v({
            id: 'son-arrete',
            niveau: 'exact',
            mecanisme: 'suspension',
            etat: 'ratee',
            espece: 'hors_bornes',
            trouve: 450,
            borne: [692, 724],
            horsNiveau: true,
          }),
          v({ id: 'nul', etat: 'ratee', espece: 'hors_bornes', trouve: 499, connu }),
        ],
        delais: [
          { tour: 1, ms: { transcription: 350 }, synthese: [150] },
          { tour: 2, ms: { transcription: 400 }, synthese: [] },
        ],
        phrases: [
          {
            parole: 1,
            dit: 'Raconte-moi',
            entendu: 'Raconte-moi.',
            confiance: 0.5,
            son: 'cache:hortense',
            dureeMs: 1635,
          },
          { parole: 2, dit: 'Non', entendu: 'Non.', son: 'pose:non.wav', dureeMs: 300 },
        ],
        deroule: 'deroule-chaine-non-court-1.jsonl',
      }),
      ligne({
        partie: 'non-court#2',
        rang: 2,
        dureeMs: 7700,
        verdicts: [
          v({
            id: 'pour-de-bon',
            etat: 'ratee',
            espece: 'en_trop',
            trouve: 2851,
            source: 'ecoute',
            propre: 'voix',
            extrait: ['6618  bruit  phrase=2'],
          }),
          v({
            id: 'son-arrete',
            niveau: 'exact',
            mecanisme: 'suspension',
            etat: 'ratee',
            espece: 'absent',
            borne: [692, 724],
            horsNiveau: true,
          }),
          v({ id: 'nul', etat: 'tenue', trouve: 0, connu: { ...connu, conforme: false } }),
        ],
        delais: [{ tour: 1, ms: { transcription: 370 }, synthese: [170] }],
        phrases: [
          { parole: 1, dit: 'Raconte-moi', entendu: 'Recondement.', son: 'cache:hortense', dureeMs: 1635 },
          { parole: 2, dit: 'Non', son: 'pose:non.wav', dureeMs: 300 },
        ],
        deroule: 'deroule-chaine-non-court-2.jsonl',
      }),
      ligne({
        partie: 'non-court#3',
        rang: 3,
        dureeMs: 7500,
        verdicts: [
          v({ id: 'pour-de-bon' }),
          v({
            id: 'son-arrete',
            niveau: 'exact',
            mecanisme: 'suspension',
            etat: 'ratee',
            espece: 'hors_bornes',
            trouve: 450,
            borne: [692, 724],
            horsNiveau: true,
          }),
          v({ id: 'nul', etat: 'ratee', espece: 'absent', connu: { ...connu, conforme: false } }),
        ],
        delais: [{ tour: 1, ms: { transcription: 600 }, synthese: [190] }],
        phrases: [
          { parole: 1, dit: 'Raconte-moi', entendu: 'Raconte-moi.', son: 'cache:hortense', dureeMs: 1635 },
          { parole: 2, dit: 'Non', entendu: 'Non.', son: 'pose:non.wav', dureeMs: 300 },
        ],
        inattendus: [{ texte: 'Arret.', source: 'transcription' }],
        deroule: 'deroule-chaine-non-court-3.jsonl',
      }),
      ligne({
        partie: 'non-court#4',
        rang: 4,
        voix: 'julie',
        dureeMs: 7500,
        verdicts: [
          v({ id: 'pour-de-bon', etat: 'ratee', espece: 'en_trop', trouve: 2833, source: 'transcription' }),
          v({
            id: 'son-arrete',
            niveau: 'exact',
            mecanisme: 'suspension',
            etat: 'ratee',
            espece: 'absent',
            borne: [692, 724],
            horsNiveau: true,
          }),
          v({ id: 'nul', etat: 'ratee', espece: 'hors_bornes', trouve: 486, connu }),
        ],
        phrases: [
          { parole: 1, dit: 'Raconte-moi', entendu: 'Raconte-moi.', son: 'synthese:julie', dureeMs: 1800 },
          { parole: 2, dit: 'Non', entendu: 'Bon.', son: 'synthese:julie', dureeMs: 350 },
        ],
        deroule: 'deroule-chaine-non-court-4.jsonl',
      }),
      ligne({ scenario: 'echo-fort', partie: 'echo-fort#1', raison: "l'écho passe par un vrai micro" }),
    ];
    expect(releveTaux(lignes).split('\n')).toEqual([
      '# Relevé des taux',
      '',
      '4 parties jouées, 1 scénario ; voix : hortense 3, julie 1.',
      '',
      'Transcription : faster:tiny. Sa voix : piper:fr_FR-siwis-medium. Poste : PC (i7). Durée des parties : 30 s.',
      '',
      'Ces taux valent pour faster:tiny sur ce poste, pas pour un autre modèle ni un autre poste.',
      '',
      'La course (hortense) : 2 parties ratées sur 3.',
      '',
      // A known defect counts nowhere here, whatever its state, as in a game held: its own table says it.
      'Échecs par espèce : en_trop 2.',
      '',
      'Échecs par source : ecoute 1, transcription 1.',
      '',
      'Échecs par voix : hortense 1, julie 1.',
      '',
      'Demandes sans réponse : transcription 1.',
      '',
      '## Par scénario',
      '',
      '| Scénario | Voix | Tenues | Jouées | Taux |',
      '|---|---|---|---|---|',
      '| non-court | hortense | 1 | 3 | 33 % |',
      '| non-court | julie | 0 | 1 | 0 % |',
      '',
      '## non-court',
      '',
      'Attentes tous :',
      '',
      '| Attendu | Voix | Tenues | Ratées | Non jouées | Taux |',
      '|---|---|---|---|---|---|',
      '| pour-de-bon | hortense | 2 | 1 | 0 | 67 % |',
      '| pour-de-bon | julie | 0 | 1 | 0 | 0 % |',
      '',
      'Défauts connus :',
      '',
      '| Attendu | Issue | Voix | Comme connu | Tenu | Autrement raté |',
      '|---|---|---|---|---|---|',
      '| nul | lun-luxuria#63 | hortense | 1 | 1 | 1 |',
      '| nul | lun-luxuria#63 | julie | 1 | 0 | 0 |',
      '',
      'Mesures :',
      '',
      '| Attendu | Voix | Dans sa borne | Borne | Trouvé |',
      '|---|---|---|---|---|',
      '| son-arrete | hortense | 0 / 3 | [692, 724] | 450 ×2, absent |',
      '| son-arrete | julie | 0 / 1 | [692, 724] | absent |',
      '',
      'Délais :',
      '',
      '| Tour | Délai | Voix | Médiane | 95e centile | Min | Max |',
      '|---|---|---|---|---|---|---|',
      '| 1 | transcription | hortense | 370 |  | 350 | 600 |',
      '| 1 | synthese 1 | hortense | 170 |  | 150 | 190 |',
      '| 2 | transcription | hortense | 400 |  | 400 | 400 |',
      '',
      'Transcription :',
      '',
      '| Parole | Dit | Voix | Justes | Entendu |',
      '|---|---|---|---|---|',
      '| 1 | Raconte-moi | hortense | 2 / 3 | « Raconte-moi. » ×2, « Recondement. » |',
      '| 1 | Raconte-moi | julie | 1 / 1 | « Raconte-moi. » |',
      '| 2 | Non | hortense | 2 / 3 | « Non. » ×2, (rien) |',
      '| 2 | Non | julie | 0 / 1 | « Bon. » |',
      '',
      '## Dérive',
      '',
      '| Voix | Délai | Premier passage | Dernier passage |',
      '|---|---|---|---|',
      '| hortense | transcription | 375 | 600 |',
      '| hortense | synthese | 150 | 190 |',
      '',
      '## Non joués',
      '',
      '| Scénario | Raison |',
      '|---|---|',
      "| echo-fort | l'écho passe par un vrai micro |",
      '',
      '## Parties ratées',
      '',
      '### non-court#2 (hortense)',
      '',
      'Déroulé : deroule-chaine-non-court-2.jsonl.',
      '',
      '| Attendu | Espèce | Source | Trouvé |',
      '|---|---|---|---|',
      '| pour-de-bon | en_trop | ecoute (propre : voix) | 2851 |',
      '',
      'pour-de-bon :',
      '',
      '```',
      '6618  bruit  phrase=2',
      '```',
      '',
      '### non-court#3 (hortense)',
      '',
      'Déroulé : deroule-chaine-non-court-3.jsonl.',
      '',
      'Demande sans réponse, source transcription : « Arret. ».',
      '',
      '### non-court#4 (julie)',
      '',
      'Déroulé : deroule-chaine-non-court-4.jsonl.',
      '',
      '| Attendu | Espèce | Source | Trouvé |',
      '|---|---|---|---|',
      '| pour-de-bon | en_trop | transcription | 2833 |',
      '',
    ]);
  });
});

describe('the budget, a delay per step', () => {
  const COLONNES = ['Étape', 'Délai', 'Voix', 'Médiane', '95e centile', 'Valeurs', 'Budget', 'Cible du VIP'];
  const ETAPES = [
    'Détection de voix',
    'Fin de tour',
    'Transcription',
    'Première phrase du modèle',
    'Synthèse',
    'Sa voix (RVC)',
    'Bout en bout',
  ];
  type Rang = Record<string, string>;
  const cellules = (l: string) =>
    l
      .replace(/^\| ?/, '')
      .replace(/ ?\|$/, '')
      .split(' | ')
      .map((c) => c.trim());
  /** The rows of the table, each under the name of its columns. */
  const rangs = (md: string): Rang[] => {
    const l = md.split('\n').filter((x) => x.startsWith('|'));
    const tete = cellules(l[0]!);
    expect(tete).toEqual(COLONNES);
    return l.slice(2).map((x) => Object.fromEntries(cellules(x).map((c, i) => [tete[i]!, c])));
  };
  const de = (md: string, etape: string, voix?: string) =>
    rangs(md).filter((r) => r['Étape'] === etape && (voix === undefined || r['Voix'] === voix));
  const un = (md: string, etape: string, voix: string) => {
    const rs = de(md, etape, voix);
    expect(rs).toHaveLength(1);
    return rs[0]!;
  };

  // Two voices, three games played and one not: every cell below is worked out by hand.
  const lignes = [
    ligne({
      partie: 'a#1',
      delais: [
        {
          tour: 1,
          ms: { attente_fin: 100, transcription: 300, premiere_phrase: 600, blanc_de_tour: 2000 },
          synthese: [400, 50],
        },
        // A turn without a first sentence nor a synthesis: its other delays count all the same.
        { tour: 2, ms: { attente_fin: 200, transcription: 500, blanc_de_tour: 3000 }, synthese: [] },
      ],
    }),
    ligne({
      partie: 'a#2',
      rang: 2,
      delais: [
        {
          tour: 1,
          ms: { attente_fin: 300, transcription: 400, premiere_phrase: 800, blanc_de_tour: 1000 },
          synthese: [200],
        },
      ],
    }),
    ligne({
      partie: 'a#3',
      rang: 3,
      voix: 'julie',
      delais: [
        { tour: 1, ms: { attente_fin: 150, transcription: 250, blanc_de_tour: 1500 }, synthese: [100] },
      ],
    }),
    ligne({
      partie: 'b#1',
      scenario: 'b',
      raison: 'pas de micro',
      delais: [{ tour: 1, ms: { attente_fin: 99999, blanc_de_tour: 99999 }, synthese: [99999] }],
    }),
  ];
  let md = '';
  // In a hook, so a missing function fails these tests and not the whole file.
  beforeAll(() => {
    md = releveBudget(lignes);
  });

  it('is a section « Budget » with a note: a measure, not a verdict', () => {
    expect(md.split('\n')[0]).toBe('## Budget');
    expect(md).toContain('mesure seulement');
    expect(md).toContain('même poste');
    // The public repository names no path: the reference is the budget of the veille and the ADR 0011.
    expect(md).not.toMatch(/[A-Za-z]:\\|\/Users\/|perplexity/);
  });

  it('gives a row per step and per voice, the steps in the order of the budget', () => {
    expect(rangs(md).map((r) => [r['Étape'], r['Voix']])).toEqual([
      ['Détection de voix', ''],
      ['Fin de tour', 'hortense'],
      ['Fin de tour', 'julie'],
      ['Transcription', 'hortense'],
      ['Transcription', 'julie'],
      ['Première phrase du modèle', 'hortense'],
      ['Synthèse', 'hortense'],
      ['Synthèse', 'julie'],
      ['Sa voix (RVC)', ''],
      ['Bout en bout', 'hortense'],
      ['Bout en bout', 'julie'],
    ]);
  });

  it('names the delay of each step, her first sentence of synthesis alone', () => {
    const delai = (e: string) => [...new Set(de(md, e).map((r) => r['Délai']))];
    expect(delai('Fin de tour')).toEqual(['attente_fin']);
    expect(delai('Transcription')).toEqual(['transcription']);
    expect(delai('Première phrase du modèle')).toEqual(['premiere_phrase']);
    expect(delai('Synthèse')).toEqual(['synthese 1']);
    expect(delai('Bout en bout')).toEqual(['blanc_de_tour']);
  });

  it('gives the exact median and count, over every turn of every game of a voice', () => {
    const lu = (e: string, vx: string) => {
      const r = un(md, e, vx);
      return [r['Médiane'], r['Valeurs']];
    };
    expect(lu('Fin de tour', 'hortense')).toEqual(['200', '3']);
    expect(lu('Transcription', 'hortense')).toEqual(['400', '3']);
    expect(lu('Première phrase du modèle', 'hortense')).toEqual(['700', '2']);
    // `synthese 1` only: 400 and 200, not the 50 of the second sentence.
    expect(lu('Synthèse', 'hortense')).toEqual(['300', '2']);
    expect(lu('Bout en bout', 'hortense')).toEqual(['2000', '3']);
    expect(lu('Fin de tour', 'julie')).toEqual(['150', '1']);
    expect(lu('Bout en bout', 'julie')).toEqual(['1500', '1']);
  });

  it('counts a game not played nowhere', () => {
    expect(md).not.toContain('99999');
  });

  it('writes a step with a single value, and no 95th percentile under twenty values', () => {
    const r = un(md, 'Fin de tour', 'julie');
    expect([r['Médiane'], r['Valeurs'], r['95e centile']]).toEqual(['150', '1', '']);
    expect(un(md, 'Fin de tour', 'hortense')['95e centile']).toBe('');
  });

  it('gives the 95th percentile from twenty values, the nearest rank', () => {
    const vingt = releveBudget([
      ligne({
        delais: Array.from({ length: 20 }, (_, k) => ({
          tour: k + 1,
          ms: { attente_fin: (k + 1) * 10 },
          synthese: [],
        })),
      }),
    ]);
    const r = un(vingt, 'Fin de tour', 'hortense');
    expect([r['Médiane'], r['95e centile'], r['Valeurs']]).toEqual(['105', '190', '20']);
  });

  it('writes a step without any delay as not measured, with its row and its budget', () => {
    for (const e of ['Détection de voix', 'Sa voix (RVC)']) {
      const rs = de(md, e);
      expect(rs).toHaveLength(1);
      expect(rs[0]!['Médiane']).toBe('non mesurée');
      expect(rs[0]!['95e centile']).toBe('');
    }
  });

  it('keeps a step no voice has a value for, as not measured, beside the others', () => {
    const sans = releveBudget([ligne({ delais: [{ tour: 1, ms: { attente_fin: 120 }, synthese: [] }] })]);
    expect(rangs(sans).map((r) => r['Étape'])).toEqual(ETAPES);
    expect(un(sans, 'Fin de tour', 'hortense')['Médiane']).toBe('120');
    for (const e of ['Transcription', 'Première phrase du modèle', 'Synthèse', 'Bout en bout']) {
      const rs = de(sans, e);
      expect(rs).toHaveLength(1);
      expect(rs[0]!['Médiane']).toBe('non mesurée');
    }
  });

  it('does not break on no line at all, nor on games all not played', () => {
    for (const vide of [releveBudget([]), releveBudget([ligne({ raison: 'x' })])]) {
      expect(rangs(vide).map((r) => r['Étape'])).toEqual(ETAPES);
      expect(rangs(vide).every((r) => r['Médiane'] === 'non mesurée')).toBe(true);
    }
  });

  it('shows each step its budget of the veille, and the VIP target on the end to end alone', () => {
    const budgets: Record<string, string> = {
      'Détection de voix': '< 30 ms',
      'Fin de tour': '< 100 ms',
      Transcription: '< 300 ms',
      'Première phrase du modèle': '< 700 ms',
      Synthèse: '< 400 ms',
      'Sa voix (RVC)': '< 100 ms',
      'Bout en bout': '1,5 s',
    };
    for (const r of rangs(md)) {
      expect(r['Budget']).toBe(budgets[r['Étape']!]);
      expect(r['Cible du VIP']).toBe(r['Étape'] === 'Bout en bout' ? '2,5 s' : '');
    }
  });

  it('is a measure, never a failure: a delay far past its budget changes no verdict', () => {
    const lent = [
      ligne({ delais: [{ tour: 1, ms: { blanc_de_tour: 60000, transcription: 60000 }, synthese: [60000] }] }),
    ];
    expect(() => releveBudget(lent)).not.toThrow();
    expect(echoue(lent)).toEqual([]);
    expect(un(releveBudget(lent), 'Bout en bout', 'hortense')['Médiane']).toBe('60000');
  });
});
