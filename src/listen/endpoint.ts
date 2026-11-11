export interface EndpointParams {
  /** Above this, voice starts; below `off`, it stops: a level between the two changes nothing. */
  on: number;
  off: number;
  /** Silence that may be only a breath: enough to try an answer. */
  pauseMs: number;
  /** Silence that ends the sentence. */
  silenceMs: number;
  prePadMs: number;
  /** Shorter than this, it was noise. */
  minSpeechMs: number;
  maxSpeechMs: number;
  /** Continuous voice before it may cut it off: a cough does not. */
  holdMs: number;
  frameMs: number;
}

export const ENDPOINT_DEFAULTS: EndpointParams = {
  on: 0.6,
  off: 0.45,
  pauseMs: 160,
  silenceMs: 700,
  prePadMs: 200,
  minSpeechMs: 250,
  maxSpeechMs: 30_000,
  holdMs: 400,
  frameMs: 32,
};

export type EndpointEvent =
  | { type: 'start' }
  /** Voice held for `holdMs`: it may cut it off. */
  | { type: 'held' }
  | { type: 'pause'; audio: Float32Array }
  | { type: 'resume' }
  /** `lastVoiceAt` starts the chronometer of the turn. */
  | { type: 'end'; audio: Float32Array; lastVoiceAt: number }
  | { type: 'noise' };

function joined(frames: Float32Array[]): Float32Array {
  const out = new Float32Array(frames.reduce((n, f) => n + f.length, 0));
  let at = 0;
  for (const f of frames) {
    out.set(f, at);
    at += f.length;
  }
  return out;
}

/** Frames and their voice probability in, the moments of a sentence out. */
export class Endpointer {
  #p: EndpointParams;
  #pad: Float32Array[] = [];
  #frames: Float32Array[] | null = null;
  #voiced = 0;
  #run = 0;
  #silence = 0;
  #paused = false;
  #held = false;
  #lastVoiceAt = 0;

  constructor(params: EndpointParams = ENDPOINT_DEFAULTS) {
    this.#p = params;
  }

  set params(params: EndpointParams) {
    this.#p = params;
  }

  reset(): void {
    this.#pad = [];
    this.#frames = null;
  }

  /** A sentence is being heard, from its first voice to its end. */
  get listening(): boolean {
    return this.#frames !== null;
  }

  push(frame: Float32Array, voice: number, at: number): EndpointEvent[] {
    const p = this.#p;
    if (!this.#frames) {
      if (voice < p.on) {
        this.#pad.push(frame);
        if (this.#pad.length * p.frameMs > p.prePadMs) this.#pad.shift();
        return [];
      }
      this.#frames = [...this.#pad, frame];
      this.#pad = [];
      this.#voiced = this.#run = p.frameMs;
      this.#silence = 0;
      this.#paused = this.#held = false;
      this.#lastVoiceAt = at;
      return [{ type: 'start' }];
    }

    this.#frames.push(frame);
    const out: EndpointEvent[] = [];
    const voiced = this.#paused ? voice >= p.on : voice >= p.off;
    if (voiced) {
      if (this.#paused) out.push({ type: 'resume' });
      this.#paused = false;
      this.#silence = 0;
      this.#voiced += p.frameMs;
      this.#run += p.frameMs;
      this.#lastVoiceAt = at;
      if (!this.#held && this.#run >= p.holdMs) {
        this.#held = true;
        out.push({ type: 'held' });
      }
    } else {
      this.#silence += p.frameMs;
      this.#run = 0;
      if (!this.#paused && this.#silence >= p.pauseMs && this.#voiced >= p.minSpeechMs) {
        this.#paused = true;
        out.push({ type: 'pause', audio: joined(this.#frames) });
      }
    }

    const tooLong = this.#frames.length * p.frameMs >= p.maxSpeechMs;
    if (this.#silence >= p.silenceMs || tooLong) {
      out.push(
        this.#voiced >= p.minSpeechMs
          ? { type: 'end', audio: joined(this.#frames), lastVoiceAt: this.#lastVoiceAt }
          : { type: 'noise' },
      );
      this.#frames = null;
    }
    return out;
  }
}

/** shortcut: voice is read from the level, not by Silero; replace it if tonight's trial shows false starts. */
export function levelToVoice(frame: Float32Array, floorDb: number): number {
  let sum = 0;
  for (const s of frame) sum += s * s;
  const db = 10 * Math.log10(sum / Math.max(frame.length, 1) + 1e-10);
  return Math.min(1, Math.max(0, (db - floorDb) / 20));
}
