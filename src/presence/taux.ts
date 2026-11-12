import { delays, type DelayName } from '../trace.ts';
import { nomDe } from './chaine/sons.ts';
import { passe, type Verdict } from './judge.ts';
import { compte, DELAIS, parCle, sansReponse, source, table, transcrite, type Jouee } from './releve.ts';

/**
 * The rates of a repeated suite (lun-docs plan « Les données et les taux »): a line per game, `resultats.jsonl`, then
 * the report read from those lines alone. Pure: nothing here reads a file.
 */

/** One game, one voice: a line of `resultats.jsonl`, written as soon as the game ends. */
export interface Resultat {
  /** The launch's hour, ISO. */
  suite: string;
  scenario: string;
  /** `<nom>#<k>`, the name written in `partie.json`. */
  partie: string;
  /** k, from 1, over the whole launch. */
  rang: number;
  /** `hortense`, `julie`, `piper:fr_FR-upmc-medium#pierre`… */
  voix: string;
  /** `faster:tiny`. */
  transcription: string;
  /** Her voice: `piper:fr_FR-siwis-medium`, or `fausse`. */
  synthese: string;
  /** `os.hostname()` and the processor. */
  poste: string;
  /** The real length of the game. */
  dureeMs?: number;
  /** The extract: failures only. */
  verdicts: (Omit<Verdict, 'couverture' | 'extrait'> & { extrait?: string[] })[];
  delais: { tour: number; ms: Partial<Record<DelayName, number>>; synthese: number[] }[];
  phrases?: {
    parole: number;
    dit: string;
    entendu?: string;
    confiance?: number;
    son: string;
    dureeMs: number;
  }[];
  inattendus: { texte: string; source: 'transcription' | 'scenario' }[];
  /** The file name. */
  deroule?: string;
  /** A scenario not played. */
  raison?: string;
}

/** The race is hers: the voice whose failures fail the suite. */
const COURSE = 'hortense';

/** What a game's line needs beside the game: its place in the launch. */
export interface Contexte {
  suite: string;
  partie: string;
  rang: number;
  voix: string;
  poste: string;
  deroule?: string;
}

/** The line of a game played. */
export function resultat(j: Jouee, o: Contexte): Resultat {
  const { scenario: s, chaine: c } = j;
  const sonnee = (i: number) => c.banc.some((e) => e.name === 'parole' && e['parole'] === i + 1);
  return {
    suite: o.suite,
    scenario: s.nom,
    partie: o.partie,
    rang: o.rang,
    voix: o.voix,
    transcription: j.transcription,
    synthese: j.synthese,
    poste: o.poste,
    dureeMs: Math.round(c.fin),
    verdicts: j.verdicts.map(
      (v) =>
        Object.fromEntries(
          Object.entries(v).filter(([k]) => k !== 'couverture' && (k !== 'extrait' || !passe(v))),
        ) as Resultat['verdicts'][number],
    ),
    delais: delays(c.page).map((t, k) => ({ tour: k + 1, ms: t.ms, synthese: t.synthese })),
    // A speech that never sounded (its anchor never came) was heard by nothing: no line, not a word lost.
    phrases: s.personne.flatMap((p, i) => {
      if (!sonnee(i)) return [];
      const t = transcrite(c, i);
      const [entendu, confiance] = [t?.['texte'], t?.['confiance']];
      return [
        {
          parole: i + 1,
          dit: p.dit,
          ...(typeof entendu === 'string' ? { entendu } : {}),
          ...(typeof confiance === 'number' ? { confiance } : {}),
          son: j.sons[i]!.source,
          dureeMs: j.sons[i]!.duree,
        },
      ];
    }),
    inattendus: sansReponse(s, c).map((x) => ({ texte: x.texte, source: x.source })),
    ...(o.deroule === undefined ? {} : { deroule: o.deroule }),
  };
}

/**
 * A game held, the one definition: every verdict out of a known defect passes, and the false model had no request it
 * had no reply for. A known defect counts nowhere here, whatever its state.
 */
export const tenue = (r: Resultat): boolean =>
  r.raison === undefined &&
  r.inattendus.length === 0 &&
  r.verdicts.every((v) => v.connu !== undefined || passe(v));

