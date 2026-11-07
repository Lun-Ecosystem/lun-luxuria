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
  /** `service`: in the window, the voice service started with it (`args`, one per line as typed). */
  voice: {
    volume: number;
    echoCancellation: boolean;
    noiseSuppression: boolean;
    service: { launch: boolean; folder: string; args: string[] };
  };
  /** `folder`: in the window, the body's folder, whose `corps.json` decides; the addresses serve the browser. */
  body: { level: 'breath' | 'images'; rest: string; talking: string; folder: string };
  /**
   * In the window: the scene's screen, by name (empty, the first that is not the main one), and the global
   * shortcuts between scene and small mode, and for the mute.
   */
  display: { screen: string; shortcut: string; muteShortcut: string; startWithWindows: boolean };
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
    service: { launch: false, folder: '', args: [] },
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
  if (isObject(base) && isObject(saved)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(base)) out[k] = merged(v, saved[k]);
    return out as T;
  }
  if (Array.isArray(base)) return (Array.isArray(saved) ? saved : base) as T;
  return (typeof saved === typeof base ? saved : base) as T;
}

export function readSettings(raw: string | null): Settings {
  try {
    return merged(DEFAULTS, raw ? JSON.parse(raw) : {});
  } catch {
    return structuredClone(DEFAULTS);
  }
}
