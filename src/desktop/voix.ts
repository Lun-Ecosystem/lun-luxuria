import { invoke } from '@tauri-apps/api/core';
import type { Session } from '../session.svelte.ts';
import type { Program, VoiceService } from '../settings.ts';
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

type Sleep = (ms: number) => Promise<void>;
const wait: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** What the page says of the service once it answers, or once it gave up. */
function reporter(session: Session, call: Call, bricks: () => Promise<Bricks | null>) {
  return {
    up: async () => {
      session.voiceStatus = 'up';
      session.voiceSaid = 'Le service voix répond.';
      const args = await Promise.resolve(call('voice_running', {})).catch(() => null);
      session.voiceArgs = Array.isArray(args) ? (args as string[]) : null;
      session.bricks = await bricks();
    },
    down: (said: string) => {
      session.voiceStatus = 'down';
      session.voiceSaid = said;
      session.bricks = null;
    },
  };
}

/** Once started: its first answer, the models loading meanwhile. */
async function answer(
  session: Session,
  log: string,
  ping: () => Promise<boolean>,
  sleep: Sleep,
  { up, down }: ReturnType<typeof reporter>,
): Promise<void> {
  session.voiceStatus = 'starting';
  session.voiceSaid = 'Voix en démarrage : les modèles se chargent.';
  for (let waited = 0; waited < READY_WAIT_MS; waited += POLL_MS) {
    await sleep(POLL_MS);
    if (await ping()) return up();
  }
  down(`Le service voix ne répond toujours pas. Journal : ${log}`);
}

/**
 * The voice service with the window: already answering, it is left alone; otherwise, when asked, the window
 * starts it once and waits for its first answer. What happens is said on the settings screen and the scene.
 */
export async function startVoice(
  session: Session,
  ping: () => Promise<boolean>,
  call: Call = invoke,
  sleep: Sleep = wait,
  bricks: () => Promise<Bricks | null> = readBricks(session.voiceFetch),
): Promise<void> {
  const said = reporter(session, call, bricks);
  const { up, down } = said;
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
  return answer(session, log, ping, sleep, said);
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Whether the fields differ from what the running service uses: `restart` when the window started it (it
 * restarts it), `manual` when it was started by hand and says another transcription than the fields.
 */
export function changes(session: Session): 'none' | 'restart' | 'manual' {
  if (session.voiceStatus !== 'up') return 'none';
  const v = session.settings.voice.service;
  if (session.voiceArgs) return same(session.voiceArgs, serviceArgs(v)) ? 'none' : 'restart';
  const kind = session.bricks?.stt.kind;
  return kind && kind !== v.stt.kind ? 'manual' : 'none';
}

/** The service the window started, stopped and started again with the fields; a refusal keeps it running. */
export async function restartVoice(
  session: Session,
  ping: () => Promise<boolean>,
  call: Call = invoke,
  sleep: Sleep = wait,
  bricks: () => Promise<Bricks | null> = readBricks(session.voiceFetch),
): Promise<void> {
  const service = session.settings.voice.service;
  const lack = missing(service);
  if (lack) {
    session.voiceSaid = lack;
    return;
  }
  let log: string;
  try {
    log = (await call('voice_restart', { dir: service.folder, args: serviceArgs(service) })) as string;
  } catch (err) {
    session.voiceSaid = String(err);
    return;
  }
  session.bricks = null;
  return answer(session, log, ping, sleep, reporter(session, call, bricks));
}

export type ProgramName = 'whisper-server' | 'rvc';

/** `host:port` of an address, with the scheme's port when none is written; null when it is not one. */
export function addrOf(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || (u.protocol === 'https:' ? '443' : '80')}`;
  } catch {
    return null;
  }
}

/** The programs in use: whisper-server when it transcribes, RVC when it is on. */
function inUse(v: VoiceService): { name: ProgramName; url: string; program: Program }[] {
  const stt = { name: 'whisper-server' as const, url: v.stt.url, program: v.stt.program };
  const rvc = { name: 'rvc' as const, url: v.rvc.url, program: v.rvc.program };
  return [...(v.stt.kind === 'whisper-server' ? [stt] : []), ...(v.rvc.on ? [rvc] : [])];
}

const OUTCOME: Record<string, string> = {
  started: 'Lancé par l’appli.',
  running: 'Déjà lancé par l’appli.',
  answering: 'Il répond déjà à son adresse : rien n’a été lancé.',
};

/** Launches one program by hand; true when it was started now (its state then needs following). */
export async function launchProgram(
  session: Session,
  name: ProgramName,
  call: Call = invoke,
): Promise<boolean> {
  const p = inUse(session.settings.voice.service).find((x) => x.name === name);
  const addr = p && addrOf(p.url);
  if (!p || !addr || !p.program.path.trim()) {
    session.programs[name] = !p
      ? 'Pas utilisé dans ces réglages.'
      : !addr
        ? 'Son adresse n’est pas valide.'
        : 'Il manque le chemin du programme.';
    return false;
  }
  try {
    const out = String(
      await call('program_start', { name, path: p.program.path, args: p.program.args, addr }),
    );
    session.programs[name] = OUTCOME[out] ?? out;
    return out === 'started';
  } catch (err) {
    session.programs[name] = String(err);
    return false;
  }
}

/** At the window's start: each program in use and asked to launch, before the voice service. */
export async function startPrograms(session: Session, call: Call = invoke): Promise<boolean> {
  const asked = inUse(session.settings.voice.service).filter(
    (p) => p.program.launch && p.program.path.trim(),
  );
  const started = await Promise.all(asked.map((p) => launchProgram(session, p.name, call)));
  return started.some(Boolean);
}

/** After a launch: what the service says of its programs, read again until they answer or the wait ends. */
export async function followBricks(
  session: Session,
  sleep: Sleep = wait,
  bricks: () => Promise<Bricks | null> = readBricks(session.voiceFetch),
): Promise<void> {
  for (let waited = 0; waited < READY_WAIT_MS; waited += POLL_MS) {
    await sleep(POLL_MS);
    if (session.voiceStatus !== 'up') continue;
    session.bricks = await bricks();
    const b = session.bricks;
    if (b && (b.stt.kind === 'faster' || b.stt.up) && (b.rvc?.up ?? true)) return;
  }
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

/** At the window's start: whisper-server and RVC first, then the service, then their state until they answer. */
export async function startAll(
  session: Session,
  call: Call = invoke,
  sleep: Sleep = wait,
  ping: () => Promise<boolean> = pingVoice(session.voiceFetch),
  bricks: () => Promise<Bricks | null> = readBricks(session.voiceFetch),
): Promise<void> {
  const started = await startPrograms(session, call);
  await startVoice(session, ping, call, sleep, bricks);
  if (started) await followBricks(session, sleep, bricks);
}
