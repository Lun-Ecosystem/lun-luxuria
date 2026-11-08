import { invoke } from '@tauri-apps/api/core';
import type { Session } from '../session.svelte.ts';
import type { Program, VoiceService } from '../settings.ts';
import type { Call } from './corps.svelte.ts';

const READY_WAIT_MS = 180_000; // the models load before the service answers
const POLL_MS = 2000;
const POLLS = READY_WAIT_MS / POLL_MS;

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

const isBricks = (j: unknown): j is Bricks => {
  const b = j as Bricks | null;
  return (
    typeof b?.stt?.up === 'boolean' &&
    (b.stt.kind === 'faster' || b.stt.kind === 'whisper-server') &&
    (b.rvc === null || typeof b.rvc?.up === 'boolean')
  );
};

export function readBricks(f: typeof fetch): () => Promise<Bricks | null> {
  return async () => {
    try {
      const res = await f('/voix/etat', { signal: AbortSignal.timeout(3000) });
      const j: unknown = res.ok ? await res.json() : null;
      return isBricks(j) ? j : null;
    } catch {
      return null;
    }
  };
}

type Sleep = (ms: number) => Promise<void>;
const wait: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The arguments of the service the window started; null: not started here or gone; undefined: not known. */
async function runningArgs(call: Call): Promise<string[] | null | undefined> {
  const args = await Promise.resolve(call('voice_running', {})).catch(() => undefined);
  return Array.isArray(args) ? (args as string[]) : args === null ? null : undefined;
}

/** What the page says of the service once it answers, or once it gave up. */
function reporter(session: Session, call: Call, bricks: () => Promise<Bricks | null>) {
  return {
    up: async () => {
      session.voiceStatus = 'up';
      session.voiceSaid = 'Le service voix répond.';
      session.voiceArgs = (await runningArgs(call)) ?? null;
      session.bricks = await bricks();
    },
    down: async (said: string) => {
      session.voiceStatus = 'down';
      session.voiceSaid = said;
      session.bricks = null;
      // Still the window's, though silent, it can be restarted; gone, it cannot.
      session.voiceArgs = (await runningArgs(call)) ?? null;
    },
  };
}

/** Once started: its first answer, the models loading meanwhile; a service that ends on the way is said at once. */
async function answer(
  session: Session,
  log: string,
  ping: () => Promise<boolean>,
  call: Call,
  sleep: Sleep,
  { up, down }: ReturnType<typeof reporter>,
): Promise<void> {
  session.voiceStatus = 'starting';
  session.voiceSaid = 'Voix en démarrage : les modèles se chargent.';
  for (let poll = 0; poll < POLLS; poll++) {
    await sleep(POLL_MS);
    if (await ping()) return up();
    if ((await runningArgs(call)) === null)
      return down(`Le service voix s’est arrêté au démarrage. Journal : ${log}`);
  }
  await down(`Le service voix ne répond toujours pas. Journal : ${log}`);
}

/** One action on the service at a time, whatever screen asks: a second one is not started. */
async function alone(
  session: Session,
  kind: 'check' | 'restart',
  job: () => Promise<void>,
): Promise<boolean> {
  if (session.voiceBusy) return false;
  session.voiceBusy = kind;
  try {
    await job();
  } finally {
    session.voiceBusy = null;
  }
  return true;
}

/**
 * The voice service with the window: already answering, it is left alone; otherwise, when asked, the window
 * starts it once and waits for its first answer. What happens is said on the settings screen and the scene.
 * False when another action on the service was already under way.
 */
