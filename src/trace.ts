/** The version of the file's format: the scenarios read these names, a change of meaning is a new version. */
export const TRACE_FORMAT = 1;

export type TraceName =
  // The listening: each with the instant of its sound (`son`) and of its decision (`at`).
  | 'voix'
  | 'tenue'
  | 'pause'
  | 'reprise'
  | 'fin'
  | 'bruit'
  // The sentence.
  | 'essai'
  | 'transcrite'
  | 'verdict'
  | 'envoyee'
  | 'numero'
  | 'retiree'
  | 'confirmee'
  | 'sans_reponse'
  // The server.
  | 'phrase_recue'
  | 'fin_recue'
  | 'durees'
  // Her voice.
  | 'synthese'
  | 'son'
  | 'premier_son'
  | 'suspendue'
  | 'reprise_voix'
  | 'coupee'
  | 'arretee'
  | 'silence';

export type TraceValue = number | string | boolean;

/** Where an event belongs: the sentence, its try, the reply. Nothing is found back by the time. */
export interface TraceRef {
  phrase?: number | undefined;
  essai?: number | undefined;
  reponse?: number | undefined;
}

export interface TraceEvent extends TraceRef {
  at: number;
  name: TraceName;
  [value: string]: TraceValue | undefined;
}

const keyOf = (e: TraceRef) =>
  e.phrase !== undefined ? `p${e.phrase}` : e.reponse !== undefined ? `r${e.reponse}` : undefined;

/**
 * What a turn decided, in order, on the page's one clock. It holds what the person said to her: it stays in memory,
 * for the last turns only, and leaves as a file only on a gesture.
 */
export class Trace {
  #now: () => number;
  #max: number;
  #events: TraceEvent[] = [];
  #phrases = 0;
  #tries = new Map<number, number>();
  /** The try each reply answers: her voice knows only the reply. */
  #replies = new Map<number, TraceRef>();
  /** The turns kept, oldest first. */
  #keys: string[] = [];

  constructor(now: () => number, maxTurns = 20) {
    this.#now = now;
    this.#max = maxTurns;
  }

  get events(): readonly TraceEvent[] {
    return this.#events;
  }

  /** A sentence of the person, numbered at its first sound. */
  phrase(): number {
    return ++this.#phrases;
  }

