import { delays, type DelayName, type TraceEvent, type TraceValue } from '../trace.ts';
import { passe, type Verdict } from './judge.ts';
import { choisir, rattacher, type Mecanisme, type Partie, type Scenario } from './scenario.ts';

/** One scenario judged: what the report is made of. */
export interface Juge {
  nom: string;
  verdicts: Verdict[];
  /** Lines written after its verdicts. */
  annexe?: string[];
}

export const compte = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

export const parCle = <T>(vs: readonly T[], cle: (v: T) => string): string => {
  const n = new Map<string, number>();
  for (const v of vs) n.set(cle(v), (n.get(cle(v)) ?? 0) + 1);
  return n.size === 0 ? 'aucun' : [...n].map(([k, c]) => `${k} ${c}`).join(', ');
};

const cellule = (x: unknown) => (x === undefined ? '' : String(x).replaceAll('|', '\\|'));

const etat = (v: Verdict) =>
  v.connu ? `${v.connu.conforme ? 'connue' : `${v.etat}, connue ailleurs`} (${v.connu.issue})` : v.etat;

// The link it names on its own, when the game's first failure is named instead: a second defect is not hidden.
export const source = (v: Pick<Verdict, 'source' | 'propre'>) =>
  v.propre && v.propre !== v.source ? `${v.source} (propre : ${v.propre})` : v.source;

export const table = (tete: string[], lignes: unknown[][]): string[] => [
  `| ${tete.join(' | ')} |`,
  `|${tete.map(() => '---|').join('')}`,
  ...lignes.map((l) => `| ${l.map(cellule).join(' | ')} |`),
];

const verdicts = (vs: Verdict[]) =>
  table(
    ['Attendu', 'État', 'Espèce', 'Source', 'Trouvé', 'Borne'],
    vs.map((v) => [v.id, etat(v), v.espece, source(v), v.trouve, v.borne && `[${v.borne.join(', ')}]`]),
  );

/**
 * The report in Markdown: counts, failures by species then by source, a table per scenario, its measures (the
 * `exact` judged in the chain, counted nowhere), each failure's excerpt, then the scenario's `annexe`.
 */
export function releve(juges: Juge[], titre = 'Relevé des scénarios'): string {
  const tous = juges.flatMap((j) => j.verdicts).filter((v) => !v.horsNiveau);
  const echecs = tous.filter((v) => !passe(v));
  const connues = tous.filter((v) => v.connu?.conforme).length;
  const sans = tous.filter((v) => !v.connu?.conforme);
  const out = [
    `# ${titre}`,
    '',
    `Attentes : ${[
      compte(sans.filter((v) => v.etat === 'tenue').length, 'tenue', 'tenues'),
      compte(sans.filter((v) => v.etat === 'ratee').length, 'ratée', 'ratées'),
      compte(connues, 'connue', 'connues'),
      compte(sans.filter((v) => v.etat === 'non_jouee').length, 'non jouée', 'non jouées'),
    ].join(', ')}.`,
    '',
    // A known defect that holds now has no species: it failed by changing.
    `Échecs par espèce : ${parCle(echecs, (v) => v.espece ?? 'connu_change')}.`,
    '',
    `Échecs par source : ${parCle(echecs, (v) => v.source ?? v.mecanisme)}.`,
    '',
  ];
  for (const j of juges) {
    const mesures = j.verdicts.filter((v) => v.horsNiveau);
    out.push(`## ${j.nom}`, '', ...verdicts(j.verdicts.filter((v) => !v.horsNiveau)), '');
    if (mesures.length) out.push('### Mesures', '', ...verdicts(mesures), '');
    for (const v of j.verdicts.filter((x) => !passe(x))) {
      out.push(
        `### ${v.id} : ${v.dit}`,
        '',
        `Couverture : ${v.couverture.length ? v.couverture.join(', ') : 'aucune'}.`,
        '',
      );
      if (v.extrait.length) out.push('```', ...v.extrait, '```', '');
    }
    if (j.annexe) out.push(...j.annexe);
  }
  return out.join('\n');
}

/** A scenario played through the chain, with what its report needs. */
export interface Jouee {
  scenario: Scenario;
  verdicts: Verdict[];
  /** The game through the chain: the page's trace, the probe's and the server's lines, shifted to the probe's t0. */
  chaine: Partie;
  /** The same scenario played at the exact level, for its delays. */
  exacte: Partie;
  /** The transcription model the voice service runs (`faster:tiny`). */
  transcription: string;
  /** Her voice: the service's, without its path (`piper:fr_FR-siwis-medium`), or `fausse`, the player's. */
  synthese: string;
  /** The person's: `hortense`, `julie`, `piper:fr_FR-upmc-medium#pierre`… */
  voix: string;
  /** In the order of `personne`: where each speech's sound comes from (`pose:non.wav`, `cache:julie`…), its length. */
  sons: readonly { source: string; duree: number }[];
  /** What `getOutputTimestamp` announces, once a game: never added to an instant (« Les deux horloges »). */
  latenceSortieMs?: number;
  /** The same scenario through Chromium's false device, re-timed on its first frame of sound. */
  temoin?: Partie;
}

