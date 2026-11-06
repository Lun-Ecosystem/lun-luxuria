import type { Clip, Output, Playing } from './speech/speaker.ts';

/** The browser's sound; nothing here can be tested without a sound card, so nothing decides here. */
export function webOutput(volume: () => number): Output & { level(): number } {
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  const gain = ctx.createGain();
  analyser.connect(gain).connect(ctx.destination);
  const data = new Uint8Array(analyser.fftSize);

  return {
    play(clip: Clip, onEnd: () => void): Playing {
      void ctx.resume();
      gain.gain.value = volume();
      const buffer = ctx.createBuffer(1, Math.max(clip.samples.length, 1), clip.rate);
      buffer.copyToChannel(clip.samples as Float32Array<ArrayBuffer>, 0);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(analyser);
      const started = ctx.currentTime;
      let stopped = false;
      source.onended = () => {
        if (!stopped) onEnd();
      };
      source.start();
      return {
        stop() {
          stopped = true;
          source.stop();
        },
        heard: () => (ctx.currentTime - started) / buffer.duration,
      };
    },
    /** The level of the sound really playing: what the mouth follows. */
    level() {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += ((v - 128) / 128) ** 2;
      return Math.sqrt(sum / data.length);
    },
  };
}

const WORKLET = `
class Frames extends AudioWorkletProcessor {
  constructor() { super(); this.b = new Float32Array(512); this.n = 0; }
  process(inputs) {
    const ch = inputs[0][0];
    if (ch) for (const s of ch) {
      this.b[this.n++] = s;
      if (this.n === 512) { this.port.postMessage(this.b.slice()); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('frames', Frames);
`;

/** Frames of 32 ms at 16 kHz. Until `stop`, nothing else holds the microphone open. */
export async function openMicrophone(
  opts: { echoCancellation: boolean; noiseSuppression: boolean },
  onFrame: (frame: Float32Array) => void,
): Promise<{ stop(): void }> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, autoGainControl: false, ...opts },
  });
  const ctx = new AudioContext({ sampleRate: 16000 });
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  const node = new AudioWorkletNode(ctx, 'frames');
  node.port.onmessage = (e: MessageEvent<Float32Array>) => onFrame(e.data);
  ctx.createMediaStreamSource(stream).connect(node);
  return {
    stop() {
      for (const t of stream.getTracks()) t.stop();
      void ctx.close();
    },
  };
}
