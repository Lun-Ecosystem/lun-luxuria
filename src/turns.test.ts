import { describe, expect, it } from 'vitest';
import type { ReplyDurations, SendEvent } from './brain.ts';
import { Conversation } from './conversation.ts';
import type { EndpointEvent, Moment } from './listen/endpoint.ts';
import { DEFAULTS, type Settings } from './settings.ts';
import { Speaker, type Clip, type Output } from './speech/speaker.ts';
import { delays, Trace, type TraceEvent } from './trace.ts';

/** The trace each mechanism of the page writes, case by case. */

const tick = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r));
};
const AUDIO = new Float32Array(1);
const CLIP: Clip = { samples: new Float32Array(1), rate: 16000 };

function setup(heard: string[] = ['Bonjour toi'], over: Partial<Settings> = {}) {
  let clock = 1000;
  const trace = new Trace(() => clock);
  const sounds: { end: () => void; stopped: boolean }[] = [];
  let ids = 10;
  const latencies: { ms: number; speculated: boolean }[] = [];
  const turns: ((e: SendEvent) => void)[] = [];
  const out: Output = {
    play(_, onEnd) {
      const s = { end: onEnd, stopped: false };
      sounds.push(s);
      return { stop: () => void (s.stopped = true), heard: () => 0.5 };
    },
  };
  const convo: Conversation = new Conversation({
    brain: {
      send: async (text, _opts, on) => {
        turns.push(on);
        const id = ids++;
        on({ type: 'user', message: { id, role: 'user', text, status: 'ok', surface: 'voice', at: '' } });
        on({ type: 'reply', id: id + 100 });
      },
      cut: async () => {},
      withdraw: async () => {},
    },
    stt: async () => ({ text: heard.shift() ?? '', confidence: 0.9 }),
    speaker: new Speaker(
      async () => CLIP,
      out,
      (e) => convo.onSpeaker(e),
      trace,
    ),
    settings: () => ({ ...DEFAULTS, ...over }),
    layout: () => 'scene',
    keyHeld: () => false,
    now: () => clock,
    on: (e) => void (e.type === 'latency' && latencies.push(e)),
    trace,
  });
  /** A moment of the listening, its sound 20 ms before its decision. */
  const hear = (e: EndpointEvent) =>
    convo.onEndpoint({ ...e, at: clock - 20, decidedAt: clock } as EndpointEvent & Moment);
  const say = (id: number, text: string, why: 'reply' | 'ritual' = 'reply') =>
    convo.onLive({ type: 'speech', id, n: 1, text, why });
  const ends = (id: number) => convo.onLive({ type: 'speech-end', id, why: 'reply' });
  const advance = (ms: number) => (clock += ms);
  /** The last turn sent ends, with what the server measured of it. */
  const done = (id: number, durations?: ReplyDurations) =>
    turns.at(-1)!({
      type: 'done',
      message: {
        id,
        role: 'assistant',
        text: '',
        status: 'ok',
        surface: 'voice',
        at: '',
        ...(durations && { durations }),
      },
    });
  return { convo, trace, sounds, latencies, hear, say, ends, advance, done };
}

/** Each event as its name (and step), its sentence, its try, its reply. */
const seq = (events: readonly TraceEvent[]) =>
  events.map((e) =>
    [
      e['etape'] === undefined ? e.name : `${e.name}:${String(e['etape'])}`,
      e.phrase === undefined ? '' : `p${e.phrase}`,
      e.essai === undefined ? '' : `e${e.essai}`,
      e.reponse === undefined ? '' : `r${e.reponse}`,
    ]
      .filter(Boolean)
      .join(' '),
  );
const find = (t: { trace: Trace }, name: string) => t.trace.events.filter((e) => e.name === name);

