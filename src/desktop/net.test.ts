import { describe, expect, it, vi } from 'vitest';

// What the page asks of the window, counted here: a request must never ask for an address to be confirmed.
const invoke = vi.hoisted(() => vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(async () => null));
vi.mock('@tauri-apps/api/core', async (real) => ({
  ...(await real<typeof import('@tauri-apps/api/core')>()),
  invoke,
}));

const { routes, serverWarning } = await import('./net.ts');

const seen = () => {
  const calls: string[] = [];
  const f = vi.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response('{}');
  }) as unknown as typeof fetch;
  return { calls, f };
};

describe('the window sends the page’s paths where the browser’s proxy did', () => {
  it('the server’s paths go to the server’s address, by the window’s fetch', async () => {
    const http = seen();
    const native = seen();
    const net = routes(() => 'http://127.0.0.1:8788/', http.f, native.f);
    await net.server('/api/threads/main/messages?limit=50', { method: 'GET' });
    await net.server('https://modele.exemple/v1/chat/completions');
    expect(http.calls).toEqual([
      'http://127.0.0.1:8788/api/threads/main/messages?limit=50',
      'https://modele.exemple/v1/chat/completions',
    ]);
    expect(native.calls).toEqual([]);
  });

  it('a server in clear on the network gets nothing: no code, no token leaves', async () => {
    const http = seen();
    const net = routes(() => 'http://machine.exemple:8788', http.f, seen().f);
    await expect(net.server('/api/pair', { method: 'POST' })).rejects.toThrow(/en clair/);
    expect(http.calls).toEqual([]);
  });

  it('follows a changed address at the next call', async () => {
    const http = seen();
    let address = 'http://127.0.0.1:8788';
    const net = routes(() => address, http.f, seen().f);
    address = 'https://serveur.exemple';
    await net.server('/api/live');
    expect(http.calls).toEqual(['https://serveur.exemple/api/live']);
  });

  it('the voice stays on the native fetch, on this machine: the audio never crosses into the window', async () => {
    const http = seen();
    const native = seen();
    const net = routes(() => 'http://127.0.0.1:8788', http.f, native.f);
    await net.voice('/voix/stt', { method: 'POST' });
    await net.voice('/voix/micro');
    expect(native.calls).toEqual(['http://127.0.0.1:8793/stt', 'http://127.0.0.1:8793/micro']);
    expect(http.calls).toEqual([]);
  });

  it('passes the request options through', async () => {
    const http = seen();
    const net = routes(() => 'http://127.0.0.1:8788', http.f, seen().f);
    const init = { method: 'POST', body: '{}' };
    await net.server('/api/presence', init);
    expect(http.f).toHaveBeenCalledWith('http://127.0.0.1:8788/api/presence', {
      ...init,
      maxRedirections: 0,
    });
  });
});

describe('the window follows no redirection, and takes no proxy', () => {
  it('a server path goes with maxRedirections at 0, whatever the options', async () => {
    const http = seen();
    const net = routes(() => 'http://127.0.0.1:8788', http.f, seen().f);
    await net.server('/api/live');
    await net.server('/api/threads', { method: 'GET', headers: { a: 'b' } });
    expect(http.f).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:8788/api/live', { maxRedirections: 0 });
    expect(http.f).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:8788/api/threads', {
      method: 'GET',
      headers: { a: 'b' },
      maxRedirections: 0,
    });
  });

  it('the model’s absolute address goes the same way', async () => {
    const http = seen();
    const net = routes(() => 'http://127.0.0.1:8788', http.f, seen().f);
    await net.server('https://modele.exemple/v1/chat/completions', { method: 'POST', body: '{}' });
    expect(http.f).toHaveBeenCalledWith('https://modele.exemple/v1/chat/completions', {
      method: 'POST',
      body: '{}',
      maxRedirections: 0,
    });
  });

  it('a redirection asked by the caller is not passed on: the page’s word wins, at 0', async () => {
    const http = seen();
    const net = routes(() => 'http://127.0.0.1:8788', http.f, seen().f);
    await net.server('/api/live', { maxRedirections: 5 } as RequestInit);
    await net.server('https://modele.exemple/v1/models', { maxRedirections: 5 } as RequestInit);
    expect(vi.mocked(http.f).mock.calls).toHaveLength(2);
    for (const call of vi.mocked(http.f).mock.calls)
      expect((call[1] as { maxRedirections: number }).maxRedirections).toBe(0);
  });

  it('the page never names a proxy', async () => {
    const http = seen();
    const net = routes(() => 'http://127.0.0.1:8788', http.f, seen().f);
    await net.server('/api/live');
    await net.server('https://modele.exemple/v1/models', { method: 'GET' });
    // Exactly the page's options and the redirection bound: no other key, so no proxy, ever.
    expect(vi.mocked(http.f).mock.calls.map((c) => c[1])).toEqual([
      { maxRedirections: 0 },
      { method: 'GET', maxRedirections: 0 },
    ]);
  });

  it('the voice is unchanged: the page’s own fetch, its options as they came', async () => {
    const native = seen();
    const net = routes(() => 'http://127.0.0.1:8788', seen().f, native.f);
    const init = { method: 'POST', body: 'x' };
    await net.voice('/voix/stt', init);
    expect(native.f).toHaveBeenCalledWith('http://127.0.0.1:8793/stt', init);
    expect(init).not.toHaveProperty('maxRedirections');
  });
});

describe('an address off this computer is confirmed in the settings, never at a call', () => {
  it('a request to an address Rust refuses shows Rust’s message, and asks nothing of the person', async () => {
    const said = 'Adresse non confirmée pour la fenêtre : https://serveur.exemple.';
    invoke.mockClear();
    // Tauri rejects with Rust's message, a string: it reaches the caller as it is.
    const http = vi.fn(async () => Promise.reject(said)) as unknown as typeof fetch;
    const net = routes(() => 'https://serveur.exemple', http, seen().f);
    await expect(net.server('/api/live')).rejects.toBe(said);
    await expect(net.server('https://modele.exemple/v1/models')).rejects.toBe(said);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('a request that goes through asks nothing either', async () => {
    invoke.mockClear();
    const net = routes(() => 'https://serveur.exemple', seen().f, seen().f);
    await net.server('/api/live');
    await net.server('https://modele.exemple/v1/models');
    await net.voice('/voix/stt');
    expect(invoke.mock.calls.filter(([cmd]) => cmd === 'net_host_confirm')).toEqual([]);
  });
});

describe('serverWarning', () => {
  it('lets https and this machine pass, warns of a token in clear on the network', () => {
    expect(serverWarning('https://serveur.exemple')).toBeUndefined();
    expect(serverWarning('http://127.0.0.1:8788')).toBeUndefined();
    expect(serverWarning('http://localhost:8788')).toBeUndefined();
    expect(serverWarning('http://machine.exemple:8788')).toMatch(/clair/);
    expect(serverWarning('pas une adresse')).toMatch(/illisible/);
    expect(serverWarning('ftp://serveur.exemple')).toMatch(/illisible/);
  });
});
