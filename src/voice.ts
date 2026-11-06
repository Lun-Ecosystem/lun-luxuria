import type { Heard } from './conversation.ts';
import type { Clip } from './speech/speaker.ts';

/** The local service of `voix/service.py`, proxied by Vite under `/voix`. */
export async function transcribe(audio: Float32Array, f: typeof fetch = fetch): Promise<Heard> {
  const res = await f('/voix/stt', { method: 'POST', body: audio.slice().buffer });
  if (!res.ok) throw new Error(`transcription refusée (${res.status})`);
  const { text, confidence } = (await res.json()) as Heard;
  return { text, confidence };
}

export async function synthesize(text: string, f: typeof fetch = fetch): Promise<Clip> {
  const res = await f('/voix/tts', { method: 'POST', body: JSON.stringify({ text }) });
  if (!res.ok) throw new Error(`synthèse refusée (${res.status})`);
  return {
    samples: new Float32Array(await res.arrayBuffer()),
    rate: Number(res.headers.get('x-sample-rate') ?? 22050),
  };
}

export async function appsOnMicrophone(f: typeof fetch = fetch): Promise<string[]> {
  const res = await f('/voix/micro');
  if (!res.ok) return [];
  return ((await res.json()) as { apps: string[] }).apps;
}

/** Whether another app holds the microphone, ignoring those that do not mean a conversation. */
export function busyWith(apps: string[], ignored: string[]): boolean {
  const skip = ignored.map((a) => a.toLowerCase());
  // A browser holds it for this very page; shortcut: another tab in the same browser goes unseen, until the Tauri build.
  return apps.some((a) => !/chrome|msedge|firefox|luxuria/i.test(a) && !skip.includes(a.toLowerCase()));
}
