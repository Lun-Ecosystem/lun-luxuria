import { openMicrophone, webOutput } from './audio.ts';
import { stateOf, type BodyState } from './body/body.ts';
import { Conversation } from './conversation.ts';
import type { Brain, LiveEvent, Message } from './brain.ts';
import { CoreClient } from './core.ts';
import { LocalBrain } from './local.ts';
import { Endpointer, ENDPOINT_DEFAULTS, levelToVoice, type EndpointParams } from './listen/endpoint.ts';
import { readSettings, type Layout, type Settings } from './settings.ts';
import { Speaker, type SpeakerEvent } from './speech/speaker.ts';
import { appsOnMicrophone, busyWith, synthesize, transcribe } from './voice.ts';

const SETTINGS_KEY = 'luxuria.settings';
const MIC_KEY = 'luxuria.mic';
const TOKEN_KEY = 'luxuria.token';
const LAYOUT_KEY = 'luxuria.layout';
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
  layout = $state<Layout>(stored(LAYOUT_KEY) === 'small' ? 'small' : 'scene');
  /** A cut microphone never comes back on by itself: only the button changes this. */
  micOn = $state(stored(MIC_KEY) === 'on');
  linked = $state(true);
  capturing = $state(false);
  busy = $state(false);
  /** He took the microphone back from the detection. */
  busyOverride = $state(false);
  hearing = $state(false);
  thinking = $state(false);
  speaking = $state(false);
  capped = $state(false);
  subtitle = $state('');
  trace = $state('');
  failure = $state('');
  level = $state(0);
  latencies = $state<{ ms: number; speculated: boolean }[]>([]);
  thread = $state<Message[]>([]);
  entered = $state(false);
  token = $state<string | null>(stored(TOKEN_KEY));

  core = new CoreClient(this.token);
  /** Chosen when entering: a change of brain goes through a reload. */
  brain: Brain = this.core;
  #keyHeld = false;
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
      hearing: this.hearing,
    });
  }

  saveSettings(next: Settings): void {
    this.settings = next;
    store(SETTINGS_KEY, JSON.stringify(next));
    this.#endpointer.params = this.#params();
    void this.#applyMic();
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

  /** A click starts it: a browser plays no sound without one. */
  async enter(): Promise<void> {
    this.entered = true;
    this.brain =
      this.settings.brain === 'linked'
        ? this.core
        : new LocalBrain(() => this.settings, { get: stored, set: store });
    const out = webOutput(() => this.settings.voice.volume);
    const convo: Conversation = new Conversation({
      brain: this.brain,
      stt: transcribe,
      speaker: (this.#speaker = new Speaker(
        (text) => synthesize(text),
        out,
        (e: SpeakerEvent) => this.#onSpeaker(e, convo),
      )),
      settings: () => this.settings,
      layout: () => this.layout,
      keyHeld: () => this.#keyHeld,
      now: () => Date.now(),
      on: (e) => {
        if (e.type === 'thinking') this.thinking = e.on;
        else if (e.type === 'ignored') this.#showTrace(e.text);
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

    const beat = setInterval(
      () => void this.brain.presence('beat', { busy: this.busy }).catch(() => {}),
      BEAT_MS,
    );
    const poll = setInterval(() => void this.#pollBusy(), BUSY_POLL_MS);
    const down = (e: KeyboardEvent) => this.#key(e, true);
    const up = (e: KeyboardEvent) => this.#key(e, false);
    const leave = () => void this.brain.presence('stopped').catch(() => {});
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    addEventListener('pagehide', leave);
    signal.addEventListener('abort', () => {
      clearInterval(beat);
      clearInterval(poll);
      removeEventListener('keydown', down);
      removeEventListener('keyup', up);
      removeEventListener('pagehide', leave);
    });

    const frame = () => {
      if (signal.aborted) return;
      this.level = this.speaking ? out.level() : 0;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    await this.#applyMic();
  }

  async #announce(): Promise<void> {
    try {
      await this.brain.presence('started', { ritual: this.settings.speak.ritual });
      this.linked = true;
    } catch {
      this.linked = false;
    }
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
      this.speaking = true;
      this.failure = '';
      this.capped = false;
    } else if (e.type === 'silent') {
      this.speaking = false;
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
    if (e.code !== this.settings.key.code || !this.settings.key.on) return;
    if (held === this.#keyHeld) return;
    this.#keyHeld = held;
  }

  async #pollBusy(): Promise<void> {
    if (!this.settings.busy.on) {
      this.busy = false;
      return this.#applyMic();
    }
    const taken = busyWith(await appsOnMicrophone().catch(() => []), this.settings.busy.ignored);
    const now = Date.now();
    if (taken) this.#busySince = now;
    const next = taken || now - this.#busySince < this.settings.busy.returnSeconds * 1000;
    const changed = next !== this.busy;
    this.busy = this.#busySince !== 0 && next;
    if (changed) {
      void this.brain.presence('beat', { busy: this.busy }).catch(() => {});
      await this.#applyMic();
    }
  }

  /** The state of the capture follows the facts: cut, nothing runs. */
  async #applyMic(): Promise<void> {
    if (!this.entered) return;
    const should =
      this.micOn && this.settings.talk[this.layout] !== 'muted' && (!this.busy || this.busyOverride);
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
    for (const e of this.#endpointer.push(frame, voice, Date.now())) {
      if (e.type === 'start') this.hearing = true;
      if (e.type === 'end' || e.type === 'noise') this.hearing = false;
      this.#convo?.onEndpoint(e);
    }
  }

  async #refreshThread(): Promise<void> {
    this.thread = await this.brain.thread().catch(() => this.thread);
  }

  toggleMic(): void {
    this.micOn = !this.micOn;
    store(MIC_KEY, this.micOn ? 'on' : 'off');
    void this.#applyMic();
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
    try {
      await this.#convo?.write(text);
    } catch (err) {
      this.failure = String(err);
    }
    await this.#refreshThread();
  }
}
