import { flushSync } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ n: 0, args: [] as unknown[] }));
vi.mock('@tauri-apps/api/core', async (real) => ({
  ...(await real<typeof import('@tauri-apps/api/core')>()),
  invoke: async (command: string, args?: unknown) => {
    calls.n++;
    calls.args.push(args ?? {});
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
  calls.args = [];
});

describe('bodyFollows', () => {
  it('reads the body when the window opens, and no setting saved afterwards reads it again', async () => {
    const session = new Session();
    const stop = $effect.root(() => bodyFollows(session));
    flushSync();
    await new Promise((r) => setTimeout(r, 50));
    flushSync();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.n).toBe(2); // corps.json, then the rest image
    expect(session.bodyView?.level).toBe('images');

    // The old folder is only a reminder: changing it, or any other setting, reads nothing.
    session.saveSettings({
      ...session.settings,
      body: { ...session.settings.body, formerFolder: 'C:\\corps' },
    });
    flushSync();
    await new Promise((r) => setTimeout(r, 50));
    session.saveSettings({
      ...session.settings,
      display: { ...session.settings.display, shortcut: 'Alt+L' },
    });
    flushSync();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.n).toBe(2);
    stop();
  });

  it('never names a folder to the window, even with an old one saved', async () => {
    localStorage.setItem('luxuria.settings', JSON.stringify({ body: { folder: 'C:\\corps' } }));
    const session = new Session();
    const stop = $effect.root(() => bodyFollows(session));
    flushSync();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.n).toBeGreaterThan(0);
    expect(JSON.stringify(calls.args)).not.toMatch(/folder|C:/);
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
