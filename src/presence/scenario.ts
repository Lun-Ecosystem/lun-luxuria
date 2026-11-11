import type { SpeechWhy } from '../brain.ts';
import type { Layout, Settings } from '../settings.ts';
import { SYNTH_TIMEOUT_MS } from '../speech/speaker.ts';
import type { DelayName, TraceEvent, TraceName, TraceValue } from '../trace.ts';

/**
 * A scenario: a point of the listening list, as data a player plays and a judge reads. Data only (no function, no
 * computed value): it goes through `JSON.stringify` as it is. Times are in ms from the start of the game.
 */

/**
 * The links of the chain, in its order: the source of a failure is the first of them a failure of the game names
 * (the rule is on `juger`).
 */
export const RANG = {
  ecoute: 0,
  essai: 1,
  transcription: 2,
  filtre: 3,
  // Same rank: one holds when she is silent, the other when she speaks.
  retenue: 4,
  suspension: 4,
  coupure: 5,
  serveur: 6,
  voix: 7,
} as const;

export type Mecanisme = keyof typeof RANG;

/** What the player writes in its own log, on the page's clock: what the world did, that the page does not know. */
export type BancNom =
  /** `etape` 'debut' | 'fin', `parole` its number from 1. */
  | 'parole'
  /** `etape` 'debut' | 'fin'. */
  | 'bruit_joue'
  /** `etape` 'debut' | 'fin': her own sound back in the microphone. */
  | 'echo'
  /** `texte`: what the false server received; `reponse`: the number it gives that reply. */
  | 'envoi_recu'
  /** `message`: the number withdrawn. */
  | 'retrait_recu'
  /** `reponse`, `entendu`: the words heard of it. */
  | 'coupure_recue'
  /**
   * `reponse`, `texte`: the sentence the output starts. At the chain's level, the probe dates its first sample not
   * silent, and adds `tete`: the ms of silence at the head of the sound the voice service gave.
   */
  | 'joue'
  /** `reponse`: the output stops, at its end or cut. */
  | 'arrete'
  /**
   * `geste` 'silence', `etape` 'fait' | 'saute' | 'introuvable': a gesture of the person, played at its instant, never
   * anchored, or (in the chain) its button not on the page.
   */
  | 'geste'
  /** `parole`: an anchored speech whose anchor never came; it never sounded. */
  | 'parole_sautee'
  /** `reponse` (the index in `modele.reponses`, from 0), `texte`: what the false model behind the real server chose. */
  | 'modele_appele'
  /**
   * `sorte` 'stream' | 'complete', `extrait`: the last 80 characters of a request the false model had no reply for.
   * A 'stream' one answers a text received.
   */
  | 'modele_inattendu';

/** A line of the player's log, merged with the page's trace in the same file. */
export interface BancEvent {
  de: 'banc';
  at: number;
  name: BancNom;
  reponse?: number;
  [value: string]: TraceValue | undefined;
}

/** What one game gives the judge: the page's trace, with its format, and the player's log. */
export interface Partie {
  format: number;
  page: readonly TraceEvent[];
  banc: readonly BancEvent[];
  /** The instant the game stops: a window « until the end » runs to it. */
  fin: number;
  /** An exception the chain of frames threw: the judge makes every expectation `joueur`. */
  erreur?: string;
}

/** What says, in the trace or the log, that a link played. */
export const ECRIT_PAR: Record<Mecanisme, { page: readonly TraceName[]; banc: readonly BancNom[] }> = {
  ecoute: { page: ['voix', 'tenue', 'pause', 'reprise', 'fin', 'bruit'], banc: ['parole', 'bruit_joue'] },
  essai: { page: ['essai', 'retiree', 'confirmee'], banc: [] },
  transcription: { page: ['transcrite'], banc: [] },
  filtre: { page: ['verdict'], banc: [] },
  retenue: { page: ['retenue', 'relachee', 'oubliee'], banc: [] },
  // The sound it stops (`son`, `arrete`) is always written after its `suspendue`.
  suspension: { page: ['suspendue', 'reprise_voix'], banc: [] },
  coupure: { page: ['coupee', 'arretee'], banc: ['coupure_recue'] },
  serveur: {
    page: ['envoyee', 'numero', 'phrase_recue', 'fin_recue', 'durees'],
    banc: ['envoi_recu', 'retrait_recu', 'modele_appele', 'modele_inattendu'],
  },
  voix: { page: ['synthese', 'son', 'premier_son', 'silence'], banc: ['joue', 'arrete', 'echo'] },
};

