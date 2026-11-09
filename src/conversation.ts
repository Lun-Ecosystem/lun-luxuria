import type { Brain, LiveEvent, Message, SendEvent } from './brain.ts';
import { decide } from './listen/filter.ts';
import type { EndpointEvent } from './listen/endpoint.ts';
import type { Layout, Settings } from './settings.ts';
import type { SpeakerEvent } from './speech/speaker.ts';

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
    add(id: number, text: string): void;
    end(id: number): void;
    stop(): { id: number; said: string } | undefined;
    stopAfterSentence(): { id: number; said: string } | undefined;
  };
  settings(): Settings;
  layout(): Layout;
  keyHeld(): boolean;
  /** The desk mute: only a P0 may still be said. */
  silenced?(): boolean;
  now(): number;
  on(e: ConversationEvent): void;
}

export type ConversationEvent =
  | { type: 'thinking'; on: boolean }
  /** A phrase heard passed the filter: it is for her, so the person is there. */
  | { type: 'addressed' }
  | { type: 'ignored'; text: string }
  | { type: 'failed'; text: string }
  | { type: 'latency'; ms: number; speculated: boolean }
  | { type: 'said' };

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

  constructor(deps: ConversationDeps) {
    this.#d = deps;
  }

  #fail(what: string, err: unknown): void {
    this.#d.on({ type: 'failed', text: `${what} : ${err instanceof Error ? err.message : String(err)}` });
  }

  /** A turn the brain marked as spoken. */
  onLive(e: LiveEvent): void {
    if (e.type === 'speech') {
      const speak = this.#d.settings().speak;
      if (this.#d.silenced?.() && e.why !== 'p0') return;
      if (e.why !== 'reply' && !speak[e.why]) return;
      this.#d.speaker.add(e.id, e.text);
    } else if (e.type === 'speech-end') {
      this.#d.speaker.end(e.id);
    }
  }

  onSpeaker(e: SpeakerEvent): void {
    if (e.type === 'first-sound') {
      this.#lastSpokeAt = this.#d.now();
      this.#d.on({ type: 'thinking', on: false });
      if (this.#clockFrom && e.id === this.#waitingReply) {
        this.#d.on({
          type: 'latency',
          ms: this.#d.now() - this.#clockFrom.at,
          speculated: this.#clockFrom.speculated,
        });
        this.#clockFrom = null;
      }
    } else if (e.type === 'subtitle' && e.mute) {
      // Its reply came, without a voice: no first sound will end the thinking, nor stop the clock.
      this.#d.on({ type: 'thinking', on: false });
      this.#clockFrom = null;
    } else if (e.type === 'silent') {
      this.#lastSpokeAt = this.#d.now();
      this.#d.on({ type: 'said' });
    } else if (e.type === 'failed') {
      this.#d.on({ type: 'failed', text: e.text });
    }
  }

  onEndpoint(e: EndpointEvent): void {
    const s = this.#d.settings();
    switch (e.type) {
      case 'held':
        if (s.bargeIn.on && this.#d.speaker.speaking) this.#cutOff(s.bargeIn.mode);
        return;
      case 'pause':
        if (s.endOfSpeech.speculate && !this.#attempt) this.#attempt = this.#try(e.audio, false);
        return;
      case 'resume':
        this.#dropAttempt();
        return;
      case 'noise':
        this.#dropAttempt();
        return;
      case 'end':
        this.#clockFrom = { at: e.lastVoiceAt, speculated: this.#attempt !== null };
        if (this.#attempt) this.#commit(this.#attempt);
        else this.#try(e.audio, true);
        this.#attempt = null;
        return;
      case 'start':
        return;
    }
  }

  #cutOff(mode: 'soft' | 'now'): void {
    const cut = mode === 'now' ? this.#d.speaker.stop() : this.#d.speaker.stopAfterSentence();
    if (cut)
      void this.#d.brain.cut(cut.id, cut.said).catch((err) => this.#fail('Coupure non transmise', err));
  }

  /** Transcribes, filters, sends; held unless `final`. */
  #try(audio: Float32Array, final: boolean): Attempt {
    const attempt: Attempt = { dropped: false, committed: final, early: !final };
    attempt.sent = this.#transcribeAndSend(audio, attempt);
    return attempt;
  }

  async #transcribeAndSend(audio: Float32Array, attempt: Attempt): Promise<void> {
    const d = this.#d;
    let heard: Heard;
    try {
      heard = await d.stt(audio);
    } catch (err) {
      if (attempt.dropped) return;
      // Nothing will come of it: the end of the sentence must not wait for a reply.
      attempt.dropped = true;
      if (attempt.committed) d.on({ type: 'thinking', on: false });
      this.#fail('Ta phrase n’a pas pu être transcrite', err);
      return;
    }
    try {
      // Muted while it was transcribed: nothing leaves, nothing is paid.
      if (d.silenced?.()) attempt.dropped = true;
      if (attempt.dropped) return;
      const verdict = decide(
        heard.text,
        { layout: d.layout(), keyHeld: d.keyHeld(), lastSpokeAt: this.#lastSpokeAt, now: d.now() },
        d.settings(),
      );
      if (!verdict.pass) {
        if (verdict.reason === 'filtered' && attempt.committed && d.settings().traceIgnored)
          d.on({ type: 'ignored', text: heard.text });
        // Committed by the end of the sentence before this verdict: its thinking ends here, nothing will answer.
        if (attempt.committed && attempt.early) d.on({ type: 'thinking', on: false });
        // Filtered on a fragment: the whole sentence may still say the name.
        if (!attempt.committed) attempt.dropped = true;
        return;
      }
      d.on({ type: 'addressed' });
      if (attempt.committed) d.on({ type: 'thinking', on: true });
      await d.brain.send(heard.text, { surface: 'voice', confidence: heard.confidence }, (e) =>
        this.#onTurn(e, attempt),
      );
    } catch (err) {
      d.on({ type: 'thinking', on: false });
      this.#fail('Sa réponse n’est pas venue', err);
    }
  }

  #onTurn(e: SendEvent, attempt: Attempt): void {
    if (e.type === 'user') {
      attempt.userId = (e.message as Message).id;
      if (attempt.dropped) this.#withdraw(attempt);
    } else if (e.type === 'reply') {
      attempt.replyId = e.id;
      if (attempt.dropped) this.#d.speaker.drop(e.id);
      else if (attempt.committed) this.#waitingReply = e.id;
      else this.#d.speaker.hold(e.id);
    } else if (e.type === 'done' && e.message.status === 'error') {
      this.#d.on({ type: 'thinking', on: false });
      this.#d.on({ type: 'failed', text: e.message.error ?? 'Sa réponse a échoué.' });
    }
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
    this.#withdraw(attempt);
  }

  /** The speaker's sentence is over and it was that fragment: its words can come out. */
  #commit(attempt: Attempt): void {
    if (attempt.dropped) return;
    attempt.committed = true;
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
      if (e.type === 'done' && e.message.status === 'error')
        refused = e.message.error ?? 'Sa réponse a échoué.';
    });
    if (refused !== undefined) throw new Error(refused);
  }

  /** The mute comes: a fragment held for the end of the sentence is withdrawn. */
  mute(): void {
    this.#dropAttempt();
  }

  /** The button that exists only while it speaks. */
  silence(): void {
    this.#cutOff('now');
  }
}
