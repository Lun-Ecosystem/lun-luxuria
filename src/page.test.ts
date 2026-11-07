import { describe, expect, it } from 'vitest';
import { watchPage } from './page.ts';

const fire = (type: string, persisted: boolean) =>
  dispatchEvent(Object.assign(new Event(type), { persisted }));

describe('the page coming and going', () => {
  it('leaves at every hide, comes back only from the history cache, and stops listening', () => {
    const seen: string[] = [];
    const stop = watchPage(
      () => seen.push('leave'),
      () => seen.push('back'),
    );
    fire('pagehide', false);
    fire('pagehide', true);
    fire('pageshow', false); // a first load: the start already announced it
    fire('pageshow', true);
    expect(seen).toEqual(['leave', 'leave', 'back']);
    stop();
    fire('pagehide', false);
    fire('pageshow', true);
    expect(seen).toHaveLength(3);
  });
});