/** The false bricks' values when a scenario says nothing. */
export const DEFAUTS = {
  /** Probability of voice during a `Parole`. */
  voix: 0.9,
  confiance: 0.9,
  transcriptionMs: 150,
  /** From `send` to its `reply` number. */
  numeroMs: 20,
  premierMotMs: 400,
  entrePhrasesMs: 300,
  syntheseMs: 150,
  msParCaractere: 60,
  modeleMs: 0,
  /** The game ends this long after the last planned event, when `jusqua` is not given. */
  finApresMs: 5000,
  disposition: 'scene' as Layout,
} as const;

export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/**
 * An instant anchored on the game, `ms` after it. `joue`: the start of the sound of sentence `phrase` (1 by default)
 * of reply `joue` (the reply to the n-th text the server received, as `Tour`); `envoi`: the n-th text received.
 */
export type Apres = { joue: number; phrase?: number; ms: number } | { envoi: number; ms: number };

/** What the person says, and when: at `a`, or after an anchor (one of the two). */
export interface Parole {
  a?: number;
  apres?: Apres;
  dit: string;
  duree: number;
  /** Probability of voice during the speech, `DEFAUTS.voix` by default. */
  voix?: number;
  /** Silences inside it, relative to `a`. */
  trous?: { a: number; duree: number }[];
  /** What the transcription gives, `dit` by default. */
  entendu?: string;
  confiance?: number;
  transcriptionMs?: number;
  /** The transcription fails. */
  echec?: true;
}

/**
 * What the false model says to a text it receives. The false server's clock, from `envoi_recu` (the text received):
 * the reply's number at `DEFAUTS.numeroMs`; sentence 1 at `premierMotMs` (the number included); each next sentence
 * `entrePhrasesMs` after the one before, except the one after a `poste`: `poste.ms + premierMotMs` after it, as
 * the server does, whose `secondWordMs` is the first word of the call that follows the tool. Nothing waits for her
 * voice.
 */
export interface Reponse {
  /**
   * Contained in the text received, without accents or case; the first that matches answers, one without `si` any.
   * One without `si` answers her own words heard back too: with an `echo`, give every reply a `si`.
   */
  si?: string;
  /** From the text received to the first sentence, the reply's number included. */
  premierMotMs?: number;
  /** What the model writes, sentence by sentence. */
  phrases: string[];
  entrePhrasesMs?: number;
  /** A call to a tool of the PC after the sentence `apres` (from 1), and how long it takes. */
  poste?: { apres: number; ms: number };
  /** The reply ends in this error. */
  erreur?: string;
}

/**
 * A word of her own, without a sentence of the person (`pourquoi` other than a reply): sentence 1 at `a`, each next
 * one `DEFAUTS.entrePhrasesMs` after the one before; numbered 51, 52… in their order.
 */
export interface Parle {
  a: number;
  pourquoi: Exclude<SpeechWhy, 'reply'>;
  phrases: string[];
}

/** A gesture of the person on the page: `silence` presses « Faire taire ». At `a`, or after an anchor. */
export interface Geste {
  geste: 'silence';
  a?: number;
  apres?: Apres;
}

export type Niveau = 'exact' | 'tous';

/** Where a game is played: the false bricks on a false clock, or the real chain in real time. */
export type Lieu = 'exact' | 'chaine';

/**
 * From 1. `parole`: the sentence of the trace the n-th speech of `personne` sounds in, the one it opens or, said
 * before the sentence before has ended (after a cough, say), the one it goes on. `reponse`: the reply to the n-th
 * text the false server received (`envoi_recu`), a try withdrawn included. `parle`: the n-th of `modele.parle`.
 * A sentence opened by her echo or by a noise has no turn: an expectation on it names none, and says it by `valeurs`.
 */
export type Tour = { parole: number } | { reponse: number } | { parle: number };

/** The turn, and values the event must carry (`etape`, `resultat`, `par`, `texte`…). */
export type Filtre = Partial<Tour> & { essai?: number; valeurs?: Record<string, TraceValue> };

/** From the start of the game by default. */
export type Ancre = { attendu: string } | { parole: number; bord: 'debut' | 'fin' };

export type Espece =
  'absent' | 'hors_bornes' | 'en_trop' | 'delai_manquant' | 'non_jouee' | 'scenario' | 'joueur';

