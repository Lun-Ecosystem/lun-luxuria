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
}

const SYNTH_TIMEOUT_MS = 5000;

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

  constructor(synth: (text: string) => Promise<Clip>, out: Output, on: (e: SpeakerEvent) => void) {
    this.#synth = synth;
    this.#out = out;
    this.#on = on;
  }

  /** True between two sentences of a turn already heard: the next one is only being made. */
  get speaking(): boolean {
    const turn = this.#turns[0];
    return this.#playing !== null || this.#reading !== null || (!!turn && turn.sounded && !turn.held);
  }

  #turn(id: number): Turn {
    let turn = this.#turns.find((t) => t.id === id);
    if (!turn) {
      turn = { id, held: false, ended: false, pieces: [], next: 0, said: [], sounded: false };
      this.#turns.push(turn);
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

  add(id: number, text: string): void {
    if (this.#gone.has(id)) return;
    // One at a time: a voice conversion takes one call at a time, and order matters more than speed.
    const clip = this.#chain.then(() => this.#oneClip(text));
    this.#chain = clip;
    this.#turn(id).pieces.push({ text, clip });
    this.#pump();
  }

  end(id: number): void {
    if (this.#gone.has(id)) return;
    this.#turn(id).ended = true;
    this.#pump();
  }

  async #oneClip(text: string): Promise<Clip | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.#synth(text),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('synthèse trop longue')), SYNTH_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
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
      const sound = this.#out.play(clip, () => {
        if (this.#playing?.sound !== sound) return;
        turn.said.push(piece.text);
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
   * The speaker cut it off: the sound stops now and what follows is thrown away. Answers what the speaker heard of the
   * current turn, undefined if nothing was under way.
   */
  stop(): { id: number; said: string } | undefined {
    const turn = this.#turns[0];
    const now = this.#playing;
    const reading = this.#reading !== null;
    this.#playing = null;
    clearTimeout(this.#reading ?? undefined);
    this.#reading = null;
    for (const t of this.#turns) this.#gone.add(t.id);
    this.#turns = [];
    this.#on({ type: 'silent', cut: now !== null || reading });
    if (!turn) return undefined;
    const said = [...turn.said];
    if (now) {
      const part = wordsHeard(now.piece.text, now.sound.heard());
      now.sound.stop();
      if (part) said.push(part);
    }
    return { id: turn.id, said: said.join(' ') };
  }

  /** The soft way: the sentence under way ends, the rest does not come. */
  stopAfterSentence(): { id: number; said: string } | undefined {
    const turn = this.#turns[0];
    const now = this.#playing;
    if (!turn || !now) return this.stop();
    for (const t of this.#turns) this.#gone.add(t.id);
    this.#turns = [{ ...turn, pieces: [], next: 0, ended: true }];
    const kept = this.#turns[0]!;
    now.turn = kept;
    return { id: turn.id, said: [...turn.said, now.piece.text].join(' ') };
  }
}
