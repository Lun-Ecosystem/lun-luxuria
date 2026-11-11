import type { Brain, LiveEvent, Message, SendEvent } from './brain.ts';
import { decide } from './listen/filter.ts';
import type { EndpointEvent, Moment } from './listen/endpoint.ts';
import type { Layout, Settings } from './settings.ts';
import type { SpeakerEvent } from './speech/speaker.ts';
import type { Trace, TraceName, TraceRef, TraceValue } from './trace.ts';

export interface Heard {
  text: string;
  confidence: number;
}

export interface ConversationDeps {
  brain: Pick<Brain, 'send' | 'cut' | 'withdraw'>;
  stt(audio: Float32Array): Promise<Heard>;
  speaker: {
    readonly speaking: boolean;
    hold(id: number): void;
    release(id: number): void;
    drop(id: number): void;
    add(id: number, text: string, urgent?: boolean): void;
    /** `by`: the sentence whose sound suspends her, for the trace. */
    suspend(soft?: boolean, by?: number): void;
    resume(): void;
    cutSuspended(keep?: number): { id: number; said: string }[];
    end(id: number): void;
    stop(): { id: number; said: string } | undefined;
  };
  settings(): Settings;
  layout(): Layout;
  /** Held at some point of the phrase being heard, not only now. */
  keyHeld(): boolean;
  /** The desk mute: only a P0 may still be said. */
  silenced?(): boolean;
  now(): number;
  on(e: ConversationEvent): void;
  /** Where each decision is written; without it, nothing else changes. */
  trace?: Trace;
}

export type ConversationEvent =
  | { type: 'thinking'; on: boolean }
  /** A phrase heard passed the filter: it is for her, so the person is there. */
  | { type: 'addressed' }
  | { type: 'ignored'; text: string }
  | { type: 'failed'; text: string }
  | { type: 'latency'; ms: number; speculated: boolean }
  | { type: 'said' };

const LISTENED: Record<EndpointEvent['type'], TraceName> = {
  start: 'voix',
  held: 'tenue',
  pause: 'pause',
  resume: 'reprise',
  end: 'fin',
  noise: 'bruit',
};

const MAX_TRIES = 3;
const MAX_TRIED_MS = 10_000;

/** A fragment sent before the sentence was over: its words stay silent until it is. */
interface Attempt {
  /** Set when the transcription came back and went to the core. */
  sent?: Promise<void>;
  userId?: number;
  replyId?: number;
  dropped: boolean;
  committed: boolean;
  /** Sent at a pause: the end of the sentence commits it, and starts its thinking, before its verdict. */
  early: boolean;
  /** Read when it is made: its verdict comes after the transcription, once the key is let go. */
  keyHeld: boolean;
  /** Passed the filter as a fragment: it is for her only once the sentence ends on it. */
  passed?: boolean;
  /** The speaker talks again before its reply was heard: the reply waits for what that new sentence is. */
  heldBack?: boolean;
  /** That new sentence was for her: its reply is never said. The message itself stays. */
  superseded?: boolean;
  /** The one whose reply was still unheard when this sentence ended: it is again, if this one asks nothing. */
  before?: Attempt | null;
  /** In the trace: its sentence and its rank. */
  phrase?: number;
  essai?: number;
}

/**
 * The turn of talk: the speaker's sentence, on the moments the endpointer finds, and its answer. The brain only
 * ever sees a message, a cut or a withdrawal; holding its words until the speaker is done happens here.
 */
export class Conversation {
  #d: ConversationDeps;
  #attempt: Attempt | null = null;
  #lastSpokeAt: number | null = null;
  #clockFrom: { at: number; speculated: boolean } | null = null;
  #waitingReply: number | null = null;
  /** The sentence whose reply nobody has heard yet. */
  #unheard: Attempt | null = null;
  /** The one held back by the sentence being said now. */
  #heldBack: Attempt | null = null;
  /** The sentence being heard: when it began, and how many times it was sent before its end. */
  #sentence = { from: 0, tries: 0 };
  /** He holds a sentence now; and the ones that ended without their verdict yet. She does not resume over either. */
  #talking = false;
  #unjudged = new Set<Attempt>();
  /** The sentence being heard, in the trace: numbered at its first sound. */
  #phrase: number | undefined;

