import { describe, expect, it } from 'vitest';
import { Conversation, type ConversationEvent } from './conversation.ts';
import type { Message, SendEvent } from './brain.ts';
import { DEFAULTS, type Settings } from './settings.ts';
import { Speaker, type Clip, type Output } from './speech/speaker.ts';

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
  /** A list is one transcription per sentence, in order. */
  heard: string | Error | string[] = 'Bonjour toi',
  silenced = () => false,
  refuse?: string,
) {
  let clock = 1000;
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
        const id = ids++;
        on({ type: 'user', message: message(id) });
        on({ type: 'reply', id: id + 100 });
        if (refuse) on({ type: 'done', message: { ...message(id), status: 'error', error: refuse } });
      },
      cut: async (id, said) => void calls.push(`cut ${id} "${said}"`),
      withdraw: async (id) => void calls.push(`withdraw ${id}`),
    },
    stt: async () => {
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
  });
  const say = (id: number, text: string) => convo.onLive({ type: 'speech', id, n: 1, text, why: 'reply' });
  const advance = (ms: number) => (clock += ms);
  return { convo, calls, events, sounds, sends, say, advance };
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
    ['the mute', (t) => t.convo.mute(), undefined],
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