/** One scenario at the chain's level: its game, or why it was not played. */
export type PartieChaine = Jouee | { scenario: Scenario; raison: string };

/** The link a delay's gap is born in. */
const MAILLON: Partial<Record<DelayName, Mecanisme>> = {
  attente_fin: 'ecoute',
  transcription: 'transcription',
  file_serveur: 'serveur',
  premier_mot: 'serveur',
  premiere_phrase: 'serveur',
  arret_coupure: 'suspension',
};
export const DELAIS: DelayName[] = [
  'attente_fin',
  'transcription',
  'file_serveur',
  'premier_mot',
  'poste',
  'second_mot',
  'premiere_phrase',
  'blanc_de_tour',
  'arret_coupure',
];

const num = (v: TraceValue | undefined) => (typeof v === 'number' ? v : undefined);
const ecart = (a?: number, b?: number) => (a === undefined || b === undefined ? undefined : b - a);
const son = (e: TraceEvent) => num(e['son']) ?? e.at;

/**
 * The report of the chain: the scenarios' report, each with what the chain measured, then those not played. Each
 * title says the person's voice, unless it is Hortense's alone.
 */
export function releveChaine(parties: PartieChaine[]): string {
  const jouees = parties.filter((p): p is Jouee => 'chaine' in p);
  const manquent = parties.filter((p) => 'raison' in p);
  const seule = jouees.every((p) => p.voix === 'hortense');
  const out = [
    releve(
      jouees.map((p) => ({
        nom: seule ? p.scenario.nom : `${p.scenario.nom} (${p.voix})`,
        verdicts: p.verdicts,
        annexe: annexe(p),
      })),
      'Relevé de la chaîne',
    ),
  ];
  if (manquent.length)
    out.push(
      '## Non joués',
      '',
      ...table(
        ['Scénario', 'Raison'],
        manquent.map((p) => [p.scenario.nom, p.raison]),
      ),
      '',
    );
  return out.join('\n');
}

/** The sentence of the trace a speech sounds in: the first `voix` from its start (see the shortcut in `annexe`). */
const voixDe = (c: Partie, i: number) => {
  const d = c.banc.find((e) => e.name === 'parole' && e['etape'] === 'debut' && e['parole'] === i + 1);
  return d && c.page.find((e) => e.name === 'voix' && son(e) >= d.at);
};

/** The last transcription of the sentence the n-th speech (from 0) sounds in: what was heard of it. */
export const transcrite = (c: Partie, i: number): TraceEvent | undefined => {
  const voix = voixDe(c, i);
  return voix && c.page.filter((e) => e.name === 'transcrite' && e.phrase === voix.phrase).at(-1);
};

/**
 * Each request the false model had no reply for, with the text received and its source, as `juger` names it: the
 * transcription when what was said would have chosen a reply, else the scenario. One rule, for every report.
 */
export function sansReponse(
  s: Scenario,
  c: Partie,
): { sorte: string; texte: string; extrait: string; source: 'transcription' | 'scenario' }[] {
  const banc = (name: string) => c.banc.filter((e) => e.name === name);
  const appels = c.banc.filter(
    (e) => e.name === 'modele_appele' || (e.name === 'modele_inattendu' && e['sorte'] === 'stream'),
  );
  const envois = rattacher(appels, banc('envoi_recu'));
  return banc('modele_inattendu').map((e) => {
    const envoi = envois[appels.indexOf(e)];
    const phrase = envoi && c.page.find((x) => x.name === 'numero' && x.reponse === envoi.reponse)?.phrase;
    const dits = s.personne.filter((_, i) => phrase !== undefined && voixDe(c, i)?.phrase === phrase);
    const source =
      dits.length && choisir(s.modele?.reponses ?? [], dits.map((x) => x.dit).join(' ')) >= 0
        ? 'transcription'
        : 'scenario';
    return {
      sorte: String(e['sorte']),
      texte: String(envoi?.['texte'] ?? ''),
      extrait: String(e['extrait'] ?? ''),
      source,
    };
  });
}

