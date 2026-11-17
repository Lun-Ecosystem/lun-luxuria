import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Conversation, type ConversationEvent, type Heard } from './conversation.ts';
import type { Message, SendEvent } from './brain.ts';
import { DEFAULTS, type Settings } from './settings.ts';
import { Speaker, type Clip, type Output } from './speech/speaker.ts';
import { Trace } from './trace.ts';

const tick = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r));
};
/** Her voice is back after the default wait (real timers: the tests that use fake ones advance them by it). */
const resumed = () => new Promise((r) => setTimeout(r, DEFAULTS.bargeIn.resumeMs + 30));
const AUDIO = new Float32Array(1);
const CLIP: Clip = { samples: new Float32Array(1), rate: 16000 };
const message = (id: number): Message => ({
  id,
  role: 'user',
  text: 'x',
  status: 'ok',
  surface: 'voice',
  at: '',
});

function setup(
  over: Partial<Settings> = {},
  /** A list is one transcription per sentence, in order; a function is the transcription itself. */
  heard: string | Error | string[] | ((signal?: AbortSignal) => Promise<Heard>) = 'Bonjour toi',
  silenced = () => false,
  refuse?: string,
  /** The send throws, before any event, as the client on a reply the server refused. */
  throws?: string,
  /** One per send, in order, in place of its stream: `id` numbers its message, `id + 100` its reply. */
  streams: ((on: (e: SendEvent) => void, id: number) => Promise<void>)[] = [],
) {
  let clock = 1000;
  const trace = new Trace(() => clock);
  const calls: string[] = [];
  const events: ConversationEvent[] = [];
  const sounds: { end: () => void; ratio: number }[] = [];
  let ids = 10;
  const sends: { text: string; opts: object; on: (e: SendEvent) => void }[] = [];
  const out: Output = {
    play(_, onEnd) {
      const s = { end: onEnd, ratio: 0.5 };
      sounds.push(s);
      return { stop: () => calls.push('sound stop'), heard: () => s.ratio };
    },
  };
  const speaker = new Speaker(
    async () => CLIP,
    out,
    (e) => convo.onSpeaker(e),
  );
  const convo: Conversation = new Conversation({
    brain: {
      send: async (text, opts, on) => {
        sends.push({ text, opts, on });
        if (throws) throw new Error(throws);
        const id = ids++;
        const stream = streams.shift();
        if (stream) return stream(on, id);
        on({ type: 'user', message: message(id) });
        on({ type: 'reply', id: id + 100 });
        if (refuse) on({ type: 'done', message: { ...message(id), status: 'error', error: refuse } });
      },
      cut: async (id, said) => void calls.push(`cut ${id} "${said}"`),
      withdraw: async (id) => void calls.push(`withdraw ${id}`),
    },
    stt: async (_, signal) => {
      if (typeof heard === 'function') return heard(signal);
      if (heard instanceof Error) throw heard;
      return { text: typeof heard === 'string' ? heard : (heard.shift() ?? ''), confidence: 0.9 };
    },
    speaker,
    settings: () => ({ ...DEFAULTS, ...over }),
    layout: () => 'scene',
    keyHeld: () => false,
    silenced,
    now: () => clock,
    on: (e) => events.push(e),
    trace,
  });
  const say = (id: number, text: string) => convo.onLive({ type: 'speech', id, n: 1, text, why: 'reply' });
  const advance = (ms: number) => (clock += ms);
  return { convo, calls, events, sounds, sends, say, advance, trace, speaker };
}

describe('addressed: a phrase for her, said once the sentence is over', () => {
  const addressed = (events: ConversationEvent[]) => events.filter((e) => e.type === 'addressed').length;

  it('passed on a pause, it counts only at the end of the sentence', async () => {
    const t = setup();
    t.convo.onEndpoint({ type: 'pause', audio: AUDIO });
    await tick();
    expect(addressed(t.events)).toBe(0);
    t.convo.onEndpoint({ type: 'end', audio: AUDIO, lastVoiceAt: 1000 });
    await tick();
    expect(addressed(t.events)).toBe(1);
  });

  it('a fragment withdrawn never counts; the sentence that follows does, once', async () => {
    const t = setup();
    t.convo.onEndpoint({ type: 'pause', audio: AUDIO });
    await tick();
    t.convo.onEndpoint({ type: 'resume' });
    await tick();
    expect(addressed(t.events)).toBe(0);
    t.convo.onEndpoint({ type: 'end', audio: AUDIO, lastVoiceAt: 2000 });
    await tick();
    expect(addressed(t.events)).toBe(1);
  });

  it('the end before the verdict of its fragment: it counts at the verdict', async () => {
    const t = setup();
    t.convo.onEndpoint({ type: 'pause', audio: AUDIO });
    t.convo.onEndpoint({ type: 'end', audio: AUDIO, lastVoiceAt: 1000 });
    await tick();
    expect(addressed(t.events)).toBe(1);
  });
});

describe("the speaker's sentence, with an attempt on the pause", () => {
  it("held until the end, then released, and the chronometer runs from the speaker's last voice", async () => {
    const t = setup();
    t.convo.onEndpoint({ type: 'pause', audio: AUDIO });
    await tick();
    expect(t.sends).toHaveLength(1);
    t.say(110, 'Salut.');
    await tick();
    expect(t.sounds).toHaveLength(0);

    t.convo.onEndpoint({ type: 'end', audio: AUDIO, lastVoiceAt: 1000 });
    t.advance(800);
    await tick();
    expect(t.sends).toHaveLength(1);
    expect(t.sounds).toHaveLength(1);
    expect(t.events).toContainEqual({ type: 'latency', ms: 800, speculated: true });
  });

  it('the speaker goes on: the fragment is withdrawn, its words never sound, the next try starts over', async () => {
    const t = setup();
    t.convo.onEndpoint({ type: 'pause', audio: AUDIO });
    await tick();
    t.say(110, 'Trop tôt.');
    t.convo.onEndpoint({ type: 'resume' });
    await tick();
    expect(t.calls).toEqual(['withdraw 10']);
    expect(t.sounds).toHaveLength(0);

    t.convo.onEndpoint({ type: 'end', audio: AUDIO, lastVoiceAt: 2000 });
    await tick();
    expect(t.sends).toHaveLength(2);
    t.say(111, 'Là oui.');
    await tick();
    expect(t.sounds).toHaveLength(1);
  });

  it('the speaker goes on before the transcription came back: nothing is ever sent', async () => {
    const t = setup();
    t.convo.onEndpoint({ type: 'pause', audio: AUDIO });
    t.convo.onEndpoint({ type: 'resume' });
    await tick();
    expect(t.sends).toHaveLength(0);
  });

  it('the speaker goes on while the message is on its way: withdrawn, and its words cannot block the next', async () => {
    const t = setup();
    t.convo.onEndpoint({ type: 'pause', audio: AUDIO });
    await tick();
    const late = t.sends[0]!;
    t.convo.onEndpoint({ type: 'resume' });
    late.on({ type: 'reply', id: 500 });
    t.say(500, 'Trop tard.');
    t.say(600, 'Autre chose.');
    await tick();
    expect(t.sounds).toHaveLength(1);
  });

  it('speculation off: nothing leaves before the end, and it is not held', async () => {
    const t = setup({ endOfSpeech: { ...DEFAULTS.endOfSpeech, speculate: false } });
    t.convo.onEndpoint({ type: 'pause', audio: AUDIO });
    await tick();
    expect(t.sends).toHaveLength(0);
    t.convo.onEndpoint({ type: 'end', audio: AUDIO, lastVoiceAt: 1000 });
    await tick();
    expect(t.sends).toHaveLength(1);
    t.say(110, 'Oui.');
    await tick();
    expect(t.sounds).toHaveLength(1);
    expect(t.events).toContainEqual(expect.objectContaining({ type: 'latency', speculated: false }));
  });
});

describe('what stays on the PC', () => {
  it('a sentence filtered out is not sent, and leaves a trace here only', async () => {
    const small = {
      filter: { scene: true, small: true },
      endOfSpeech: { ...DEFAULTS.endOfSpeech, speculate: false },
    };
    const t = setup(small);
    t.convo.onEndpoint({ type: 'end', audio: AUDIO, lastVoiceAt: 1000 });
    await tick();
    expect(t.sends).toHaveLength(0);
    expect(t.events).toContainEqual({ type: 'ignored', text: 'Bonjour toi' });
  });

  it('the trace turns off', async () => {
    const t = setup({
      filter: { scene: true, small: true },
      traceIgnored: false,
      endOfSpeech: { ...DEFAULTS.endOfSpeech, speculate: false },
    });
    t.convo.onEndpoint({ type: 'end', audio: AUDIO, lastVoiceAt: 1000 });
    await tick();
    expect(t.events).toEqual([]);
  });

  it('noise from the transcription is dropped with no trace', async () => {
    const t = setup(
      { endOfSpeech: { ...DEFAULTS.endOfSpeech, speculate: false } },
      'Sous-titres par Amara.org',
    );
    t.convo.onEndpoint({ type: 'end', audio: AUDIO, lastVoiceAt: 1000 });
    await tick();
    expect(t.sends).toHaveLength(0);
    expect(t.events).toEqual([]);
  });

  it('its window counts from when it last spoke', async () => {
    const t = setup({
      filter: { scene: true, small: true },
      endOfSpeech: { ...DEFAULTS.endOfSpeech, speculate: false },
    });
    t.say(1, 'Tiens.');
    t.convo.onLive({ type: 'speech-end', id: 1, why: 'p0' });
    await tick();
    t.sounds[0]!.end();
    await tick();
    t.advance(14_000);
    t.convo.onEndpoint({ type: 'end', audio: AUDIO, lastVoiceAt: 1000 });
    await tick();
    expect(t.sends).toHaveLength(1);
  });
});

