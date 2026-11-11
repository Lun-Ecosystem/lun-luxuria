import { frames } from '../../brain.ts';
import type { BancNom } from '../scenario.ts';
import type { TraceValue } from '../../trace.ts';

/**
 * The probe, posed before the page (`addInitScript`): the page's microphone is a stream it makes, and it dates what
 * sounds of her voice. Nothing of the page changes. Every instant is `performance.now()` of the page; a Web Audio
 * instant is brought to it by a pair (`currentTime`, `performance.now()`) read in the same callback, without the output
 * latency `getOutputTimestamp` announces (plan 2026-11-11-chaine-laptop, « Les deux horloges »).
 */

// shortcut: declared here until task 1 lands `Parole.apres` and `ancre` in scenario.ts; reconcile at the merge.
export type Apres = { joue: number; phrase?: number; ms: number } | { envoi: number; ms: number };
export type Ancrer = (apres: Apres, journal: readonly EvenementSonde[]) => number | undefined;

// shortcut: declared here until task 3 lands `planDePartie` in sons.ts; reconcile at the merge.
export type Pose = { son: string; a: number } | { son: string; apres: Apres };
export interface PlanDePartie {
  paroles: Pose[];
  bruits?: Pose[];
  gestes?: ({ geste: 'silence'; a: number } | { geste: 'silence'; apres: Apres })[];
}

/** The probe's own lines, beyond the player's: task 1 adds `geste` and `parole_sautee` to `BancNom`. */
export type NomSonde = BancNom | 'geste' | 'parole_sautee';
/** A `BancEvent` with the probe's names; the same type once task 1 is merged. */
export interface EvenementSonde {
  de: 'banc';
  at: number;
  name: NomSonde;
  reponse?: number;
  [value: string]: TraceValue | undefined;
}

export interface Banc {
  journal: EvenementSonde[];
  /** The instant the probe's context starts to sound, once `jouer` has started it. */
  t0?: number;
  /** The output latency the page's voice context announces, in ms, read once. */
  sortieAnnonceeMs?: number;
  /** Waits for regular frames of the page, then starts the sounds; gives `t0`. */
  jouer(): Promise<number>;
  /** The game is over: each anchor never come writes `parole_sautee`. Gives the journal. */
  fin(): EvenementSonde[];
}

/** Below it, a sample is silence: the threshold task 0 measured Piper with. */
const SILENCE = 1e-3;
/** Ten frames in a row, each under 45 ms after the one before: the page no longer stalls (task 0, point 3). */
const TRAMES = 10;
const ECART_MS = 45;
/** The probe's sounds start this long after `jouer` decides: time to post them all before the first. */
const MARGE_S = 0.1;
/** After `ended`, the tap may still hold the last samples: it waits this long before writing `arrete`. */
const QUEUE_MS = 100;
/** The samples that find a sound's text, after its leading silence. */
const CLE = 64;