describe('the trace of a turn', () => {
  it('a simple turn, from the first sound to her last word', async () => {
    const t = setup();
    t.hear({ type: 'start' });
    t.advance(500);
    t.hear({ type: 'held' });
    t.advance(700);
    t.hear({ type: 'end', audio: AUDIO, lastVoiceAt: 1480 });
    await tick();
    t.say(110, 'Salut.');
    t.ends(110);
    t.advance(300);
    await tick();
    t.sounds[0]!.end();
    await tick();
    expect(seq(t.trace.events)).toEqual([
      'voix p1',
      'tenue p1',
      'fin p1',
      'essai p1 e1',
      'transcrite p1 e1',
      'verdict p1 e1',
      'envoyee p1 e1',
      'numero p1 e1 r110',
      'phrase_recue p1 e1 r110',
      'fin_recue p1 e1 r110',
      'synthese:debut p1 e1 r110',
      'synthese:fin p1 e1 r110',
      'premier_son p1 e1 r110',
      'son:debut p1 e1 r110',
      'son:fin p1 e1 r110',
      'silence',
    ]);
    expect(find(t, 'fin')[0]).toMatchObject({ son: 2180, at: 2200, dernier_son: 1480 });
    expect(find(t, 'essai')[0]).toMatchObject({ final: true });
    expect(find(t, 'transcrite')[0]).toMatchObject({ texte: 'Bonjour toi', confiance: 0.9, longueur: 11 });
    expect(find(t, 'verdict')[0]).toMatchObject({ resultat: 'pour_elle' });
    expect(find(t, 'numero')[0]).toMatchObject({ message: 10 });
    expect(find(t, 'premier_son')[0]!.at).toBe(2500);
  });

  it('a try at a pause, withdrawn, made again, then confirmed by the end', async () => {
    const t = setup(['Bonjour', 'Bonjour toi']);
    t.hear({ type: 'start' });
    t.advance(300);
    t.hear({ type: 'pause', audio: AUDIO });
    await tick();
    t.hear({ type: 'resume' });
    t.advance(300);
    t.hear({ type: 'pause', audio: AUDIO });
    await tick();
    t.advance(540);
    t.hear({ type: 'end', audio: AUDIO, lastVoiceAt: 1600 });
    await tick();
    expect(seq(t.trace.events)).toEqual([
      'voix p1',
      'pause p1',
      'essai p1 e1',
      'transcrite p1 e1',
      'verdict p1 e1',
      'envoyee p1 e1',
      'numero p1 e1 r110',
      'reprise p1',
      'retiree p1 e1 r110',
      'pause p1',
      'essai p1 e2',
      'transcrite p1 e2',
      'verdict p1 e2',
      'envoyee p1 e2',
      'numero p1 e2 r111',
      'fin p1',
      'confirmee p1 e2 r111',
    ]);
    expect(find(t, 'essai').map((e) => e['final'])).toEqual([false, false]);
    expect(find(t, 'envoyee').map((e) => e['final'])).toEqual([false, false]);
  });

  it('a sentence the filter sets aside: its words are never written', async () => {
    const t = setup(['Il fait beau dehors'], { filter: { scene: true, small: true } });
    t.hear({ type: 'start' });
    t.advance(1200);
    t.hear({ type: 'end', audio: AUDIO, lastVoiceAt: 1500 });
    await tick();
    expect(seq(t.trace.events)).toEqual([
      'voix p1',
      'fin p1',
      'essai p1 e1',
      'transcrite p1 e1',
      'verdict p1 e1',
      'sans_reponse p1 e1',
    ]);
    expect(find(t, 'verdict')[0]).toMatchObject({ resultat: 'ecartee' });
    expect(find(t, 'transcrite')[0]).toMatchObject({ longueur: 19 });
    expect(t.trace.lines()).not.toMatch(/beau/);
  });

  it('a try at a pause passed the filter, the whole sentence did not: none of its words stay', async () => {
    const t = setup([`${DEFAULTS.agent.name} attends`, 'il fait beau dehors'], {
      filter: { scene: true, small: true },
    });
    t.hear({ type: 'start' });
    t.advance(300);
    t.hear({ type: 'pause', audio: AUDIO });
    await tick();
    expect(find(t, 'transcrite')[0]).toHaveProperty('texte');
    t.hear({ type: 'resume' });
    t.advance(1200);
    t.hear({ type: 'end', audio: AUDIO, lastVoiceAt: 2300 });
    await tick();
    expect(find(t, 'verdict').map((e) => e['resultat'])).toEqual(['pour_elle', 'ecartee']);
    expect(t.trace.lines()).not.toMatch(/"texte"|attends|beau/);
  });

  it('a noise: a sentence numbered, nothing tried', () => {
    const t = setup();
    t.hear({ type: 'start' });
    t.advance(700);
    t.hear({ type: 'noise' });
    expect(seq(t.trace.events)).toEqual(['voix p1', 'bruit p1']);
  });

  it('a sound over her voice suspends her, and she resumes when it was nothing', async () => {
    const t = setup();
    t.say(50, 'Une longue phrase.', 'ritual');
    await tick();
    t.hear({ type: 'start' });
    t.advance(400);
    t.hear({ type: 'held' });
    t.advance(300);
    t.hear({ type: 'noise' });
    await tick();
    expect(seq(t.trace.events)).toEqual([
      'phrase_recue r50',
      'synthese:debut r50',
      'synthese:fin r50',
      'premier_son r50',
      'son:debut r50',
      'voix p1',
      'tenue p1',
      'suspendue r50',
      'son:fin r50',
      'bruit p1',
      'reprise_voix r50',
      'son:debut r50',
    ]);
    // The suspension says which sentence caused it; the sound stopped by it, too.
    expect(find(t, 'suspendue')[0]).toMatchObject({ par: 1, doux: false });
    expect(find(t, 'son')[1]).toMatchObject({ arrete: true, par: 1 });
  });

  it('a clean cut: her sound stops at the hold, the sentence for her cuts the reply for good', async () => {
    const t = setup(['Arrête']);
    t.say(50, 'Une longue phrase.', 'ritual');
    await tick();
    t.hear({ type: 'start' });
    t.advance(400);
    t.hear({ type: 'held' });
    t.advance(700);
    t.hear({ type: 'end', audio: AUDIO, lastVoiceAt: 1400 });
    await tick();
    expect(seq(t.trace.events)).toEqual([
      'phrase_recue r50',
      'synthese:debut r50',
      'synthese:fin r50',
      'premier_son r50',
      'son:debut r50',
      'voix p1',
      'tenue p1',
      'suspendue r50',
      'son:fin r50',
      'fin p1',
      'essai p1 e1',
      'transcrite p1 e1',
      'verdict p1 e1',
      'silence',
      'coupee r50',
      'envoyee p1 e1',
      'numero p1 e1 r110',
    ]);
    expect(find(t, 'coupee')[0]).toMatchObject({ entendu: 'Une' });
  });

  it('each sound says which sentence of the reply it is, and the same again when said over', async () => {
    const t = setup();
    t.say(50, 'Une phrase.', 'ritual');
    t.convo.onLive({ type: 'speech', id: 50, n: 2, text: 'Une autre.', why: 'ritual' });
    await tick();
    t.sounds[0]!.end();
    await tick();
    t.hear({ type: 'start' });
    t.advance(400);
    t.hear({ type: 'held' });
    t.hear({ type: 'noise' });
    await tick();
    expect(find(t, 'son').map((e) => [e['etape'], e['rang']])).toEqual([
      ['debut', 1],
      ['fin', undefined],
      ['debut', 2],
      ['fin', undefined],
      ['debut', 2],
    ]);
  });

  it('a speech without a sentence is found by its reply alone', async () => {
    const t = setup();
    t.say(40, 'Bonjour.', 'ritual');
    t.ends(40);
    await tick();
    t.sounds[0]!.end();
    await tick();
    expect(seq(t.trace.events)).toEqual([
      'phrase_recue r40',
      'fin_recue r40',
      'synthese:debut r40',
      'synthese:fin r40',
      'premier_son r40',
      'son:debut r40',
      'son:fin r40',
      'silence',
    ]);
  });
});

