import type { Trace } from '../trace.ts';

export interface Clip {
  samples: Float32Array;
  rate: number;
}

export interface Playing {
  stop(): void;
  /** How much was heard, from 0 to 1. */
  heard(): number;
}

export interface Output {
  play(clip: Clip, onEnd: () => void): Playing;
}

export type SpeakerEvent =
  | { type: 'first-sound'; id: number }
  | { type: 'subtitle'; id: number; text: string; mute?: true }
  | { type: 'silent'; cut?: boolean }
  | { type: 'failed'; text: string };

interface Piece {
  text: string;
  clip: Promise<Clip | null>;
}

interface Turn {
  id: number;
  held: boolean;
  ended: boolean;
  pieces: Piece[];
  next: number;
  said: string[];
  sounded: boolean;
  /** Suspended by a sound that may be nothing: what was heard of the sentence it stopped in. */
  suspended?: { part: string };
  urgent?: true;
}

/** A synthesis longer than this is given up: the sentence is shown without a voice. */
export const SYNTH_TIMEOUT_MS = 5000;

/** How long words without a voice stay on screen before the next sentence: enough to read them. */
export const readingMs = (text: string) => Math.max(1500, 60 * text.length);

/** The words heard of a sentence cut in the middle: the sound carries no words, only a ratio. */
export function wordsHeard(text: string, ratio: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  return words.slice(0, Math.floor(words.length * Math.min(1, Math.max(0, ratio)))).join(' ');
}

/**
 * What it says, one sentence after the other, turn after turn. The next sentence is synthesized while
 * the previous plays; a turn may be held, ready but silent, until the speaker's sentence really ends.
 */
export class Speaker {
  #turns: Turn[] = [];
  /** Words of these turns may still be on their way: they stay unheard. */
  #gone = new Set<number>();
  #playing: { turn: Turn; piece: Piece; sound: Playing } | null = null;
  #waiting = false;
  /** Words shown without a voice, for the time to read them. */
  #reading: ReturnType<typeof setTimeout> | null = null;
  #chain: Promise<unknown> = Promise.resolve();
  #synth: (text: string) => Promise<Clip>;
  #out: Output;
  #on: (e: SpeakerEvent) => void;

  #trace: Trace | undefined;

