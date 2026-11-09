import { openMicrophone, webOutput } from './audio.ts';
import { stateOf, type BodyState } from './body/body.ts';
import { Conversation } from './conversation.ts';
import type { Brain, LiveEvent, Message, PresenceFlags } from './brain.ts';
import { CoreClient } from './core.ts';
import type { BodyView } from './desktop/corps.svelte.ts';
import type { Bricks, ProgramName, ProgramState } from './desktop/voix.ts';
import { inWindow, pageNet } from './desktop/net.ts';
import { LocalBrain } from './local.ts';
import { Endpointer, ENDPOINT_DEFAULTS, levelToVoice, type EndpointParams } from './listen/endpoint.ts';
import { presenceKeeper, watchPage } from './page.ts';
import { readSettings, type Layout, type Settings } from './settings.ts';
import { Speaker, type SpeakerEvent } from './speech/speaker.ts';
import { appsOnMicrophone, busyWith, synthesize, transcribe } from './voice.ts';

const SETTINGS_KEY = 'luxuria.settings';
const MIC_KEY = 'luxuria.mic';
const MUTE_KEY = 'luxuria.mute';
const TOKEN_KEY = 'luxuria.token';
const LAYOUT_KEY = 'luxuria.layout';
/** Why the arrival is back, kept across one reload of this page. */
const SAID_KEY = 'luxuria.said';
const FORGOTTEN = 'Ce poste n’est plus reconnu par le serveur : entre un nouveau code d’appairage.';
const BEAT_MS = 30_000;
const BUSY_POLL_MS = 3000;
const SUBTITLE_STAYS_MS = 4000;
const TRACE_STAYS_MS = 6000;

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
/** Read once: the next load no longer sees it. */
function takeSaid(): string {
  try {
    const said = sessionStorage.getItem(SAID_KEY) ?? '';
    sessionStorage.removeItem(SAID_KEY);
    return said;
  } catch {
    return '';
  }
}
function store(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // A private window: settings last until the page closes.
  }
}

/** Ties the pure parts to the browser. Nothing is decided here that a test should see. */
export class Session {
  settings = $state<Settings>(readSettings(stored(SETTINGS_KEY)));
  // The small mode only has a meaning in the window: a tab shows the scene, whatever was saved.
  layout = $state<Layout>(inWindow && stored(LAYOUT_KEY) === 'small' ? 'small' : 'scene');
  /** A cut microphone never comes back on by itself: only the button changes this. */
  micOn = $state(stored(MIC_KEY) === 'on');
  /** The desk mute: no capture, nothing said of herself, nothing sent. Never lifted by itself either. */
  silenced = $state(stored(MUTE_KEY) === 'on');
  linked = $state(true);
  capturing = $state(false);
  busy = $state(false);
  /** He took the microphone back from the detection. */
  busyOverride = $state(false);
  hearing = $state(false);
  thinking = $state(false);
  speaking = $state(false);
  /** Her words on screen without a voice: not speaking, but cut, muted and silenced the same way. */
  reading = $state(false);
  capped = $state(false);
  subtitle = $state('');
  trace = $state('');
  failure = $state('');
  level = $state(0);
  latencies = $state<{ ms: number; speculated: boolean }[]>([]);
  thread = $state<Message[]>([]);
  /** Read once at least: before, or unreachable since, an empty thread says nothing of what it holds. */
  threadRead = $state(false);
  entered = $state(false);
  /** In the window: no input for the set delay (`desktop/away.ts`). */
  away = $state(false);
  /** When a phrase was last heard or written: talking without keys is being there too. */
  heardAt = 0;
  /** A phrase of the person left in this session, heard or written: the scene's instruction has done its job. */
  spoke = $state(false);
  /** The thread over the scene; in the window's small mode, it turns the thumbnail into a panel. */
  threadOpen = $state(false);
  /** In the window: what the global keys could not take, said on the settings screen. */
  keysSaid = $state('');
  /** In the window: the body read from its folder, and what that reading says. */
  bodyView = $state<BodyView | null>(null);
  bodySaid = $state('');
  /** In the window: whether the voice service answers, was started, or why not. */
  voiceSaid = $state('');
  /** The voice service: unknown until tested, then up, starting (launched by the window), or down. */
  voiceStatus = $state<'unknown' | 'up' | 'starting' | 'down'>('unknown');
  /** What the service says of whisper-server and RVC, once it answers. */
  bricks = $state<Bricks | null>(null);
  /** The arguments of the voice service the window started; null: not started here, or not known. */
  voiceArgs = $state<string[] | null>(null);
  /** whisper-server and RVC as the window last launched or followed them. */
  programs = $state<Partial<Record<ProgramName, ProgramState>>>({});
  /** The `.exe` the person picked for each, as the window keeps it: shown, never sent back. */
  programPaths = $state<Partial<Record<ProgramName, string>>>({});
  /** The action on the voice service under way, whatever screen started it: one at a time. */
  voiceBusy = $state<'check' | 'restart' | null>(null);
  /** One follow of the programs being launched, at most. */
  following = false;
  /** In the window: why starting with Windows could not be read or changed. */
  startSaid = $state('');
  token = $state<string | null>(stored(TOKEN_KEY));
  /** Why the arrival is shown again, said on it. */
  arrivalSaid = $state(takeSaid());

