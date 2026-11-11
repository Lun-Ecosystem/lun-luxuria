import { describe, expect, it } from 'vitest';
import { delays, Trace, TRACE_FORMAT, type TraceName, type TraceRef, type TraceValue } from './trace.ts';

function setup(max?: number) {
  let clock = 100;
  const trace = new Trace(() => clock, max);
  return { trace, advance: (ms: number) => (clock += ms) };
}

describe('the trace of a turn', () => {
  it('keeps the order of the decisions, each on the clock', () => {
    const { trace, advance } = setup();
    const phrase = trace.phrase();
    trace.add('voix', { phrase }, { son: 90 });
    advance(50);
    trace.add('fin', { phrase }, { son: 120 });
    expect(trace.events.map((e) => [e.name, e.at, e['son']])).toEqual([
      ['voix', 100, 90],
      ['fin', 150, 120],
    ]);
  });

  it('keeps two sentences that overlap apart', () => {
    const { trace } = setup();
    const one = trace.phrase();
    trace.add('fin', { phrase: one });
    const two = trace.phrase();
    trace.add('voix', { phrase: two });
    // The first one's reply number comes after the second began.
    trace.add('numero', { phrase: one, essai: trace.essai(one), reponse: 11 });
    trace.add('premier_son', { reponse: 11 });
    expect(trace.events.filter((e) => e.phrase === one).map((e) => e.name)).toEqual([
      'fin',
      'numero',
      'premier_son',
    ]);
    expect(trace.events.filter((e) => e.phrase === two).map((e) => e.name)).toEqual(['voix']);
  });

  it('a try withdrawn then made again keeps both reply numbers under the same sentence', () => {
    const { trace } = setup();
    const phrase = trace.phrase();
    const first = trace.essai(phrase);
    trace.add('numero', { phrase, essai: first, reponse: 11 });
    trace.add('retiree', { phrase, essai: first, reponse: 11 });
    const second = trace.essai(phrase);
    trace.add('numero', { phrase, essai: second, reponse: 12 });
    trace.add('son', { reponse: 12 }, { debut: true });
    expect([first, second]).toEqual([1, 2]);
    expect(trace.events.map((e) => [e.name, e.phrase, e.essai, e.reponse])).toEqual([
      ['numero', 1, 1, 11],
      ['retiree', 1, 1, 11],
      ['numero', 1, 2, 12],
      ['son', 1, 2, 12],
    ]);
  });

  it('a speech without a sentence is found by its reply alone', () => {
    const { trace } = setup();
    trace.add('premier_son', { reponse: 40 });
    expect(trace.events[0]).toMatchObject({ reponse: 40 });
    expect(trace.events[0]!.phrase).toBeUndefined();
  });

  it('keeps the last turns only', () => {
    const { trace } = setup(2);
    trace.add('silence');
    for (let i = 0; i < 3; i++) {
      const phrase = trace.phrase();
      trace.add('voix', { phrase });
      trace.add('numero', { phrase, essai: 1, reponse: 10 + i });
    }
    trace.add('son', { reponse: 10 });
    trace.add('son', { reponse: 12 });
    // The first sentence and what came before it are gone; its reply, back later, is a turn of its own.
    expect(trace.events.map((e) => [e.name, e.phrase, e.reponse])).toEqual([
      ['voix', 3, undefined],
      ['numero', 3, 12],
      ['son', undefined, 10],
      ['son', 3, 12],
    ]);
  });

  it('forgets the count of tries of a sentence gone with the bound, and only of that one', () => {
    const { trace } = setup(2);
    const tried = (phrase: number) => {
      trace.add('voix', { phrase });
      trace.add('essai', { phrase, essai: trace.essai(phrase) });
    };
    const [one, two, three] = [trace.phrase(), trace.phrase(), trace.phrase()];
    for (const phrase of [one, two, three]) tried(phrase);
    // The first sentence left the trace: its count went with it. The second is still counted.
    expect(trace.essai(one)).toBe(1);
    expect(trace.essai(two)).toBe(2);
  });

  it('is written one line per event, after its format', () => {
    const { trace } = setup();
    trace.add('voix', { phrase: trace.phrase() }, { son: 90 });
    const lines = trace.lines().trimEnd().split('\n');
    expect(lines.map((l) => JSON.parse(l) as object)).toEqual([
      { format: TRACE_FORMAT },
      { at: 100, name: 'voix', phrase: 1, son: 90 },
    ]);
  });
});

/** A trace written by hand: `[at, name, ref, values]`. */
function written(rows: [number, TraceName, TraceRef, Record<string, TraceValue>?][]) {
  let clock = 0;
  const trace = new Trace(() => clock);
  for (const [at, name, ref, values] of rows) {
    clock = at;
    trace.add(name, ref, values);
  }
  return trace.events;
}