  /** `trace`: where each of its decisions is written; without it, nothing else changes. */
  constructor(
    synth: (text: string) => Promise<Clip>,
    out: Output,
    on: (e: SpeakerEvent) => void,
    trace?: Trace,
  ) {
    this.#synth = synth;
    this.#out = out;
    this.#trace = trace;
    this.#on = (e) => {
      if (e.type === 'silent') trace?.add('silence', {}, { coupee: e.cut });
      on(e);
    };
  }

  /** True between two sentences of a turn already heard: the next one is only being made. */
  get speaking(): boolean {
    const turn = this.#turns[0];
    return this.#playing !== null || this.#reading !== null || (!!turn && turn.sounded && !turn.held);
  }

  #turn(id: number, urgent = false): Turn {
    let turn = this.#turns.find((t) => t.id === id);
    if (!turn) {
      turn = { id, held: false, ended: false, pieces: [], next: 0, said: [], sounded: false };
      if (urgent) {
        // In front of what waits, behind the urgencies already there; the sentence that sounds ends first.
        turn.urgent = true;
        const at = this.#turns.findIndex((t) => !t.urgent);
        this.#turns.splice(at < 0 ? this.#turns.length : at, 0, turn);
      } else this.#turns.push(turn);
    }
    return turn;
  }

  /** Must come before its first sentence. */
  hold(id: number): void {
    if (this.#gone.has(id)) return;
    this.#turn(id).held = true;
  }

  release(id: number): void {
    if (this.#gone.has(id)) return;
    this.#turn(id).held = false;
    this.#pump();
  }

  /** `urgent`: this turn goes in front of the ones that wait. */
  add(id: number, text: string, urgent = false): void {
    if (this.#gone.has(id)) return;
    // One at a time: a voice conversion takes one call at a time, and order matters more than speed.
    // shortcut: an urgency waits for the sentences already being made, give it its own lane if that is heard.
    const turn = this.#turn(id, urgent);
    const rang = turn.pieces.length + 1;
    const clip = this.#chain.then(() => this.#oneClip(text, id, rang));
    this.#chain = clip;
    turn.pieces.push({ text, clip });
    this.#pump();
  }

  end(id: number): void {
    if (this.#gone.has(id)) return;
    this.#turn(id).ended = true;
    this.#pump();
  }

  async #oneClip(text: string, id: number, rang: number): Promise<Clip | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const write = (etape: string) => this.#trace?.add('synthese', { reponse: id }, { etape, rang });
    write('debut');
    try {
      const clip = await Promise.race([
        this.#synth(text),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('synthèse trop longue')), SYNTH_TIMEOUT_MS);
        }),
      ]);
      write('fin');
      return clip;
    } catch (err) {
      write('echec');
      this.#on({
        type: 'failed',
        text: `Sa voix n’a pas pu dire une phrase : ${err instanceof Error ? err.message : String(err)}`,
      });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  #pump(): void {
    if (this.#playing || this.#waiting || this.#reading) return;
    const turn = this.#turns[0];
    if (!turn) return;
    if (turn.held) return;
    const piece = turn.pieces[turn.next];
    if (!piece) {
      if (!turn.ended) return;
      this.#turns.shift();
      if (this.#turns.length === 0) this.#on({ type: 'silent' });
      this.#pump();
      return;
    }
    this.#waiting = true;
    void piece.clip.then((clip) => {
      this.#waiting = false;
      // Stopped, or held, while it was being made.
      if (this.#turns[0] !== turn || turn.pieces[turn.next] !== piece || turn.held) return this.#pump();
      turn.next++;
      if (!clip) {
        // Its voice failed, its words are still paid for: said on screen, and nobody heard them.
        this.#on({ type: 'subtitle', id: turn.id, text: piece.text, mute: true });
        this.#reading = setTimeout(() => {
          this.#reading = null;
          this.#pump();
        }, readingMs(piece.text));
        return;
      }
      if (!turn.sounded) {
        turn.sounded = true;
        this.#on({ type: 'first-sound', id: turn.id });
      }
      this.#on({ type: 'subtitle', id: turn.id, text: piece.text });
      // `rang`: the sentence of the reply, from 1; a sentence said again after a suspension keeps its rank.
      this.#trace?.add('son', { reponse: turn.id }, { etape: 'debut', rang: turn.next });
      const sound = this.#out.play(clip, () => {
        if (this.#playing?.sound !== sound) return;
        this.#trace?.add('son', { reponse: this.#playing.turn.id }, { etape: 'fin' });
        // An urgency may have come in front meanwhile: the words go to the turn that said them.
        this.#playing.turn.said.push(piece.text);
        this.#playing = null;
        this.#pump();
      });
      this.#playing = { turn, piece, sound };
    });
  }

  /** Drops a turn nobody heard: the speaker went on talking. */
  drop(id: number): void {
    this.#gone.add(id);
    const i = this.#turns.findIndex((t) => t.id === id);
    if (i < 0) return;
    this.#turns.splice(i, 1);
    if (i === 0 && this.#reading !== null) {
      clearTimeout(this.#reading);
      this.#reading = null;
    }
    this.#pump();
  }

  /**
   * A sound came over her voice, and nobody knows yet what it is: the turn that sounds falls silent and waits, at the
   * sentence it was in. The soft way lets that sentence end first. `resume` or `cutSuspended` tells what it was.
   */
  suspend(soft = false, by?: number): void {
    const now = this.#playing;
    const turn = now?.turn ?? this.#turns[0];
    if (!turn || turn.suspended) return;
    turn.held = true;
    turn.suspended = { part: '' };
    this.#trace?.add('suspendue', { reponse: turn.id }, { par: by, doux: soft });
    if (!now || soft) return;
    turn.suspended.part = wordsHeard(now.piece.text, now.sound.heard());
    this.#playing = null;
    now.sound.stop();
    this.#trace?.add('son', { reponse: turn.id }, { etape: 'fin', arrete: true, par: by });
    // The sentence it was in is said again from its start.
    turn.next--;
    // An urgency that waited behind this sentence does not wait for the verdict.
    this.#pump();
  }

  /** It was nothing: the suspended turn goes on. */
  resume(): void {
    const turn = this.#turns.find((t) => t.suspended);
    if (!turn) return;
    delete turn.suspended;
    turn.held = false;
    this.#trace?.add('reprise_voix', { reponse: turn.id });
    this.#pump();
  }

  /**
   * It was for her: what was suspended is cut for good, and what waited behind goes with it, but for an urgency and
   * for the turn `keep`, the answer to what was just said. Answers what was heard of each before its suspension.
   */
  cutSuspended(keep?: number): { id: number; said: string }[] {
    const cut = this.#turns.filter((t) => t.suspended);
    if (cut.length === 0) return [];
    const last = this.#playing?.turn;
    const stays = (t: Turn) => t.id === keep || (t.urgent && !t.suspended) || t === last;
    for (const t of this.#turns) if (!stays(t)) this.#gone.add(t.id);
    this.#turns = this.#turns.filter(stays);
    // The soft way: its sentence may still be sounding, and is the last.
    if (last?.suspended) {
      const kept: Turn = { ...last, pieces: [], next: 0, ended: true, held: false };
      delete kept.suspended;
      this.#turns[this.#turns.indexOf(last)] = kept;
      this.#playing!.turn = kept;
      this.#gone.add(last.id);
    } else this.#on({ type: 'silent', cut: true });
    this.#pump();
    const said = cut.map((t) => ({
      id: t.id,
      said: [...t.said, t === last ? this.#playing!.piece.text : t.suspended!.part].filter(Boolean).join(' '),
    }));
    for (const c of said) this.#trace?.add('coupee', { reponse: c.id }, { entendu: c.said });
    return said;
  }

  /**
   * The speaker cut it off: the sound stops now and what follows is thrown away. Answers what the speaker heard of the
   * current turn, undefined if nothing was under way.
   */
  stop(): { id: number; said: string } | undefined {
    const now = this.#playing;
    const turn = now?.turn ?? this.#turns.find((t) => t.suspended) ?? this.#turns[0];
    const reading = this.#reading !== null;
    this.#playing = null;
    clearTimeout(this.#reading ?? undefined);
    this.#reading = null;
    for (const t of this.#turns) this.#gone.add(t.id);
    this.#turns = [];
    this.#on({ type: 'silent', cut: now !== null || reading || !!turn?.suspended });
    if (!turn) return undefined;
    const said = [...turn.said];
    if (turn.suspended?.part) said.push(turn.suspended.part);
    if (now) {
      const part = wordsHeard(now.piece.text, now.sound.heard());
      now.sound.stop();
      this.#trace?.add('son', { reponse: now.turn.id }, { etape: 'fin', arrete: true });
      if (part) said.push(part);
    }
    this.#trace?.add('arretee', { reponse: turn.id }, { entendu: said.join(' ') });
    return { id: turn.id, said: said.join(' ') };
  }
}
