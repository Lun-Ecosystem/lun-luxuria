import * as ort from 'onnxruntime-web/wasm';

/** One window of 32 ms at 16 kHz in, the model's own memory in and out. */
export type Infer = (
  input: Float32Array,
  state: Float32Array,
) => Promise<{ voice: number; state: Float32Array }>;

export const FRAME = 512;
const CONTEXT = 64;
const STATE = 2 * 1 * 128;
/** About 2 s of sound between two resets of the model's memory. */
const RESET_EVERY = Math.round(2000 / 32);
/** A reset waits for this many windows in a row clearly without voice: one low window can be a dip inside a word. */
const QUIET_WINDOWS = 5;
const QUIET_BELOW = 0.1;

/**
 * Silero: how likely a window is voice, from 0 to 1. The model reads 64 samples of the window before in front of
 * each one, and keeps a memory from window to window. Sound that is not voice bends that memory (music most of all)
 * and it then under-hears the voice that follows: it is cleared every 2 s of sound, once nobody is talking. The
 * contract and the reset rule are those of the model's own wrapper (snakers4/silero-vad, MIT).
 */
export class SileroVoice {
  #infer: Infer;
  #state = new Float32Array(STATE);
  #context = new Float32Array(CONTEXT);
  #sinceReset = 0;
  #quiet = 0;

  constructor(infer: Infer) {
    this.#infer = infer;
  }

  reset(): void {
    this.#state = new Float32Array(STATE);
    this.#context = new Float32Array(CONTEXT);
    this.#sinceReset = this.#quiet = 0;
  }

  /** `listening`: a sentence is being heard, so the memory is left alone. */
  async voice(frame: Float32Array, listening: boolean): Promise<number> {
    const input = new Float32Array(CONTEXT + FRAME);
    input.set(this.#context);
    input.set(frame, CONTEXT);
    const out = await this.#infer(input, this.#state);
    // A copy: the engine may give its own buffer again.
    this.#state = new Float32Array(out.state);
    this.#context = input.slice(-CONTEXT);
    this.#sinceReset++;
    this.#quiet = out.voice < QUIET_BELOW ? this.#quiet + 1 : 0;
    if (this.#sinceReset >= RESET_EVERY && !listening && this.#quiet >= QUIET_WINDOWS) this.reset();
    return out.voice;
  }
}

/**
 * The model from its bytes. One thread: the page has no shared memory to give it more, and one window costs a few
 * milliseconds. `wasm`: where the page finds the engine's own file; in tests the engine finds it by itself.
 */
export async function loadSilero(model: Uint8Array, wasm?: string): Promise<Infer> {
  ort.env.wasm.numThreads = 1;
  if (wasm) ort.env.wasm.wasmPaths = { wasm };
  const session = await ort.InferenceSession.create(model);
  const sr = new ort.Tensor('int64', BigInt64Array.from([16000n]), []);
  return async (input, state) => {
    const out = await session.run({
      input: new ort.Tensor('float32', input, [1, input.length]),
      state: new ort.Tensor('float32', state, [2, 1, 128]),
      sr,
    });
    return {
      voice: (out['output']!.data as Float32Array)[0]!,
      state: out['stateN']!.data as Float32Array,
    };
  };
}