  constructor(deps: ConversationDeps) {
    this.#d = deps;
  }

  #write(name: TraceName, ref: TraceRef, values?: Record<string, TraceValue | undefined>, at?: number): void {
    this.#d.trace?.add(name, ref, values, at);
  }

  #ref(a: Attempt): TraceRef {
    return { phrase: a.phrase, essai: a.essai, reponse: a.replyId };
  }

  #fail(what: string, err: unknown): void {
    this.#d.on({ type: 'failed', text: `${what} : ${err instanceof Error ? err.message : String(err)}` });
  }

  /** A turn the brain marked as spoken. */
  onLive(e: LiveEvent): void {
    if (e.type === 'speech')
      this.#write('phrase_recue', { reponse: e.id }, { rang: e.n, longueur: e.text.length, pourquoi: e.why });
    else if (e.type === 'speech-end') this.#write('fin_recue', { reponse: e.id });
    if (e.type === 'speech') {
      const speak = this.#d.settings().speak;
      if (this.#d.silenced?.() && e.why !== 'p0') {
        // Its words will not sound: nothing of it is left to take back.
        this.#heard(e.id);
        return;
      }
      if (e.why !== 'reply' && !speak[e.why]) return;
      this.#d.speaker.add(e.id, e.text, e.why === 'p0');
    } else if (e.type === 'speech-end') {
      this.#d.speaker.end(e.id);
    }
  }

  onSpeaker(e: SpeakerEvent): void {
    if (e.type === 'first-sound') {
      const now = this.#d.now();
      this.#lastSpokeAt = now;
      // Written here, on the same instant as the measure: the trace must give back the same number.
      this.#write('premier_son', { reponse: e.id }, {}, now);
      this.#d.on({ type: 'thinking', on: false });
      this.#heard(e.id);
      if (this.#clockFrom && e.id === this.#waitingReply) {
        this.#d.on({
          type: 'latency',
          ms: now - this.#clockFrom.at,
          speculated: this.#clockFrom.speculated,
        });
        this.#clockFrom = null;
      }
    } else if (e.type === 'subtitle' && !e.mute) {
      // Each sentence of a long reply keeps open the time in which a word without her name is for her.
      this.#lastSpokeAt = this.#d.now();
    } else if (e.type === 'subtitle') {
      // Its reply came, without a voice: no first sound will end the thinking, nor stop the clock.
      this.#d.on({ type: 'thinking', on: false });
      this.#clockFrom = null;
      this.#heard(e.id);
    } else if (e.type === 'silent') {
      this.#lastSpokeAt = this.#d.now();
      this.#d.on({ type: 'said' });
    } else if (e.type === 'failed') {
      this.#d.on({ type: 'failed', text: e.text });
    }
  }

  /** The listening's moments, each with the instant of its sound and of its decision (the clock, when it has none). */
  onEndpoint(e: EndpointEvent & Partial<Moment>): void {
    const s = this.#d.settings();
    if (this.#d.trace) {
      if (e.type === 'start' || this.#phrase === undefined) this.#phrase = this.#d.trace.phrase();
      const name = LISTENED[e.type];
      const now = e.decidedAt ?? this.#d.now();
      const last = e.type === 'end' ? e.lastVoiceAt : undefined;
      this.#write(name, { phrase: this.#phrase }, { son: e.at ?? now, dernier_son: last }, now);
    }
    switch (e.type) {
      case 'held':
        this.#talking = true;
        if (!s.bargeIn.on) return;
        // Nobody knows yet what this sound is: she falls silent, and the end of the sentence will tell.
        if (this.#d.speaker.speaking) {
          this.#lastSpokeAt = this.#d.now();
          this.#d.speaker.suspend(s.bargeIn.mode === 'soft', this.#phrase);
        } else this.#holdBack();
        return;
      case 'pause':
        // Each try is a transcription and a call taken back if he goes on: a long or halting sentence waits its end.
        if (
          s.endOfSpeech.speculate &&
          !this.#attempt &&
          this.#sentence.tries < MAX_TRIES &&
          this.#d.now() - this.#sentence.from <= MAX_TRIED_MS
        ) {
          this.#sentence.tries++;
          this.#attempt = this.#try(e.audio, false);
        }
        return;
      case 'resume':
        this.#dropAttempt();
        return;
      case 'noise':
        this.#talking = false;
        this.#dropAttempt();
        // No sentence ended, so the chronometer was not restarted.
        this.#letGo(undefined, false);
        return;
      case 'end':
        this.#talking = false;
        this.#clockFrom = { at: e.lastVoiceAt, speculated: this.#attempt !== null };
        if (this.#attempt) {
          this.#commit(this.#attempt);
          // Its fragment was filtered out: nothing of this sentence will answer.
          if (this.#attempt.dropped) this.#noAnswer(this.#attempt);
        } else this.#try(e.audio, true);
        this.#attempt = null;
        return;
      case 'start':
        this.#sentence = { from: this.#d.now(), tries: 0 };
        return;
    }
  }

  /** Its reply sounded, or was shown: it is no longer one to take back. */
  #heard(replyId: number): void {
    if (this.#unheard?.replyId === replyId) this.#unheard = null;
    else if (this.#unheard?.before?.replyId === replyId) this.#unheard.before = null;
  }

  /** A sentence that ended becomes the one whose reply nobody heard; the one before is kept in case it asks nothing. */
  #awaits(attempt: Attempt): void {
    this.#unjudged.add(attempt);
    attempt.before = this.#unheard;
    this.#unheard = attempt;
  }

  /** Nothing will answer this sentence: the reply before it is the unheard one again, and comes out if held back. */
  #noAnswer(attempt: Attempt): void {
    this.#write('sans_reponse', this.#ref(attempt), {});
    // A try at a pause may have passed the filter: the sentence did not, its words go.
    if (attempt.phrase !== undefined) this.#d.trace?.forget(attempt.phrase);
    if (this.#unheard === attempt) this.#unheard = attempt.before ?? null;
    this.#letGo(attempt);
  }

  /** He talks again while a reply is on its way: it waits, silent, for what he is saying. A cough must not cost it. */
  #holdBack(): void {
    const waiting = this.#unheard;
    if (!waiting || waiting.dropped || this.#heldBack) return;
    this.#heldBack = waiting;
    waiting.heldBack = true;
    if (waiting.replyId !== undefined) this.#d.speaker.hold(waiting.replyId);
    this.#write('retenue', this.#ref(waiting), { par: this.#phrase });
  }

  /** What he said (`by`) was not for her: the reply held back comes out. */
  #letGo(by?: Attempt, restarted = true): void {
    // A reply suspended while it sounded goes on; no first sound will come again, so no thinking is lit.
    // Not while he is in a sentence, nor while one that ended may still turn out to be for her.
    if (by) this.#unjudged.delete(by);
    if (!this.#talking && this.#unjudged.size === 0) this.#d.speaker.resume();
    const waiting = this.#heldBack;
    this.#heldBack = null;
    if (!waiting) return;
    waiting.heldBack = false;
    // The sound that held it back came while its own sentence was still being transcribed: it had no reply to hold.
    if (waiting === by) return;
    this.#write('relachee', this.#ref(waiting), { par: by?.phrase });
    // The chronometer was restarted by a sentence that asked nothing.
    if (restarted) this.#clockFrom = null;
    // It is still on its way.
    this.#d.on({ type: 'thinking', on: true });
    if (waiting.replyId !== undefined) this.#d.speaker.release(waiting.replyId);
  }

  /** What he said (`by`) was for her: the reply held back is never said, and the server forgets it. His message stays. */
  #supersede(by: Attempt): void {
    // A reply suspended while it sounded is cut for good, and the server learns what was heard of it.
    // A word too short to have suspended her (« non ») cuts her all the same, now that it is known to be for her.
    const { on, mode } = this.#d.settings().bargeIn;
    if (on && this.#d.speaker.speaking) this.#d.speaker.suspend(mode === 'soft', by.phrase);
    this.#unjudged.delete(by);
    for (const cut of this.#d.speaker.cutSuspended(by.replyId))
      void this.#d.brain.cut(cut.id, cut.said).catch((err) => this.#fail('Coupure non transmise', err));
    const waiting = this.#heldBack;
    // Held back while its own sentence was transcribed: the sentence said since will tell.
    if (!waiting || waiting === by) return;
    this.#heldBack = null;
    waiting.superseded = true;
    if (by.before === waiting) by.before = null;
    if (waiting.replyId !== undefined) this.#forget(waiting.replyId);
  }

  #forget(replyId: number): void {
    this.#write('oubliee', { reponse: replyId });
    this.#d.speaker.drop(replyId);
    void this.#d.brain.cut(replyId, '').catch((err) => this.#fail('Coupure non transmise', err));
  }

  /** Transcribes, filters, sends; held unless `final`. */
  #try(audio: Float32Array, final: boolean): Attempt {
    const attempt: Attempt = { dropped: false, committed: final, early: !final, keyHeld: this.#d.keyHeld() };
    const t = this.#d.trace;
    if (t && this.#phrase !== undefined) {
      attempt.phrase = this.#phrase;
      attempt.essai = t.essai(this.#phrase);
      this.#write('essai', this.#ref(attempt), { final });
    }
    if (final) this.#awaits(attempt);
    attempt.sent = this.#transcribeAndSend(audio, attempt);
    return attempt;
  }

  async #transcribeAndSend(audio: Float32Array, attempt: Attempt): Promise<void> {
    const d = this.#d;
    let heard: Heard;
    const from = d.now();
    try {
      heard = await d.stt(audio);
    } catch (err) {
      this.#write('transcrite', this.#ref(attempt), { duree: d.now() - from, echec: true });
      if (attempt.dropped) return;
      // Nothing will come of it: the end of the sentence must not wait for a reply.
      attempt.dropped = true;
      if (attempt.committed) {
        d.on({ type: 'thinking', on: false });
        this.#noAnswer(attempt);
      }
      this.#fail('Ta phrase n’a pas pu être transcrite', err);
      return;
    }
    const transcribed = {
      duree: d.now() - from,
      confiance: heard.confidence,
      longueur: heard.text.length,
    };
    try {
      // Muted while it was transcribed: nothing leaves, nothing is paid.
      if (d.silenced?.()) attempt.dropped = true;
      if (attempt.dropped) {
        this.#write('transcrite', this.#ref(attempt), transcribed);
        if (attempt.committed) this.#noAnswer(attempt);
        return;
      }
      const verdict = decide(
        heard.text,
        { layout: d.layout(), keyHeld: attempt.keyHeld, lastSpokeAt: this.#lastSpokeAt, now: d.now() },
        d.settings(),
      );
      // Its words are written only when it is for her: what the filter set aside never is.
      this.#write('transcrite', this.#ref(attempt), {
        ...transcribed,
        texte: verdict.pass ? heard.text : undefined,
      });
      this.#write('verdict', this.#ref(attempt), {
        resultat: verdict.pass ? 'pour_elle' : verdict.reason === 'noise' ? 'bruit' : 'ecartee',
        par: verdict.pass ? verdict.by : undefined,
      });
      if (!verdict.pass) {
        if (verdict.reason === 'filtered' && attempt.committed && d.settings().traceIgnored)
          d.on({ type: 'ignored', text: heard.text });
        // Committed by the end of the sentence before this verdict: its thinking ends here, nothing will answer.
        if (attempt.committed && attempt.early) d.on({ type: 'thinking', on: false });
        // Filtered on a fragment: the whole sentence may still say the name.
        if (!attempt.committed) attempt.dropped = true;
        else this.#noAnswer(attempt);
        return;
      }
      if (attempt.committed) {
        d.on({ type: 'addressed' });
        d.on({ type: 'thinking', on: true });
        this.#supersede(attempt);
      } else attempt.passed = true;
      this.#write('envoyee', this.#ref(attempt), { final: attempt.committed });
      await d.brain.send(heard.text, { surface: 'voice', confidence: heard.confidence }, (e) =>
        this.#onTurn(e, attempt),
      );
    } catch (err) {
      d.on({ type: 'thinking', on: false });
      // Nothing will answer: what this sentence suspended, or held back, goes on.
      if (attempt.committed) this.#noAnswer(attempt);
      this.#fail('Sa réponse n’est pas venue', err);
    }
  }

  #onTurn(e: SendEvent, attempt: Attempt): void {
    if (e.type === 'user') {
      attempt.userId = (e.message as Message).id;
      if (attempt.dropped) this.#withdraw(attempt);
    } else if (e.type === 'reply') {
      attempt.replyId = e.id;
      this.#write('numero', this.#ref(attempt), { message: attempt.userId });
      if (attempt.dropped) this.#d.speaker.drop(e.id);
      else if (attempt.superseded) this.#forget(e.id);
      else if (attempt.committed) {
        this.#waitingReply = e.id;
        if (attempt.heldBack) this.#d.speaker.hold(e.id);
      } else this.#d.speaker.hold(e.id);
    } else if (e.type === 'done') this.#durations(e.message, this.#ref(attempt));
    if (e.type === 'done' && e.message.status === 'error') {
      // No word will come: a turn held back for it must not block the next ones.
      if (this.#unheard === attempt) this.#unheard = attempt.before ?? null;
      if (this.#heldBack === attempt) this.#heldBack = null;
      if (attempt.heldBack && attempt.replyId !== undefined) this.#d.speaker.drop(attempt.replyId);
      this.#write('sans_reponse', this.#ref(attempt), { raison: 'erreur' });
      this.#d.on({ type: 'thinking', on: false });
      this.#d.on({ type: 'failed', text: e.message.error ?? 'Sa réponse a échoué.' });
    }
  }

  /** What the server measured of its reply, as it gave it: an older server gives nothing, and nothing is written. */
  #durations(reply: Message, ref: TraceRef): void {
    if (reply.durations) this.#write('durees', ref, { ...reply.durations });
  }

  #withdraw(attempt: Attempt): void {
    if (attempt.replyId !== undefined) this.#d.speaker.drop(attempt.replyId);
    if (attempt.userId !== undefined)
      void this.#d.brain.withdraw(attempt.userId).catch((err) => this.#fail('Retrait non transmis', err));
  }

  /** The speaker went on talking: what it prepared is thrown away. */
  #dropAttempt(): void {
    const attempt = this.#attempt;
    this.#attempt = null;
    if (!attempt) return;
    attempt.dropped = true;
    this.#write('retiree', this.#ref(attempt), {});
    this.#withdraw(attempt);
  }

  /** The speaker's sentence is over and it was that fragment: its words can come out. */
  #commit(attempt: Attempt): void {
    if (attempt.dropped) return;
    attempt.committed = true;
    this.#write('confirmee', this.#ref(attempt), {});
    this.#awaits(attempt);
    if (attempt.passed) {
      this.#d.on({ type: 'addressed' });
      this.#supersede(attempt);
    }
    this.#d.on({ type: 'thinking', on: true });
    if (attempt.replyId !== undefined) {
      this.#waitingReply = attempt.replyId;
      this.#d.speaker.release(attempt.replyId);
    }
  }

  /** Written in the thread; it answers aloud too. */
  async write(text: string): Promise<void> {
    let refused: string | undefined;
    await this.#d.brain.send(text, { surface: 'desktop' }, (e) => {
      if (e.type === 'done') this.#durations(e.message, { reponse: e.message.id });
      if (e.type === 'done' && e.message.status === 'error')
        refused = e.message.error ?? 'Sa réponse a échoué.';
    });
    if (refused !== undefined) throw new Error(refused);
  }

  /** The mute comes: a fragment held for the end of the sentence is withdrawn, and no reply is left to take back. */
  mute(): void {
    this.stopListening();
    this.#unheard = null;
  }

  /** The microphone stops in the middle of a sentence: it will never end, so nothing waits on it any more. */
  stopListening(): void {
    this.#talking = false;
    this.#unjudged.clear();
    this.#dropAttempt();
    this.#letGo(undefined, false);
  }

  /** The button that exists only while it speaks. */
  silence(): void {
    const cut = this.#d.speaker.stop();
    if (cut)
      void this.#d.brain.cut(cut.id, cut.said).catch((err) => this.#fail('Coupure non transmise', err));
  }
}
