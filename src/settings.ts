/** Every perception mechanic has its switch here and none depends on another (spec §6.8). */
export type TalkMode = 'open' | 'key' | 'muted';
export type Layout = 'scene' | 'small';

export interface Settings {
  /** Alone on a model, or linked to a server that thinks for it. */
  brain: 'alone' | 'linked';
  /** Linked, in the window: where the server answers. In a browser tab, the page's proxy decides. */
  server: string;
  /** Its name is also the word that calls it. */
  agent: { name: string; context: string };
  /**
   * `tokensPerDay` at 0: no cap.
   * shortcut: the key sits in browser storage like the rest, the system keychain comes with Tauri.
   */
  model: { url: string; name: string; key: string; tokensPerDay: number };
  talk: Record<Layout, TalkMode>;
  /** Only sentences that pass `decide` leave the PC. */
  filter: Record<Layout, boolean>;
  name: { on: boolean; words: string[]; tolerance: number };
  window: { on: boolean; seconds: number };
  key: { on: boolean; code: string };
  busy: { on: boolean; ignored: string[]; returnSeconds: number };
  traceIgnored: boolean;
  bargeIn: { on: boolean; mode: 'soft' | 'now'; holdMs: number };
  endOfSpeech: {
    silenceMs: number;
    /** Sends at the first pause, and takes it back if the speaker goes on. Off: waits for the end. */
    speculate: boolean;
    pauseMs: number;
    /** Below this level (dB), the microphone hears silence. */
    floorDb: number;
    minSpeechMs: number;
  };
  /** Said aloud or not; the thread keeps them either way. */
  speak: { ritual: boolean; p0: boolean; spontaneous: boolean };
  /** `service`: in the window, the voice service started with it. */
  voice: {
    volume: number;
    echoCancellation: boolean;
    noiseSuppression: boolean;
    service: VoiceService;
  };
  /** `folder`: in the window, the body's folder, whose `corps.json` decides; the addresses serve the browser. */
  body: { level: 'breath' | 'images'; rest: string; talking: string; folder: string };
  /**
   * In the window: the scene's screen, by name (empty, the first that is not the main one), and the global
   * shortcuts between scene and small mode, and for the mute.
   */
  display: { screen: string; shortcut: string; muteShortcut: string; startWithWindows: boolean };
}

/**
 * The voice service by named fields: its transcription (a local model, or a whisper-server at its address), its
 * voice (a Piper file), RVC at its address. `args`: anything else, one per line as typed.
 */
export interface VoiceService {
  launch: boolean;
  folder: string;
  stt: { kind: 'faster' | 'whisper-server'; model: string; url: string; program: Program };
  piper: string;
  rvc: { on: boolean; url: string; gain: number; program: Program };
  args: string[];
}

/**
 * whisper-server or RVC, launched by the window: its arguments one per line. Its `.exe` is never here: the person
 * picks it in the system's dialog, and the window keeps it (`src-tauri/src/programs.rs`).
 */
export interface Program {
  args: string[];
  /** With the app, when nothing answers at its address yet. */
  launch: boolean;
}

export const DEFAULTS: Settings = {
  brain: 'alone',
  server: 'http://127.0.0.1:8788',
  agent: {
    name: 'Agent',
    context: 'Tu parles à voix haute : des phrases courtes, sans liste ni mise en forme.',
  },
  model: { url: 'http://127.0.0.1:11434/v1', name: '', key: '', tokensPerDay: 100_000 },
  talk: { scene: 'open', small: 'open' },
  filter: { scene: false, small: true },
  name: { on: true, words: [], tolerance: 2 },
  window: { on: true, seconds: 15 },
  key: { on: true, code: 'F9' },
  busy: { on: true, ignored: ['obs64.exe'], returnSeconds: 5 },
  traceIgnored: true,
  bargeIn: { on: true, mode: 'now', holdMs: 400 },
  endOfSpeech: { silenceMs: 500, speculate: true, pauseMs: 160, floorDb: -50, minSpeechMs: 250 },
  speak: { ritual: true, p0: true, spontaneous: true },
  voice: {
    volume: 1,
    echoCancellation: true,
    noiseSuppression: true,
    service: {
      launch: false,
      folder: '',
      stt: {
        kind: 'faster',
        model: 'small',
        url: 'http://127.0.0.1:8080',
        program: { args: [], launch: false },
      },
      piper: '',
      rvc: {
        on: false,
        url: 'http://127.0.0.1:18888',
        gain: 2,
        program: { args: [], launch: false },
      },
      args: [],
    },
  },
  body: { level: 'breath', rest: '', talking: '', folder: '' },
  display: {
    screen: '',
    shortcut: 'Control+Shift+L',
    muteShortcut: 'Control+Shift+M',
    startWithWindows: false,
  },
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** What was saved wins, key by key: a setting added later takes its default, a bad type is ignored. */
function merged<T>(base: T, saved: unknown): T {
  // A group saved as anything else (null included) comes back whole from the defaults.
  if (isObject(base)) {
    const from = isObject(saved) ? saved : {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(base)) out[k] = merged(v, from[k]);
    return out as T;
  }
  if (Array.isArray(base)) return (Array.isArray(saved) ? saved : base) as T;
  return (typeof saved === typeof base ? saved : base) as T;
}

/** Before 11/2026, the service took argument lines: the known ones become fields, the rest stays as typed. */
function fromArgs(saved: Record<string, unknown>): Record<string, unknown> {
  // A flag and its value on one line, with a space or an equals sign, read as two.
  const args = (saved.args as unknown[]).map(String).flatMap((a) => {
    const m = /^(--[\w-]+)[= ](.+)$/.exec(a.trim());
    return m ? [m[1]!, m[2]!.trim()] : [a];
  });
  const service = structuredClone(DEFAULTS.voice.service);
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const [flag, value] = [args[i]!, args[i + 1] ?? ''];
    if (flag === '--stt' && value.startsWith('faster:')) service.stt.model = value.slice(7) || 'small';
    else if (flag === '--stt' && value.startsWith('whisper-server:'))
      service.stt = { ...service.stt, kind: 'whisper-server', url: value.slice(15) };
    else if (flag === '--tts' && value.startsWith('piper:')) service.piper = value.slice(6);
    else if (flag === '--rvc' && value !== '' && !value.startsWith('--'))
      service.rvc = { ...service.rvc, on: true, url: value };
    else if (flag === '--rvc-gain' && Number.isFinite(Number(value))) service.rvc.gain = Number(value);
    else {
      rest.push(flag);
      continue;
    }
    i++;
  }
  return { ...service, launch: saved.launch, folder: saved.folder, args: rest };
}

export function readSettings(raw: string | null): Settings {
  try {
    const saved: unknown = raw ? JSON.parse(raw) : {};
    const service = isObject(saved) && isObject(saved.voice) ? saved.voice.service : undefined;
    if (isObject(service) && Array.isArray(service.args) && !('stt' in service))
      (saved as { voice: Record<string, unknown> }).voice.service = fromArgs(service);
    const settings = merged(DEFAULTS, saved);
    // Only the type is checked by the merge: an unknown transcription comes back to the local one.
    const stt = settings.voice.service.stt;
    if (stt.kind !== 'faster' && stt.kind !== 'whisper-server') stt.kind = 'faster';
    return settings;
  } catch {
    return structuredClone(DEFAULTS);
  }
}
