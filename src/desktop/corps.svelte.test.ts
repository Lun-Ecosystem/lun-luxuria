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

const { bodyFollows } = await import('./corps.svelte.ts');
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
    stop();
  });
});
