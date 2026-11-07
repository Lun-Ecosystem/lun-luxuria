import { describe, expect, it } from 'vitest';
import { frames, type LiveEvent } from './brain.ts';
import { CoreClient, CoreError } from './core.ts';

const stream = (...chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const x of chunks) c.enqueue(new TextEncoder().encode(x));
      c.close();
    },
  });

describe('the stream frames', () => {
  it('whatever the chunks, ignoring pings', async () => {
    const out = [];
    for await (const f of frames(
      stream('event: a\nda', 'ta: {"x":1}\n\n: ping\n\nevent: b\r\ndata: 2\r\n\r\n'),
    ))
      out.push(f);
    expect(out).toEqual([
      { event: 'a', data: '{"x":1}' },
      { event: 'b', data: '2' },
    ]);
  });
});

describe('the client of the core', () => {
  it('sends with the token, and reads a turn', async () => {
    const asked: [string, RequestInit][] = [];
    const client = new CoreClient('t', (async (url: string, init: RequestInit) => {
      asked.push([url, init]);
      return new Response(
        stream(
          'event: user\ndata: {"id":4}\n\nevent: reply\ndata: {"id":5}\n\nevent: done\ndata: {"id":5}\n\n',
        ),
      );
    }) as typeof fetch);
    const seen: string[] = [];
    await client.send('Salut', { surface: 'voice', confidence: 0.9 }, (e) => seen.push(e.type));
    expect(seen).toEqual(['user', 'reply', 'done']);
    expect(asked[0]![0]).toBe('/api/threads/main/messages');
    expect(JSON.parse(String(asked[0]![1].body))).toEqual({
      text: 'Salut',
      speak: true,
      surface: 'voice',
      confidence: 0.9,
    });
    expect(new Headers(asked[0]![1].headers).get('authorization')).toBe('Bearer t');
  });

  it('a refusal says what the core said', async () => {
    const client = new CoreClient(
      't',
      (async () =>
        new Response(JSON.stringify({ error: 'Non' }), { status: 404 })) as unknown as typeof fetch,
    );
    await expect(client.cut(1, '')).rejects.toEqual(new CoreError(404, 'Non'));
  });

  it('live reads events and stops on its signal', async () => {
    const stop = new AbortController();
    const heard: LiveEvent[] = [];
    const client = new CoreClient(
      't',
      (async () =>
        new Response(
          stream('event: speech\ndata: {"type":"speech","id":1,"n":1,"text":"a","why":"p0"}\n\n'),
        )) as unknown as typeof fetch,
    );
    const links: boolean[] = [];
    const run = client.live(
      (e) => {
        heard.push(e);
        stop.abort();
      },
      (up) => links.push(up),
      stop.signal,
    );
    await run;
    expect(heard[0]).toMatchObject({ type: 'speech', why: 'p0' });
    expect(links[0]).toBe(true);
  });
});

describe('the presence', () => {
  it('asks the browser to finish the stop even if the page closes, and only the stop', async () => {
    const asked: [string, RequestInit][] = [];
    const client = new CoreClient('t', (async (url: string, init: RequestInit) => {
      asked.push([url, init]);
      return new Response(null, { status: 204 });
    }) as typeof fetch);
    await client.presence('started', { ritual: true });
    await client.presence('beat', { busy: false });
    await client.presence('stopped');
    expect(asked.map(([, init]) => init.keepalive)).toEqual([undefined, undefined, true]);
    const [url, init] = asked[2]!;
    expect(url).toBe('/api/presence');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ authorization: 'Bearer t' });
  });

  it('a beat the server does not take resolves to gone, any other refusal still throws', async () => {
    let status = 410;
    const client = new CoreClient('t', (async () =>
      status === 204 ? new Response(null, { status }) : Response.json({}, { status })) as typeof fetch);
    await expect(client.presence('beat', { busy: false })).resolves.toBe('gone');
    status = 204;
    await expect(client.presence('beat', { busy: false })).resolves.toBe('taken');
    status = 401;
    await expect(client.presence('beat', { busy: false })).rejects.toThrow();
    status = 410;
    await expect(client.presence('started')).rejects.toThrow();
  });

  it('names its tab, the same on every call, so closing another tab does not end this one', async () => {
    const bodies: { state: string; tab: string }[] = [];
    const client = new CoreClient('t', (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string) as { state: string; tab: string });
      return new Response(null, { status: 204 });
    }) as typeof fetch);
    await client.presence('started', { ritual: true });
    await client.presence('beat', { busy: false });
    await client.presence('stopped');
    expect(bodies.map((b) => b.state)).toEqual(['started', 'beat', 'stopped']);
    expect(bodies[0]!.tab).toMatch(/^[0-9a-f]{32}$/);
    expect(new Set(bodies.map((b) => b.tab)).size).toBe(1);
  });
});