/**
 * Why a repeated suite fails, empty when it passes. Her games (the race): an expectation `tous` out of a known defect,
 * failed or not played, whose source is not the transcription; a request without a reply the scenario did not plan;
 * an error of the player. Another voice (the robustness): an error of the player only, the rest is in the report.
 */
export function echoue(lignes: readonly Resultat[]): string[] {
  return lignes.flatMap((r) => {
    if (r.raison !== undefined) return [];
    const qui = `${r.partie} (${r.voix})`;
    const joueur = r.verdicts.find((v) => v.espece === 'joueur');
    if (joueur) return [`${qui} : erreur du joueur, ${String(joueur.trouve)}`];
    if (r.voix !== COURSE) return [];
    return [
      ...r.verdicts
        .filter((v) => v.niveau === 'tous' && !v.connu && v.etat !== 'tenue' && v.source !== 'transcription')
        .map((v) => `${qui} : ${v.id} ${v.etat}, source ${v.source}`),
      ...r.inattendus
        .filter((x) => x.source === 'scenario')
        .map((x) => `${qui} : demande sans réponse « ${x.texte} », source scenario`),
    ];
  });
}

const unique = <T>(xs: readonly T[]) => [...new Set(xs)];
const pourcent = (a: number, b: number) => `${Math.round((100 * a) / b)} %`;
const trie = (xs: readonly number[]) => [...xs].sort((a, b) => a - b);
const mediane = (xs: readonly number[]) => {
  const s = trie(xs);
  const m = s.length >> 1;
  return Math.round(s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2);
};
/** The nearest rank, from twenty values only. */
const centile95 = (xs: readonly number[]) =>
  xs.length < 20 ? undefined : Math.round(trie(xs)[Math.ceil(0.95 * xs.length) - 1]!);
/** Each value and how many times it came: numbers in their order, other values the most frequent first. */
const repartition = (cles: readonly string[]) => {
  const n = new Map<string, number>();
  for (const k of cles) n.set(k, (n.get(k) ?? 0) + 1);
  const nombres = [...n.keys()].every((k) => k !== '' && !Number.isNaN(Number(k)));
  return [...n]
    .sort(([a, x], [b, y]) => (nombres ? Number(a) - Number(b) : y - x))
    .map(([k, c]) => (c > 1 ? `${k} ×${c}` : k))
    .join(', ');
};
/** Each delay of a line, by its name, `synthese <r>` for her voice's sentences. */
const delaisDe = (d: Resultat['delais'][number]): [string, number][] => [
  ...DELAIS.filter((n) => d.ms[n] !== undefined).map((n): [string, number] => [n, d.ms[n]!]),
  ...d.synthese.map((ms, r): [string, number] => [`synthese ${r + 1}`, ms]),
];

/**
 * The report of the rates, from the lines alone: what they are worth, then by scenario, by expectation and by voice
 * every rate « Ce qu'est un taux » defines, the drift of the delays from the first round to the last, and each game
 * failed with its file and its extracts.
 */
