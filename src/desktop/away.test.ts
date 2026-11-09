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
function linked() {
  localStorage.setItem(
    'luxuria.settings',
    JSON.stringify({ brain: 'linked', busy: { ...DEFAULTS.busy, on: false } }),
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
afterEach(() => vi.useRealTimers());

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