interface AttenduCommun {
  id: string;
  niveau: Niveau;
  /**
   * The link it checks: one of the scenario's `mecanismes`, or, for an `absent` only, a link that must not play
   * (the scenario does not play it, so it is not in its chain). Any other is refused at loading.
   */
  mecanisme: Mecanisme;
  /** What it checks, in words. */
  dit: string;
}

/** An event after its anchor, in `entre` (ms from the anchor) if given; `absent`: none in that window. */
export interface AttenduEvenement extends AttenduCommun {
  evenement: TraceName | BancNom;
  ou?: Filtre;
  depuis?: Ancre;
  entre?: [number, number];
  absent?: true;
}

/** A delay of `delays()`, for the turn named. */
export interface AttenduDelai extends AttenduCommun {
  delai: DelayName;
  tour: Tour;
  entre: [number, number];
}

/**
 * The time she speaks over the person, read in the player's log: the sum, over every `parole` of `personne` (not a
 * noise, not her echo) and every sentence she plays (`joue` to its `arrete`), of their overlap.
 */
export interface AttenduMesure extends AttenduCommun {
  mesure: 'chevauchement';
  entre: [number, number];
}

export type Attendu = AttenduEvenement | AttenduDelai | AttenduMesure;

/** A known defect: the species and the value it gives today. Any other result breaks the CI. */
export interface Connu {
  issue: string;
  attendu: string;
  espece: Espece;
  trouve?: TraceValue;
}

export interface Scenario {
  nom: string;
  /** The point of the listening list it replaces, word for word. */
  source: string;
  /** What it proves beyond conversation.test.ts and turns.test.ts, in one line. */
  apport: string;
  /** The links it plays, in the order of the chain. */
  mecanismes: Mecanisme[];
  /** `DEFAUTS.disposition` by default. */
  disposition?: Layout;
  /** Over `DEFAULTS`. */
  reglages?: DeepPartial<Settings>;
  /** The voice model's time per frame: a frame is decided at `at + modeleMs`, after the one before. */
  modeleMs?: number;
  /** What she hears of the person. */
  personne: Parole[];
  /** A sound without words: the transcription gives ''. */
  bruits?: { a: number; duree: number; voix: number }[];
  /** Her own sound back in the microphone, at this probability of voice, while it sounds. */
  echo?: { voix: number };
  /**
   * What the false model says. At the exact level the false server draws sentences and durations from it; at step 3
   * the same object drives a false model behind the real server. `reponses`: to what is sent; `parle`: on its own.
   */
  modele?: { reponses?: Reponse[]; parle?: Parle[] };
  /** Her voice: synthesis time, sound time per character, texts whose synthesis fails. */
  voix?: { syntheseMs?: number; msParCaractere?: number; echoue?: string[] };
  gestes?: Geste[];
  /** End of the game; by default `DEFAUTS.finApresMs` after the last planned event. */
  jusqua?: number;
  attendus: Attendu[];
  connus?: Connu[];
}

/** `over` on `base`, key by key; an array or a value replaces. */
export const merged = (base: unknown, over: unknown): unknown =>
  over && typeof over === 'object' && !Array.isArray(over)
    ? Object.fromEntries(
        [...new Set([...Object.keys(base as object), ...Object.keys(over)])].map((k) => [
          k,
          merged((base as Record<string, unknown>)[k], (over as Record<string, unknown>)[k]),
        ]),
      )
    : over === undefined
      ? base
      : over;

export const plain = (t: string): string => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The false model's rule: the index of the first reply whose `si` the text contains, or of one without; -1: none. */
export const choisir = (reponses: readonly Reponse[], texte: string): number =>
  reponses.findIndex((x) => !x.si || plain(texte).includes(plain(x.si)));

/**
 * What the real server says of each sentence of a reply (the speaker of the chain's server): the first one
 * may stop at its first `, ` outside brackets, from its third character, because a first sound matters more than a
 * whole sentence; its rest follows as a sentence of its own. The others stay whole.
 * shortcut: a sentence end before that comma keeps the sentence whole (the server would cut it there first); a
 * scenario's sentence is one sentence. Go to the server's `sentenceEnd` if one ever holds two.
 */
