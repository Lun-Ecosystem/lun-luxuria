import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Apres, AttenduEvenement, Geste } from '../scenario.ts';
import faireTaire from '../scenarios/faire-taire.ts';
import { installerSonde, type Banc, type Plan } from './sonde.ts';

// Web Audio by hand: jsdom has none. Time is the false clock of vitest, read by `performance.now()` of the window.

class Node_ {
  connect(n: unknown) {
    return n;
  }
}
class Source extends Node_ {
  buffer: { duration: number; getChannelData(c: number): Float32Array } | null = null;
  context!: Ctx;
  debut?: number;
  #ecoute: (() => void)[] = [];
  start(t: number) {
    this.debut = t;
  }
  addEventListener(_: 'ended', f: () => void) {
    this.#ecoute.push(f);
  }
  finir() {
    for (const f of this.#ecoute) f();
  }
}
interface Tap {
  bufferSize: number;
  connect(): void;
  onaudioprocess:
    ((e: { playbackTime: number; inputBuffer: { getChannelData(): Float32Array } }) => void) | null;
  disconnect(): void;
}
class Ctx {
  static tous: Ctx[] = [];
  /** A class per test: the probe patches its prototype. */
  static Source = class extends Source {};
  currentTime = 0;
  outputLatency = 0.05;
  destination = {};
  sampleRate: number;
  taps: Tap[] = [];
  sources: Source[] = [];
  constructor(o?: { sampleRate?: number }) {
    this.sampleRate = o?.sampleRate ?? 48000;
    Ctx.tous.push(this);
  }
  createMediaStreamDestination() {
    const clone = (): object => ({ micro: this, clone });
    return { stream: clone(), channelCount: 2 };
  }
  createBufferSource() {
    const s = new Ctx.Source();
    s.context = this;
    this.sources.push(s);
    return s;
  }
  createScriptProcessor(bufferSize: number) {
    const t: Tap = { bufferSize, connect: () => {}, onaudioprocess: null, disconnect: vi.fn() };
    this.taps.push(t);
    return t;
  }
  async resume() {}
  async decodeAudioData() {
    return { duration: 0.5, getChannelData: () => new Float32Array(1) };
  }
}
class Worklet {
  port = new EventTarget();
}

const sseTexte = (blocs: [string, unknown][]) =>
  blocs.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
const sse = (blocs: [string, unknown][]) =>
  new Response(sseTexte(blocs), { headers: { 'content-type': 'text/event-stream' } });
/** What the server answers a sending, a reply 7 of two sentences by default. */
let serveur: () => Response;

let tts: Float32Array;
let win: Window & typeof globalThis;
let banc: Banc;
const page = () => Ctx.tous[1]!;
const micro = () => Ctx.tous[0]!;

/** A plan as `planDePartie` gives it: each speech by its number, of 500 ms, as `decodeAudioData` says. */
function installer(paroles: ({ a: number } | { apres: Apres })[], gestes: Geste[] = []) {
  const plan: Plan = {
    nom: 'essai',
    poses: paroles.map((at, i) => ({ son: i, de: 'parole', numero: i + 1, duree: 500, ...at })),
    gestes,
    reponses: [],
  };
  win = {
    performance: { now: () => Date.now() },
    setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
    navigator: { mediaDevices: {} },
    document,
    AudioContext: Ctx,
    AudioWorkletNode: Worklet,
    AudioBufferSourceNode: Ctx.Source,
    fetch: async (url: string, init?: RequestInit) => {
      if (url.startsWith('/banc/sons/')) return new Response(new ArrayBuffer(4));
      if (init?.body === '{"text":"refus"}') return new Response('', { status: 503 });
      if (url === '/voix/tts')
        return new Response(tts.slice().buffer, { headers: { 'x-sample-rate': '1000' } });
      return serveur();
    },
  } as unknown as Window & typeof globalThis;
  banc = installerSonde(win, plan);
}

/** The page opens its microphone and its frames, as `openMicrophone` does. */
async function ouvrir() {
  await win.navigator.mediaDevices.getUserMedia({ audio: true });
  new Ctx({ sampleRate: 16000 });
  return new win.AudioWorkletNode(page() as unknown as BaseAudioContext, 'frames');
}
const trames = (n: Worklet, combien: number, ecart: number) => {
  for (let i = 0; i < combien; i++) {
    vi.advanceTimersByTime(ecart);
    n.port.dispatchEvent(new Event('message'));
  }
};
const finirJouer = async (n: Worklet) => {
  const t0 = banc.jouer();
  await vi.advanceTimersByTimeAsync(0);
  trames(n, 10, 32);
  return t0;
};

/** What the page does with a reply: send, synthesize, play in a context of its own. */
async function synthetiser(texte: string, samples: Float32Array) {
  tts = samples;
  await win.fetch('/voix/tts', { method: 'POST', body: JSON.stringify({ text: texte }) });
}
async function parler(texte: string, sortie: Ctx, samples = tts, avant?: () => Promise<void>) {
  await synthetiser(texte, samples);
  await avant?.();
  const src = sortie.createBufferSource();
  src.buffer = { duration: samples.length / 1000, getChannelData: () => samples };
  src.connect(sortie.destination);
  src.start(sortie.currentTime);
  return { src, tap: sortie.taps.at(-1)! };
}
const son = (tete: number, n = 300) => {
  const x = new Float32Array(tete + n);
  for (let i = tete; i < tete + n; i++) x[i] = 0.2 + (i % 7) / 100;
  return x;
};
/** The tap reads `x`, which reached it at context time `entree`; its output plays a buffer later. */
const traiter = (tap: Tap, x: Float32Array, entree: number, sr = 1000) =>
  tap.onaudioprocess!({
    playbackTime: entree + tap.bufferSize / sr,
    inputBuffer: { getChannelData: () => x },
  });

beforeEach(() => {
  vi.useFakeTimers({ now: 10_000 });
  Ctx.tous = [];
  Ctx.Source = class extends Source {};
  serveur = () =>
    sse([
      ['user', { id: 6 }],
      ['reply', { id: 7 }],
      ['delta', { text: 'Bonjour. ' }],
      ['delta', { text: 'Il fait beau.' }],
    ]);
});
afterEach(() => vi.useRealTimers());

describe('installerSonde', () => {
  it('gives the page a stream of a 48 kHz context, silent until jouer', async () => {
    installer([{ a: 300 }]);
    const stream = await win.navigator.mediaDevices.getUserMedia({ audio: true });
    expect(micro().sampleRate).toBe(48000);
    expect(stream).toMatchObject({ micro: micro() });
    expect(micro().sources).toHaveLength(0);
    // The page stops the tracks of the stream it closes: each opening gets its own, of the same context.
    const encore = await win.navigator.mediaDevices.getUserMedia({ audio: true });
    expect(encore).not.toBe(stream);
    expect(encore).toMatchObject({ micro: micro() });
    expect(Ctx.tous).toHaveLength(1);
  });

  it('dates a sample at the instant it entered the tap, not when the tap gives it out', async () => {
    installer([]);
    const sortie = new Ctx({ sampleRate: 1000 });
    const x = son(0);
    const { tap } = await parler('Bonjour.', sortie, x);
    sortie.currentTime = 3;
    tap.onaudioprocess!({ playbackTime: 3.256, inputBuffer: { getChannelData: () => x } });
    expect(banc.journal.find((e) => e.name === 'joue')!.at).toBe(Date.now());
  });

  it('counts a reply in progress until its done, its cut or its withdrawal, and says when the last ended', async () => {
    installer([]);
    expect(banc.reponses()).toEqual({ enCours: 0, finie: 0 });
    // Three sendings whose streams stay open: the server is still writing their replies.
    const fermes: (() => void)[] = [];
    let n = 0;
    serveur = () => {
      const [user, reply] = [6 + 2 * n, 7 + 2 * n++];
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(
              new TextEncoder().encode(
                sseTexte([
                  ['user', { id: user }],
                  ['reply', { id: reply }],
                ]),
              ),
            );
            fermes.push(() => c.close());
          },
        }),
      );
    };
    const envoyer = () => win.fetch('/api/threads/main/messages', { method: 'POST', body: '{"text":"x"}' });
    for (let i = 0; i < 3; i++) await envoyer();
    await vi.advanceTimersByTimeAsync(0);
    expect(banc.reponses().enCours).toBe(3);
    // Reply 7 cut, the try of reply 9 (user 8) withdrawn, reply 11 done.
    await win.fetch('/api/threads/main/messages/7/cut', { method: 'POST', body: '{"said":""}' });
    vi.advanceTimersByTime(10);
    await win.fetch('/api/threads/main/messages/8/withdraw', { method: 'POST' });
    expect(banc.reponses().enCours).toBe(1);
    serveur = () => sse([]);
    vi.advanceTimersByTime(10);
    fermes[2]!();
    await vi.advanceTimersByTimeAsync(0);
    expect(banc.reponses()).toEqual({ enCours: 0, finie: Date.now() });
  });

  it("forgets a sending the server refused: it is no anchor's", async () => {
    installer([]);
    await win.fetch('/api/threads/main/messages', { method: 'POST', body: '{"text":"refus"}' });
    await win.fetch('/api/threads/main/messages', { method: 'POST', body: '{"text":"b"}' });
    await vi.advanceTimersByTimeAsync(0);
    expect(banc.journal.filter((e) => e.name === 'envoi_recu')).toMatchObject([{ texte: 'b', reponse: 7 }]);
  });

  it('starts only after ten regular frames of the page, then poses each sound at t0 + a', async () => {
    installer([{ a: 300 }]);
    const n = await ouvrir();
    let t0: number | undefined;
    void banc.jouer().then((t) => (t0 = t));
    await vi.advanceTimersByTimeAsync(0);
    trames(n, 9, 30);
    trames(n, 1, 80); // a stall: the count starts again
    trames(n, 8, 30);
    await vi.advanceTimersByTimeAsync(0);
    expect(t0).toBeUndefined();
    trames(n, 1, 30);
    await vi.advanceTimersByTimeAsync(0);
    expect(t0).toBe(Date.now() + 100);
    expect(micro().sources[0]!.debut).toBeCloseTo(0.4);
    expect(banc.journal.filter((e) => e.name === 'parole')).toMatchObject([
      { at: t0! + 300, parole: 1, etape: 'debut' },
      { at: t0! + 800, parole: 1, etape: 'fin' },
    ]);
  });

  it('poses a speech anchored on the first sentence of reply 1, 1 s after it sounds', async () => {
    installer([{ apres: { joue: 1, ms: 1000 } }]);
    const n = await ouvrir();
    const sortie = new Ctx({ sampleRate: 1000 });
    await finirJouer(n);
    await vi.advanceTimersByTimeAsync(0);
    expect(micro().sources).toHaveLength(0);

    await win.fetch('/api/threads/main/messages', {
      method: 'POST',
      body: JSON.stringify({ text: 'la météo' }),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(banc.journal.find((e) => e.name === 'envoi_recu')).toMatchObject({
      texte: 'la météo',
      reponse: 7,
    });
    const x = son(0);
    const { tap } = await parler('Bonjour.', sortie, x);
    sortie.currentTime = 2;
    traiter(tap, x, 2.05);

    const joue = banc.journal.find((e) => e.name === 'joue')!;
    expect(joue).toMatchObject({ at: Date.now() + 50, reponse: 7, phrase: 1, texte: 'Bonjour.' });
    expect(micro().sources[0]!.debut).toBeCloseTo(1.05);
    expect(banc.journal.find((e) => e.name === 'parole')!.at).toBe(joue.at + 1000);
  });

  it('dates two sources 100 ms apart each on its own tap', async () => {
    installer([]);
    const sortie = new Ctx({ sampleRate: 1000 });
    await win.fetch('/api/threads/main/messages', { method: 'POST', body: '{"text":"x"}' });
    await vi.advanceTimersByTimeAsync(0);
    const [a, b] = [son(0), son(0, 200).map((v) => v + 0.1)];
    const un = await parler('Bonjour.', sortie, a);
    const deux = await parler('Il fait beau.', sortie, b);
    traiter(un.tap, a, 0);
    traiter(deux.tap, b, 0.1);
    expect(banc.journal.filter((e) => e.name === 'joue')).toMatchObject([
      { at: Date.now(), phrase: 1, texte: 'Bonjour.' },
      { at: Date.now() + 100, phrase: 2, texte: 'Il fait beau.' },
    ]);
  });

  it('writes arrete once, at the last sound sample, after the source ends', async () => {
    installer([]);
    const sortie = new Ctx({ sampleRate: 1000 });
    const x = son(0, 100);
    x.fill(0, 80);
    const { src, tap } = await parler('Bonjour.', sortie, x);
    traiter(tap, x, 0);
    src.finir();
    src.finir();
    vi.advanceTimersByTime(200);
    expect(banc.journal.filter((e) => e.name === 'arrete')).toEqual([
      expect.objectContaining({ at: Date.now() - 200 + 79 }),
    ]);
    expect(tap.disconnect).toHaveBeenCalledOnce();
  });

  it('finds the text of a sound behind its leading silence, and says how long it is', async () => {
    installer([]);
    const sortie = new Ctx({ sampleRate: 1000 });
    const x = son(191);
    // The page asks for the next sentence before it plays this one: the last synthesis is not always the one heard.
    const { tap } = await parler('Bonjour.', sortie, x, () =>
      synthetiser(
        'Autre chose.',
        son(0).map((v) => -v),
      ),
    );
    traiter(tap, x, 0);
    expect(banc.journal.find((e) => e.name === 'joue')).toMatchObject({
      at: Date.now() + 191,
      texte: 'Bonjour.',
      tete: 191,
    });
    expect(banc.sortieAnnonceeMs).toBe(50);
  });

  it('clicks « Faire taire » at its instant, and writes each anchor never come at the end', async () => {
    document.body.innerHTML = '<button aria-label="Faire taire"></button>';
    // The page's `silence` is written in the click: the gesture must already be in the log.
    const clic = vi.fn(() => banc.journal.some((e) => e.name === 'geste'));
    document.querySelector('button')!.addEventListener('click', clic);
    installer(
      [{ apres: { envoi: 2, ms: 0 } }],
      [
        { geste: 'silence', a: 500 },
        { geste: 'silence', apres: { envoi: 3, ms: 0 } },
      ],
    );
    const n = await ouvrir();
    const t0 = await (async () => {
      const p = finirJouer(n);
      await vi.advanceTimersByTimeAsync(0);
      return p;
    })();
    await vi.advanceTimersByTimeAsync(t0 + 499 - Date.now());
    expect(clic).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(clic).toHaveBeenCalledOnce();
    expect(clic).toHaveReturnedWith(true);
    const journal = banc.fin();
    expect(journal.filter((e) => e.name === 'geste' || e.name === 'parole_sautee')).toMatchObject([
      { name: 'geste', geste: 'silence', etape: 'fait', at: t0 + 500 },
      { name: 'parole_sautee', son: 0, parole: 1 },
      { name: 'geste', geste: 'silence', etape: 'saute' },
    ]);
    // The line the scenario expects of the button, as the exact player writes it.
    const attendu = faireTaire.attendus.find((a) => a.id === 'geste') as AttenduEvenement;
    const fait = journal.find((e) => e.name === 'geste')!;
    expect(Object.entries(attendu.ou!.valeurs!).every(([k, v]) => fait[k] === v)).toBe(true);
  });

  it('writes the gesture introuvable when the page has no « Faire taire »', async () => {
    document.body.innerHTML = '';
    installer([], [{ geste: 'silence', a: 100 }]);
    const n = await ouvrir();
    const t0 = await (async () => {
      const p = finirJouer(n);
      await vi.advanceTimersByTimeAsync(0);
      return p;
    })();
    await vi.advanceTimersByTimeAsync(t0 + 100 - Date.now());
    expect(banc.journal.find((e) => e.name === 'geste')).toMatchObject({ etape: 'introuvable' });
  });
});
