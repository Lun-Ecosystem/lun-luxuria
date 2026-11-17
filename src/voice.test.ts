import { describe, expect, it } from 'vitest';
import { appsOnMicrophone, busyWith, synthesize, transcribe } from './voice.ts';

describe('the local voice', () => {
  it('sends raw samples and reads what was heard', async () => {
    const bodies: unknown[] = [];
    const f = (async (_: string, init: RequestInit) => {
      bodies.push(init.body);
      return Response.json({ text: 'salut', confidence: 0.8, ms: 3 });
    }) as unknown as typeof fetch;
    expect(await transcribe(new Float32Array([1, 2]), f)).toEqual({ text: 'salut', confidence: 0.8 });
    expect((bodies[0] as ArrayBuffer).byteLength).toBe(8);
  });

  it('a transcription can be cut: its signal goes to fetch', async () => {
    const inits: RequestInit[] = [];
    const f = (async (_: string, init: RequestInit) => {
      inits.push(init);
      return Response.json({ text: '', confidence: 0 });
    }) as unknown as typeof fetch;
    const stop = new AbortController();
    await transcribe(new Float32Array(1), f, stop.signal);
    expect(inits[0]!.signal).toBe(stop.signal);
  });

  it('a service that does not answer is named, a refusal keeps its status', async () => {
    const down = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(transcribe(new Float32Array(1), down)).rejects.toThrow('le service voix ne répond pas');
    await expect(synthesize('x', down)).rejects.toThrow('le service voix ne répond pas');
    const refused = (async () => new Response('', { status: 502 })) as typeof fetch;
    await expect(transcribe(new Float32Array(1), refused)).rejects.toThrow('transcription refusée (502)');
  });

  it('reads a clip at its own rate; a refusal throws, to be shown', async () => {
    const ok = (async () =>
      new Response(new Float32Array([0.5]).buffer, {
        headers: { 'x-sample-rate': '48000' },
      })) as unknown as typeof fetch;
    const clip = await synthesize('a', ok);
    expect(clip.rate).toBe(48000);
    expect(clip.samples[0]).toBe(0.5);
    const no = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    await expect(synthesize('a', no)).rejects.toThrow('500');
  });

  describe('the poll of the microphone', () => {
    const answering = (status: number, body: unknown = { apps: ['discord.exe'] }) =>
      (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

    it('an answer lists the apps that hold the microphone', async () => {
      expect(await appsOnMicrophone(answering(200))).toEqual(['discord.exe']);
    });

    it('its signal goes to fetch, to give up on a service that hangs', async () => {
      const seen: (AbortSignal | null | undefined)[] = [];
      const f = (async (_: string, init?: RequestInit) => {
        seen.push(init?.signal);
        return Response.json({ apps: [] });
      }) as unknown as typeof fetch;
      const stop = new AbortController();
      await appsOnMicrophone(f, stop.signal);
      expect(seen[0]).toBe(stop.signal);
    });

    it('a 404 is no detection, not a failure: an empty list', async () => {
      expect(await appsOnMicrophone(answering(404, {}))).toEqual([]);
    });

    it('any other refusal, the 502 of the proxy among them, is a failure, not an empty list', async () => {
      await expect(appsOnMicrophone(answering(502, {}))).rejects.toThrow();
      await expect(appsOnMicrophone(answering(500, {}))).rejects.toThrow();
    });

    it('a service that does not answer is a failure too', async () => {
      const down = (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch;
      await expect(appsOnMicrophone(down)).rejects.toThrow();
    });
  });

  it('busy: another app, unless it is ignored or the browser holding it for this page', () => {
    expect(busyWith(['discord.exe'], [])).toBe(true);
    expect(busyWith(['OBS64.exe'], ['obs64.exe'])).toBe(false);
    expect(busyWith(['chrome.exe'], [])).toBe(false);
    expect(busyWith([], [])).toBe(false);
  });
});