export function morceaux(phrases: readonly string[]): string[][] {
  return phrases.map((p, i) => {
    if (i > 0) return [p];
    let ouvertes = 0;
    for (let k = 0; k < p.length; k++) {
      const c = p[k]!;
      if (c === '(' || c === '[') ouvertes++;
      else if ((c === ')' || c === ']') && ouvertes > 0) ouvertes--;
      else if ('.!?…\n'.includes(c)) return [p];
      else if (c === ',' && p[k + 1] === ' ' && ouvertes === 0)
        return k >= 2 ? [p.slice(0, k + 1), p.slice(k + 1).trim()] : [p];
    }
    return [p];
  });
}

/** The instant an anchor gives in the player's log, or undefined while it has not come. */
export function ancre(apres: Apres, journal: readonly BancEvent[]): number | undefined {
  const envois = journal.filter((e) => e.name === 'envoi_recu');
  if ('envoi' in apres) {
    const e = envois[apres.envoi - 1];
    return e && e.at + apres.ms;
  }
  const r = envois[apres.joue - 1]?.reponse;
  if (r === undefined) return undefined;
  const n = apres.phrase ?? 1;
  const joues = journal.filter((e) => e.name === 'joue' && e.reponse === r);
  // The probe numbers each sound's sentence; the exact level's `joue` has no number, its rank is the sentence.
  const j = joues.some((e) => e['phrase'] !== undefined)
    ? joues.find((e) => e['phrase'] === n)
    : joues[n - 1];
  return j && j.at + apres.ms;
}

/**
 * For each call of the false model, the text received it answers: the first not yet taken with the same `texte` (the
 * server writes the same raw string in both). A reply withdrawn or forgotten in the queue, or `fixed`, has no call.
 * A request it refused (`modele_inattendu`) keeps only the last 80 characters, `extrait`: the texts compare by them.
 */
export function rattacher<E extends object>(appels: readonly E[], envois: readonly E[]): (E | undefined)[] {
  const fin = (x: E) => {
    const r = x as Record<string, unknown>;
    return String(r['texte'] ?? r['extrait'] ?? '').slice(-80);
  };
  const pris = new Set<E>();
  return appels.map((a) => {
    const e = envois.find((x) => !pris.has(x) && fin(x) === fin(a));
    if (e) pris.add(e);
    return e;
  });
}

/** The events that carry the person's words as heard: a transcribed text is never the same twice in the chain. */
const MOTS_ENTENDUS: readonly string[] = ['transcrite', 'envoi_recu', 'modele_appele'];
/** The server's lines: in the chain, merged by their numbers, not by their instant. */
const LIGNES_SERVEUR: readonly string[] = ['envoi_recu', 'coupure_recue', 'retrait_recu'];

/** A scenario badly written: every reason at once. */
export class ScenarioRefuse extends Error {
  readonly raisons: string[];
  constructor(nom: string, raisons: string[]) {
    super(`${nom} : ${raisons.join(' ; ')}`);
    this.name = 'ScenarioRefuse';
    this.raisons = raisons;
  }
}