const premierSon = (x: Float32Array) => {
  let i = 0;
  while (i < x.length && Math.abs(x[i]!) <= SILENCE) i++;
  return i;
};
const memeCle = (a: Float32Array, b: Float32Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const cleDe = (x: Float32Array) => {
  const i = premierSon(x);
  return x.slice(i, i + CLE);
};
const reduit = (t: string) => t.replace(/\s+/g, ' ').trim();

/** What the page asked of `/voix/tts`: the text and what it gave. */
interface Synthese {
  texte: string;
  cle: Float32Array;
  teteMs: number;
  reponse?: number;
}

/** A reply as the page read it in the stream of its sending: its number and the text so far. */
interface Envoi {
  evenement: EvenementSonde;
  texte: string;
  phrases: string[];
}

export function installerSonde(win: Window & typeof globalThis, plan: PlanDePartie, ancre: Ancrer): Banc {
  const now = () => win.performance.now();
  const journal: EvenementSonde[] = [];
  let micCtx: AudioContext | undefined;
  let dest: MediaStreamAudioDestinationNode | undefined;
  const syntheses: Synthese[] = [];
  const envois: Envoi[] = [];
  const enAttente: { apres: Apres; poser: (at: number) => void; sautee: Record<string, TraceValue> }[] = [];
  let joue = false;

  const log = (name: NomSonde, valeurs: Record<string, TraceValue | undefined> = {}, at = now()) => {
    const e: EvenementSonde = { de: 'banc', at, name };
    for (const [k, v] of Object.entries(valeurs)) if (v !== undefined) e[k] = v;
    journal.push(e);
    if (joue) resoudre();
    return e;
  };
  const resoudre = () => {
    for (let i = 0; i < enAttente.length; i++) {
      const at = ancre(enAttente[i]!.apres, journal);
      if (at === undefined) continue;
      const [p] = enAttente.splice(i--, 1);
      p!.poser(at);
    }
  };

  // The microphone: silent until `jouer`, at 48 kHz like a real one, resampled by the page.
  win.navigator.mediaDevices.getUserMedia = async () => {
    micCtx ??= new win.AudioContext({ sampleRate: 48000 });
    dest ??= micCtx.createMediaStreamDestination();
    dest.channelCount = 1;
    return dest.stream;
  };

  // The page's frames, read beside its own `onmessage`.
  let derniere: number | undefined;
  let regulieres = 0;
  let regulier: (() => void) | undefined;
  const Worklet = win.AudioWorkletNode;
  win.AudioWorkletNode = class extends Worklet {
    constructor(ctx: BaseAudioContext, name: string, opts?: AudioWorkletNodeOptions) {
      super(ctx, name, opts);
      if (name !== 'frames') return;
      this.port.addEventListener('message', () => {
        const t = now();
        regulieres = derniere !== undefined && t - derniere < ECART_MS ? regulieres + 1 : 1;
        derniere = t;
        if (regulieres >= TRAMES) regulier?.();
      });
    }
  };

  // Her voice: what `/voix/tts` gave, and the page's sendings, for the anchors and to find a sound's reply.
  const fetchPage = win.fetch.bind(win);
  win.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const post = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase() === 'POST';
    const corps = typeof init?.body === 'string' ? init.body : undefined;
    if (post && url.endsWith('/voix/tts')) {
      const res = await fetchPage(input, init);
      const texte = reduit((JSON.parse(corps ?? '{}') as { text?: string }).text ?? '');
      if (res.ok) {
        const x = new Float32Array(await res.clone().arrayBuffer());
        const rate = Number(res.headers.get('x-sample-rate') ?? 22050);
        const envoi = [...envois].reverse().find((e) => reduit(e.texte).includes(texte));
        syntheses.push({
          texte,
          cle: cleDe(x),
          teteMs: (premierSon(x) / rate) * 1000,
          ...(envoi?.evenement.reponse !== undefined ? { reponse: envoi.evenement.reponse } : {}),
        });
      }
      return res;
    }
    if (post && /\/api\/threads\/[^/]+\/messages$/.test(url)) {
      const evenement = log('envoi_recu', { texte: (JSON.parse(corps ?? '{}') as { text?: string }).text });
      const envoi: Envoi = { evenement, texte: '', phrases: [] };
      envois.push(envoi);
      const res = await fetchPage(input, init);
      if (!res.ok || !res.body) return res;
      const [page, lu] = res.body.tee();
      void (async () => {
        for await (const { event, data } of frames(lu)) {
          if (event === 'reply') {
            evenement.reponse = (JSON.parse(data) as { id: number }).id;
            if (joue) resoudre();
          } else if (event === 'delta') envoi.texte += (JSON.parse(data) as { text: string }).text;
        }
      })().catch(() => {});
      return new Response(page, { status: res.status, statusText: res.statusText, headers: res.headers });
    }
    return fetchPage(input, init);
  };

  // A tap per source of her voice: the first and last non-silent sample of that source, `joue` and `arrete`.
  const sources = win.AudioBufferSourceNode.prototype;
  const connect = sources.connect as (this: AudioNode, ...a: unknown[]) => AudioNode;
  const prises = new WeakSet<AudioBufferSourceNode>();
  sources.connect = function (this: AudioBufferSourceNode, ...a: unknown[]) {
    const r = connect.apply(this, a);
    if (this.context !== micCtx && this.buffer && !prises.has(this)) {
      prises.add(this);
      prise(this);
    }
    return r;
  } as typeof sources.connect;

  const prise = (src: AudioBufferSourceNode) => {
    const ctx = src.context as AudioContext;
    banc.sortieAnnonceeMs ??= ctx.outputLatency * 1000;
    const cle = cleDe(src.buffer!.getChannelData(0));
    const s = [...syntheses].reverse().find((x) => memeCle(x.cle, cle));
    const envoi = envois.find((e) => e.evenement.reponse !== undefined && e.evenement.reponse === s?.reponse);
    let phrase: number | undefined;
    if (envoi && s) {
      if (!envoi.phrases.includes(s.texte)) envoi.phrases.push(s.texte);
      phrase = envoi.phrases.indexOf(s.texte) + 1;
    }
    const tap = ctx.createScriptProcessor(256, 1, 1);
    connect.call(src, tap);
    connect.call(tap, ctx.destination);
    let premier: number | undefined;
    let dernier: number | undefined;
    tap.onaudioprocess = (e) => {
      const [p, ct, sr] = [now(), ctx.currentTime, ctx.sampleRate];
      const x = e.inputBuffer.getChannelData(0);
      for (let i = 0; i < x.length; i++) {
        if (Math.abs(x[i]!) <= SILENCE) continue;
        dernier = p + (e.playbackTime + i / sr - ct) * 1000;
        if (premier === undefined) {
          premier = dernier;
          log('joue', { reponse: s?.reponse, phrase, texte: s?.texte ?? '', teteMs: s?.teteMs }, premier);
        }
      }
    };
    let fini = false;
    src.addEventListener('ended', () =>
      win.setTimeout(() => {
        if (fini) return;
        fini = true;
        tap.onaudioprocess = null;
        tap.disconnect();
        // A source stopped before a sound left it never played: nothing to stop.
        if (dernier !== undefined) log('arrete', { reponse: s?.reponse, phrase }, dernier);
      }, QUEUE_MS),
    );
  };
  const cliquer = (geste: 'silence') => {
    const b = win.document.querySelector<HTMLElement>('[aria-label="Faire taire"]');
    b?.click();
    log('geste', { geste, trouve: b !== null });
  };
  const plusTard = (at: number, f: () => void) => win.setTimeout(f, Math.max(0, at - now()));

  const banc: Banc = {
    journal,
    async jouer() {
      if (!micCtx || !dest) throw new Error('jouer avant que la page ouvre le micro');
      const [ctx, sortie] = [micCtx, dest];
      const sons = new Map<string, Promise<AudioBuffer>>();
      const charger = (n: string) => {
        if (!sons.has(n))
          sons.set(
            n,
            fetchPage(`/banc/sons/${encodeURIComponent(n)}.wav`).then(async (r) => {
              if (!r.ok) throw new Error(`son ${n} : ${r.status}`);
              return ctx.decodeAudioData(await r.arrayBuffer());
            }),
          );
        return sons.get(n)!;
      };
      const poses = [
        ...plan.paroles.map((p, i) => ({
          p,
          debut: { parole: i + 1, etape: 'debut' } as const,
          nom: 'parole' as const,
        })),
        ...(plan.bruits ?? []).map((p) => ({
          p,
          debut: { etape: 'debut' } as const,
          nom: 'bruit_joue' as const,
        })),
      ];
      const tampons = new Map(
        await Promise.all(poses.map(async ({ p }) => [p.son, await charger(p.son)] as const)),
      );
      await ctx.resume();
      if (regulieres < TRAMES) await new Promise<void>((r) => (regulier = r));
      regulier = undefined;

      const p0 = now();
      // The sounds posted from here are the first the stream carries: `t0` is when this context starts to sound.
      const t0 = p0 + MARGE_S * 1000;
      const poser = (
        son: string,
        at: number,
        nom: 'parole' | 'bruit_joue',
        debut: Record<string, TraceValue>,
      ) => {
        const b = tampons.get(son)!;
        const src = ctx.createBufferSource();
        src.buffer = b;
        connect.call(src, sortie);
        const [p, ct] = [now(), ctx.currentTime];
        const quand = Math.max(ct, ct + (at - p) / 1000);
        src.start(quand);
        const de = p + (quand - ct) * 1000;
        log(nom, debut, de);
        log(nom, { ...debut, etape: 'fin' }, de + b.duration * 1000);
      };
      for (const { p, debut, nom } of poses) {
        if ('a' in p) poser(p.son, t0 + p.a, nom, debut);
        else
          enAttente.push({
            apres: p.apres,
            poser: (at) => poser(p.son, at, nom, debut),
            sautee: { son: p.son, ...('parole' in debut ? { parole: debut.parole } : {}) },
          });
      }
      for (const g of plan.gestes ?? []) {
        if ('a' in g) plusTard(t0 + g.a, () => cliquer(g.geste));
        else
          enAttente.push({
            apres: g.apres,
            poser: (at) => plusTard(at, () => cliquer(g.geste)),
            sautee: { geste: g.geste },
          });
      }
      banc.t0 = t0;
      joue = true;
      resoudre();
      return t0;
    },
    fin() {
      joue = false;
      for (const p of enAttente.splice(0)) log('parole_sautee', p.sautee);
      return journal;
    },
  };
  return banc;
}

/**
 * shortcut: the minimum of task 1's `ancre`, so the probe builds today; replace by the import from scenario.ts at the
 * merge. `envoi: n` is the n-th `envoi_recu`; `joue: n` the sentence `phrase` (1 by default) of the reply to it.
 */
export const ancreLocale: Ancrer = (apres, journal) => {
  const envoi = journal.filter((e) => e.name === 'envoi_recu')[
    ('envoi' in apres ? apres.envoi : apres.joue) - 1
  ];
  if (!envoi) return undefined;
  if ('envoi' in apres) return envoi.at + apres.ms;
  if (envoi.reponse === undefined) return undefined;
  const j = journal.find(
    (e) => e.name === 'joue' && e.reponse === envoi.reponse && e['phrase'] === (apres.phrase ?? 1),
  );
  return j && j.at + apres.ms;
};
