import { describe, expect, it } from 'vitest';
import { single, watchPage } from './page.ts';

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
