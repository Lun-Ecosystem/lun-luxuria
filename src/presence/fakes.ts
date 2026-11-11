import type { Brain, LiveEvent, Message, ReplyDurations, SendEvent } from '../brain.ts';
import type { Heard } from '../conversation.ts';
import type { Clip, Output, Playing } from '../speech/speaker.ts';
import type { TraceValue } from '../trace.ts';
import { DEFAUTS, type BancEvent, type BancNom, type Reponse, type Scenario } from './scenario.ts';

/**
 * The false bricks of a scenario: the transcription, the server, the voice and its output. They wait by
 * `setTimeout`, as the speaker does, so a false clock plays them exactly; nothing here reads a clock of its own.
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The player's log, on the page's clock. */
export class Journal {
  readonly events: BancEvent[] = [];
  #now: () => number;

  constructor(now: () => number) {
    this.#now = now;
  }

  add(name: BancNom, values: Record<string, TraceValue | undefined> = {}): void {
    const e: BancEvent = { de: 'banc', at: this.#now(), name };
    for (const [k, v] of Object.entries(values)) if (v !== undefined) e[k] = v;
    this.events.push(e);
  }
}

/** A frame of the microphone: it carries its instant, so the transcription knows what its sound covers. */
export const trame = (at: number) => Float32Array.of(at);

/** One sound of her voice: when it started, when it stopped, what it said. */
export interface Son {
  de: number;
  a?: number;
  texte: string;
}

/**
 * Her voice: a synthesis takes `syntheseMs` and fails on a text of `echoue`; a sound lasts `msParCaractere` per
 * character. `reponse` says which reply the output plays: the speaker writes it in the trace just before.
 */
export class FausseVoix {
  /** Every sound played, in order. */
  readonly sons: Son[] = [];
  #s: Scenario;
  #journal: Journal;
  #reponse: () => number | undefined;
  #now: () => number;
  #textes = new WeakMap<Clip, string>();

  constructor(s: Scenario, journal: Journal, reponse: () => number | undefined, now: () => number) {
    this.#s = s;
    this.#journal = journal;
    this.#reponse = reponse;
    this.#now = now;
  }

  /** The sound playing now, if any. */
  get sonne(): Son | undefined {
    const last = this.sons.at(-1);
    return last && last.a === undefined ? last : undefined;
  }

