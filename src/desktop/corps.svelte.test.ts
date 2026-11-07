import { flushSync } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ n: 0 }));
vi.mock('@tauri-apps/api/core', async (real) => ({
  ...(await real<typeof import('@tauri-apps/api/core')>()),
  invoke: async (command: string) => {
    calls.n++;
    if (command === 'body_config') return '{"repos":"r.png"}';
    return new Uint8Array([1]).buffer;
  },
}));

const { bodyFollows, reloadBody } = await import('./corps.svelte.ts');
const { Session } = await import('../session.svelte.ts');

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn());
  calls.n = 0;
});

describe('bodyFollows', () => {
  it('reads the folder once, then again only when the folder changes: the new body never loops back', async () => {
    localStorage.setItem('luxuria.settings', JSON.stringify({ body: { folder: 'D:\\corps' } }));
    const session = new Session();
    const stop = $effect.root(() => bodyFollows(session));
    flushSync();
    await new Promise((r) => setTimeout(r, 50));
    flushSync();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.n).toBe(2); // corps.json, then the rest image
    expect(session.bodyView?.level).toBe('images');

    session.saveSettings({ ...session.settings, body: { ...session.settings.body, folder: 'D:\\autre' } });
    flushSync();
    await new Promise((r) => setTimeout(r, 50));
    flushSync();
    expect(calls.n).toBe(4);

    // Any other setting saved replaces the whole settings object: the folder is the same, nothing is read.
    session.saveSettings({
      ...session.settings,
      display: { ...session.settings.display, shortcut: 'Alt+L' },
    });
    flushSync();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.n).toBe(4);
    stop();
  });
});

describe('reloadBody', () => {
  it('two readings crossed: the last one shows, the late one lets its images go', async () => {
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const session = new Session();
    const view = (n: string) => ({ level: 'images' as const, rest: `blob:${n}`, talking: '', crop: null });
    let first!: (v: { view: ReturnType<typeof view>; said: string }) => void;
    const slow = reloadBody(session, () => new Promise((r) => (first = r)));
    await reloadBody(session, async () => ({ view: view('neuf'), said: '' }));
    first({ view: view('vieux'), said: '' });
    await slow;
    expect(session.bodyView?.rest).toBe('blob:neuf');
    expect(revoked).toHaveBeenCalledWith('blob:vieux');
    expect(revoked).not.toHaveBeenCalledWith('blob:neuf');
    revoked.mockRestore();
  });
});