  /** A try of that sentence: its rank, from 1. */
  essai(phrase: number): number {
    const rank = (this.#tries.get(phrase) ?? 0) + 1;
    this.#tries.set(phrase, rank);
    return rank;
  }

  /** `at` is the instant of the decision; by default, now. */
  /** A value left undefined is not written. */
  add(
    name: TraceName,
    ref: TraceRef = {},
    values: Record<string, TraceValue | undefined> = {},
    at = this.#now(),
  ): void {
    const own: TraceRef = { ...ref };
    if (own.reponse !== undefined) {
      if (own.phrase !== undefined) this.#replies.set(own.reponse, { ...own });
      else Object.assign(own, this.#replies.get(own.reponse));
    }
    const e: TraceEvent = { ...values, at, name, ...own };
    this.#events.push(e);
    const key = keyOf(e);
    if (key === undefined || this.#keys.includes(key)) return;
    this.#keys.push(key);
    if (this.#keys.length <= this.#max) return;
    const gone = this.#keys.shift()!;
    // Every turn kept began after the one that goes: what came before its first event goes with it.
    const from = this.#events.findIndex((x) => keyOf(x) === this.#keys[0]);
    this.#events = this.#events.slice(from).filter((x) => keyOf(x) !== gone);
    for (const [id, r] of this.#replies) if (keyOf(r) === gone) this.#replies.delete(id);
  }

  /** One line per event, after one that says the format. */
  lines(): string {
    return [{ format: TRACE_FORMAT }, ...this.#events].map((e) => JSON.stringify(e)).join('\n') + '\n';
  }
}

export type DelayName =
  | 'attente_fin'
  | 'transcription'
  | 'file_serveur'
  | 'premier_mot'
  | 'poste'
  | 'second_mot'
  | 'premiere_phrase'
  | 'blanc_de_tour'
  | 'arret_coupure';

export interface TurnDelays extends TraceRef {
  /** A delay one of whose ends is missing is absent, never deduced. */
  ms: Partial<Record<DelayName, number>>;
  /** The sentence left at a pause: its first sentence back answers a try. */
  aLEssai: boolean;
  /** Her voice's synthesis, sentence by sentence of the reply. */
  synthese: number[];
}

/** What the server measured of a reply (`durees`), under the names of the turn. */
const SERVER: Record<string, DelayName> = {
  queueMs: 'file_serveur',
  firstWordMs: 'premier_mot',
  postMs: 'poste',
  secondWordMs: 'second_mot',
};

/** The delays of each turn of the trace, in the order the turns began. */
export function delays(events: readonly TraceEvent[]): TurnDelays[] {
  const turns = new Map<string, TraceEvent[]>();
  for (const e of events) {
    const key = keyOf(e);
    if (key !== undefined) turns.set(key, [...(turns.get(key) ?? []), e]);
  }
  return [...turns.values()].map((own) => turnDelays(own, events));
}

function turnDelays(own: readonly TraceEvent[], all: readonly TraceEvent[]): TurnDelays {
  const find = (name: TraceName, f: (e: TraceEvent) => boolean = () => true, from = own) =>
    from.find((e) => e.name === name && f(e));
  const phrase = own[0]!.phrase;
  // The try that answers the sentence: made at its end, or confirmed by it.
  const kept = find('essai', (e) => e['final'] === true)?.essai ?? find('confirmee')?.essai;
  const ofKept = (name: TraceName) => (kept === undefined ? undefined : find(name, (e) => e.essai === kept));
  const reponse = phrase === undefined ? own[0]!.reponse : ofKept('numero')?.reponse;
  const ofReply = (name: TraceName, f: (e: TraceEvent) => boolean = () => true) =>
    reponse === undefined ? undefined : find(name, (e) => e.reponse === reponse && f(e));
  const span = (a?: number, b?: number) => (a === undefined || b === undefined ? undefined : b - a);
  const num = (v: TraceValue | undefined) => (typeof v === 'number' ? v : undefined);

  const fin = find('fin');
  const sent = ofKept('envoyee');
  const tenue = find('tenue');
  const ms: Partial<Record<DelayName, number | undefined>> = {
    attente_fin: span(num(fin?.['dernier_son']), fin?.at),
    transcription: span(ofKept('essai')?.at, ofKept('transcrite')?.at),
    premiere_phrase: span(sent?.at, ofReply('phrase_recue')?.at),
    blanc_de_tour: span(num(fin?.['dernier_son']), ofReply('premier_son')?.at),
    // Only a clean cut stops her sound on the voice; the soft way lets the sentence end.
    arret_coupure:
      phrase === undefined
        ? undefined
        : span(tenue?.at, find('son', (e) => e['arrete'] === true && e['par'] === phrase, all)?.at),
  };
  const server = ofReply('durees');
  for (const [field, name] of Object.entries(SERVER)) ms[name] = num(server?.[field]);

  const synthese: number[] = [];
  if (reponse !== undefined)
    for (const start of own.filter(
      (e) => e.name === 'synthese' && e['etape'] === 'debut' && e.reponse === reponse,
    )) {
      const end = find(
        'synthese',
        (e) => e.reponse === reponse && e['etape'] === 'fin' && e['rang'] === start['rang'],
      );
      if (end) synthese.push(end.at - start.at);
    }
  return {
    phrase,
    reponse,
    ms: Object.fromEntries(Object.entries(ms).filter(([, v]) => v !== undefined)),
    aLEssai: sent?.['final'] === false,
    synthese,
  };
}
