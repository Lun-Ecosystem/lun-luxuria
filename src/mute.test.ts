import { beforeEach, describe, expect, it, vi } from 'vitest';

const mic = vi.hoisted(() => ({ open: vi.fn(async () => ({ stop: vi.fn() })) }));
vi.mock('./audio.ts', () => ({
  openMicrophone: mic.open,
  webOutput: () => ({ play: () => ({ stop() {}, heard: () => 0 }), level: () => 0 }),
}));

import { Session } from './session.svelte.ts';
import { DEFAULTS, type Settings } from './settings.ts';

type Sent = { state: string; opts: Record<string, unknown> };

/** A linked session whose server is a recorder; the detection of another app stays off. */
function linked(opts: { mute?: boolean; settings?: Partial<Settings>; beat?: 'taken' | 'gone' } = {}) {
  localStorage.setItem(
    'luxuria.settings',
    JSON.stringify({ brain: 'linked', busy: { ...DEFAULTS.busy, on: false }, ...opts.settings }),
  );
  localStorage.setItem('luxuria.token', 't');
  localStorage.setItem('luxuria.mic', 'on');
  if (opts.mute) localStorage.setItem('luxuria.mute', 'on');
  const s = new Session();
  const sent: Sent[] = [];
  s.core.presence = vi.fn(async (state: 'started' | 'beat' | 'stopped', o = {}) => {
    sent.push({ state, opts: o });
    return state === 'beat' ? (opts.beat ?? 'taken') : undefined;
  }) as typeof s.core.presence;
  s.core.live = vi.fn(() => new Promise<void>(() => {}));
  s.core.thread = vi.fn(async () => []);
  s.core.send = vi.fn(async () => {});
  return { s, sent };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  mic.open.mockClear();
  vi.stubGlobal('requestAnimationFrame', () => 0);
});

describe('the desk mute', () => {
  it('muted at launch: no capture, no welcome, and the start says so', async () => {
    const { s, sent } = linked({ mute: true });
    await s.enter();
    expect(s.silenced).toBe(true);
    expect(mic.open).not.toHaveBeenCalled();
    expect(sent[0]).toEqual({
      state: 'started',
      opts: expect.objectContaining({ ritual: false, muted: true }),
    });
    expect(s.state).toBe('silenced');
  });

  it('not muted: the start carries no new field, as for an older server', async () => {
    const { s, sent } = linked();
    await s.enter();
    expect(mic.open).toHaveBeenCalledOnce();
    expect(sent[0]!.opts).toMatchObject({ ritual: true });
    expect(sent[0]!.opts).not.toHaveProperty('muted');
    expect(sent[0]!.opts).not.toHaveProperty('silentAnnounce');
  });

  it('muting closes the microphone, beats at once, and lasts across a relaunch', async () => {
    const { s, sent } = linked();
    await s.enter();
    const stop = (await mic.open.mock.results[0]!.value) as { stop: ReturnType<typeof vi.fn> };
    s.toggleMute();
    await flush();
    expect(stop.stop).toHaveBeenCalled();
    expect(s.capturing).toBe(false);
    expect(sent.at(-1)).toEqual({ state: 'beat', opts: expect.objectContaining({ muted: true }) });
    expect(localStorage.getItem('luxuria.mute')).toBe('on');
    expect(new Session().silenced).toBe(true);
  });

  it('unmuting gives the microphone back as it was', async () => {
    const { s } = linked({ mute: true });
    await s.enter();
    s.toggleMute();
    await flush();
    expect(mic.open).toHaveBeenCalledOnce();

    localStorage.clear();
    mic.open.mockClear();
    const off = linked({ mute: true });
    localStorage.setItem('luxuria.mic', 'off');
    const cut = new Session();
    cut.core = off.s.core;
    await cut.enter();
    cut.toggleMute();
    await flush();
    expect(mic.open).not.toHaveBeenCalled();
  });

  it('unmuted during a call, the microphone stays closed', async () => {
    const { s } = linked({ mute: true });
    await s.enter();
    s.busy = true;
    s.toggleMute();
    await flush();
    expect(mic.open).not.toHaveBeenCalled();
  });

  it('muting while she speaks cuts her', async () => {
    const { s } = linked();
    await s.enter();
    const silence = vi.spyOn(s, 'silence');
    s.speaking = true;
    s.toggleMute();
    expect(silence).toHaveBeenCalled();
  });

  it('muted, what he writes does not leave', async () => {
    const { s } = linked({ mute: true });
    await s.enter();
    await s.write('Bonjour');
    expect(s.core.send).not.toHaveBeenCalled();
  });
  it('P0 aloud turned off: a silent announce on the start, and at once when the setting changes', async () => {
    const { s, sent } = linked({ settings: { speak: { ...DEFAULTS.speak, p0: false } } });
    await s.enter();
    expect(sent[0]!.opts).toMatchObject({ silentAnnounce: true });
    s.saveSettings({ ...s.settings, speak: { ...s.settings.speak, p0: true } });
    await flush();
    expect(sent.at(-1)!.state).toBe('beat');
    expect(sent.at(-1)!.opts).not.toHaveProperty('silentAnnounce');
  });

  it('a muted announce again after a refused beat says no welcome', async () => {
    const { s, sent } = linked({ beat: 'gone' });
    await s.enter();
    s.toggleMute();
    await flush();
    await flush();
    const starts = sent.filter((x) => x.state === 'started');
    expect(starts).toHaveLength(2);
    expect(starts[1]!.opts).toMatchObject({ ritual: false, muted: true });
  });
});