describe('a reply held back while he talks again', () => {
  /** A first sentence sent and numbered (r110), then a second one held: its reply waits. */
  async function heldBack(heard: string[]) {
    const t = setup(heard);
    t.hear({ type: 'start' });
    t.advance(1200);
    t.hear({ type: 'end', audio: AUDIO, lastVoiceAt: 1480 });
    await tick();
    t.hear({ type: 'start' });
    t.advance(400);
    t.hear({ type: 'held' });
    t.advance(500);
    t.hear({ type: 'end', audio: AUDIO, lastVoiceAt: 2000 });
    await tick();
    return t;
  }

  it('is held back by the sentence that holds, and let go by one not for her', async () => {
    const t = await heldBack(['Bonjour toi', '']);
    expect(find(t, 'retenue')).toMatchObject([{ phrase: 1, essai: 1, reponse: 110, par: 2 }]);
    expect(find(t, 'relachee')).toMatchObject([{ phrase: 1, essai: 1, reponse: 110, par: 2 }]);
    expect(find(t, 'oubliee')).toEqual([]);
    expect(find(t, 'verdict').map((e) => e['resultat'])).toEqual(['pour_elle', 'bruit']);
  });

  it('is forgotten when the new sentence is for her, and the verdict says by which rule', async () => {
    const t = await heldBack(['Bonjour toi', 'Et demain ?']);
    expect(find(t, 'retenue')).toHaveLength(1);
    expect(find(t, 'relachee')).toEqual([]);
    expect(find(t, 'oubliee')).toMatchObject([{ phrase: 1, essai: 1, reponse: 110 }]);
    expect(find(t, 'verdict').map((e) => e['par'])).toEqual(['off', 'off']);
  });

  it('is not let go when the sentence held back is the one let go', async () => {
    const t = setup(['']);
    t.hear({ type: 'start' });
    t.advance(1200);
    t.hear({ type: 'end', audio: AUDIO, lastVoiceAt: 1480 });
    // Held while its own transcription is on its way: it has no reply yet.
    t.hear({ type: 'start' });
    t.advance(400);
    t.hear({ type: 'held' });
    await tick();
    expect(find(t, 'retenue')).toMatchObject([{ phrase: 1, essai: 1, par: 2 }]);
    expect(find(t, 'retenue')[0]!.reponse).toBeUndefined();
    expect(find(t, 'relachee')).toEqual([]);
  });

  it('the verdict names the rule when the filter is on', async () => {
    const t = setup([`${DEFAULTS.agent.name} viens`], { filter: { scene: true, small: true } });
    t.hear({ type: 'start' });
    t.advance(1200);
    t.hear({ type: 'end', audio: AUDIO, lastVoiceAt: 1500 });
    await tick();
    expect(find(t, 'verdict')[0]).toMatchObject({ resultat: 'pour_elle', par: 'nom' });
  });
});