describe('cutting it off', () => {
  const pause = { type: 'pause', audio: AUDIO } as const;
  const ended = { type: 'end', audio: AUDIO, lastVoiceAt: 2000 } as const;
  /** She is in the middle of a sentence, and a voice holds over hers. */
  async function suspended(...args: Parameters<typeof setup>) {
    const t = setup(...args);
    t.say(50, 'Une phrase assez longue pour être coupée.');
    t.say(50, 'La suite.');
    await tick();
    t.convo.onEndpoint({ type: 'held' });
    await tick();
    expect(t.calls).toEqual(['sound stop']);
    return t;
  }

  it('held voice suspends her; the sentence was for her: cut for good, told once, and its answer sounds', async () => {
    const t = await suspended();
    t.convo.onEndpoint(pause);
    await tick();
    t.convo.onEndpoint(ended);
    await tick();
    expect(t.calls).toEqual(['sound stop', 'cut 50 "Une phrase assez"']);
    t.say(110, 'Oui ?');
    await tick();
    expect(t.sounds).toHaveLength(2);
    expect(t.events.filter((e) => e.type === 'thinking').at(-1)).toEqual({ type: 'thinking', on: false });
  });

  it.each([
    [
      'a cough',
      (t: Awaited<ReturnType<typeof suspended>>) => t.convo.onEndpoint({ type: 'noise' }),
      undefined,
    ],
    ['nothing transcribed', (t) => t.convo.onEndpoint(ended), 'Sous-titres par Amara.org'],
    ['a transcription that fails', (t) => t.convo.onEndpoint(ended), new Error('en panne')],
    ['the microphone stopped', (t) => t.convo.stopListening(), undefined],
  ] as [string, (t: Awaited<ReturnType<typeof suspended>>) => void, string | Error | undefined][])(
    '%s: she says her sentence again and goes on, the server hears nothing',
    async (_, what, heard) => {
      const t = await suspended({}, heard);
      const thinking = t.events.filter((e) => e.type === 'thinking').length;
      what(t);
      await tick();
      await resumed();
      expect(t.calls).toEqual(['sound stop']);
      expect(t.sounds).toHaveLength(2);
      t.sounds[1]!.end();
      await tick();
      expect(t.sounds).toHaveLength(3);
      // No first sound will come again to put it out.
      expect(t.events.filter((e) => e.type === 'thinking' && e.on).length).toBeLessThanOrEqual(thinking);
    },
  );

  it('a fragment the server refuses: she stays cut, nothing thinks, and the next sentence holds nothing back', async () => {
    const t = await suspended({}, 'Bonjour toi', () => false, undefined, 'Message refusé');
    t.convo.onEndpoint(pause);
    await tick();
    t.convo.onEndpoint(ended);
    await tick();
    expect(t.calls).toEqual(['sound stop', 'cut 50 "Une phrase assez"']);
    expect(t.events.filter((e) => e.type === 'thinking').at(-1)).toEqual({ type: 'thinking', on: false });
    // He talks again while she is silent, then it was only a sound: nothing was on its way to hold back.
    const thinking = t.events.filter((e) => e.type === 'thinking').length;
    t.convo.onEndpoint({ type: 'held' });
    t.convo.onEndpoint({ type: 'noise' });
    await tick();
    expect(t.events.filter((e) => e.type === 'thinking')).toHaveLength(thinking);
  });

  it('a fragment whose reply ends in error: she stays cut, nothing thinks, it is told once, nothing is held back', async () => {
    const t = await suspended({}, 'Bonjour toi', () => false, 'Plafond atteint');
    t.convo.onEndpoint(pause);
    await tick();
    t.convo.onEndpoint(ended);
    await tick();
    expect(t.calls).toEqual(['sound stop', 'cut 50 "Une phrase assez"']);
    expect(t.events.filter((e) => e.type === 'thinking').at(-1)).toEqual({ type: 'thinking', on: false });
    expect(t.trace.events.filter((e) => e.name === 'sans_reponse')).toHaveLength(1);
    // He talks again while she is silent, then it was only a sound: nothing was on its way to hold back.
    const thinking = t.events.filter((e) => e.type === 'thinking').length;
    t.convo.onEndpoint({ type: 'held' });
    t.convo.onEndpoint({ type: 'noise' });
    await tick();
    expect(t.trace.events.filter((e) => e.name === 'retenue')).toHaveLength(0);
    expect(t.events.filter((e) => e.type === 'thinking')).toHaveLength(thinking);
  });

  it('a reply held back, replaced by a fragment whose reply fails: forgotten, and nothing holds it again', async () => {
    const t = setup();
    t.convo.onEndpoint(pause);
    await tick();
    t.convo.onEndpoint(ended);
    await tick();
    // Its reply 110 is on its way, unheard; he talks again while she is silent: it is held back.
    t.convo.onEndpoint({ type: 'held' });
    t.convo.onEndpoint(pause);
    await tick();
    t.sends[1]!.on({ type: 'done', message: { ...message(11), status: 'error', error: 'Plafond atteint' } });
    t.convo.onEndpoint(ended);
    await tick();
    expect(t.calls).toEqual(['cut 110 ""']);
    expect(t.trace.events.filter((e) => e.name === 'oubliee')).toHaveLength(1);
    t.convo.onEndpoint({ type: 'held' });
    t.convo.onEndpoint({ type: 'noise' });
    await tick();
    expect(t.trace.events.filter((e) => e.name === 'retenue')).toHaveLength(1);
    expect(t.events.filter((e) => e.type === 'thinking').at(-1)).toEqual({ type: 'thinking', on: false });
  });

  it('a sentence the filter sets aside costs her nothing; « arrête » late in a long reply still cuts', async () => {
    const FILTERED = { filter: { scene: true, small: true } };
    const aside = await suspended(FILTERED, 'On mange quoi ce soir');
    aside.advance(20_000);
    aside.convo.onEndpoint(ended);
    await tick();
    await resumed();
    expect(aside.calls).toEqual(['sound stop']);
    expect(aside.sounds).toHaveLength(2);

    const late = setup(FILTERED, 'Arrête');
    late.say(50, 'Une.');
    late.say(50, 'Deux, vingt secondes plus tard.');
    await tick();
    late.advance(20_000);
    late.sounds[0]!.end();
    await tick();
    late.convo.onEndpoint({ type: 'held' });
    late.convo.onEndpoint(ended);
    await tick();
    expect(late.calls).toEqual(['sound stop', 'cut 50 "Une. Deux, vingt"']);
  });

  it('a second sentence begins while the first is transcribed: its answer does not sound over it', async () => {
    const t = await suspended({}, ['Bonjour toi', 'Sous-titres par Amara.org']);
    t.convo.onEndpoint(ended);
    t.convo.onEndpoint({ type: 'held' });
    await tick();
    expect(t.calls).toEqual(['sound stop', 'cut 50 "Une phrase assez"']);
    t.say(110, 'Oui ?');
    await tick();
    expect(t.sounds).toHaveLength(1);
    t.convo.onEndpoint({ type: 'noise' });
    await tick();
    expect(t.sounds).toHaveLength(2);
  });

  it('a word too short to hold cuts her once it is known to be for her; not when barge-in is off', async () => {
    const t = setup();
    t.say(50, 'Une phrase assez longue pour être coupée.');
    await tick();
    t.convo.onEndpoint(ended);
    await tick();
    expect(t.calls).toEqual(['sound stop', 'cut 50 "Une phrase assez"']);

    const off = setup({ bargeIn: { ...DEFAULTS.bargeIn, on: false } });
    off.say(50, 'Une phrase.');
    await tick();
    off.convo.onEndpoint(ended);
    await tick();
    expect(off.calls).toEqual([]);
  });

  it('she does not resume while a sentence that ended may still be for her, nor over one he holds', async () => {
    const FILTERED = { filter: { scene: true, small: true } };
    const v = verdicts();
    const cough = await suspended({}, v.stt);
    cough.convo.onEndpoint(ended);
    cough.convo.onEndpoint({ type: 'noise' });
    // Its verdict comes only after the wait could have ended: what may still be for her keeps her silent all along.
    await resumed();
    expect(cough.sounds).toHaveLength(1);
    v.give(0, 'Bonjour toi');
    await tick();
    expect(cough.calls).toEqual(['sound stop', 'cut 50 "Une phrase assez"']);

    const over = await suspended(FILTERED, ['On mange quoi ce soir', 'Sous-titres par Amara.org']);
    over.advance(20_000);
    over.convo.onEndpoint(ended);
    over.convo.onEndpoint({ type: 'held' });
    await tick();
    await resumed();
    expect(over.sounds).toHaveLength(1);
    over.convo.onEndpoint(ended);
    await tick();
    await resumed();
    expect(over.sounds).toHaveLength(2);
    expect(over.calls).toEqual(['sound stop']);
  });

  it('an urgency that waited behind her sentence sounds during the suspension, and both are told cut', async () => {
    const t = setup();
    t.say(50, 'Une phrase assez longue pour être coupée.');
    await tick();
    t.convo.onLive({ type: 'speech', id: 60, n: 1, text: 'Alerte rouge.', why: 'p0' });
    t.convo.onEndpoint({ type: 'held' });
    await tick();
    expect(t.sounds).toHaveLength(2);
    t.convo.onEndpoint(ended);
    await tick();
    expect(t.calls.filter((c) => c.startsWith('cut')).sort()).toEqual([
      'cut 50 "Une phrase assez"',
      'cut 60 "Alerte"',
    ]);
  });

  it('the soft way: her sentence ends, the rest waits for what he says', async () => {
    const t = setup({ bargeIn: { ...DEFAULTS.bargeIn, mode: 'soft' } });
    t.say(50, 'Elle finit.');
    t.say(50, 'Pas tout de suite.');
    await tick();
    t.convo.onEndpoint({ type: 'held' });
    t.sounds[0]!.end();
    await tick();
    expect(t.sounds).toHaveLength(1);
    t.convo.onEndpoint(ended);
    await tick();
    expect(t.calls).toEqual(['cut 50 "Elle finit."']);
    expect(t.sounds).toHaveLength(1);
  });

  it('the button during a suspension silences her for good', async () => {
    const t = await suspended();
    t.convo.silence();
    t.convo.onEndpoint({ type: 'noise' });
    await tick();
    await resumed();
    expect(t.calls).toEqual(['sound stop', 'cut 50 "Une phrase assez"']);
    expect(t.sounds).toHaveLength(1);
  });

  it('not when barge-in is off, nor when it is silent', async () => {
    const off = setup({ bargeIn: { ...DEFAULTS.bargeIn, on: false } });
    off.say(50, 'Une phrase.');
    await tick();
    off.convo.onEndpoint({ type: 'held' });
    await tick();
    expect(off.calls).toEqual([]);

    const silent = setup();
    silent.convo.onEndpoint({ type: 'held' });
    await tick();
    expect(silent.calls).toEqual([]);
  });

  const NO_TRY = { endOfSpeech: { ...DEFAULTS.endOfSpeech, speculate: false } };
  const end = (at: number) => ({ type: 'end', audio: AUDIO, lastVoiceAt: at }) as const;

  it('he talks again before its reply was heard: that reply is never said, the server forgets it', async () => {
    const t = setup(NO_TRY);
    t.convo.onEndpoint(end(1000));
    await tick();
    t.convo.onEndpoint({ type: 'held' });
    t.say(110, 'Trop tard.');
    await tick();
    expect(t.sounds).toHaveLength(0);

    t.convo.onEndpoint(end(4000));
    await tick();
    expect(t.calls).toEqual(['cut 110 ""']);
    t.say(110, 'Encore elle.');
    t.say(111, 'La bonne.');
    await tick();
    expect(t.sounds).toHaveLength(1);
    expect(t.sends).toHaveLength(2);
  });

  it('a cough, or a sentence that was not for her, costs the reply nothing', async () => {
    const cough = setup(NO_TRY);
    cough.convo.onEndpoint(end(1000));
    await tick();
    cough.convo.onEndpoint({ type: 'held' });
    cough.say(110, 'Je réponds.');
    await tick();
    expect(cough.sounds).toHaveLength(0);
    cough.convo.onEndpoint({ type: 'noise' });
    await tick();
    expect(cough.sounds).toHaveLength(1);
    expect(cough.calls).toEqual([]);

    const aside = setup(NO_TRY, ['Bonjour toi', 'Sous-titres par Amara.org']);
    aside.convo.onEndpoint(end(1000));
    await tick();
    aside.convo.onEndpoint({ type: 'held' });
    aside.say(110, 'Je réponds.');
    aside.convo.onEndpoint(end(4000));
    await tick();
    expect(aside.sounds).toHaveLength(1);
    expect(aside.calls).toEqual([]);
    // The sentence that asked nothing does not time the reply.
    expect(aside.events.filter((e) => e.type === 'latency')).toEqual([]);
  });

  it('he talks again before the reply even has a number: it is forgotten when it comes', async () => {
    const t = setup(NO_TRY);
    t.convo.onEndpoint(end(1000));
    t.convo.onEndpoint({ type: 'held' });
    t.convo.onEndpoint(end(4000));
    await tick();
    expect(t.calls).toEqual(['cut 110 ""']);
    t.say(110, 'Jamais dite.');
    t.say(111, 'La bonne.');
    await tick();
    expect(t.sounds).toHaveLength(1);
  });

  it('a sound while his sentence is still transcribed does not make that sentence forget itself', async () => {
    const t = setup(NO_TRY, ['Bonjour toi', 'Sous-titres par Amara.org']);
    t.convo.onEndpoint(end(1000));
    t.convo.onEndpoint({ type: 'held' });
    t.convo.onEndpoint(end(4000));
    await tick();
    t.say(110, 'Je réponds.');
    await tick();
    expect(t.calls).toEqual([]);
    expect(t.sounds).toHaveLength(1);
  });

  it('the microphone stops in the middle of his sentence: the reply held back comes out', async () => {
    const t = setup(NO_TRY);
    t.convo.onEndpoint(end(1000));
    await tick();
    t.convo.onEndpoint({ type: 'held' });
    t.say(110, 'Je réponds.');
    await tick();
    expect(t.sounds).toHaveLength(0);
    t.convo.stopListening();
    await tick();
    expect(t.sounds).toHaveLength(1);
    expect(t.calls).toEqual([]);
  });

  it('a reply the mute kept silent is not one to take back later', async () => {
    let muted = false;
    const t = setup(NO_TRY, 'Bonjour toi', () => muted);
    t.convo.onEndpoint(end(1000));
    await tick();
    muted = true;
    t.convo.mute();
    t.say(110, 'Personne ne l’entend.');
    muted = false;
    t.convo.onEndpoint({ type: 'held' });
    t.convo.onEndpoint(end(9000));
    await tick();
    expect(t.calls).toEqual([]);
  });

  it('a sentence that was not for her does not hide the reply still on its way from the next one', async () => {
    const t = setup(NO_TRY, ['Bonjour toi', 'Sous-titres par Amara.org', 'Bonjour toi']);
    t.convo.onEndpoint(end(1000));
    await tick();
    t.convo.onEndpoint(end(2000));
    await tick();
    t.convo.onEndpoint({ type: 'held' });
    t.convo.onEndpoint(end(4000));
    await tick();
    expect(t.calls).toEqual(['cut 110 ""']);
  });

  /** Each transcription waits for `give`, numbered from 0 in the order of the sentences that ended; an error fails it. */
  function verdicts() {
    const waiting: ((text: string | Error) => void)[] = [];
    const stt = (): Promise<Heard> =>
      new Promise((ok, fail) =>
        waiting.push((text) => (text instanceof Error ? fail(text) : ok({ text, confidence: 0.9 }))),
      );
    return { stt, give: (i: number, text: string | Error) => waiting[i]!(text) };
  }
  const ASIDE = 'Sous-titres par Amara.org';

  /** Her reply 110 is on its way; sentences A then B both end before either has a verdict. */
  async function twoEnded() {
    const v = verdicts();
    const t = setup(NO_TRY, v.stt);
    t.convo.onEndpoint(end(1000));
    v.give(0, 'Bonjour toi');
    await tick();
    t.convo.onEndpoint({ type: 'held' });
    t.convo.onEndpoint(end(2000));
    t.convo.onEndpoint({ type: 'held' });
    t.convo.onEndpoint(end(3000));
    return { ...v, t };
  }

  it('a reply held back waits for every sentence that ended: the later one for her forgets it', async () => {
    const { t, give } = await twoEnded();
    give(1, ASIDE);
    await tick();
    t.say(110, 'Je réponds.');
    await tick();
    expect(t.sounds).toHaveLength(0);
    expect(t.calls).toEqual([]);
    give(2, 'Bonjour toi');
    await tick();
    expect(t.calls).toEqual(['cut 110 ""']);
    expect(t.sounds).toHaveLength(0);
  });

  it('the later one asks nothing too: it comes out once, after the last verdict', async () => {
    const { t, give } = await twoEnded();
    give(1, ASIDE);
    await tick();
    t.say(110, 'Je réponds.');
    await tick();
    expect(t.sounds).toHaveLength(0);
    give(2, ASIDE);
    await tick();
    expect(t.sounds).toHaveLength(1);
    expect(t.calls).toEqual([]);
    expect(t.trace.events.filter((e) => e.name === 'relachee')).toHaveLength(1);
  });

  it('the sound that held it back was its own sentence: the next sentence still holds a reply back', async () => {
    const v = verdicts();
    const t = setup(NO_TRY, v.stt);
    t.convo.onEndpoint(end(1000));
    // Held while its own sentence is still transcribed: it had no reply to hold.
    t.convo.onEndpoint({ type: 'held' });
    t.convo.onEndpoint(end(2000));
    v.give(0, ASIDE);
    await tick();
    // The next sentence asks (its reply is 110: the first send), and a third voice must hold it back in its turn.
    t.convo.onEndpoint({ type: 'held' });
    v.give(1, 'Bonjour toi');
    await tick();
    t.say(110, 'Je réponds.');
    await tick();
    expect(t.sounds).toHaveLength(0);
    t.convo.onEndpoint(end(5000));
    v.give(2, ASIDE);
    await tick();
    expect(t.sounds).toHaveLength(1);
    expect(t.calls).toEqual([]);
  });

  it('a verdict after the next sentence began does not resume her over it', async () => {
    const t = await suspended({}, ASIDE);
    t.convo.onEndpoint(ended);
    t.convo.onEndpoint({ type: 'start' });
    await tick();
    await resumed();
    expect(t.sounds).toHaveLength(1);
    expect(t.calls).toEqual(['sound stop']);
    // That sentence was only a noise: now nothing is said, and she goes on.
    t.convo.onEndpoint({ type: 'noise' });
    await tick();
    await resumed();
    expect(t.sounds).toHaveLength(2);
  });

  it('held back by its own sound, a sentence for her still answers once the later one asked nothing', async () => {
    const aside = verdicts();
    const later = setup(NO_TRY, aside.stt);
    later.convo.onEndpoint(end(1000));
    later.convo.onEndpoint({ type: 'held' });
    later.convo.onEndpoint(end(2000));
    aside.give(1, ASIDE);
    await tick();
    aside.give(0, 'Bonjour toi');
    await tick();
    later.say(110, 'Je réponds.');
    await tick();
    expect(later.sounds).toHaveLength(1);

    // The later sound was only a noise.
    const cough = verdicts();
    const noise = setup(NO_TRY, cough.stt);
    noise.convo.onEndpoint(end(1000));
    noise.convo.onEndpoint({ type: 'held' });
    noise.convo.onEndpoint({ type: 'noise' });
    cough.give(0, 'Bonjour toi');
    await tick();
    noise.say(110, 'Je réponds.');
    await tick();
    expect(noise.sounds).toHaveLength(1);
  });

  it('a sentence begun after the last verdict still holds the reply back, until it is only a noise', async () => {
    const v = verdicts();
    const t = setup(NO_TRY, v.stt);
    t.convo.onEndpoint(end(1000));
    v.give(0, 'Bonjour toi');
    await tick();
    t.convo.onEndpoint({ type: 'held' });
    t.convo.onEndpoint(end(2000));
    t.convo.onEndpoint({ type: 'start' });
    v.give(1, ASIDE);
    await tick();
    t.say(110, 'Je réponds.');
    await tick();
    expect(t.sounds).toHaveLength(0);
    t.convo.onEndpoint({ type: 'noise' });
    await tick();
    expect(t.sounds).toHaveLength(1);
    // The sentence that asked nothing does not time the reply, even though a noise let it out.
    expect(t.events.filter((e) => e.type === 'latency')).toEqual([]);
  });

  it('a late verdict for a sentence already replaced takes back nothing said since', async () => {
    // C judged before A, or after.
    for (const cLast of [false, true]) {
      // A is for her and slow; B holds it back and is judged for her first (110); C holds 110 back and asks nothing.
      const v = verdicts();
      const t = setup(NO_TRY, v.stt);
      t.convo.onEndpoint(end(1000));
      t.convo.onEndpoint({ type: 'held' });
      t.convo.onEndpoint(end(2000));
      v.give(1, 'Bonjour toi');
      await tick();
      t.convo.onEndpoint({ type: 'start' });
      t.convo.onEndpoint({ type: 'held' });
      t.convo.onEndpoint(end(3000));
      const late: [number, string][] = [
        [2, ASIDE],
        [0, 'Bonjour toi'],
      ];
      for (const [i, text] of cLast ? late.reverse() : late) {
        v.give(i, text);
        await tick();
      }
      t.say(110, 'Pour B.');
      t.say(111, 'Pour A.');
      await tick();
      expect(t.sounds, `C last: ${cLast}`).toHaveLength(1);
      expect(t.calls, `C last: ${cLast}`).toEqual(['cut 111 ""']);
    }
  });

  it('nor does it stop the clock of the newer sentence: its reply is still timed', async () => {
    const v = verdicts();
    const t = setup(NO_TRY, v.stt);
    t.convo.onEndpoint(end(1000));
    t.convo.onEndpoint({ type: 'held' });
    t.convo.onEndpoint(end(2000));
    v.give(1, 'Bonjour toi');
    await tick();
    // A cough holds 110 back while A is still transcribed.
    for (const type of ['start', 'held', 'noise'] as const) t.convo.onEndpoint({ type });
    v.give(0, 'Bonjour toi');
    await tick();
    t.say(110, 'Pour B.');
    await tick();
    expect(t.sounds).toHaveLength(1);
    expect(t.events.filter((e) => e.type === 'latency')).toHaveLength(1);
  });

  it('nor does it cut the newer reply as it sounds', async () => {
    const v = verdicts();
    const t = setup(NO_TRY, v.stt);
    t.convo.onEndpoint(end(1000));
    t.convo.onEndpoint({ type: 'held' });
    t.convo.onEndpoint(end(2000));
    v.give(1, 'Bonjour toi');
    await tick();
    t.say(110, 'Pour B.');
    await tick();
    expect(t.sounds).toHaveLength(1);
    v.give(0, 'Bonjour toi');
    await tick();
    expect(t.calls).toEqual(['cut 111 ""']);
  });

  /** Sentences 0 to 2 are said (`said`) in order, each judged (`judged`) after it ended, in any order between them. */
  function timelines(): string[][] {
    const out: string[][] = [];
    const grow = (line: string[], said: number, judged: number[]) => {
      if (line.length === 6) return void out.push(line);
      if (said < 3) grow([...line, `said${said}`], said + 1, judged);
      for (const k of [0, 1, 2])
        if (k < said && !judged.includes(k)) grow([...line, `judged${k}`], said, [...judged, k]);
    };
    grow([], 0, []);
    return out;
  }
  const HEARD = { elle: 'Bonjour toi', rien: ASIDE, panne: new Error('panne') };
  type Heard3 = keyof typeof HEARD;
  const kinds = Object.keys(HEARD) as Heard3[];
  /** A reply already on its way, or not; what each of the three sentences turns out to be. */
  const lastVerdicts = [false, true].flatMap((ahead) =>
    kinds.flatMap((a) => kinds.flatMap((b) => kinds.map((c) => ({ ahead, said: [a, b, c] })))),
  );

  it.each(lastVerdicts)(
    'after the last verdict, nothing open: the last sentence for her answers, and every reply sounds or is ' +
      'forgotten (ahead $ahead, $said, every order of verdicts, a cough anywhere)',
    async ({ ahead, said }) => {
      // Nothing here waits on a timer: the turn of the loop after every promise is enough.
      const settle = () => new Promise<void>((ok) => setImmediate(ok));
      for (const line of timelines())
        for (let cough = -1; cough < line.length; cough++) {
          const name = `${line.join(' ')}, cough before ${line[cough] ?? 'nothing'}`;
          const v = verdicts();
          const t = setup(NO_TRY, v.stt);
          // The sentences for her, in the order they were sent; -1 is the reply already on its way.
          const sent: number[] = [];
          let n = 0;
          if (ahead) {
            t.convo.onEndpoint(end(500));
            v.give(n++, 'Bonjour toi');
            sent.push(-1);
            await settle();
          }
          const first = n;
          for (const [i, step] of line.entries()) {
            if (cough === i)
              for (const type of ['start', 'held', 'noise'] as const) t.convo.onEndpoint({ type });
            const k = Number(step.at(-1));
            if (step.startsWith('said')) {
              for (const type of ['start', 'held'] as const) t.convo.onEndpoint({ type });
              t.convo.onEndpoint(end(1000 * (k + 1)));
            } else {
              v.give(first + k, HEARD[said[k]!]);
              if (said[k] === 'elle') sent.push(k);
            }
            await settle();
          }
          for (let r = 0; r < t.sends.length; r++) {
            t.say(110 + r, `Réponse ${r}.`);
            t.convo.onLive({ type: 'speech-end', id: 110 + r, why: 'reply' });
          }
          await settle();
          for (let s = 0; s < t.sounds.length; s++) {
            t.sounds[s]!.end();
            await settle();
          }
          expect(t.sends, name).toHaveLength(sent.length);
          const cut = t.calls.filter((c) => c.startsWith('cut ')).length;
          expect(t.sounds.length + cut, name).toBe(t.sends.length);
          if (sent.length === 0) continue;
          const sounded = t.trace.events.filter((e) => e.name === 'premier_son').map((e) => e.reponse);
          expect(sounded, name).toContain(110 + sent.indexOf(Math.max(...sent)));
        }
    },
  );

  const thinkingOf = (events: ConversationEvent[]) =>
    events.filter((e) => e.type === 'thinking').at(-1) ?? { type: 'thinking', on: false };
  /** Which of the replies, in the order they were sent, end in error: none, all, the first, or the one of the last sentence. */
  const WHICH = ['none', 'all', 'first', 'last'] as const;
  const errorRuns = [true, false].flatMap((soon) =>
    WHICH.flatMap((which) => lastVerdicts.map((c) => ({ ...c, which, soon }))).filter(
      (c) => !(c.which === 'none' && c.soon),
    ),
  );

  it.each(errorRuns)(
    'the reply of a sentence ends in error: nothing stays held, the last one for her still answers, and each ' +
      'error is said at most once (ahead $ahead, $said, errors on $which, $soon, every order, a cough anywhere)',
    async ({ ahead, said, which, soon }) => {
      const settle = () => new Promise<void>((ok) => setImmediate(ok));
      for (const line of timelines())
        for (let cough = -1; cough < line.length; cough++) {
          const name = `${line.join(' ')}, cough before ${line[cough] ?? 'nothing'}`;
          const v = verdicts();
          const t = setup(NO_TRY, v.stt);
          const sent: number[] = [];
          const errored = new Set<number>();
          const fail = (r: number) => {
            errored.add(r);
            t.sends[r]!.on({
              type: 'done',
              message: { ...message(10 + r), status: 'error', error: 'Plafond atteint' },
            });
          };
          /** Whether the reply sent as `r` (of the `sent.length` so far) is one that errs. */
          const errs = (r: number, last: boolean) =>
            which === 'all' || (which === 'first' ? r === 0 : which === 'last' && last);
          let n = 0;
          if (ahead) {
            t.convo.onEndpoint(end(500));
            v.give(n++, 'Bonjour toi');
            sent.push(-1);
            await settle();
            if (soon && errs(0, false)) fail(0);
          }
          const first = n;
          for (const [i, step] of line.entries()) {
            if (cough === i)
              for (const type of ['start', 'held', 'noise'] as const) t.convo.onEndpoint({ type });
            const k = Number(step.at(-1));
            if (step.startsWith('said')) {
              for (const type of ['start', 'held'] as const) t.convo.onEndpoint({ type });
              t.convo.onEndpoint(end(1000 * (k + 1)));
            } else {
              v.give(first + k, HEARD[said[k]!]);
              if (said[k] === 'elle') sent.push(k);
            }
            await settle();
            // Its error comes as soon as it is sent; whether it is the last for her is only known at the end.
            if (soon && step.startsWith('judged') && said[k] === 'elle' && errs(sent.length - 1, false))
              fail(sent.length - 1);
          }
          const lastReply = sent.length ? sent.indexOf(Math.max(...sent)) : -1;
          for (let r = 0; r < t.sends.length; r++) {
            if (errored.has(r)) continue;
            if (errs(r, r === lastReply)) fail(r);
            else {
              t.say(110 + r, `Réponse ${r}.`);
              t.convo.onLive({ type: 'speech-end', id: 110 + r, why: 'reply' });
            }
          }
          await settle();
          for (let s = 0; s < t.sounds.length; s++) {
            t.sounds[s]!.end();
            await settle();
          }
          const sounded = () => t.trace.events.filter((e) => e.name === 'premier_son').map((e) => e.reponse);
          expect(t.sends, name).toHaveLength(sent.length);
          // Each reply that does not err sounds or is forgotten; one that errs never sounds.
          for (let r = 0; r < t.sends.length; r++) {
            if (errored.has(r)) expect(sounded(), `${name}, reply ${r} errs`).not.toContain(110 + r);
            else
              expect(
                sounded().includes(110 + r) || t.calls.some((c) => c.startsWith(`cut ${110 + r} `)),
                `${name}, reply ${r} sounds or is forgotten`,
              ).toBe(true);
          }
          if (lastReply >= 0 && !errored.has(lastReply)) expect(sounded(), name).toContain(110 + lastReply);
          // At most one message for each reply that erred.
          const messages = t.events.filter((e) => e.type === 'failed' && e.text === 'Plafond atteint');
          expect(messages.length, name).toBeLessThanOrEqual(errored.size);
          // Nothing is held, nothing waits: a sentence for her, once everything is over, is answered at once.
          expect(t.speaker.speaking, name).toBe(false);
          const before = t.sends.length;
          for (const type of ['start', 'held'] as const) t.convo.onEndpoint({ type });
          t.convo.onEndpoint(end(9000));
          v.give(first + 3, 'Bonjour toi');
          await settle();
          expect(t.sends, name).toHaveLength(before + 1);
          t.say(110 + before, 'Et ensuite.');
          t.convo.onLive({ type: 'speech-end', id: 110 + before, why: 'reply' });
          await settle();
          expect(sounded(), `${name}, the next sentence is answered`).toContain(110 + before);
          t.sounds.at(-1)!.end();
          await settle();
          expect(thinkingOf(t.events), name).toEqual({ type: 'thinking', on: false });
        }
    },
  );

  it('a reply already heard is never taken back afterwards', async () => {
    const t = setup(NO_TRY);
    t.convo.onEndpoint(end(1000));
    await tick();
    t.say(110, 'Entendue.');
    t.convo.onLive({ type: 'speech-end', id: 110, why: 'reply' });
    await tick();
    t.sounds[0]!.end();
    await tick();
    t.convo.onEndpoint({ type: 'held' });
    t.convo.onEndpoint(end(9000));
    await tick();
    expect(t.calls).toEqual([]);
  });

  it('barge-in off: a reply on its way is left alone', async () => {
    const t = setup({ ...NO_TRY, bargeIn: { ...DEFAULTS.bargeIn, on: false } });
    t.convo.onEndpoint(end(1000));
    await tick();
    t.convo.onEndpoint({ type: 'held' });
    t.say(110, 'Je réponds.');
    await tick();
    expect(t.sounds).toHaveLength(1);
    expect(t.calls).toEqual([]);
  });

  it('held voice suspends between two sentences of a long reply too', async () => {
    const t = setup();
    t.say(50, 'Première phrase.');
    await tick();
    t.sounds[0]!.end();
    // The next sentence has not come yet: nothing plays, and it is still her turn.
    t.convo.onEndpoint({ type: 'held' });
    t.convo.onEndpoint(ended);
    await tick();
    expect(t.calls).toEqual(['cut 50 "Première phrase."']);
  });

  it('the button says the same', async () => {
    const t = setup();
    t.say(50, 'Une phrase.');
    await tick();
    t.convo.silence();
    await tick();
    expect(t.calls).toContain('cut 50 "Une"');
  });

  describe('the wait before she resumes her voice', () => {
    // A false clock: `tick` would wait on it, `flush` lets what is due happen, `later` moves it.
    beforeEach(() => void vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
    afterEach(() => void vi.useRealTimers());
    const flush = () => vi.advanceTimersByTimeAsync(0);
    const later = (ms: number) => vi.advanceTimersByTimeAsync(ms);
    const WAIT = 300;
    /** The wait set on its own: `NO_TRY` for the sentences, `resumeMs` for her. */
    const waits = (resumeMs = WAIT) => ({ ...NO_TRY, bargeIn: { ...DEFAULTS.bargeIn, resumeMs } });
    const LONG = 'Une phrase assez longue pour être coupée.';
    /** She is in the middle of a long reply, and a voice holds over hers. */
    async function silenced(...args: Parameters<typeof setup>) {
      const t = setup(...args);
      t.say(50, LONG);
      t.say(50, 'La suite.');
      await flush();
      t.convo.onEndpoint({ type: 'held' });
      await flush();
      expect(t.calls).toEqual(['sound stop']);
      expect(t.sounds).toHaveLength(1);
      return t;
    }

    it('the settings of the tests below are the real ones: the default wait is 300 ms', async () => {
      const t = await silenced(NO_TRY);
      t.convo.onEndpoint({ type: 'noise' });
      await later(WAIT - 1);
      expect(t.sounds).toHaveLength(1);
      await later(1);
      expect(t.sounds).toHaveLength(2);
    });

    it('after a sound that was nothing she resumes resumeMs later; a start in that wait keeps her silent', async () => {
      const t = await silenced(waits());
      t.convo.onEndpoint({ type: 'noise' });
      await flush();
      expect(t.sounds).toHaveLength(1);
      await later(WAIT - 1);
      expect(t.sounds).toHaveLength(1);
      await later(1);
      expect(t.sounds).toHaveLength(2);

      // A sentence begins in the wait: no resumption, however long it lasts.
      const over = await silenced(waits());
      over.convo.onEndpoint({ type: 'noise' });
      await later(100);
      over.convo.onEndpoint({ type: 'start' });
      await later(5 * WAIT);
      expect(over.sounds).toHaveLength(1);
      // It was only a noise: the wait starts over, from now.
      over.convo.onEndpoint({ type: 'noise' });
      await later(WAIT - 1);
      expect(over.sounds).toHaveLength(1);
      await later(1);
      expect(over.sounds).toHaveLength(2);
    });

    it('a noise during the wait starts it again, and there is one timer only', async () => {
      const t = await silenced(waits());
      const base = vi.getTimerCount();
      t.convo.onEndpoint({ type: 'noise' });
      expect(vi.getTimerCount()).toBe(base + 1);
      await later(200);
      t.convo.onEndpoint({ type: 'noise' });
      expect(vi.getTimerCount()).toBe(base + 1);
      await later(WAIT - 200 + 1);
      // The first wait would have ended by now.
      expect(t.sounds).toHaveLength(1);
      await later(199 - 1);
      expect(t.sounds).toHaveLength(1);
      await later(1);
      expect(t.sounds).toHaveLength(2);
    });

    it('resumeMs 0 resumes at once, as before, and arms nothing', async () => {
      const t = await silenced(waits(0));
      const base = vi.getTimerCount();
      t.convo.onEndpoint({ type: 'noise' });
      // Before the flush: a timer of 0 ms would be gone after it.
      expect(vi.getTimerCount()).toBe(base);
      await flush();
      expect(t.sounds).toHaveLength(2);
      expect(vi.getTimerCount()).toBe(base);
    });

    it('resumeMs 0: she still does not resume while a sentence that ended waits for its verdict', async () => {
      const v = verdicts();
      const t = await silenced(waits(0), v.stt);
      t.convo.onEndpoint(end(1000));
      t.convo.onEndpoint({ type: 'noise' });
      await later(5 * WAIT);
      expect(t.sounds).toHaveLength(1);
      v.give(0, ASIDE);
      await flush();
      expect(t.sounds).toHaveLength(2);
      expect(t.calls).toEqual(['sound stop']);
    });

    it('the microphone stops: she resumes at once, in the wait too', async () => {
      const t = await silenced(waits());
      t.convo.stopListening();
      await flush();
      expect(t.sounds).toHaveLength(2);

      const during = await silenced(waits());
      during.convo.onEndpoint({ type: 'noise' });
      await later(100);
      const base = vi.getTimerCount();
      during.convo.stopListening();
      await flush();
      expect(during.sounds).toHaveLength(2);
      expect(vi.getTimerCount()).toBe(base - 1);
      await later(WAIT);
      expect(during.sounds).toHaveLength(2);
    });

    it('the button during the wait: nothing resumes, and its timer is cut', async () => {
      const t = await silenced(waits());
      const base = vi.getTimerCount();
      t.convo.onEndpoint({ type: 'noise' });
      expect(vi.getTimerCount()).toBe(base + 1);
      t.convo.silence();
      expect(vi.getTimerCount()).toBe(base);
      await later(5 * WAIT);
      expect(t.sounds).toHaveLength(1);
      expect(t.calls).toEqual(['sound stop', 'cut 50 "Une phrase assez"']);
    });

    it('a sentence for her in the wait: nothing resumes, its timer is cut, a later suspension waits its own time', async () => {
      const t = await silenced(waits());
      const base = vi.getTimerCount();
      t.convo.onEndpoint({ type: 'noise' });
      expect(vi.getTimerCount()).toBe(base + 1);
      await later(100);
      // A word too short to hold her, said in the wait, and for her.
      t.convo.onEndpoint(end(1000));
      await flush();
      expect(t.calls).toEqual(['sound stop', 'cut 50 "Une phrase assez"']);
      t.say(110, 'Oui ?');
      await flush();
      expect(t.sounds).toHaveLength(2);
      // The first wait would have ended at 300: it was cut with her voice.
      await later(WAIT);
      expect(t.sounds).toHaveLength(2);
      expect(vi.getTimerCount()).toBe(base);
      // Held over her answer, and nothing after it: she stays silent, however long.
      t.convo.onEndpoint({ type: 'held' });
      await later(5 * WAIT);
      expect(t.sounds).toHaveLength(2);
      expect(t.calls).toEqual(['sound stop', 'cut 50 "Une phrase assez"', 'sound stop']);
    });

    it('a reply held back is let out at once: only her own voice waits', async () => {
      const t = setup(waits(), 'Bonjour toi');
      t.convo.onEndpoint(end(1000));
      await flush();
      t.convo.onEndpoint({ type: 'held' });
      t.say(110, 'Je réponds.');
      await flush();
      expect(t.sounds).toHaveLength(0);
      t.convo.onEndpoint({ type: 'noise' });
      await flush();
      expect(t.sounds).toHaveLength(1);
      expect(t.trace.events.filter((e) => e.name === 'relachee')).toHaveLength(1);
      expect(t.calls).toEqual([]);
    });

    it('the sound that held it back was its own sentence: she still resumes resumeMs after the last verdict, not before, not never', async () => {
      const v = verdicts();
      const t = setup(waits(), v.stt);
      t.say(50, LONG);
      t.say(50, 'La suite.');
      await flush();
      t.convo.onEndpoint({ type: 'held' });
      // S1 ends, its verdict pending; S2's voice holds S1 back (S1 has no reply yet); S2 ends.
      t.convo.onEndpoint(end(1000));
      t.convo.onEndpoint({ type: 'held' });
      t.convo.onEndpoint(end(2000));
      v.give(1, ASIDE);
      await flush();
      await later(2 * WAIT);
      expect(t.sounds).toHaveLength(1);
      // S1, held back by S2's voice, is the last verdict: the path of « its own sentence ».
      v.give(0, ASIDE);
      await flush();
      expect(t.sounds).toHaveLength(1);
      await later(WAIT - 1);
      expect(t.sounds).toHaveLength(1);
      await later(1);
      expect(t.sounds).toHaveLength(2);
      expect(t.calls).toEqual(['sound stop']);
    });

    it('a sentence already replaced, judged late while a cough suspended her: she resumes resumeMs after that verdict', async () => {
      const v = verdicts();
      const t = setup(waits(), v.stt);
      // A is slow; B's voice holds it back, then B, for her, replaces it: its reply is 110.
      t.convo.onEndpoint(end(1000));
      t.convo.onEndpoint({ type: 'held' });
      t.convo.onEndpoint(end(2000));
      v.give(1, 'Bonjour toi');
      await flush();
      t.say(110, LONG);
      t.say(110, 'La suite.');
      await flush();
      expect(t.sounds).toHaveLength(1);
      // A cough over it, judged nothing: A, still unjudged, keeps her silent.
      t.convo.onEndpoint({ type: 'held' });
      t.convo.onEndpoint(end(3000));
      v.give(2, ASIDE);
      await flush();
      await later(2 * WAIT);
      expect(t.sounds).toHaveLength(1);
      // A, replaced already, is judged for her at last: as if it had asked nothing, and the wait starts now.
      v.give(0, 'Bonjour toi');
      await flush();
      expect(t.sounds).toHaveLength(1);
      await later(WAIT - 1);
      expect(t.sounds).toHaveLength(1);
      await later(1);
      expect(t.sounds).toHaveLength(2);
    });
  });
});

describe('what is said aloud', () => {
  it('each reason has its own switch; a reply always sounds', async () => {
    const t = setup({ speak: { ritual: false, p0: false, spontaneous: false } });
    for (const why of ['ritual', 'p0', 'spontaneous'] as const)
      t.convo.onLive({ type: 'speech', id: 1, n: 1, text: 'x', why });
    await tick();
    expect(t.sounds).toHaveLength(0);
    t.say(2, 'Oui.');
    await tick();
    expect(t.sounds).toHaveLength(1);
  });

  it('muted, only a P0 sounds, and only if its switch is on', async () => {
    const t = setup({}, 'Bonjour toi', () => true);
    for (const why of ['ritual', 'spontaneous', 'reply'] as const)
      t.convo.onLive({ type: 'speech', id: 1, n: 1, text: 'x', why });
    await tick();
    expect(t.sounds).toHaveLength(0);
    t.convo.onLive({ type: 'speech', id: 2, n: 1, text: 'Urgent : x.', why: 'p0' });
    await tick();
    expect(t.sounds).toHaveLength(1);
    const off = setup({ speak: { ...DEFAULTS.speak, p0: false } }, 'Bonjour toi', () => true);
    off.convo.onLive({ type: 'speech', id: 3, n: 1, text: 'Urgent : x.', why: 'p0' });
    await tick();
    expect(off.sounds).toHaveLength(0);
  });

  it('muted while a sentence is transcribed: it never leaves, and a held fragment is withdrawn', async () => {
    let muted = false;
    const t = setup(
      { endOfSpeech: { ...DEFAULTS.endOfSpeech, speculate: false } },
      'Bonjour toi',
      () => muted,
    );
    t.convo.onEndpoint({ type: 'end', audio: AUDIO, lastVoiceAt: 1000 });
    muted = true;
    await tick();
    expect(t.sends).toHaveLength(0);

    muted = false;
    const s = setup({}, 'Bonjour toi', () => muted);
    s.convo.onEndpoint({ type: 'pause', audio: AUDIO });
    await tick();
    muted = true;
    s.convo.mute();
    await tick();
    expect(s.calls).toEqual(['withdraw 10']);
  });

  it('a failed turn is said, not swallowed', async () => {
    const t = setup({ endOfSpeech: { ...DEFAULTS.endOfSpeech, speculate: false } });
    t.convo.onEndpoint({ type: 'end', audio: AUDIO, lastVoiceAt: 1000 });
    await tick();
    t.sends[0]!.on({
      type: 'done',
      message: { ...message(1), status: 'error', error: 'Plafond atteint' },
    });
    expect(t.events).toContainEqual({ type: 'failed', text: 'Plafond atteint' });
  });

  it('a written message the server refuses is not swallowed', async () => {
    const t = setup({}, 'Bonjour toi', () => false, 'Plafond atteint');
    await expect(t.convo.write('Salut')).rejects.toThrow('Plafond atteint');
  });

  it('a failed transcription on the pause leaves nothing thinking once the sentence ends', async () => {
    const t = setup({}, new Error('le service voix ne répond pas'));
    t.convo.onEndpoint({ type: 'pause', audio: AUDIO });
    await tick();
    t.convo.onEndpoint({ type: 'end', audio: AUDIO, lastVoiceAt: 1000 });
    await tick();
    const thinking = t.events.filter((e) => e.type === 'thinking');
    expect(thinking.at(-1) ?? { type: 'thinking', on: false }).toEqual({ type: 'thinking', on: false });
    expect(t.events.filter((e) => e.type === 'failed')).toHaveLength(1);
  });

  it('a failed transcription says so, and nothing is sent', async () => {
    const t = setup(
      { endOfSpeech: { ...DEFAULTS.endOfSpeech, speculate: false } },
      new Error('le service voix ne répond pas'),
    );
    t.convo.onEndpoint({ type: 'end', audio: AUDIO, lastVoiceAt: 1000 });
    await tick();
    expect(t.sends).toHaveLength(0);
    expect(t.events).toContainEqual({
      type: 'failed',
      text: 'Ta phrase n’a pas pu être transcrite : le service voix ne répond pas',
    });
  });
});

describe('the sentence sent before its end has bounds', () => {
  const pause = { type: 'pause', audio: AUDIO } as const;

  it('three tries in a sentence, not a fourth; its end still answers', async () => {
    const t = setup();
    t.convo.onEndpoint({ type: 'start' });
    for (let i = 0; i < 4; i++) {
      t.convo.onEndpoint(pause);
      await tick();
      t.convo.onEndpoint({ type: 'resume' });
    }
    expect(t.sends).toHaveLength(3);
    t.convo.onEndpoint({ type: 'end', audio: AUDIO, lastVoiceAt: 1000 });
    await tick();
    expect(t.sends).toHaveLength(4);
    t.say(113, 'Je réponds.');
    await tick();
    expect(t.sounds).toHaveLength(1);
  });

  it('no try past ten seconds of a sentence; the next sentence is tried again', async () => {
    const t = setup();
    t.convo.onEndpoint({ type: 'start' });
    t.advance(12_000);
    t.convo.onEndpoint(pause);
    await tick();
    expect(t.sends).toHaveLength(0);
    t.convo.onEndpoint({ type: 'end', audio: AUDIO, lastVoiceAt: 1000 });
    await tick();
    expect(t.sends).toHaveLength(1);
    t.convo.onEndpoint({ type: 'start' });
    t.convo.onEndpoint(pause);
    await tick();
    expect(t.sends).toHaveLength(2);
  });
});

describe('nothing waits without end: the guards', () => {
  // A false clock: `tick` would wait on it, `flush` lets what is due happen.
  beforeEach(() => void vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => void vi.useRealTimers());
  const flush = () => vi.advanceTimersByTimeAsync(0);
  const pause = { type: 'pause', audio: AUDIO } as const;
  const ended = { type: 'end', audio: AUDIO, lastVoiceAt: 1000 } as const;
  const thinking = (t: ReturnType<typeof setup>) => t.events.filter((e) => e.type === 'thinking');
  const named = (t: ReturnType<typeof setup>, name: string) => t.trace.events.filter((e) => e.name === name);
  const never = () => new Promise<never>(() => {});
  /** A fragment at the pause, then the end of its sentence. */
  const sentence = async (t: ReturnType<typeof setup>) => {
    t.convo.onEndpoint(pause);
    await flush();
    t.convo.onEndpoint(ended);
    await flush();
  };

  it('a transcription that never answers: at 20 s, nothing thinks, it is said once, its request is cut', async () => {
    let signal: AbortSignal | undefined;
    const t = setup({}, (s) => {
      signal = s;
      return never();
    });
    await sentence(t);
    expect(thinking(t).at(-1)).toEqual({ type: 'thinking', on: true });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(thinking(t).at(-1)).toEqual({ type: 'thinking', on: false });
    expect(t.events.filter((e) => e.type === 'failed')).toHaveLength(1);
    expect(signal?.aborted).toBe(true);
  });

  it('a send whose first sentence never comes: at 60 s, nothing thinks, its reply is cut, his message stays', async () => {
    const t = setup();
    await sentence(t);
    expect(thinking(t).at(-1)).toEqual({ type: 'thinking', on: true });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(thinking(t).at(-1)).toEqual({ type: 'thinking', on: false });
    expect(t.calls).toEqual(['cut 110 ""']);
    expect(named(t, 'sans_reponse')).toHaveLength(1);
  });

  it('a try withdrawn: none of its guards goes off', async () => {
    let n = 0;
    // The first never answers; the second is sent, and its first sentence never comes.
    const t = setup({}, () =>
      n++ === 0 ? never() : Promise.resolve({ text: 'Bonjour toi', confidence: 0.9 }),
    );
    t.convo.onEndpoint(pause);
    await flush();
    t.convo.onEndpoint({ type: 'resume' });
    t.convo.onEndpoint(pause);
    await flush();
    t.convo.onEndpoint({ type: 'resume' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.calls).toEqual(['withdraw 10']);
    expect(t.events.filter((e) => e.type === 'failed' || e.type === 'thinking')).toEqual([]);
    expect(named(t, 'sans_reponse')).toEqual([]);
  });

  it('a number that comes after the guard is forgotten: cut, and never said', async () => {
    const t = setup({}, 'Bonjour toi', () => false, undefined, undefined, [
      async (on, id) => {
        on({ type: 'user', message: message(id) });
        return never();
      },
    ]);
    await sentence(t);
    await vi.advanceTimersByTimeAsync(60_000);
    t.sends[0]!.on({ type: 'reply', id: 110 });
    t.say(110, 'Trop tard.');
    await flush();
    expect(t.calls).toEqual(['cut 110 ""']);
    expect(t.sounds).toHaveLength(0);
  });

  it('a fragment whose stream breaks after its number: the next reply sounds at once, not after the guard', async () => {
    const t = setup({}, 'Bonjour toi', () => false, undefined, undefined, [
      async (on, id) => {
        on({ type: 'user', message: message(id) });
        on({ type: 'reply', id: id + 100 });
        throw new Error('flux coupé');
      },
    ]);
    await sentence(t);
    // The next sentence has its reply.
    await sentence(t);
    t.say(111, 'Je réponds.');
    await flush();
    expect(t.sounds).toHaveLength(1);
    // Its guard is off: nothing is said, written or cut a minute later.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.events.filter((e) => e.type === 'failed')).toHaveLength(1);
    expect(named(t, 'sans_reponse')).toHaveLength(1);
    expect(t.calls).toEqual([]);
  });

  it('a sentence held back while it is transcribed, then replaced: it still fails at 20 s, and she goes on', async () => {
    const signals: (AbortSignal | undefined)[] = [];
    // The first never answers; the second is for her.
    const t = setup({ endOfSpeech: { ...DEFAULTS.endOfSpeech, speculate: false } }, (s) => {
      signals.push(s);
      return signals.length === 1 ? never() : Promise.resolve({ text: 'Bonjour toi', confidence: 0.9 });
    });
    t.convo.onEndpoint(ended);
    await flush();
    // He talks again while she is silent: the first is held back, then the second replaces it.
    t.convo.onEndpoint({ type: 'held' });
    t.convo.onEndpoint(ended);
    await flush();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(named(t, 'transcrite').filter((e) => e['echec'])).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
    // Her reply to the second, a cough over it: nothing waits on the first any more, she goes on.
    t.say(110, 'Une phrase assez longue pour être coupée.');
    t.say(110, 'La suite.');
    await flush();
    t.convo.onEndpoint({ type: 'held' });
    t.convo.onEndpoint({ type: 'noise' });
    await flush();
    await vi.advanceTimersByTimeAsync(DEFAULTS.bargeIn.resumeMs);
    expect(t.sounds).toHaveLength(2);
  });

  it.each([
    ['a reply held back passes its guard', () => vi.advanceTimersByTimeAsync(1_000)],
    [
      'a reply held back whose stream breaks',
      async (_, fail) => {
        fail(new Error('flux coupé'));
        await flush();
      },
    ],
    [
      'a reply held back that ends in error',
      async (t) => {
        t.sends[0]!.on({
          type: 'done',
          message: { ...message(10), status: 'error', error: 'Plafond atteint' },
        });
        await flush();
      },
    ],
  ] as [string, (t: ReturnType<typeof setup>, fail: (err: Error) => void) => Promise<unknown>][])(
    '%s while the next sentence is transcribed, which asks nothing: a cough holds nothing back, nothing thinks',
    async (_, dies) => {
      let n = 0;
      let fail!: (err: Error) => void;
      let aside!: (h: Heard) => void;
      // The first is for her; the second comes back once the first is dead, and asks nothing.
      const t = setup(
        { endOfSpeech: { ...DEFAULTS.endOfSpeech, speculate: false } },
        () =>
          n++ === 0
            ? Promise.resolve({ text: 'Bonjour toi', confidence: 0.9 })
            : new Promise<Heard>((r) => (aside = r)),
        () => false,
        undefined,
        undefined,
        [
          async (on, id) => {
            on({ type: 'user', message: message(id) });
            on({ type: 'reply', id: id + 100 });
            return new Promise<void>((_, reject) => (fail = reject));
          },
        ],
      );
      t.convo.onEndpoint(ended);
      await flush();
      // A second short of its guard: it can go off while the next is transcribed, before that one's own.
      await vi.advanceTimersByTimeAsync(59_000);
      // He talks again while she is silent: the first is held back.
      t.convo.onEndpoint({ type: 'held' });
      t.convo.onEndpoint(ended);
      await flush();
      await dies(t, fail);
      aside({ text: 'Sous-titres par Amara.org', confidence: 0.9 });
      await flush();
      t.convo.onEndpoint({ type: 'held' });
      t.convo.onEndpoint({ type: 'noise' });
      await flush();
      expect(thinking(t).at(-1)).toEqual({ type: 'thinking', on: false });
      expect(named(t, 'retenue')).toHaveLength(1);
    },
  );

  describe('the line of replies nobody heard: what dies, asks nothing or is heard leaves it at any rank', () => {
    const FOR: Heard = { text: 'Bonjour toi', confidence: 0.9 };
    const NOTHING: Heard = { text: 'Sous-titres par Amara.org', confidence: 0.9 };
    /** Each transcription waits to be given, in order; no reply ever comes unless told. */
    const line = () => {
      const give: ((h: Heard) => void)[] = [];
      const t = setup(
        { endOfSpeech: { ...DEFAULTS.endOfSpeech, speculate: false } },
        () => new Promise<Heard>((r) => give.push(r)),
        () => false,
        undefined,
        undefined,
        Array.from({ length: 5 }, () => async (on: (e: SendEvent) => void, id: number) => {
          on({ type: 'user', message: message(id) });
          on({ type: 'reply', id: id + 100 });
          return never();
        }),
      );
      return { ...t, give };
    };
    type Line = ReturnType<typeof line>;
    /** A sentence he holds, then ends; without `held`, too short to hold anything back. */
    const said = (t: Line, held = true) => {
      if (held) t.convo.onEndpoint({ type: 'held' });
      t.convo.onEndpoint(ended);
    };
    const cough = async (t: Line) => {
      t.convo.onEndpoint({ type: 'held' });
      t.convo.onEndpoint({ type: 'noise' });
      await flush();
    };
    /** The reply to the `k`-th send ends in error. */
    const errs = async (t: Line, k: number) => {
      t.sends[k]!.on({
        type: 'done',
        message: { ...message(10 + k), status: 'error', error: 'Plafond atteint' },
      });
      await flush();
    };

    it.each([
      ['passes its guard', () => vi.advanceTimersByTimeAsync(1_000)],
      ['ends in error', (t: Line) => errs(t, 0)],
    ] as [string, (t: Line) => Promise<unknown>][])(
      'a reply held back %s, third in line; the two sentences said since ask nothing: a cough holds nothing back',
      async (_, dies) => {
        const t = line();
        said(t);
        t.give[0]!(FOR);
        await flush();
        await vi.advanceTimersByTimeAsync(59_000);
        said(t);
        said(t);
        await flush();
        await dies(t);
        t.give[1]!(NOTHING);
        await flush();
        t.give[2]!(NOTHING);
        await flush();
        await cough(t);
        expect(thinking(t).at(-1)).toEqual({ type: 'thinking', on: false });
        expect(named(t, 'retenue')).toHaveLength(1);
      },
    );

    it.each([2, 3])(
      '%i sentences that ask nothing, all ended before a verdict: a cough lights nothing',
      async (n) => {
        const t = line();
        for (let i = 0; i < n; i++) said(t);
        await flush();
        for (let i = 0; i < n; i++) {
          t.give[i]!(NOTHING);
          await flush();
        }
        await cough(t);
        expect(thinking(t)).toEqual([]);
      },
    );

    it('a reply heard while it was third in line is never taken back after', async () => {
      const t = line();
      said(t);
      t.give[0]!(FOR);
      await flush();
      // A short one for her holds nothing back; the next holds it back.
      said(t, false);
      t.give[1]!(FOR);
      await flush();
      // The reply to the first is being made as the next is said: it sounds whole while that one is transcribed.
      t.say(110, 'Je réponds.');
      t.convo.onLive({ type: 'speech-end', id: 110, why: 'reply' });
      said(t);
      await flush();
      t.sounds[0]!.end();
      await flush();
      await errs(t, 1);
      t.give[2]!(NOTHING);
      await flush();
      await cough(t);
      expect(thinking(t).at(-1)).toEqual({ type: 'thinking', on: false });
      said(t);
      t.give[3]!(FOR);
      await flush();
      expect(t.calls).toEqual([]);
    });

    it('a reply further in the line outlives the one before it: the next sentence for her still replaces it', async () => {
      const t = line();
      said(t);
      t.give[0]!(FOR);
      await flush();
      said(t, false);
      t.give[1]!(FOR);
      await flush();
      said(t);
      await flush();
      // The reply to the second fails, the last asks nothing: the reply to the first is still on its way.
      await errs(t, 1);
      t.give[2]!(NOTHING);
      await flush();
      said(t);
      t.give[3]!(FOR);
      await flush();
      expect(t.calls).toEqual(['cut 110 ""']);
    });

    it('a reply replaced by a sentence judged before the one between: it is never held back again', async () => {
      const t = line();
      said(t);
      t.give[0]!(FOR);
      await flush();
      said(t);
      said(t);
      await flush();
      // The last is for her and replaces the first; the one between asks nothing; the reply to the last fails.
      t.give[2]!(FOR);
      await flush();
      t.give[1]!(NOTHING);
      await flush();
      await errs(t, 1);
      await cough(t);
      expect(thinking(t).at(-1)).toEqual({ type: 'thinking', on: false });
      expect(named(t, 'retenue')).toHaveLength(1);
    });
  });
});

describe('a reply that ends in error: one gesture, once nothing more will come of it', () => {
  // A false clock: `flush` lets what is due happen, and the guards are moved by their own durations.
  beforeEach(() => void vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => void vi.useRealTimers());
  const flush = () => vi.advanceTimersByTimeAsync(0);
  const pause = { type: 'pause', audio: AUDIO } as const;
  const ended = { type: 'end', audio: AUDIO, lastVoiceAt: 1000 } as const;
  const NO_TRY = { endOfSpeech: { ...DEFAULTS.endOfSpeech, speculate: false } };
  type T = ReturnType<typeof setup>;
  const named = (t: T, name: string) => t.trace.events.filter((e) => e.name === name);
  const thinking = (t: T) => t.events.filter((e) => e.type === 'thinking');
  const failed = (t: T) => t.events.filter((e) => e.type === 'failed');
  const said = (t: T) => t.events.filter((e) => e.type === 'said');
  /** A fragment at the pause, then the end of its sentence. */
  const sentence = async (t: T) => {
    t.convo.onEndpoint(pause);
    await flush();
    t.convo.onEndpoint(ended);
    await flush();
  };
  /** The reply to the `k`-th send ends in error, with no word and no end of speech: the server said nothing more. */
  const errs = async (t: T, k: number) => {
    t.sends[k]!.on({
      type: 'done',
      message: { ...message(10 + k), status: 'error', error: 'Plafond atteint' },
    });
    await flush();
  };
  /** A stream that numbers its reply, then ends in error, then breaks. */
  const errorThenBreak = async (on: (e: SendEvent) => void, id: number) => {
    on({ type: 'user', message: message(id) });
    on({ type: 'reply', id: id + 100 });
    on({ type: 'done', message: { ...message(id), status: 'error', error: 'Plafond atteint' } });
    throw new Error('flux coupé');
  };

  it('Q7: after its turn was released, with no end of speech, the next reply sounds', async () => {
    const t = setup();
    await sentence(t);
    await errs(t, 0);
    await sentence(t);
    t.say(111, 'Je réponds.');
    await flush();
    expect(t.sounds).toHaveLength(1);
  });

  it('what it said is said, then the turn is over: she falls silent once, and its late end changes nothing', async () => {
    const t = setup();
    await sentence(t);
    t.say(110, 'Une phrase.');
    await flush();
    expect(t.sounds).toHaveLength(1);
    await errs(t, 0);
    t.sounds[0]!.end();
    await flush();
    expect(said(t)).toHaveLength(1);
    expect(t.speaker.speaking).toBe(false);
    // Its end of speech comes after all: the turn is gone, nothing is made of it.
    t.convo.onLive({ type: 'speech-end', id: 110, why: 'reply' });
    await flush();
    expect(said(t)).toHaveLength(1);
    expect(t.speaker.speaking).toBe(false);
  });

  it('a reply said, then an empty turn in error behind it: one silent, and she is not speaking', async () => {
    const t = setup();
    await sentence(t);
    t.say(110, 'Une phrase.');
    t.convo.onLive({ type: 'speech-end', id: 110, why: 'reply' });
    await flush();
    await sentence(t);
    await errs(t, 1);
    t.sounds[0]!.end();
    await flush();
    expect(said(t)).toHaveLength(1);
    expect(t.speaker.speaking).toBe(false);
    t.convo.onLive({ type: 'speech-end', id: 111, why: 'reply' });
    await flush();
    expect(said(t)).toHaveLength(1);
  });

  it('an empty turn in error alone: no silent, nothing shown, and she is not speaking', async () => {
    const t = setup();
    await sentence(t);
    await errs(t, 0);
    expect(said(t)).toEqual([]);
    expect(t.speaker.speaking).toBe(false);
  });

  it('its end of speech comes late, after the error and with nothing said: still no silent', async () => {
    const t = setup();
    await sentence(t);
    await errs(t, 0);
    t.convo.onLive({ type: 'speech-end', id: 110, why: 'reply' });
    await flush();
    expect(said(t)).toEqual([]);
    expect(t.speaker.speaking).toBe(false);
    // And nothing waits in front of the next reply.
    await sentence(t);
    t.say(111, 'Je réponds.');
    await flush();
    expect(t.sounds).toHaveLength(1);
  });

  it.each([
    ['a fragment tried at the pause', {}],
    ['the sentence sent whole at its end', NO_TRY],
  ] as [string, Partial<Settings>][])(
    'Q8: an error, then a stream that throws (%s): one message, one sans_reponse, and nothing thinks',
    async (_, over) => {
      const t = setup(over, 'Bonjour toi', () => false, undefined, undefined, [errorThenBreak]);
      if (over === NO_TRY) {
        t.convo.onEndpoint(ended);
        await flush();
      } else await sentence(t);
      expect(failed(t)).toHaveLength(1);
      expect(named(t, 'sans_reponse')).toHaveLength(1);
      expect(thinking(t).at(-1) ?? { type: 'thinking', on: false }).toEqual({ type: 'thinking', on: false });
      // Its guard is off: a minute later nothing more is said, written or cut.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(failed(t)).toHaveLength(1);
      expect(named(t, 'sans_reponse')).toHaveLength(1);
      expect(t.calls).toEqual([]);
    },
  );

  it('a stream that breaks after its number: the next reply sounds at once, and one message is said', async () => {
    const t = setup({}, 'Bonjour toi', () => false, undefined, undefined, [
      async (on, id) => {
        on({ type: 'user', message: message(id) });
        on({ type: 'reply', id: id + 100 });
        throw new Error('flux coupé');
      },
    ]);
    await sentence(t);
    await sentence(t);
    t.say(111, 'Je réponds.');
    await flush();
    expect(t.sounds).toHaveLength(1);
    expect(failed(t)).toHaveLength(1);
    expect(named(t, 'sans_reponse')).toHaveLength(1);
  });

  it('a withdrawn fragment whose reply ends in error says nothing, writes nothing, lights nothing', async () => {
    const t = setup();
    t.convo.onEndpoint(pause);
    await flush();
    t.convo.onEndpoint({ type: 'resume' });
    await flush();
    expect(t.calls).toEqual(['withdraw 10']);
    const before = t.events.length;
    await errs(t, 0);
    expect(t.events.slice(before)).toEqual([]);
    expect(named(t, 'sans_reponse')).toEqual([]);
    // Its words, had it any, never sound; and the sentence that follows is answered.
    await sentence(t);
    t.say(111, 'Je réponds.');
    await flush();
    expect(t.sounds).toHaveLength(1);
  });

  it('a withdrawn fragment whose stream then breaks says nothing either', async () => {
    let breaks!: () => void;
    const t = setup({}, 'Bonjour toi', () => false, undefined, undefined, [
      async (on, id) => {
        on({ type: 'user', message: message(id) });
        on({ type: 'reply', id: id + 100 });
        await new Promise<void>((ok) => (breaks = ok));
        throw new Error('flux coupé');
      },
    ]);
    t.convo.onEndpoint(pause);
    await flush();
    t.convo.onEndpoint({ type: 'resume' });
    await flush();
    const before = t.events.length;
    breaks();
    await flush();
    expect(t.events.slice(before)).toEqual([]);
    expect(named(t, 'sans_reponse')).toEqual([]);
  });

  it('a replaced reply that ends in error says nothing, and the thinking of the new one stays on', async () => {
    const t = setup(NO_TRY);
    t.convo.onEndpoint(ended);
    await flush();
    // He talks again while she is silent: reply 110 is held back, then replaced by the sentence for her.
    t.convo.onEndpoint({ type: 'held' });
    t.convo.onEndpoint({ type: 'end', audio: AUDIO, lastVoiceAt: 4000 });
    await flush();
    expect(t.calls).toEqual(['cut 110 ""']);
    expect(thinking(t).at(-1)).toEqual({ type: 'thinking', on: true });
    const before = t.events.length;
    await errs(t, 0);
    expect(t.events.slice(before)).toEqual([]);
    expect(named(t, 'sans_reponse')).toEqual([]);
    expect(thinking(t).at(-1)).toEqual({ type: 'thinking', on: true });
    // Its own reply still sounds.
    t.say(111, 'La bonne.');
    await flush();
    expect(t.sounds).toHaveLength(1);
  });

  it('a fragment refused, then the sentence goes on and is answered: nothing is ever said of the refusal', async () => {
    const t = setup({}, 'Bonjour toi', () => false, undefined, undefined, [
      async () => {
        throw new Error('refusé');
      },
    ]);
    t.convo.onEndpoint(pause);
    await flush();
    expect(failed(t)).toEqual([]);
    t.convo.onEndpoint({ type: 'resume' });
    await flush();
    await sentence(t);
    t.say(111, 'Je réponds.');
    await flush();
    expect(t.sounds).toHaveLength(1);
    expect(failed(t)).toEqual([]);
    expect(named(t, 'sans_reponse')).toEqual([]);
  });

  it('a fragment refused, then its sentence ends: the refusal is said once, at the end, and nothing thinks', async () => {
    const t = setup({}, 'Bonjour toi', () => false, undefined, undefined, [
      async () => {
        throw new Error('refusé');
      },
    ]);
    t.convo.onEndpoint(pause);
    await flush();
    expect(failed(t)).toEqual([]);
    expect(named(t, 'sans_reponse')).toEqual([]);
    t.convo.onEndpoint(ended);
    await flush();
    expect(failed(t)).toEqual([{ type: 'failed', text: 'Sa réponse n’est pas venue : refusé' }]);
    expect(named(t, 'sans_reponse')).toHaveLength(1);
    expect(thinking(t).at(-1)).toEqual({ type: 'thinking', on: false });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(failed(t)).toHaveLength(1);
  });
});

describe('an urgency', () => {
  it('sounds before the rest of the reply under way', async () => {
    const t = setup();
    t.say(50, 'Un.');
    t.say(50, 'Deux.');
    await tick();
    t.convo.onLive({ type: 'speech', id: 60, n: 1, text: 'Alerte.', why: 'p0' });
    t.convo.onLive({ type: 'speech-end', id: 60, why: 'p0' });
    t.sounds[0]!.end();
    await tick();
    t.sounds[1]!.end();
    await tick();
    expect(t.sounds).toHaveLength(3);
    expect(t.events.filter((e) => e.type === 'said')).toHaveLength(0);
  });
});
