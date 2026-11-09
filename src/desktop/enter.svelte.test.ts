import { flushSync } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../session.svelte.ts';
import { enterFollows } from './enter.svelte.ts';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn());
});

/** A session whose entering is only counted. */
function ready(settings: object = { model: { name: 'qwen3:8b' } }) {
  localStorage.setItem('luxuria.settings', JSON.stringify(settings));
  const s = new Session();
  const enter = vi.fn(async () => void (s.entered = true));
  s.enter = enter;
  return { s, enter };
}

describe('the window enters by itself', () => {
  it('once the voice service has answered, and only once', () => {
    const { s, enter } = ready();
    const stop = $effect.root(() => enterFollows(s));
    flushSync();
    expect(enter).not.toHaveBeenCalled(); // not known yet
    s.voiceStatus = 'starting';
    flushSync();
    expect(enter).not.toHaveBeenCalled();
    s.voiceStatus = 'up';
    flushSync();
    expect(enter).toHaveBeenCalledOnce();
    s.voiceStatus = 'down';
    s.voiceStatus = 'up';
    flushSync();
    expect(enter).toHaveBeenCalledOnce();
    stop();
  });

  it('a service that does not answer is a verdict too: it enters without its voice', () => {
    const { s, enter } = ready();
    const stop = $effect.root(() => enterFollows(s));
    s.voiceStatus = 'down';
    flushSync();
    expect(enter).toHaveBeenCalledOnce();
    stop();
  });

  it('something missing: it waits on the arrival, then enters when it is given', () => {
    const { s, enter } = ready({ brain: 'linked' });
    const stop = $effect.root(() => enterFollows(s));
    s.voiceStatus = 'up';
    flushSync();
    expect(enter).not.toHaveBeenCalled();
    s.token = 'jeton'; // the code was paired
    flushSync();
    expect(enter).toHaveBeenCalledOnce();
    stop();
  });
});
