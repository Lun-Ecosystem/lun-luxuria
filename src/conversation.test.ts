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
  heard: string | Error = 'Bonjour toi',
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
      return { text: heard, confidence: 0.9 };
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
  it('held voice cuts, and the brain is told what the speaker heard', async () => {
    const t = setup();
    t.say(50, 'Une phrase assez longue pour être coupée.');
    await tick();
    t.convo.onEndpoint({ type: 'held' });
    await tick();
    expect(t.calls).toContain('sound stop');
    expect(t.calls).toContain('cut 50 "Une phrase assez"');
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
