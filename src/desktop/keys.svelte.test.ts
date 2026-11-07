import { flushSync } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShortcutEvent } from '@tauri-apps/plugin-global-shortcut';
import { Session } from '../session.svelte.ts';
import type { Settings } from '../settings.ts';
import { keysFollow, refusedGlobally, type Shortcuts } from './keys.svelte.ts';

type Handler = (e: ShortcutEvent) => void;

const fake = (busy: string[] = []) => {
  const held = new Map<string, Handler>();
  const shortcuts: Shortcuts = {
    register: (async (key: string, handler: Handler) => {
      if (busy.includes(key)) throw new Error('taken');
      held.set(key, handler);
    }) as Shortcuts['register'],
    unregister: (async (keys: string | string[]) => {
      for (const k of [keys].flat()) held.delete(k);
    }) as Shortcuts['unregister'],
  };
  const press = (key: string, state: 'Pressed' | 'Released') =>
    held.get(key)!({ shortcut: key, id: 0, state } as ShortcutEvent);
  return { held, shortcuts, press };
};

const settle = async () => {
  flushSync();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn());
});

describe('refusedGlobally', () => {
  it('refuses a key that types, lets a function key pass', () => {
    for (const code of ['KeyV', 'Digit1', 'Space', 'Enter']) expect(refusedGlobally(code)).toMatch(/écrit/);
    for (const code of ['F9', 'Pause', 'ScrollLock', 'Insert']) expect(refusedGlobally(code)).toBeUndefined();
  });
});

describe('keysFollow', () => {
  it('the shortcut switches scene and small mode on the press only, the held key follows press and release', async () => {
    const session = new Session();
    const { held, shortcuts, press } = fake();
    const stop = $effect.root(() => keysFollow(session, shortcuts));
    await settle();
    expect([...held.keys()]).toEqual(['Control+Shift+L', 'F9']);

    press('Control+Shift+L', 'Pressed');
    expect(session.layout).toBe('small');
    press('Control+Shift+L', 'Released');
    expect(session.layout).toBe('small');
    press('Control+Shift+L', 'Pressed');
    expect(session.layout).toBe('scene');

    const hold = vi.spyOn(session, 'holdKey');
    press('F9', 'Pressed');
    press('F9', 'Released');
    expect(hold.mock.calls).toEqual([[true], [false]]);
    stop();
  });

  it('a changed key lets the old one go; a typing key is never taken, and the screen says why', async () => {
    const session = new Session();
    const { held, shortcuts } = fake();
    const stop = $effect.root(() => keysFollow(session, shortcuts));
    await settle();
    session.saveSettings({ ...session.settings, key: { on: true, code: 'KeyV' } } as Settings);
    await settle();
    expect([...held.keys()]).toEqual(['Control+Shift+L']);
    expect(session.keysSaid).toMatch(/écrit/);
    session.saveSettings({ ...session.settings, key: { on: false, code: 'F8' } } as Settings);
    await settle();
    expect([...held.keys()]).toEqual(['Control+Shift+L']);
    expect(session.keysSaid).toBe('');
    stop();
  });

  it('a key another app holds: said on the screen, the rest still works', async () => {
    const session = new Session();
    const { held, shortcuts } = fake(['F9']);
    const stop = $effect.root(() => keysFollow(session, shortcuts));
    await settle();
    expect([...held.keys()]).toEqual(['Control+Shift+L']);
    expect(session.keysSaid).toMatch(/F9 déjà prise/);
    stop();
  });
});
