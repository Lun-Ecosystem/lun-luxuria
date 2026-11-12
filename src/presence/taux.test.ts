// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Verdict } from './judge.ts';
import type { Jouee } from './releve.ts';
import type { Partie, Scenario } from './scenario.ts';
import { echoue, releveTaux, resultat, tenue, type Resultat } from './taux.ts';

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
