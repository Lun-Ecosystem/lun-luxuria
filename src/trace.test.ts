import { describe, expect, it } from 'vitest';
import { Trace, TRACE_FORMAT } from './trace.ts';

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