export function releveTaux(lignes: readonly Resultat[]): string {
  const jouees = lignes.filter((r) => r.raison === undefined);
  const noms = unique(jouees.map((r) => r.scenario));
  const voix = unique(jouees.map((r) => r.voix));
  const de = (nom: string, vx: string) => jouees.filter((r) => r.scenario === nom && r.voix === vx);
  const groupes = (nom: string) =>
    voix.map((vx) => [vx, de(nom, vx)] as const).filter(([, rs]) => rs.length > 0);
  // As in a game held: a known defect counts nowhere, whatever its state; its own table says it.
  const echecs = jouees.flatMap((r) =>
    r.verdicts.filter((v) => !v.connu && !passe(v)).map((v) => ({ ...v, voix: r.voix })),
  );
  const transcription = unique(lignes.map((r) => r.transcription)).join(', ');
  const duree = jouees.reduce((t, r) => t + (r.dureeMs ?? 0), 0);
  const course = noms.map((nom) => de(nom, COURSE).length).filter((n) => n > 0);

  const out = [
    '# Relevé des taux',
    '',
    `${compte(jouees.length, 'partie jouée', 'parties jouées')}, ${compte(noms.length, 'scénario', 'scénarios')} ; voix : ${parCle(jouees, (r) => r.voix)}.`,
    '',
    `Transcription : ${transcription}. Sa voix : ${unique(lignes.map((r) => r.synthese)).join(', ')}. Poste : ${unique(lignes.map((r) => r.poste)).join(', ')}. Durée des parties : ${Math.round(duree / 1000)} s.`,
    '',
    `Ces taux valent pour ${transcription} sur ce poste, pas pour un autre modèle ni un autre poste.`,
    '',
  ];
  if (course.length) {
    const n = Math.min(...course);
    out.push(
      `La course (${COURSE}) : zéro échec sur ${n} parties met l'échec sous ${Math.min(100, Math.round(300 / n))} %, à 95 % (règle de trois).`,
      '',
    );
  }
  out.push(
    `Échecs par espèce : ${parCle(echecs, (v) => v.espece ?? v.etat)}.`,
    '',
    `Échecs par source : ${parCle(echecs, (v) => v.source ?? v.mecanisme)}.`,
    '',
    `Échecs par voix : ${parCle(echecs, (v) => v.voix)}.`,
    '',
    `Demandes sans réponse : ${parCle(
      jouees.flatMap((r) => r.inattendus),
      (x) => x.source,
    )}.`,
    '',
    '## Par scénario',
    '',
    ...table(
      ['Scénario', 'Voix', 'Tenues', 'Jouées', 'Taux'],
      noms.flatMap((nom) =>
        groupes(nom).map(([vx, rs]) => {
          const n = rs.filter(tenue).length;
          return [nom, vx, n, rs.length, pourcent(n, rs.length)];
        }),
      ),
    ),
    '',
  );

  for (const nom of noms) {
    out.push(`## ${nom}`, '');
    const ids = unique(jouees.filter((r) => r.scenario === nom).flatMap((r) => r.verdicts.map((v) => v.id)));
    /** Each expectation's verdicts, voice by voice, where `garde` keeps it. */
    const lignesDe = (
      garde: (v: Resultat['verdicts'][number]) => boolean,
      f: (id: string, vx: string, vs: Resultat['verdicts'], n: number) => unknown[],
    ) =>
      ids.flatMap((id) =>
        groupes(nom).flatMap(([vx, rs]) => {
          const vs = rs.flatMap((r) => r.verdicts.filter((v) => v.id === id));
          return vs.length && vs.every(garde) ? [f(id, vx, vs, rs.length)] : [];
        }),
      );
    const section = (titre: string, tete: string[], rangs: unknown[][]) => {
      if (rangs.length) out.push(`${titre} :`, '', ...table(tete, rangs), '');
    };
    const nb = (vs: Resultat['verdicts'], f: (v: Resultat['verdicts'][number]) => boolean) =>
      vs.filter(f).length;

    section(
      'Attentes tous',
      ['Attendu', 'Voix', 'Tenues', 'Ratées', 'Non jouées', 'Taux'],
      lignesDe(
        (v) => v.niveau === 'tous' && !v.connu,
        (id, vx, vs, n) => {
          const t = nb(vs, (v) => v.etat === 'tenue');
          return [
            id,
            vx,
            t,
            nb(vs, (v) => v.etat === 'ratee'),
            nb(vs, (v) => v.etat === 'non_jouee'),
            pourcent(t, n),
          ];
        },
      ),
    );
    section(
      'Défauts connus',
      ['Attendu', 'Issue', 'Voix', 'Comme connu', 'Tenu', 'Autrement raté'],
      lignesDe(
        (v) => v.connu !== undefined,
        (id, vx, vs) => {
          const [connu, tenu] = [nb(vs, (v) => v.connu!.conforme), nb(vs, (v) => v.etat === 'tenue')];
          return [id, vs[0]!.connu!.issue, vx, connu, tenu, vs.length - connu - tenu];
        },
      ),
    );
    section(
      'Mesures',
      ['Attendu', 'Voix', 'Dans sa borne', 'Borne', 'Trouvé'],
      lignesDe(
        (v) => v.niveau === 'exact' && !v.connu,
        (id, vx, vs, n) => [
          id,
          vx,
          `${nb(vs, (v) => v.etat === 'tenue')} / ${n}`,
          vs[0]!.borne && `[${vs[0]!.borne.join(', ')}]`,
          repartition(vs.map((v) => (v.trouve === undefined ? (v.espece ?? v.etat) : String(v.trouve)))),
        ],
      ),
    );

    // One cell per turn, delay and voice; the voices keep their order through the stable sort.
    const delais = new Map<string, number[]>();
    for (const [vx, rs] of groupes(nom))
      for (const d of rs.flatMap((r) => r.delais))
        for (const [n, ms] of delaisDe(d)) {
          const cle = [d.tour, n, vx].join('	');
          delais.set(cle, [...(delais.get(cle) ?? []), ms]);
        }
    const ordre = ([tour, n]: string[]) =>
      Number(tour) * 1000 +
      (n!.startsWith('synthese') ? DELAIS.length + Number(n!.split(' ')[1]) : DELAIS.indexOf(n as DelayName));
    section(
      'Délais',
      ['Tour', 'Délai', 'Voix', 'Médiane', '95e centile', 'Min', 'Max'],
      [...delais]
        .map(([cle, xs]) => [
          ...cle.split('	'),
          mediane(xs),
          centile95(xs),
          Math.round(Math.min(...xs)),
          Math.round(Math.max(...xs)),
        ])
        .sort((a, b) => ordre(a as string[]) - ordre(b as string[])),
    );

    const paroles = unique(
      jouees.filter((r) => r.scenario === nom).flatMap((r) => (r.phrases ?? []).map((p) => p.parole)),
    ).sort((a, b) => a - b);
    section(
      'Transcription',
      ['Parole', 'Dit', 'Voix', 'Justes', 'Entendu'],
      paroles.flatMap((k) =>
        groupes(nom).flatMap(([vx, rs]) => {
          const ps = rs.flatMap((r) => (r.phrases ?? []).filter((p) => p.parole === k));
          if (!ps.length) return [];
          const justes = ps.filter((p) => nomDe(p.entendu ?? '') === nomDe(p.dit)).length;
          return [
            [
              k,
              ps[0]!.dit,
              vx,
              `${justes} / ${ps.length}`,
              repartition(ps.map((p) => (p.entendu ? `« ${p.entendu} »` : '(rien)'))),
            ],
          ];
        }),
      ),
    );
  }

  // A round: the k-th game of each scenario in a voice. The drift compares the first round with the last.
  const derive = voix.flatMap((vx) => {
    const parRang = noms
      .map((nom) => [...de(nom, vx)].sort((a, b) => a.rang - b.rang))
      .filter((rs) => rs.length > 1);
    const valeurs = (rs: Resultat[], n: string) =>
      rs
        .flatMap((r) => r.delais.flatMap(delaisDe))
        .filter(([x]) => x.split(' ')[0] === n)
        .map(([, ms]) => ms);
    const [premier, dernier] = [parRang.map((rs) => rs[0]!), parRang.map((rs) => rs.at(-1)!)];
    return [...DELAIS, 'synthese'].flatMap((n) => {
      const [a, b] = [valeurs(premier, n), valeurs(dernier, n)];
      return a.length && b.length ? [[vx, n, mediane(a), mediane(b)]] : [];
    });
  });
  if (derive.length)
    out.push('## Dérive', '', ...table(['Voix', 'Délai', 'Premier tour', 'Dernier tour'], derive), '');

  const manquent = unique(
    lignes.filter((r) => r.raison !== undefined).map((r) => `${r.scenario}\t${r.raison}`),
  );
  if (manquent.length)
    out.push(
      '## Non joués',
      '',
      ...table(
        ['Scénario', 'Raison'],
        manquent.map((m) => m.split('\t')),
      ),
      '',
    );

  const ratees = jouees.filter((r) => !tenue(r));
  if (ratees.length) out.push('## Parties ratées', '');
  for (const r of ratees) {
    const fautes = r.verdicts.filter((v) => !v.connu && !passe(v));
    out.push(`### ${r.partie} (${r.voix})`, '', `Déroulé : ${r.deroule ?? 'aucun'}.`, '');
    if (fautes.length)
      out.push(
        ...table(
          ['Attendu', 'Espèce', 'Source', 'Trouvé'],
          fautes.map((v) => [v.id, v.espece, source(v), v.trouve]),
        ),
        '',
      );
    for (const x of r.inattendus) out.push(`Demande sans réponse, source ${x.source} : « ${x.texte} ».`, '');
    for (const v of fautes.filter((x) => x.extrait?.length))
      out.push(`${v.id} :`, '', '```', ...v.extrait!, '```', '');
  }
  return out.join('\n');
}
