import { describe, expect, it } from 'vitest';
import { busyWith, synthesize, transcribe } from './voice.ts';

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

  it('busy: another app, unless it is ignored or the browser holding it for this page', () => {
    expect(busyWith(['discord.exe'], [])).toBe(true);
    expect(busyWith(['OBS64.exe'], ['obs64.exe'])).toBe(false);
    expect(busyWith(['chrome.exe'], [])).toBe(false);
    expect(busyWith([], [])).toBe(false);
  });
});