  /** In the window, the page's paths go where the browser's proxy sent them. */
  #net = pageNet(() => this.settings.server);
  #forgotten = false;
  core = new CoreClient(this.token, this.#net.server, () => this.#forget());
  /** Chosen when entering: a change of brain goes through a reload. */
  brain: Brain = this.core;
  #keyHeld = false;
  /** The key was held during the phrase being heard: let go before its end, it still counts. */
  #keyInPhrase = false;
  #stop = new AbortController();
  #mic: { stop(): void } | null = null;
  #endpointer = new Endpointer();
  #convo: Conversation | null = null;
  #speaker: Speaker | null = null;
  #subtitleTimer: ReturnType<typeof setTimeout> | undefined;
  #traceTimer: ReturnType<typeof setTimeout> | undefined;
  #busySince = 0;

  get state(): BodyState {
    return stateOf({
      linked: this.linked,
      capped: this.capped,
      speaking: this.speaking,
      thinking: this.thinking,
      micOn: this.capturing,
      busy: this.busy && !this.busyOverride,
      silenced: this.silenced,
      hearing: this.hearing,
    });
  }

  saveSettings(next: Settings): void {
    const p0Changed = next.speak.p0 !== this.settings.speak.p0;
    this.settings = next;
    store(SETTINGS_KEY, JSON.stringify(next));
    this.#endpointer.params = this.#params();
    void this.#applyMic();
    // The server must know at once that a P0 will not be said here, or it would drop its notification.
    if (p0Changed && this.entered) void this.#beat();
  }

  async pair(code: string): Promise<void> {
    await this.core.pair(code);
    this.token = this.core.token;
    store(TOKEN_KEY, this.token);
  }

  #params(): EndpointParams {
    const e = this.settings.endOfSpeech;
    return {
      ...ENDPOINT_DEFAULTS,
      pauseMs: e.pauseMs,
      silenceMs: e.silenceMs,
      minSpeechMs: e.minSpeechMs,
      holdMs: this.settings.bargeIn.holdMs,
    };
  }

  /** The two brains share nothing: a clean start. */
  switchBrain(next: Settings['brain']): void {
    this.saveSettings({ ...($state.snapshot(this.settings) as Settings), brain: next });
    if (this.entered) location.reload();
  }

  /** The voice service's fetch: the window reaches it directly, a browser tab through its proxy. */
  get voiceFetch(): typeof fetch {
    return this.#net.voice;
  }