describe("the server's durations", () => {
  it('are written under the turn when the finished reply carries them, and the delays read them', async () => {
    const t = setup();
    t.hear({ type: 'start' });
    t.advance(1200);
    t.hear({ type: 'end', audio: AUDIO, lastVoiceAt: 1480 });
    await tick();
    t.done(110, { queueMs: 4, firstWordMs: 320 });
    expect(find(t, 'durees')).toMatchObject([
      { phrase: 1, essai: 1, reponse: 110, queueMs: 4, firstWordMs: 320 },
    ]);
    expect(delays(t.trace.events)[0]!.ms).toMatchObject({ file_serveur: 4, premier_mot: 320 });
    expect(delays(t.trace.events)[0]!.ms).not.toHaveProperty('poste');
  });

  it('an older server gives none: nothing is written, nothing breaks', async () => {
    const t = setup();
    t.hear({ type: 'start' });
    t.advance(1200);
    t.hear({ type: 'end', audio: AUDIO, lastVoiceAt: 1480 });
    await tick();
    t.done(110);
    expect(find(t, 'durees')).toEqual([]);
  });

  it('a written message is found by its reply', async () => {
    const t = setup();
    await t.convo.write('Bonjour');
    t.done(110, { firstWordMs: 280 });
    expect(find(t, 'durees')).toMatchObject([{ reponse: 110, firstWordMs: 280 }]);
  });
});

describe('the blank of a turn, read from the trace', () => {
  it('is the measure of today, which is still given, on a sentence sent at its end', async () => {
    const t = setup();
    t.hear({ type: 'start' });
    t.advance(1200);
    t.hear({ type: 'end', audio: AUDIO, lastVoiceAt: 1480 });
    await tick();
    t.say(110, 'Salut.');
    t.advance(437);
    await tick();
    expect(t.latencies).toEqual([{ type: 'latency', ms: 1157, speculated: false }]);
    expect(delays(t.trace.events)[0]).toMatchObject({ aLEssai: false, ms: { blanc_de_tour: 1157 } });
  });

  it('and on a sentence tried at a pause', async () => {
    const t = setup();
    t.hear({ type: 'start' });
    t.advance(400);
    t.hear({ type: 'pause', audio: AUDIO });
    await tick();
    t.say(110, 'Salut.');
    await tick();
    t.advance(540);
    t.hear({ type: 'end', audio: AUDIO, lastVoiceAt: 1380 });
    t.advance(90);
    await tick();
    expect(t.latencies).toEqual([{ type: 'latency', ms: 650, speculated: true }]);
    expect(delays(t.trace.events)[0]).toMatchObject({ aLEssai: true, ms: { blanc_de_tour: 650 } });
  });
});
