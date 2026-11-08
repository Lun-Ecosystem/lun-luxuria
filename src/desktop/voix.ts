import { invoke } from '@tauri-apps/api/core';
import type { Session } from '../session.svelte.ts';
import type { VoiceService } from '../settings.ts';
import type { Call } from './corps.svelte.ts';

const READY_WAIT_MS = 180_000; // the models load before the service answers
const POLL_MS = 2000;

/** One argument per line, as typed: a path with spaces stays one argument. */
export const argsOf = (text: string) =>
  text
    .split(/\r?\n/)
    .map((a) => a.trim())
    .filter(Boolean);

/** The service's command line, from its fields; the lines typed by hand come last. */
export function serviceArgs(s: VoiceService): string[] {
  return [
    '--stt',
    s.stt.kind === 'faster' ? `faster:${s.stt.model}` : `whisper-server:${s.stt.url}`,
    ...(s.piper ? ['--tts', `piper:${s.piper}`] : []),
    ...(s.rvc.on ? ['--rvc', s.rvc.url, '--rvc-gain', String(s.rvc.gain)] : []),
    ...s.args,
  ];
}

/** What the service cannot start without, said as such; null when nothing is. */
export function missing(s: VoiceService): string | null {
  if (!s.folder.trim()) return 'Il manque le dossier du service, celui qui contient service.py.';
  if (!s.piper.trim() && !s.args.includes('--tts')) return 'Il manque le fichier de la voix (.onnx).';
  if (s.stt.kind === 'whisper-server' && !s.stt.url.trim()) return 'Il manque l’adresse de whisper-server.';
  if (s.rvc.on && !s.rvc.url.trim()) return 'Il manque l’adresse de RVC.';
  return null;
}

/** What the service says of the programs it calls; `up` false: not answering at their address. */
export interface Bricks {
  stt: { kind: 'faster' | 'whisper-server'; up: boolean };
  rvc: { up: boolean } | null;
}

export function readBricks(f: typeof fetch): () => Promise<Bricks | null> {
  return async () => {
    try {
      const res = await f('/voix/etat', { signal: AbortSignal.timeout(3000) });
      return res.ok ? ((await res.json()) as Bricks) : null;
    } catch {
      return null;
    }
  };
}

/**
 * The voice service with the window: already answering, it is left alone; otherwise, when asked, the window
 * starts it once and waits for its first answer. What happens is said on the settings screen and the scene.
 */
export async function startVoice(
  session: Session,
  ping: () => Promise<boolean>,
  call: Call = invoke,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  bricks: () => Promise<Bricks | null> = readBricks(session.voiceFetch),
): Promise<void> {
  const up = async () => {
    session.voiceStatus = 'up';
    session.voiceSaid = 'Le service voix répond.';
    session.bricks = await bricks();
  };
  const down = (said: string) => {
    session.voiceStatus = 'down';
    session.voiceSaid = said;
    session.bricks = null;
  };
  if (await ping()) return up();
  const service = session.settings.voice.service;
  if (!service.launch)
    return down(
      'Le service voix ne répond pas. Lance-le, ou active « Lancer le service voix avec l’appli ».',
    );
  const lack = missing(service);
  if (lack) return down(`Le service voix ne répond pas. ${lack}`);
  let log: string;
  try {
    log = (await call('voice_start', { dir: service.folder, args: serviceArgs(service) })) as string;
  } catch (err) {
    return down(String(err));
  }
  session.voiceStatus = 'starting';
  session.voiceSaid = 'Voix en démarrage : les modèles se chargent.';
  for (let waited = 0; waited < READY_WAIT_MS; waited += POLL_MS) {
    await sleep(POLL_MS);
    if (await ping()) return up();
  }
  down(`Le service voix ne répond toujours pas. Journal : ${log}`);
}

/** Asks only, never launches: a browser tab, once entered and when asked. */
export async function checkVoice(
  session: Session,
  ping: () => Promise<boolean> = pingVoice(session.voiceFetch),
  bricks: () => Promise<Bricks | null> = readBricks(session.voiceFetch),
): Promise<void> {
  const up = await ping();
  session.voiceStatus = up ? 'up' : 'down';
  session.bricks = up ? await bricks() : null;
}

/** At the window's start, then again when he asks from the settings. */
export function pingVoice(f: typeof fetch): () => Promise<boolean> {
  return async () => {
    try {
      return (await f('/voix/ping', { signal: AbortSignal.timeout(1500) })).ok;
    } catch {
      return false;
    }
  };
}