  /** A token never goes to another address: a new server means pairing again. */
  setServer(url: string): void {
    if (url === this.settings.server) return;
    this.saveSettings({ ...($state.snapshot(this.settings) as Settings), server: url });
    this.token = null;
    store(TOKEN_KEY, null);
    this.core = new CoreClient(null, this.#net.server, () => this.#forget());
    if (this.entered) location.reload();
  }

  /** The server no longer knows this device: its token goes, and the arrival comes back asking for a code. */
  #forget(): void {
    if (this.#forgotten) return;
    this.#forgotten = true;
    // Another tab may have paired meanwhile: only this token goes, the reload takes the new one.
    if (stored(TOKEN_KEY) === this.token) store(TOKEN_KEY, null);
    this.token = null;
    try {
      sessionStorage.setItem(SAID_KEY, FORGOTTEN);
    } catch {
      // A private window: the arrival comes back without its reason.
    }
    location.reload();
  }

  /**
   * In a browser tab, a click starts it: a tab plays no sound without one. The window plays it without a click and
   * enters by itself (`desktop/enter.svelte.ts`).
   */
  async enter(): Promise<void> {
    this.entered = true;
    this.brain =
      this.settings.brain === 'linked'
        ? this.core
        : new LocalBrain(() => this.settings, { get: stored, set: store }, this.#net.server);
    const out = webOutput(() => this.settings.voice.volume);
    const convo: Conversation = new Conversation({
      brain: this.brain,
      stt: (audio) => transcribe(audio, this.#net.voice),
      speaker: (this.#speaker = new Speaker(
        (text) => synthesize(text, this.#net.voice),
        out,
        (e: SpeakerEvent) => this.#onSpeaker(e, convo),
      )),
      settings: () => this.settings,
      layout: () => this.layout,
      keyHeld: () => this.#keyHeld || this.#keyInPhrase,
      silenced: () => this.silenced,
      now: () => Date.now(),
      on: (e) => {
        if (e.type === 'thinking') this.thinking = e.on;
        else if (e.type === 'addressed') {
          // Only a phrase the filter let through: noise, a video or someone else in the room do not count.
          this.spoke = true;
          void this.#heard();
        } else if (e.type === 'ignored') this.#showTrace(e.text);
        else if (e.type === 'latency') this.latencies = [e, ...this.latencies].slice(0, 20);
        else if (e.type === 'failed') {
          this.failure = e.text;
          this.capped = /plafond/i.test(e.text);
        }
      },
    });
    this.#convo = convo;
    this.#endpointer.params = this.#params();
    const { signal } = this.#stop;

    void this.brain.live(
      (e) => this.#onLive(e),
      (up) => {
        if (!up) {
          // No end will come for what it was saying.
          this.#speaker?.stop();
          this.thinking = false;
        } else if (!this.linked) void this.#announce();
        this.linked = up;
      },
      signal,
    );
    await this.#announce();
    void this.#refreshThread();

    const beat = setInterval(() => void this.#beat(), BEAT_MS);
    const poll = setInterval(() => void this.#pollBusy(), BUSY_POLL_MS);
    const down = (e: KeyboardEvent) => this.#key(e, true);
    const up = (e: KeyboardEvent) => this.#key(e, false);
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    const unwatch = watchPage(
      () => void this.brain.presence('stopped').catch(() => {}),
      () => void this.#announce(),
      // A beat, never a start: a start while present would say the short welcome at each tab switch.
      () => void this.#beat(),
    );
    signal.addEventListener('abort', () => {
      clearInterval(beat);
      clearInterval(poll);
      removeEventListener('keydown', down);
      removeEventListener('keyup', up);
      unwatch();
    });

    const frame = () => {
      if (signal.aborted) return;
      this.level = this.speaking ? out.level() : 0;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    await this.#applyMic();
  }

  // A refused beat, the page shown again and the stream coming back may fall together: one start.
  #presence = presenceKeeper(
    async () => {
      // Also reached from a beat refused while away: it must not reopen the presence.
      if (this.away) return;
      try {
        await this.brain.presence('started', {
          ...this.#flags(),
          ritual: this.settings.speak.ritual && !this.silenced,
        });
        this.linked = true;
        // Gone while the start was on its way: it closes again.
        if (this.away) void this.brain.presence('stopped').catch(() => {});
      } catch {
        this.linked = false;
      }
    },
    () => this.brain.presence('beat', this.#flags()),
  );

  /** Sent on every start and beat. A P0 the desk will not say goes to the phone. */
  #flags(): PresenceFlags {
    return {
      busy: this.busy,
      ...(this.silenced ? { muted: true } : {}),
      ...(this.settings.speak.p0 ? {} : { silentAnnounce: true }),
    };
  }
  // Away, nothing is announced: a beat would be refused, and its refusal would announce again.
  #announce = () => (this.away ? Promise.resolve() : this.#presence.announce());
  #beat = () => (this.away ? Promise.resolve() : this.#presence.beat());

  /** Only what the server is told changes: listening and the mute stay as they are. */
  async setAway(next: boolean): Promise<void> {
    if (next === this.away) return;
    this.away = next;
    if (!this.entered) return;
    if (next) await this.brain.presence('stopped').catch(() => {});
    else await this.#announce();
  }

  /** A phrase sent, heard or written: the person is there, as with a key. Away, the presence comes back first. */
  #heard(): Promise<void> {
    this.heardAt = Date.now();
    return this.setAway(false);
  }

  #onLive(e: LiveEvent): void {
    this.#convo?.onLive(e);
    if (e.type === 'message') void this.#refreshThread();
  }

  #onSpeaker(e: SpeakerEvent, convo: Conversation): void {
    convo.onSpeaker(e);
    if (e.type === 'subtitle') {
      clearTimeout(this.#subtitleTimer);
      this.subtitle = e.text;
      // Without a voice it is not speaking, and the failure that says why stays.
      this.reading = e.mute === true;
      if (e.mute) return;
      this.speaking = true;
      this.failure = '';
      this.capped = false;
    } else if (e.type === 'silent') {
      this.speaking = false;
      this.reading = false;
      // Cut, its words leave with its voice: nothing on screen keeps talking.
      if (e.cut) this.subtitle = '';
      else this.#subtitleTimer = setTimeout(() => (this.subtitle = ''), SUBTITLE_STAYS_MS);
    }
  }

  #showTrace(text: string): void {
    clearTimeout(this.#traceTimer);
    this.trace = text;
    this.#traceTimer = setTimeout(() => (this.trace = ''), TRACE_STAYS_MS);
  }

  #key(e: KeyboardEvent, held: boolean): void {
    if (e.code === this.settings.key.code) this.holdKey(held);
  }

  /** The held key, from this window or, in the desktop window, from any other. */
  holdKey(held: boolean): void {
    // A release always counts: a key held when the mute came must not stay down after.
    if (!this.settings.key.on || (held && this.silenced)) return;
    this.#keyHeld = held;
  }

  get keyHeld(): boolean {
    return this.#keyHeld;
  }

  async #pollBusy(): Promise<void> {
    if (!this.settings.busy.on) {
      this.busy = false;
      return this.#applyMic();
    }
    const taken = busyWith(
      await appsOnMicrophone(this.#net.voice).catch(() => []),
      this.settings.busy.ignored,
    );
    const now = Date.now();
    if (taken) this.#busySince = now;
    const next = taken || now - this.#busySince < this.settings.busy.returnSeconds * 1000;
    const changed = next !== this.busy;
    this.busy = this.#busySince !== 0 && next;
    if (changed) {
      void this.#beat();
      await this.#applyMic();
    }
  }

  /** The state of the capture follows the facts: cut, nothing runs. */
  async #applyMic(): Promise<void> {
    if (!this.entered) return;
    const should =
      this.micOn &&
      !this.silenced &&
      this.settings.talk[this.layout] !== 'muted' &&
      (!this.busy || this.busyOverride);
    if (should === (this.#mic !== null)) return;
    if (!should) {
      this.#mic?.stop();
      this.#mic = null;
      this.#endpointer.reset();
      this.capturing = this.hearing = false;
      return;
    }
    try {
      const { echoCancellation, noiseSuppression } = this.settings.voice;
      this.#mic = await openMicrophone({ echoCancellation, noiseSuppression }, (f) => this.#onFrame(f));
      this.capturing = true;
    } catch (err) {
      this.failure = `Le micro n’a pas pu s’ouvrir : ${String(err)}`;
    }
  }

  #onFrame(frame: Float32Array): void {
    const { talk, endOfSpeech, key } = this.settings;
    const onlyKey = talk[this.layout] === 'key';
    const voice = onlyKey && (!key.on || !this.#keyHeld) ? 0 : levelToVoice(frame, endOfSpeech.floorDb);
    if (this.#keyHeld) this.#keyInPhrase = true;
    for (const e of this.#endpointer.push(frame, voice, Date.now())) {
      if (e.type === 'start') {
        this.hearing = true;
        this.#keyInPhrase = this.#keyHeld;
      }
      if (e.type === 'end' || e.type === 'noise') this.hearing = false;
      this.#convo?.onEndpoint(e);
    }
  }

  async #refreshThread(): Promise<void> {
    try {
      this.thread = await this.brain.thread();
      this.threadRead = true;
    } catch {
      // Keeps what it had.
    }
  }

  toggleMic(): void {
    this.micOn = !this.micOn;
    store(MIC_KEY, this.micOn ? 'on' : 'off');
    void this.#applyMic();
  }

  /** Muting while she speaks cuts her, as the button would. */
  toggleMute(): void {
    if (this.speaking || this.reading) this.silence();
    this.silenced = !this.silenced;
    if (this.silenced) {
      this.#convo?.mute();
      // Her reply will not be said, so nothing will end the thinking.
      this.thinking = false;
    }
    store(MUTE_KEY, this.silenced ? 'on' : null);
    void this.#applyMic();
    if (this.entered) void this.#beat();
  }

  takeBackMic(): void {
    this.busyOverride = !this.busyOverride;
    void this.#applyMic();
  }

  setLayout(layout: Layout): void {
    this.layout = layout;
    store(LAYOUT_KEY, layout);
    void this.#applyMic();
  }

  silence(): void {
    this.#convo?.silence();
  }

  async write(text: string): Promise<void> {
    if (this.silenced) return;
    this.spoke = true;
    await this.#heard();
    try {
      await this.#convo?.write(text);
      // It went through: an older failure no longer holds.
      this.failure = '';
    } catch (err) {
      this.failure = err instanceof Error ? err.message : String(err);
    }
    await this.#refreshThread();
  }
}