function annexe(p: Jouee): string[] {
  const { scenario: s, chaine: c } = p;
  const banc = (name: string) => c.banc.filter((e) => e.name === name);
  const debuts = banc('parole').filter((e) => e['etape'] === 'debut');
  // A request refused fails the game (`chaine.test.ts`) even with every verdict held: said here, its source as `juger`.
  const refus = sansReponse(s, c).map(
    (r) =>
      `Échec : demande au modèle sans réponse prévue (${r.sorte}), texte reçu « ${r.texte} », extrait « ${r.extrait} », source : ${r.source}.`,
  );
  const out = [
    ...refus.flatMap((l) => [l, '']),
    '### La chaîne',
    '',
    `Transcription : ${p.transcription}. Sa voix : ${p.synthese}. Latence de sortie annoncée : ${
      p.latenceSortieMs === undefined ? 'non lue' : `${p.latenceSortieMs} ms`
    }.`,
    '',
  ];

  // shortcut: a speech is the sentence of the first `voix` from its start; one that goes on an open sentence shows none.
  out.push(
    ...table(
      ['Parole', 'Dit', 'Son', 'Entendu', 'Confiance', 'Capture'],
      s.personne.map((x, i) => {
        const d = debuts.find((e) => e['parole'] === i + 1);
        const source = p.sons[i]?.source;
        if (!d) return [i + 1, x.dit, source, '(sautée)'];
        const [voix, t] = [voixDe(c, i), transcrite(c, i)];
        return [i + 1, x.dit, source, t?.['texte'], t?.['confiance'], voix && son(voix) - d.at];
      }),
    ),
    '',
  );

  // Turns matched by their order: the reply numbers are not the same on both levels.
  const [ex, ch] = [delays(p.exacte.page), delays(c.page)];
  const tours: unknown[][] = [];
  for (let k = 0; k < Math.max(ex.length, ch.length); k++) {
    const [e, h] = [ex[k], ch[k]];
    for (const n of DELAIS.filter((x) => e?.ms[x] !== undefined || h?.ms[x] !== undefined))
      tours.push([k + 1, n, e?.ms[n], h?.ms[n], ecart(e?.ms[n], h?.ms[n]), MAILLON[n]]);
    for (let r = 0; r < Math.max(e?.synthese.length ?? 0, h?.synthese.length ?? 0); r++)
      tours.push([
        k + 1,
        `synthese ${r + 1}`,
        e?.synthese[r],
        h?.synthese[r],
        ecart(e?.synthese[r], h?.synthese[r]),
        'voix',
      ]);
  }
  out.push(...table(['Tour', 'Délai', 'Exact', 'Chaîne', 'Écart', 'Maillon'], tours), '');

  // What the page believes (`son` at `start()`) against what sounds (`joue`), sentence by sentence, in their order.
  const departs = c.page.filter((e) => e.name === 'son' && e['etape'] === 'debut');
  out.push(
    ...table(
      ['Son', 'Texte', 'joue − départ', 'Silence de tête', 'Web Audio'],
      banc('joue').map((j, k) => {
        const d = departs[k] && j.at - departs[k].at;
        const tete = num(j['tete']);
        return [k + 1, j['texte'], d, tete, ecart(tete, d)];
      }),
    ),
    '',
  );

  if (p.temoin) {
    const t = p.temoin;
    const decisions: unknown[][] = [];
    for (const n of ['voix', 'tenue', 'fin']) {
      const [a, b] = [c.page.filter((e) => e.name === n), t.page.filter((e) => e.name === n)];
      for (let k = 0; k < Math.max(a.length, b.length); k++)
        decisions.push([`${n} ${k + 1}`, a[k]?.at, b[k]?.at, ecart(a[k]?.at, b[k]?.at)]);
    }
    out.push(
      'Le témoin par Chromium :',
      '',
      ...table(['Décision', 'Sonde', 'Chromium', 'Écart'], decisions),
      '',
    );
  }

  const ignores = [
    ...s.personne.flatMap((x, i) =>
      (['voix', 'entendu', 'confiance', 'transcriptionMs', 'echec'] as const)
        .filter((k) => x[k] !== undefined)
        .map((k) => `personne[${i + 1}].${k}`),
    ),
    ...(s.bruits ?? []).map((_, i) => `bruits[${i + 1}].voix`),
    ...(s.modeleMs !== undefined ? ['modeleMs'] : []),
    ...(p.synthese !== 'fausse'
      ? (['syntheseMs', 'msParCaractere', 'echoue'] as const)
          .filter((k) => s.voix?.[k] !== undefined)
          .map((k) => `voix.${k}`)
      : []),
  ];
  out.push(`Champs ignorés : ${ignores.length ? ignores.join(', ') : 'aucun'}.`, '');
  return out;
}
