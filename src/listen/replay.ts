import { Endpointer, type EndpointEvent, type EndpointParams, type Moment } from './endpoint.ts';
import { FRAME } from './vad.ts';

export const FRAME_MS = 32;

/** A WAV of 16-bit samples, one channel kept, as the microphone would give it: 16 kHz, from -1 to 1. */
export function readWav(bytes: Uint8Array): Float32Array {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
  let rate = 0;
  let channels = 0;
  let bits = 0;
  for (let at = 12; at + 8 <= bytes.length;) {
    const size = v.getUint32(at + 4, true);
    if (tag(at) === 'fmt ') {
      channels = v.getUint16(at + 10, true);
      rate = v.getUint32(at + 12, true);
      bits = v.getUint16(at + 22, true);
    } else if (tag(at) === 'data') {
      if (bits !== 16 || channels < 1) throw new Error(`only 16-bit WAV is read (${bits} bits)`);
      const n = Math.floor(Math.min(size, bytes.length - at - 8) / 2 / channels);
      const own = new Float32Array(n);
      for (let i = 0; i < n; i++) own[i] = v.getInt16(at + 8 + i * 2 * channels, true) / 32768;
      return rate === 16000 ? own : resample(own, rate);
    }
    at += 8 + size + (size % 2);
  }
  throw new Error('no sound in this WAV file');
}

/** shortcut: straight lines between samples, no filter; fine to find where a voice is, not to judge a sound. */
function resample(own: Float32Array, rate: number): Float32Array {
  const out = new Float32Array(Math.floor((own.length * 16000) / rate));
  for (let i = 0; i < out.length; i++) {
    const at = (i * rate) / 16000;
    const a = Math.floor(at);
    out[i] = own[a]! + ((own[a + 1] ?? own[a]!) - own[a]!) * (at - a);
  }
  return out;
}

/** The inverse: what the page heard, as a file to keep. */
export function writeWav(frames: Float32Array[]): Uint8Array {
  const n = frames.reduce((sum, f) => sum + f.length, 0);
  const bytes = new Uint8Array(44 + n * 2);
  const v = new DataView(bytes.buffer);
  const put = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  put(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  put(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true);
  v.setUint32(28, 32000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  put(36, 'data');
  v.setUint32(40, n * 2, true);
  let at = 44;
  for (const f of frames)
    for (const s of f) {
      v.setInt16(at, Math.round(Math.max(-1, Math.min(1, s)) * 32767), true);
      at += 2;
    }
  return bytes;
}

export interface Heard {
  /** What the endpointer found, each at its moment in the sound (ms). */
  events: { at: number; type: EndpointEvent['type'] }[];
  /** Where each sentence was heard to begin and to stop (ms): its first and its last voice. */
  sentences: { from: number; to: number }[];
  /** Sounds too short to be a sentence. */
  noises: number;
  /** Times a voice held long enough to cut her off. */
  held: number;
  /** Times a sentence stopped for a breath and went on. */
  resumed: number;
}

/**
 * A recording through the real listening, frame by frame, on a clock that is the frame's place in the sound: the
 * same answer every time, faster than the sound. A silence is added at the end so that the last sentence closes.
 */
export async function replay(
  samples: Float32Array,
  voice: (frame: Float32Array, listening: boolean) => number | Promise<number>,
  params: EndpointParams,
  /** Each moment as it is found, for what listens further down. */
  on?: (e: EndpointEvent & Moment) => void,
  /** The clock of what listens further down: the place in the sound of the frame being heard. */
  time?: (at: number) => void,
): Promise<Heard> {
  const endpointer = new Endpointer(params);
  const heard: Heard = { events: [], sentences: [], noises: 0, held: 0, resumed: 0 };
  const tail = Math.ceil((params.silenceMs + 2 * FRAME_MS) / FRAME_MS);
  const frames = Math.ceil(samples.length / FRAME) + tail;
  let from = 0;
  for (let i = 0; i < frames; i++) {
    const frame = new Float32Array(FRAME);
    frame.set(samples.subarray(i * FRAME, (i + 1) * FRAME));
    const at = i * FRAME_MS;
    time?.(at);
    for (const e of endpointer.push(frame, await voice(frame, endpointer.listening), at)) {
      on?.(e);
      heard.events.push({ at, type: e.type });
      if (e.type === 'start') from = at;
      else if (e.type === 'end') heard.sentences.push({ from, to: e.lastVoiceAt });
      else if (e.type === 'noise') heard.noises++;
      else if (e.type === 'held') heard.held++;
      else if (e.type === 'resume') heard.resumed++;
    }
  }
  return heard;
}
