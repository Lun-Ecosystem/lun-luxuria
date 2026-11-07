import { describe, expect, it } from 'vitest';
import { presenceKeeper, single, watchPage } from './page.ts';

const fire = (type: string, persisted: boolean) =>
  dispatchEvent(Object.assign(new Event(type), { persisted }));

const visibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('the page coming and going', () => {
  it('leaves at every hide, comes back only from the history cache, and stops listening', () => {
    const seen: string[] = [];
    const stop = watchPage(
      () => seen.push('leave'),
      () => seen.push('back'),
      () => seen.push('shown'),
    );
    fire('pagehide', false);
    fire('pagehide', true);
    fire('pageshow', false); // a first load: the start already announced it
    fire('pageshow', true);
    expect(seen).toEqual(['leave', 'leave', 'back']);
    stop();
    fire('pagehide', false);
    fire('pageshow', true);
    visibility('visible');
    expect(seen).toHaveLength(3);
  });

  it('says when the page shows again, never when it hides', () => {
    const seen: string[] = [];
    const stop = watchPage(
      () => {},
      () => {},
      () => seen.push('shown'),
    );
    visibility('hidden');
    visibility('visible');
    visibility('hidden');
    visibility('visible');
    expect(seen).toEqual(['shown', 'shown']);
    stop();
  });
});

describe('presenceKeeper', () => {
  const later = <T>() => {
    let settle: (v: T) => void = () => {};
    const promise = new Promise<T>((r) => (settle = r));
    return { promise, settle };
  };

  it('two close returns with a live presence beat twice and never start', async () => {
    let starts = 0;
    const p = presenceKeeper(
      async () => void starts++,
      async () => 'taken',
    );
    await Promise.all([p.beat(), p.beat()]);
    expect(starts).toBe(0);
  });

  it('a refusal during an announce gives one start', async () => {
    let starts = 0;
    const started = later<void>();
    const p = presenceKeeper(
      () => (starts++, started.promise),
      async () => 'gone',
    );
    const first = p.announce();
    const refused = p.beat();
    await Promise.resolve();
    started.settle();
    await Promise.all([first, refused]);
    expect(starts).toBe(1);
  });

  it('a refusal landing after an announce that began behind it starts nothing more', async () => {
    let starts = 0;
    const answer = later<'gone'>();
    const p = presenceKeeper(
      async () => void starts++,
      () => answer.promise,
    );
    const refused = p.beat(); // the beat leaves first, from the history cache
    await p.announce(); // pageshow's start, done before the 410 comes back
    answer.settle('gone');
    await refused;
    expect(starts).toBe(1);
  });

  it('a refused beat with no announce since starts again, and an unreachable beat does not', async () => {
    let starts = 0;
    const answers: ('gone' | Error)[] = ['gone', new Error('injoignable')];
    const p = presenceKeeper(
      async () => void starts++,
      async () => {
        const a = answers.shift()!;
        if (a instanceof Error) throw a;
        return a;
      },
    );
    await p.beat();
    await p.beat();
    expect(starts).toBe(1);
  });
});

describe('single', () => {
  it('runs once while a run is under way, then again after it', async () => {
    let runs = 0;
    let finish = () => {};
    const announce = single(
      () =>
        new Promise<void>((resolve) => {
          runs++;
          finish = resolve;
        }),
    );
    const a = announce();
    const b = announce(); // a refused beat while the stream comes back: one start, not two
    expect(runs).toBe(1);
    finish();
    await Promise.all([a, b]);
    void announce();
    expect(runs).toBe(2);
  });

  it('runs again after a failed run', async () => {
    let runs = 0;
    const announce = single(async () => {
      runs++;
      throw new Error('injoignable');
    });
    await announce().catch(() => {});
    await announce().catch(() => {});
    expect(runs).toBe(2);
  });
});
