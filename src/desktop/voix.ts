import { invoke } from '@tauri-apps/api/core';
import type { Session } from '../session.svelte.ts';
import type { Call } from './corps.svelte.ts';

const READY_WAIT_MS = 180_000; // the models load before the service answers
const POLL_MS = 2000;

/** One argument per line, as typed: a path with spaces stays one argument. */
export const argsOf = (text: string) =>
  text
    .split(/\r?\n/)
    .map((a) => a.trim())
    .filter(Boolean);

/**
 * The voice service with the window: already answering, it is left alone; otherwise, when asked, the window
 * starts it once and waits for its first answer. What happens is said on the settings screen.
 */
export async function startVoice(
  session: Session,
  ping: () => Promise<boolean>,
  call: Call = invoke,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<void> {
  if (await ping()) {
    session.voiceSaid = 'Le service voix répond.';
    return;
  }
  const { launch, folder, args } = session.settings.voice.service;
  if (!launch || !folder) {
    session.voiceSaid = 'Le service voix ne répond pas, et l’appli ne le lance pas.';
    return;
  }
  let log: string;
  try {
    log = (await call('voice_start', { dir: folder, args })) as string;
  } catch (err) {
    session.voiceSaid = String(err);
    return;
  }
  session.voiceSaid = 'Voix en démarrage : les modèles se chargent.';
  for (let waited = 0; waited < READY_WAIT_MS; waited += POLL_MS) {
    await sleep(POLL_MS);
    if (await ping()) {
      session.voiceSaid = 'Le service voix répond.';
      return;
    }
  }
  session.voiceSaid = `Le service voix ne répond toujours pas. Journal : ${log}`;
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
