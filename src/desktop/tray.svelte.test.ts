import { flushSync } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../session.svelte.ts';
import type { Settings } from '../settings.ts';
import { autostartFollows, trayFollows, trayOf, type Autostart, type TrayDeps } from './tray.svelte.ts';

const settle = async () => {
  flushSync();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn());
});

function tray() {
  let menu: (id: string) => void = () => {};
  const calls: { state: string; tooltip: string; silenced: boolean }[] = [];
  const win = {
    show: vi.fn(async () => {}),
    unminimize: vi.fn(async () => {}),
    setFocus: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  const deps: TrayDeps = {
    call: vi.fn(
      async (_cmd: string, args: { state: string; tooltip: string; silenced: boolean }) =>
        void calls.push(args),
    ) as TrayDeps['call'],
    listen: vi.fn(async (_e: string, on: (e: { payload: string }) => void) => {
      menu = (id) => on({ payload: id });
      return () => {};
    }) as TrayDeps['listen'],
    win: () => win,
  };
  return { deps, calls, win, click: (id: string) => menu(id) };
}

describe('the tray icon', () => {
  it('says one of three states', () => {
    expect(trayOf('silenced')).toBe('silenced');
    expect(trayOf('unreachable')).toBe('unreachable');
    for (const s of ['present', 'listening', 'speaking', 'thinking', 'muted', 'busy', 'capped'] as const)
      expect(trayOf(s)).toBe('present');
  });

  it('follows the state, and another setting saved does not call it again', async () => {
    const session = new Session();
    const t = tray();
    const stop = $effect.root(() => trayFollows(session, t.deps));
    await settle();
    expect(t.calls).toHaveLength(1);
    session.saveSettings({ ...session.settings, traceIgnored: false } as Settings);
    await settle();
    expect(t.calls).toHaveLength(1);
    session.toggleMute();
    await settle();
    expect(t.calls.at(-1)).toEqual({
      state: 'silenced',
      tooltip: "Lun'Luxuria : En sourdine",
      silenced: true,
    });
    stop();
  });

  it('silenced and unreachable at once, the mute entry still says the mute', async () => {
    const session = new Session();
    const t = tray();
    const stop = $effect.root(() => trayFollows(session, t.deps));
    session.toggleMute();
    session.linked = false;
    await settle();
    expect(t.calls.at(-1)).toMatchObject({ state: 'unreachable', silenced: true });
    stop();
  });

  it('its menu shows the window, switches the mute, and quits by closing the window', async () => {
    const session = new Session();
    const t = tray();
    const stop = $effect.root(() => trayFollows(session, t.deps));
    await settle();
    t.click('show');
    expect(t.win.show).toHaveBeenCalled();
    expect(t.win.setFocus).toHaveBeenCalled();
    t.click('mute');
    expect(session.silenced).toBe(true);
    t.click('quit');
    expect(t.win.close).toHaveBeenCalled();
    stop();
  });
});

describe('starting with Windows', () => {
  const plugin = (enabled: boolean, fail = false): Autostart & { calls: string[] } => {
    const calls: string[] = [];
    let on = enabled;
    return {
      calls,
      isEnabled: async () => on,
      enable: async () => {
        calls.push('enable');
        if (fail) throw new Error('refusé');
        on = true;
      },
      disable: async () => {
        calls.push('disable');
        on = false;
      },
    };
  };
  const withStart = (session: Session, on: boolean) =>
    session.saveSettings({
      ...session.settings,
      display: { ...session.settings.display, startWithWindows: on },
    });

  it('the system says first: the screen takes what it finds, without calling it back', async () => {
    const session = new Session();
    const p = plugin(true);
    const stop = $effect.root(() => autostartFollows(session, p));
    await settle();
    expect(session.settings.display.startWithWindows).toBe(true);
    expect(p.calls).toEqual([]);
    stop();
  });

  it('switched on it enables, switched off it disables', async () => {
    const session = new Session();
    const p = plugin(false);
    const stop = $effect.root(() => autostartFollows(session, p));
    await settle();
    withStart(session, true);
    await settle();
    withStart(session, false);
    await settle();
    expect(p.calls).toEqual(['enable', 'disable']);
    stop();
  });

  it('switched on then off before Windows answers, it ends off', async () => {
    const session = new Session();
    const p = plugin(false);
    let answer: () => void = () => {};
    const enable = p.enable;
    p.enable = () => new Promise<void>((r) => (answer = () => void enable().then(r)));
    const stop = $effect.root(() => autostartFollows(session, p));
    await settle();
    withStart(session, true);
    await settle();
    withStart(session, false);
    await settle();
    answer();
    await settle();
    expect(p.calls).toEqual(['enable', 'disable']);
    expect(await p.isEnabled()).toBe(false);
    stop();
  });

  it('a failure is said on the screen, and the other settings are still saved', async () => {
    const session = new Session();
    const p = plugin(false, true);
    const stop = $effect.root(() => autostartFollows(session, p));
    await settle();
    session.saveSettings({
      ...session.settings,
      traceIgnored: false,
      display: { ...session.settings.display, startWithWindows: true },
    });
    await settle();
    expect(session.startSaid).toMatch(/refusé/);
    expect(session.settings.traceIgnored).toBe(false);
    expect(session.settings.display.startWithWindows).toBe(false);
    stop();
  });
});
