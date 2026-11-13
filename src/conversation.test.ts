import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Conversation, type ConversationEvent, type Heard } from './conversation.ts';
import type { Message, SendEvent } from './brain.ts';
import { DEFAULTS, type Settings } from './settings.ts';
import { Speaker, type Clip, type Output } from './speech/speaker.ts';
import { Trace } from './trace.ts';

const tick = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r));
};
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
    speaker: new Speaker(
      async () => CLIP,
      out,
      (e) => convo.onSpeaker(e),
    ),
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
  return { convo, calls, events, sounds, sends, say, advance, trace };
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
    const cough = await suspended();
    cough.convo.onEndpoint(ended);
    cough.convo.onEndpoint({ type: 'noise' });
    expect(cough.sounds).toHaveLength(1);
    await tick();
    expect(cough.calls).toEqual(['sound stop', 'cut 50 "Une phrase assez"']);

    const over = await suspended(FILTERED, ['On mange quoi ce soir', 'Sous-titres par Amara.org']);
    over.advance(20_000);
    over.convo.onEndpoint(ended);
    over.convo.onEndpoint({ type: 'held' });
    await tick();
    expect(over.sounds).toHaveLength(1);
    over.convo.onEndpoint(ended);
    await tick();
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

  it('a fragment whose stream breaks after its number holds her voice no longer than the guard', async () => {
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
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.sounds).toHaveLength(1);
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
