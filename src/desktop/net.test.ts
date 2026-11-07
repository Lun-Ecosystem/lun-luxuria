import { describe, expect, it, vi } from 'vitest';
import { routes, serverWarning } from './net.ts';

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
    expect(http.f).toHaveBeenCalledWith('http://127.0.0.1:8788/api/presence', init);
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