describe('the delays of a turn', () => {
  const p = { phrase: 1 };
  const e1 = { phrase: 1, essai: 1 };
  const r = { reponse: 110 };

  it('each from one event to another, under its name', () => {
    const turns = delays(
      written([
        [1000, 'voix', p, { son: 990 }],
        [1500, 'tenue', p, { son: 1490 }],
        [2200, 'fin', p, { son: 2180, dernier_son: 1480 }],
        [2200, 'essai', e1, { final: true }],
        [2500, 'transcrite', e1, {}],
        [2500, 'envoyee', e1, { final: true }],
        [2510, 'numero', { ...e1, ...r }, {}],
        [2900, 'phrase_recue', r, { rang: 1 }],
        [2900, 'synthese', r, { etape: 'debut', rang: 1 }],
        [3100, 'synthese', r, { etape: 'fin', rang: 1 }],
        [3100, 'synthese', r, { etape: 'debut', rang: 2 }],
        [3150, 'premier_son', r],
        [3250, 'synthese', r, { etape: 'fin', rang: 2 }],
        [4000, 'durees', r, { queueMs: 12, firstWordMs: 340, postMs: 800, secondWordMs: 290 }],
      ]),
    );
    expect(turns).toEqual([
      {
        phrase: 1,
        reponse: 110,
        aLEssai: false,
        synthese: [200, 150],
        ms: {
          attente_fin: 720,
          transcription: 300,
          file_serveur: 12,
          premier_mot: 340,
          poste: 800,
          second_mot: 290,
          premiere_phrase: 400,
          blanc_de_tour: 1670,
        },
      },
    ]);
  });

  it('a delay whose end is missing is absent: no server durations, no first sound', () => {
    const [turn] = delays(
      written([
        [1000, 'voix', p],
        [2200, 'fin', p, { dernier_son: 1480 }],
        [2200, 'essai', e1, { final: true }],
        [2500, 'envoyee', e1, { final: true }],
        [2510, 'numero', { ...e1, ...r }],
      ]),
    );
    expect(turn!.ms).toEqual({ attente_fin: 720 });
  });

  it('the first sentence back answers a try when the sentence left at a pause', () => {
    const [turn] = delays(
      written([
        [1000, 'voix', p],
        [1400, 'pause', p],
        [1400, 'essai', e1, { final: false }],
        [1600, 'transcrite', e1],
        [1600, 'envoyee', e1, { final: false }],
        [1610, 'numero', { ...e1, ...r }],
        [1900, 'phrase_recue', r],
        [2100, 'fin', p, { dernier_son: 1380 }],
        [2100, 'confirmee', { ...e1, ...r }],
        [2150, 'premier_son', r],
      ]),
    );
    expect(turn).toMatchObject({
      aLEssai: true,
      ms: { premiere_phrase: 300, blanc_de_tour: 770, transcription: 200 },
    });
  });

  it('a try withdrawn does not count: the delays are those of the one kept', () => {
    const e2 = { phrase: 1, essai: 2 };
    const [turn] = delays(
      written([
        [1000, 'voix', p],
        [1400, 'essai', e1, { final: false }],
        [1600, 'transcrite', e1],
        [1610, 'numero', { ...e1, reponse: 110 }],
        [1700, 'retiree', { ...e1, reponse: 110 }],
        [2400, 'fin', p, { dernier_son: 1700 }],
        [2400, 'essai', e2, { final: true }],
        [2550, 'transcrite', e2],
        [2560, 'numero', { ...e2, reponse: 111 }],
        [2900, 'premier_son', { reponse: 111 }],
      ]),
    );
    expect(turn).toMatchObject({ reponse: 111, ms: { transcription: 150, blanc_de_tour: 1200 } });
  });

  it('the stop of a clean cut, from the hold to her sound stopped by that sentence', () => {
    const turns = delays(
      written([
        [500, 'premier_son', { reponse: 50 }],
        [1000, 'voix', p],
        [1400, 'tenue', p],
        [1400, 'suspendue', { reponse: 50 }, { par: 1, doux: false }],
        [1403, 'son', { reponse: 50 }, { etape: 'fin', arrete: true, par: 1 }],
      ]),
    );
    expect(turns.map((t) => t.ms)).toEqual([{}, { arret_coupure: 3 }]);
    // The soft way does not stop her sound on the voice: no delay.
    const soft = delays(
      written([
        [1000, 'voix', p],
        [1400, 'tenue', p],
        [1400, 'suspendue', { reponse: 50 }, { par: 1, doux: true }],
      ]),
    );
    expect(soft[0]!.ms).toEqual({});
  });

  it('a speech without a sentence has only the delays of its reply', () => {
    const [turn] = delays(
      written([
        [100, 'phrase_recue', { reponse: 40 }],
        [100, 'synthese', { reponse: 40 }, { etape: 'debut', rang: 1 }],
        [300, 'synthese', { reponse: 40 }, { etape: 'fin', rang: 1 }],
        [300, 'premier_son', { reponse: 40 }],
      ]),
    );
    expect(turn).toEqual({ phrase: undefined, reponse: 40, aLEssai: false, synthese: [200], ms: {} });
  });
});