export function startVoice(
  session: Session,
  ping: () => Promise<boolean>,
  call: Call = invoke,
  sleep: Sleep = wait,
  bricks: () => Promise<Bricks | null> = readBricks(session.voiceFetch),
): Promise<boolean> {
  return alone(session, 'check', async () => {
    const said = reporter(session, call, bricks);
    if (await ping()) return said.up();
    const service = session.settings.voice.service;
    if (!service.launch)
      return said.down(
        'Le service voix ne répond pas. Lance-le, ou active « Lancer le service voix avec l’appli ».',
      );
    const lack = missing(service);
    if (lack) return said.down(`Le service voix ne répond pas. ${lack}`);
    let log: string;
    try {
      log = (await call('voice_start', { dir: service.folder, args: serviceArgs(service) })) as string;
    } catch (err) {
      return said.down(String(err));
    }
    return answer(session, log, ping, call, sleep, said);
  });
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const after = (args: string[], flag: string) => {
  const i = args.indexOf(flag);
  return i < 0 ? undefined : args[i + 1];
};

/**
 * What the running service uses, as far as it is known: its arguments when the window started it, else what it
 * says of itself. Nothing when it does not answer.
 */
export function runningWith(session: Session): {
  stt?: 'faster' | 'whisper-server';
  rvc?: boolean;
  piper?: string;
} {
  if (session.voiceStatus !== 'up') return {};
  const args = session.voiceArgs;
  if (args) {
    const stt = after(args, '--stt');
    const tts = after(args, '--tts');
    return {
      stt: stt?.startsWith('whisper-server:') ? 'whisper-server' : 'faster',
      rvc: args.includes('--rvc'),
      ...(tts?.startsWith('piper:') ? { piper: tts.slice('piper:'.length) } : {}),
    };
  }
  const b = session.bricks;
  return b ? { stt: b.stt.kind, rvc: b.rvc !== null } : {};
}

/**
 * Whether the fields differ from what the running service uses: `restart` when the window started it (it
 * restarts it), `manual` when it was started by hand and says another transcription or RVC than the fields.
 */
export function changes(session: Session): 'none' | 'restart' | 'manual' {
  if (session.voiceStatus !== 'up') return 'none';
  const v = session.settings.voice.service;
  if (session.voiceArgs) return same(session.voiceArgs, serviceArgs(v)) ? 'none' : 'restart';
  const run = runningWith(session);
  if (run.stt === undefined) return 'none';
  return run.stt !== v.stt.kind || run.rvc !== v.rvc.on ? 'manual' : 'none';
}

/**
 * The service the window started, stopped and started again with the fields; a refusal keeps it running. False
 * when it was refused, or when another action on the service was under way.
 */
export async function restartVoice(
  session: Session,
  ping: () => Promise<boolean>,
  call: Call = invoke,
  sleep: Sleep = wait,
  bricks: () => Promise<Bricks | null> = readBricks(session.voiceFetch),
): Promise<boolean> {
  let done = false;
  const ran = await alone(session, 'restart', async () => {
    const service = session.settings.voice.service;
    const lack = missing(service);
    if (lack) {
      session.voiceSaid = lack;
      return;
    }
    const said = reporter(session, call, bricks);
    let log: string;
    try {
      log = (await call('voice_restart', { dir: service.folder, args: serviceArgs(service) })) as string;
    } catch (err) {
      session.voiceSaid = String(err);
      // Refused before stopping anything, as a rule; what answers now says the rest.
      if (!(await ping())) await said.down(String(err));
      return;
    }
    session.bricks = null;
    await answer(session, log, ping, call, sleep, said);
    done = session.voiceStatus === 'up';
  });
  return ran && done;
}

export type ProgramName = 'whisper-server' | 'rvc';
export const PROGRAMS: Record<ProgramName, string> = { 'whisper-server': 'whisper-server', rvc: 'RVC' };

/** What the window last said of a program; `starting` while it is followed, `left` polls before giving up. */
export interface ProgramState {
  said: string;
  ok?: boolean;
  starting?: boolean;
  log?: string | undefined;
  left?: number;
}

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

/** The `.exe` the person picked, as the window keeps them. */
export async function readProgramPaths(session: Session, call: Call = invoke): Promise<void> {
  const paths = await Promise.resolve(call('program_paths', {})).catch(() => null);
  session.programPaths = paths && typeof paths === 'object' ? (paths as Session['programPaths']) : {};
}

/** The system's dialog, opened by the window: only the person chooses what it may launch. */
export async function pickProgram(session: Session, name: ProgramName, call: Call = invoke): Promise<void> {
  try {
    const path = await call('program_pick', { name });
    if (typeof path === 'string') session.programPaths[name] = path;
  } catch (err) {
    session.programs[name] = { said: String(err) };
  }
}

export async function forgetProgram(session: Session, name: ProgramName, call: Call = invoke): Promise<void> {
  try {
    await call('program_forget', { name });
    delete session.programPaths[name];
  } catch (err) {
    session.programs[name] = { said: String(err) };
  }
}

const OUTCOME: Record<string, string> = {
  started: 'Lancé par l’appli : il se charge.',
  restarted: 'Relancé avec ses nouveaux réglages : il se charge.',
  running: 'Déjà lancé par l’appli, avec ces arguments.',
  answering: 'Il répond déjà à son adresse : rien n’a été lancé.',
};

/** Launches one program; true when it is ours and on its way (started, restarted or already ours), then followed. */
export async function launchProgram(
  session: Session,
  name: ProgramName,
  call: Call = invoke,
): Promise<boolean> {
  const p = inUse(session.settings.voice.service).find((x) => x.name === name);
  const addr = p && addrOf(p.url);
  if (!p || !addr || !session.programPaths[name]) {
    session.programs[name] = {
      said: !p
        ? 'Pas utilisé dans ces réglages.'
        : !addr
          ? 'Son adresse n’est pas valide.'
          : 'Choisis d’abord son programme.',
    };
    return false;
  }
  try {
    const { outcome, log } = (await call('program_start', { name, args: p.program.args, addr })) as {
      outcome: string;
      log: string;
    };
    // Someone else's answers already; ours, even already running, is followed until it does.
    const now = outcome !== 'answering';
    session.programs[name] = {
      said: OUTCOME[outcome] ?? outcome,
      ok: true,
      ...(now ? { starting: true, log, left: POLLS } : {}),
    };
    return now;
  } catch (err) {
    session.programs[name] = { said: String(err) };
    return false;
  }
}

/** At the window's start: each program in use, picked and asked to launch. */
export async function startPrograms(session: Session, call: Call = invoke): Promise<boolean> {
  const asked = inUse(session.settings.voice.service).filter(
    (p) => p.program.launch && session.programPaths[p.name],
  );
  const started = await Promise.all(asked.map((p) => launchProgram(session, p.name, call)));
  return started.some(Boolean);
}

const NAMES = Object.keys(PROGRAMS) as ProgramName[];
/** Where a program answers, from the fields, in use or not. */
const urlOf = (v: VoiceService, name: ProgramName) => (name === 'rvc' ? v.rvc.url : v.stt.url);

/**
 * Follows the programs being launched until each answers at its address, ends, or the wait runs out, and says it.
 * One follow at a time: a program launched meanwhile joins the one under way.
 */
export async function followPrograms(
  session: Session,
  call: Call = invoke,
  sleep: Sleep = wait,
  bricks: () => Promise<Bricks | null> = readBricks(session.voiceFetch),
): Promise<void> {
  if (session.following) return;
  session.following = true;
  // Every program being launched, in use or not: one switched off meanwhile still says how it ends.
  const waiting = () => NAMES.filter((name) => session.programs[name]?.starting);
  try {
    while (waiting().length) {
      await sleep(POLL_MS);
      // Read after the pause: a program launched again meanwhile is followed from what that launch said.
      for (const name of waiting()) {
        const s = session.programs[name]!;
        const label = PROGRAMS[name];
        const addr = addrOf(urlOf(session.settings.voice.service, name)) ?? '';
        const now = await Promise.resolve(call('program_state', { name, addr })).catch(() => 'starting');
        const left = (s.left ?? 0) - 1;
        if (now === 'answering') session.programs[name] = { said: `${label} répond.`, ok: true, log: s.log };
        else if (now !== 'starting')
          session.programs[name] = { said: `${label} s’est arrêté. Journal : ${s.log}`, log: s.log };
        else if (left <= 0)
          session.programs[name] = {
            said: `${label} ne répond toujours pas. Journal : ${s.log}`,
            log: s.log,
          };
        else s.left = left;
      }
      if (session.voiceStatus === 'up') session.bricks = await bricks();
    }
  } finally {
    session.following = false;
  }
}

/** At the window's start: whisper-server and RVC first, then the service, the programs followed meanwhile. */
export async function startAll(
  session: Session,
  call: Call = invoke,
  sleep: Sleep = wait,
  ping: () => Promise<boolean> = pingVoice(session.voiceFetch),
  bricks: () => Promise<Bricks | null> = readBricks(session.voiceFetch),
): Promise<void> {
  await readProgramPaths(session, call);
  const started = await startPrograms(session, call);
  const follow = started ? followPrograms(session, call, sleep, bricks) : Promise.resolve();
  await startVoice(session, ping, call, sleep, bricks);
  await follow;
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
