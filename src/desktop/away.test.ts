import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mic = vi.hoisted(() => ({ open: vi.fn(async () => ({ stop: vi.fn() })) }));
vi.mock('../audio.ts', () => ({
  openMicrophone: mic.open,
  webOutput: () => ({ play: () => ({ stop() {}, heard: () => 0 }), level: () => 0 }),
}));

import { Session } from '../session.svelte.ts';
import { DEFAULTS } from '../settings.ts';
import { awayFollows, isAway } from './away.ts';

const MIN = 60_000;

/** A linked session whose server is a recorder, as in the mute's tests. */
function linked(extra: object = {}) {
  localStorage.setItem(
    'luxuria.settings',
    JSON.stringify({ brain: 'linked', busy: { ...DEFAULTS.busy, on: false }, ...extra }),
  );
  localStorage.setItem('luxuria.token', 't');
  localStorage.setItem('luxuria.mic', 'on');
  const s = new Session();
  const sent: string[] = [];
  s.core.presence = vi.fn(async (state: 'started' | 'beat' | 'stopped') => {
    sent.push(state);
    return state === 'beat' ? 'taken' : undefined;
  }) as typeof s.core.presence;
  s.core.live = vi.fn(() => new Promise<void>(() => {}));
  s.core.thread = vi.fn(async () => []);
  return { s, sent };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  mic.open.mockClear();
  vi.stubGlobal('requestAnimationFrame', () => 0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('away, from the time without input', () => {
  it('away from the set delay on, present before it', () => {
    const away = { on: true, minutes: 15 };
    expect(isAway(15 * MIN - 1, away)).toBe(false);
    expect(isAway(15 * MIN, away)).toBe(true);
    expect(isAway(3 * 60 * MIN, away)).toBe(true);
  });

  it('switched off, always present', () => {
    expect(isAway(24 * 60 * MIN, { on: false, minutes: 15 })).toBe(false);
  });

  it('on by default, after 15 minutes', () => {
    expect(DEFAULTS.away).toEqual({ on: true, minutes: 15 });
  });
});

describe('the session, away and back', () => {
  it('away: the presence stops, no beat leaves, and listening and the mute stay as they are', async () => {
    const { s, sent } = linked();
    await s.enter();
    expect(s.capturing).toBe(true);
    s.setAway(true);
    await flush();
    expect(sent.at(-1)).toBe('stopped');
    const before = sent.length;
    s.toggleMute(); // beats at once when present
    s.toggleMute();
    await flush();
    expect(sent.length).toBe(before);
    expect(s.capturing).toBe(true);
    expect(s.silenced).toBe(false);
  });

  it('back: the presence starts again, as an arrival', async () => {
    const { s, sent } = linked();
    await s.enter();
    s.setAway(true);
    await flush();
    s.setAway(false);
    await flush();
    expect(sent.slice(-2)).toEqual(['stopped', 'started']);
  });

  it('the same state twice sends nothing more', async () => {
    const { s, sent } = linked();
    await s.enter();
    s.setAway(false);
    s.setAway(true);
    s.setAway(true);
    await flush();
    expect(sent).toEqual(['started', 'stopped']);
  });

  it('a beat refused after the stop does not reopen the presence', async () => {
    const { s, sent } = linked();
    await s.enter();
    let answer: (a: 'gone') => void = () => {};
    s.core.presence = vi.fn(async (state: 'started' | 'beat' | 'stopped') => {
      sent.push(state);
      return state === 'beat' ? new Promise<'gone'>((r) => (answer = r)) : undefined;
    }) as typeof s.core.presence;
    s.toggleMute(); // a beat leaves
    s.setAway(true);
    answer('gone'); // the server took the stop first
    await flush();
    expect(sent.slice(-2)).toEqual(['beat', 'stopped']);
  });

  it('a start still on its way when the absence comes closes again', async () => {
    const { s, sent } = linked();
    let arrive: () => void = () => {};
    s.core.presence = vi.fn(async (state: 'started' | 'beat' | 'stopped') => {
      sent.push(state);
      if (state === 'started') await new Promise<void>((r) => (arrive = r));
      return undefined;
    }) as typeof s.core.presence;
    const entering = s.enter();
    await flush();
    s.setAway(true);
    arrive();
    await entering;
    await flush();
    expect(sent).toEqual(['started', 'stopped', 'stopped']);
  });

  it('a phrase written while away brings the presence back before it leaves', async () => {
    const { s, sent } = linked();
    s.core.send = vi.fn(async () => void sent.push('send'));
    await s.enter();
    s.setAway(true);
    await s.write('je suis là');
    expect(sent.slice(-3)).toEqual(['stopped', 'started', 'send']);
  });

  it('away before entering: nothing is announced until the first input', async () => {
    const { s, sent } = linked();
    s.setAway(true);
    await s.enter();
    expect(sent).toEqual([]);
    s.setAway(false);
    await flush();
    expect(sent).toEqual(['started']);
  });
});

describe('a phrase heard', () => {
  /** Talks into the microphone: loud frames, then silence, 32 ms each, as the worklet gives them. */
  function say(loudFrames: number) {
    const onFrame = (mic.open.mock.calls.at(-1) as unknown as [unknown, (f: Float32Array) => void])[1];
    const loud = new Float32Array(512).fill(0.3);
    const quiet = new Float32Array(512);
    let at = Date.now();
    for (let i = 0; i < loudFrames + 40; i++) {
      vi.setSystemTime((at += 32));
      onFrame(i < loudFrames ? loud : quiet);
    }
  }
  async function heard(text: string, extra: object = {}) {
    vi.useFakeTimers({ toFake: ['Date'] });
    const stt = vi.fn(async () => Response.json({ text, confidence: 0.9 }));
    vi.stubGlobal('fetch', stt);
    const { s, sent } = linked(extra);
    s.core.send = vi.fn(async () => void sent.push('send'));
    await s.enter();
    return { s, sent, stt };
  }

  it('a phrase sent counts as an input, and brings the presence back', async () => {
    const { s, sent } = await heard('bonjour');
    s.setAway(true);
    say(20);
    await vi.waitFor(() => expect(sent).toContain('send'));
    expect(s.heardAt).toBeGreaterThan(0);
    expect(s.away).toBe(false);
    expect(sent.slice(-3)).toEqual(['stopped', 'started', 'send']);
  });

  it('a noise does not count', async () => {
    const { s, stt } = await heard('bonjour');
    say(3);
    await flush();
    expect(stt).not.toHaveBeenCalled();
    expect(s.heardAt).toBe(0);
  });

  it('a phrase the filter keeps out does not count: a video, someone else', async () => {
    const { s, stt, sent } = await heard('on se voit demain', { filter: { scene: true, small: true } });
    say(20);
    await vi.waitFor(() => expect(stt).toHaveBeenCalled());
    await flush();
    await flush();
    expect(sent).not.toContain('send');
    expect(s.heardAt).toBe(0);
    expect(s.thinking).toBe(false); // the end of the sentence had committed it before the verdict
  });
});

describe('following the input', () => {
  it('reads the time without input, and the first input brings the presence back', async () => {
    vi.useFakeTimers();
    localStorage.clear();
    const s = new Session();
    let idle = 20 * MIN;
    const stop = awayFollows(s, async () => idle);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.away).toBe(true);
    idle = 2000;
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.away).toBe(false);
    stop();
  });

  it('a phrase heard counts as an input: a talk without keys keeps the presence', async () => {
    vi.useFakeTimers();
    const s = new Session();
    const stop = awayFollows(s, async () => 60 * MIN);
    s.heardAt = Date.now() - 2 * MIN;
    await vi.advanceTimersByTimeAsync(0);
    expect(s.away).toBe(false);
    await vi.advanceTimersByTimeAsync(14 * MIN);
    expect(s.away).toBe(true); // nothing heard for 16 minutes
    stop();
  });

  it('an unreadable time counts as present', async () => {
    vi.useFakeTimers();
    const s = new Session();
    s.setAway(true);
    const stop = awayFollows(s, () => Promise.reject(new Error('no')));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.away).toBe(false);
    stop();
  });

  it('switched off in the settings, present whatever the time', async () => {
    vi.useFakeTimers();
    localStorage.setItem('luxuria.settings', JSON.stringify({ away: { on: false, minutes: 15 } }));
    const s = new Session();
    const stop = awayFollows(s, async () => 60 * MIN);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.away).toBe(false);
    stop();
  });
});