  synth = async (text: string): Promise<Clip> => {
    await sleep(this.#s.voix?.syntheseMs ?? DEFAUTS.syntheseMs);
    if (this.#s.voix?.echoue?.includes(text)) throw new Error('synthèse fausse en échec');
    const ms = (this.#s.voix?.msParCaractere ?? DEFAUTS.msParCaractere) * text.length;
    // At 1000 samples a second, a sample is a millisecond.
    const clip: Clip = { samples: new Float32Array(ms), rate: 1000 };
    this.#textes.set(clip, text);
    return clip;
  };

  output: Output = {
    play: (clip, onEnd): Playing => {
      const reponse = this.#reponse();
      const son: Son = { de: this.#now(), texte: this.#textes.get(clip) ?? '' };
      const ms = clip.samples.length;
      this.sons.push(son);
      this.#journal.add('joue', { reponse, texte: son.texte });
      if (this.#s.echo) this.#journal.add('echo', { etape: 'debut' });
      const stop = () => {
        if (son.a !== undefined) return false;
        clearTimeout(timer);
        son.a = this.#now();
        this.#journal.add('arrete', { reponse });
        if (this.#s.echo) this.#journal.add('echo', { etape: 'fin' });
        return true;
      };
      const timer = setTimeout(() => stop() && onEnd(), ms);
      return {
        stop: () => void stop(),
        heard: () => (ms === 0 ? 1 : Math.min(1, ((son.a ?? this.#now()) - son.de) / ms)),
      };
    },
  };
}

/**
 * The transcription: the sound received covers its frames' instants. It gives, joined by a space, what was heard of
 * the speeches begun in that span, and her own sentences heard back when there is an echo; a noise gives ''. It
 * answers after the `transcriptionMs` of the last of these speeches, or fails on its `echec`.
 */
export function fausseTranscription(
  s: Scenario,
  voix: FausseVoix,
  frameMs: number,
): (audio: Float32Array) => Promise<Heard> {
  return async (audio) => {
    const from = audio[0] ?? 0;
    const to = (audio.at(-1) ?? 0) + frameMs;
    const paroles = s.personne.filter((p) => p.a >= from && p.a < to);
    const echos = s.echo ? voix.sons.filter((x) => x.de < to && (x.a ?? Infinity) > from) : [];
    const said = [
      ...paroles.map((p) => ({ de: p.a, texte: p.entendu ?? p.dit })),
      ...echos.map((x) => ({ de: x.de, texte: x.texte })),
    ].sort((x, y) => x.de - y.de);
    const last = paroles.at(-1);
    await sleep(last?.transcriptionMs ?? DEFAUTS.transcriptionMs);
    if (last?.echec) throw new Error('transcription fausse en échec');
    return {
      text: said
        .map((x) => x.texte)
        .filter(Boolean)
        .join(' '),
      confidence: last?.confiance ?? DEFAUTS.confiance,
    };
  };
}

const plain = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * The server: `send` gives `user`, then `reply` after `numeroMs`; replies are numbered 101, 102…, its own words
 * (`parler`) 51, 52… Each sentence comes on `live` as the false model says; a reply cut sends nothing more.
 */
export class FauxServeur implements Pick<Brain, 'send' | 'cut' | 'withdraw'> {
  #s: Scenario;
  #journal: Journal;
  #live: (e: LiveEvent) => void;
  #users = 0;
  #replies = 100;
  #cut = new Set<number>();

  constructor(s: Scenario, journal: Journal, live: (e: LiveEvent) => void) {
    this.#s = s;
    this.#journal = journal;
    this.#live = live;
  }

  async send(text: string, _opts: unknown, on: (e: SendEvent) => void): Promise<void> {
    // Numbered on receipt: every send waits the same `numeroMs`, so the order is the same.
    const id = ++this.#replies;
    this.#journal.add('envoi_recu', { texte: text, reponse: id });
    const userId = ++this.#users;
    const msg = (id: number, role: Message['role'], extra: Partial<Message> = {}): Message => ({
      id,
      role,
      text: '',
      status: 'ok',
      surface: 'voice',
      at: '',
      ...extra,
    });
    on({ type: 'user', message: msg(userId, 'user', { text }) });
    await sleep(DEFAUTS.numeroMs);
    on({ type: 'reply', id });
    const r: Reponse = this.#s.modele?.reponses?.find((x) => !x.si || plain(text).includes(plain(x.si))) ?? {
      phrases: [],
    };
    const first = r.premierMotMs ?? DEFAUTS.premierMotMs;
    // From the text received (`Reponse`): the reply's number is already out.
    await sleep(first - DEFAUTS.numeroMs);
    const durations: ReplyDurations = { firstWordMs: first };
    for (const [i, phrase] of r.phrases.entries()) {
      if (i > 0) {
        if (r.poste?.apres === i) {
          // The tool runs, then the model writes again from it.
          await sleep(r.poste.ms + first);
          durations.postMs = r.poste.ms;
          durations.secondWordMs = first;
        } else await sleep(r.entrePhrasesMs ?? DEFAUTS.entrePhrasesMs);
      }
      if (this.#cut.has(id)) return;
      this.#live({ type: 'speech', id, n: i + 1, text: phrase, why: 'reply' });
    }
    if (this.#cut.has(id)) return;
    this.#live({ type: 'speech-end', id, why: 'reply' });
    on({
      type: 'done',
      message: msg(id, 'assistant', {
        text: r.phrases.join(' '),
        durations,
        ...(r.erreur && { status: 'error', error: r.erreur }),
      }),
    });
  }

  async cut(id: number, said: string): Promise<void> {
    this.#cut.add(id);
    this.#journal.add('coupure_recue', { reponse: id, entendu: said });
  }

  async withdraw(userId: number): Promise<void> {
    this.#journal.add('retrait_recu', { message: userId });
  }

  /** Its own words, each `parle` at its instant, its sentences `entrePhrasesMs` apart. */
  parler(): void {
    for (const [i, p] of (this.#s.modele?.parle ?? []).entries()) {
      const id = 51 + i;
      void (async () => {
        await sleep(p.a);
        for (const [n, phrase] of p.phrases.entries()) {
          if (n > 0) await sleep(DEFAUTS.entrePhrasesMs);
          if (this.#cut.has(id)) return;
          this.#live({ type: 'speech', id, n: n + 1, text: phrase, why: p.pourquoi });
        }
        if (!this.#cut.has(id)) this.#live({ type: 'speech-end', id, why: p.pourquoi });
      })();
    }
  }
}
