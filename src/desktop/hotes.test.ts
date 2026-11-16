import { describe, expect, it } from 'vitest';
import type { Session } from '../session.svelte.ts';
import { readHosts } from './hotes.ts';

/** What readHosts writes: the list, and why there is none. */
const blank = () => ({ hosts: null, hostsSaid: '' }) as unknown as Session;

describe('the confirmed origins, read from the window', () => {
  it('two reads answered backwards: the last one asked wins, the late one says nothing', async () => {
    const session = blank();
    const answers: ((hosts: unknown) => void)[] = [];
    const call = () => new Promise<unknown>((resolve) => answers.push(resolve));
    const first = readHosts(session, call);
    const second = readHosts(session, call);
    answers[1]!(['https://b.exemple']);
    await second;
    answers[0]!(['https://a.exemple', 'https://b.exemple']);
    await first;
    expect(session.hosts).toEqual(['https://b.exemple']);
  });

  it('a late refusal, older than the answer shown, says nothing either', async () => {
    const session = blank();
    const settle: ((ok: boolean) => void)[] = [];
    const call = () =>
      new Promise<unknown>((resolve, reject) =>
        settle.push((ok) => (ok ? resolve(['https://b.exemple']) : reject('hotes.json illisible'))),
      );
    const first = readHosts(session, call);
    const second = readHosts(session, call);
    settle[1]!(true);
    await second;
    settle[0]!(false);
    await first;
    expect(session.hosts).toEqual(['https://b.exemple']);
    expect(session.hostsSaid).toBe('');
  });

  it('each origin once, strings only, as Rust may repeat one', async () => {
    const session = blank();
    await readHosts(session, async () => [
      'https://a.exemple',
      'https://a.exemple',
      7,
      null,
      'https://b.exemple',
    ]);
    expect(session.hosts).toEqual(['https://a.exemple', 'https://b.exemple']);
    expect(session.hostsSaid).toBe('');
  });

  it('a refused read: none, on the closed side, and Rust’s refusal kept to be said', async () => {
    const session = blank();
    await readHosts(session, () => Promise.reject('hotes.json illisible'));
    expect(session.hosts).toEqual([]);
    expect(session.hostsSaid).toBe('hotes.json illisible');
  });

  it('an answer that is not a list: none, and said unreadable, never « none confirmed »', async () => {
    const session = blank();
    await readHosts(session, async () => ({ hosts: 'https://a.exemple' }));
    expect(session.hosts).toEqual([]);
    expect(session.hostsSaid).not.toBe('');
  });
});