/** Gives the scenario back as it is, or refuses it with its reasons; `lieu`: where it is to be played. */
export function charger(s: Scenario, lieu: Lieu = 'exact'): Scenario {
  const raisons: string[] = [];
  const ids = new Map<string, Attendu>();
  for (const a of s.attendus) {
    if (ids.has(a.id)) raisons.push(`deux attendus « ${a.id} »`);
    ids.set(a.id, a);
    if (a.entre && a.entre[0] > a.entre[1]) raisons.push(`« ${a.id} » : bornes inversées`);
    if (!s.mecanismes.includes(a.mecanisme) && !('evenement' in a && a.absent))
      raisons.push(`« ${a.id} » : mécanisme ${a.mecanisme} hors des mécanismes du scénario`);
    if (
      a.niveau === 'tous' &&
      'evenement' in a &&
      MOTS_ENTENDUS.includes(a.evenement) &&
      Object.keys(a.ou?.valeurs ?? {}).some((k) => k === 'texte' || k === 'entendu')
    )
      raisons.push(`« ${a.id} » : tous, compare les mots entendus de la personne`);
  }
  if (lieu === 'chaine') {
    const cibles = new Set(
      s.attendus.flatMap((a) =>
        'evenement' in a && a.depuis && 'attendu' in a.depuis ? [a.depuis.attendu] : [],
      ),
    );
    for (const a of s.attendus)
      if (
        a.niveau === 'tous' &&
        'evenement' in a &&
        LIGNES_SERVEUR.includes(a.evenement) &&
        (a.entre || a.depuis || cibles.has(a.id))
      )
        raisons.push(
          `« ${a.id} » : tous, une ligne du serveur avec bornes ou ancre, sans instant dans la chaîne`,
        );
  }
  const anchor = (a: Attendu | undefined) =>
    a && 'evenement' in a && a.depuis && 'attendu' in a.depuis ? a.depuis.attendu : undefined;
  for (const a of s.attendus) {
    const to = anchor(a);
    const target = to === undefined ? undefined : ids.get(to);
    if (to !== undefined && !target) raisons.push(`« ${a.id} » : ancre vers « ${to} », inconnu`);
    // In the chain an `exact` never fails, so it cannot carry one that must hold; at the exact level both are judged.
    else if (lieu === 'chaine' && target && a.niveau === 'tous' && target.niveau === 'exact')
      raisons.push(`« ${a.id} » : tous, ancré sur « ${to} », exact`);
    // Only an event found has an instant.
    else if (target && (!('evenement' in target) || target.absent))
      raisons.push(`« ${a.id} » : ancre vers « ${to} », qui n'a pas d'instant`);
    // An anchor never leads back to itself: the judge would wait for it forever.
    let at = to;
    for (let n = 0; at !== undefined && n < ids.size; n++) {
      if (at === a.id) {
        raisons.push(`« ${a.id} » : ancres en boucle`);
        break;
      }
      at = anchor(ids.get(at));
    }
  }
  for (const c of s.connus ?? [])
    if (!ids.has(c.attendu)) raisons.push(`connu (${c.issue}) : attendu « ${c.attendu} » absent`);
  const reponses = s.modele?.reponses ?? [];
  /** What an anchor needs that `modele` does not plan. */
  const imprevu = (x: Apres): string | undefined => {
    if (!('joue' in x)) return undefined;
    // shortcut: reply n is taken as the answer to speech n, as said; an anchor after a speech set aside needs better.
    const p = s.personne[x.joue - 1];
    const r = p && reponses[choisir(reponses, p.entendu ?? p.dit)];
    if (!r) return `ancre vers la réponse ${x.joue}, que modele ne prévoit pas`;
    // A sentence she says: a sentence of the model may be two (`morceaux`).
    if ((x.phrase ?? 1) > morceaux(r.phrases).flat().length)
      return `ancre vers la phrase ${x.phrase} de la réponse ${x.joue}, que modele ne prévoit pas`;
    return undefined;
  };
  const places: [string, Parole | Geste][] = [
    ...s.personne.map((p, i): [string, Parole] => [`parole ${i + 1}`, p]),
    ...(s.gestes ?? []).map((g, i): [string, Geste] => [`geste ${i + 1}`, g]),
  ];
  for (const [qui, x] of places) {
    if (x.a === undefined && !x.apres) raisons.push(`${qui} : ni a ni apres`);
    if (x.a !== undefined && x.apres) raisons.push(`${qui} : a et apres à la fois`);
    const pourquoi = x.apres && imprevu(x.apres);
    if (pourquoi) raisons.push(`${qui} : ${pourquoi}`);
  }
  // Only instants written can overlap here: an anchored speech is placed by the game.
  const paroles = s.personne
    .filter((p): p is Parole & { a: number } => p.a !== undefined)
    .sort((x, y) => x.a - y.a);
  for (let i = 1; i < paroles.length; i++)
    if (paroles[i - 1]!.a + paroles[i - 1]!.duree > paroles[i]!.a)
      raisons.push(`paroles à ${paroles[i - 1]!.a} et ${paroles[i]!.a} : elles se chevauchent`);
  if ((s.voix?.syntheseMs ?? 0) >= SYNTH_TIMEOUT_MS)
    raisons.push(
      `syntheseMs ${s.voix!.syntheseMs} : au moins ${SYNTH_TIMEOUT_MS}, la synthèse serait abandonnée`,
    );
  for (let i = 1; i < s.mecanismes.length; i++) {
    const [x, y] = [s.mecanismes[i - 1]!, s.mecanismes[i]!];
    if (RANG[x] > RANG[y] || x === y)
      raisons.push(`mécanismes : ${y} après ${x}, hors de l'ordre de la chaîne`);
  }
  if (raisons.length > 0) throw new ScenarioRefuse(s.nom, raisons);
  return s;
}
