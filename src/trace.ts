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
  phrase?: number;
  essai?: number;
  reponse?: number;
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
  add(name: TraceName, ref: TraceRef = {}, values: Record<string, TraceValue> = {}, at = this.#now()): void {
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
