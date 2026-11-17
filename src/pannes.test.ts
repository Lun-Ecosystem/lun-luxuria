import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Sentences that end only when the test says so: a reply is said one sentence at a time.
const out = vi.hoisted(() => ({
  open: vi.fn(async () => ({ stop: vi.fn() })),
  ends: [] as (() => void)[],
}));
vi.mock('./audio.ts', () => ({
  openMicrophone: out.open,
  webOutput: () => ({
    play: (_clip: unknown, onEnd: () => void) => {
      out.ends.push(onEnd);
      return { stop() {}, heard: () => 0 };
    },
    level: () => 0,
  }),
}));

import type { LiveEvent, Message } from './brain.ts';
import { Session } from './session.svelte.ts';
import { DEFAULTS, type Settings } from './settings.ts';

type Answer = 'ok' | '502' | '404' | 'hang' | 'down';

/** The voice service and the server as the tests need them: each answer is set, and each call is counted. */
function world(opts: { detection?: boolean; settings?: Partial<Settings> } = {}) {
  const w = {
    micro: 'ok' as Answer,
    apps: [] as string[],
    tts: 'ok' as Answer | 'held',
    stt: 'ok' as Answer | 'held',
    heard: 'bonjour',
    beat: 'taken' as 'taken' | 'gone' | 'throw',
    asked: { micro: 0, tts: 0, stt: 0 },
    signals: [] as (AbortSignal | null | undefined)[],
    pending: [] as (() => void)[],
    live: null as null | ((e: LiveEvent) => void),
    link: null as null | ((up: boolean) => void),
    s: null as unknown as Session,
  };
  const clip = () => new Response(new Float32Array([0.1]).buffer, { headers: { 'x-sample-rate': '22050' } });
  const reply = (mode: Answer | 'held', init?: RequestInit, ok: () => Response = clip): Promise<Response> => {
    if (mode === 'down') return Promise.reject(new TypeError('Failed to fetch'));
    if (mode === '502' || mode === '404') return Promise.resolve(new Response('', { status: Number(mode) }));
    if (mode === 'hang' || mode === 'held')
      return new Promise<Response>((resolve, reject) => {
        w.pending.push(() => resolve(ok()));
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    return Promise.resolve(ok());
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (path.includes('/voix/micro')) {
        w.asked.micro++;
        w.signals.push(init?.signal);
        return reply(w.micro, init, () => Response.json({ apps: w.apps }));
      }
      if (path.includes('/voix/tts')) {
        w.asked.tts++;
        return reply(w.tts, init);
      }
      if (path.includes('/voix/stt')) {
        w.asked.stt++;
        return reply(w.stt, init, () => Response.json({ text: w.heard, confidence: 0.9 }));
      }
      return Response.json({});
    }),
  );
  localStorage.setItem(
    'luxuria.settings',
    JSON.stringify({
      brain: 'linked',
      busy: { ...DEFAULTS.busy, on: opts.detection ?? false },
      // These frames are a level, not a voice; one sentence is one send.
      endOfSpeech: { ...DEFAULTS.endOfSpeech, model: false, speculate: false },
      ...opts.settings,
    }),
  );
  localStorage.setItem('luxuria.token', 't');
  localStorage.setItem('luxuria.mic', 'on');
  const s = (w.s = new Session());
  s.core.presence = vi.fn(async (state: 'started' | 'beat' | 'stopped') => {
    if (state !== 'beat') return undefined;
    if (w.beat === 'throw') throw new Error('hors ligne');
    return w.beat;
  }) as typeof s.core.presence;
  s.core.live = vi.fn((on: (e: LiveEvent) => void, link: (up: boolean) => void) => {
    w.live = on;
    w.link = link;
    return new Promise<void>(() => {});
  });
  s.core.thread = vi.fn(async () => []);
  s.core.send = vi.fn(async () => {});
  s.core.cut = vi.fn(async () => new Response()) as typeof s.core.cut;
  return w;
}

const words = (w: ReturnType<typeof world>, id: number, n: number, text = `phrase ${n}`) =>
  w.live!({ type: 'speech', id, n, text, why: 'reply' });
/** The reply's sentence that sounds now is over: the next one may come. */
const endSentence = () => out.ends.shift()!();
const flushAll = async () => {
  await vi.advanceTimersByTimeAsync(10);
};
/** Her voice fails on a sentence: the text of the failure says so. */
async function voiceFails(w: ReturnType<typeof world>, id = 1) {
  w.tts = '502';
  words(w, id, 1);
  w.live!({ type: 'speech-end', id, why: 'reply' });
  await flushAll();
  expect(w.s.failure).toMatch(/voix/i);
  w.tts = 'ok';
}
/** Her words sound, then she is cut and the server does not take the cut: a server failure of reply `id`. */
async function serverFails(w: ReturnType<typeof world>, id = 1) {
  words(w, id, 1);
  await flushAll();
  w.s.core.cut = vi.fn(async () => {
    throw new Error('hors ligne');
  });
  w.s.silence();
  await flushAll();
  expect(w.s.failure).toContain('Coupure non transmise');
}
/** A refusal of the server on a written message: kept until she speaks. */
async function refused(w: ReturnType<typeof world>) {
  w.s.core.send = vi.fn(async (_t, _o, on) => {
    on({
      type: 'done',
      message: {
        id: 3,
        role: 'assistant',
        text: '',
        status: 'error',
        surface: 'desktop',
        at: '',
        error: 'Plafond atteint',
      } as Message,
    });
  }) as typeof w.s.core.send;
  await w.s.write('bonjour');
  expect(w.s.failure).toContain('Plafond');
}

beforeEach(() => {
  localStorage.clear();
  out.ends.length = 0;
  out.open.mockClear();
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a voice failure, and the poll of the service', () => {
  it('a 502 poll keeps the voice failure', async () => {
    const w = world({ detection: true });
    await w.s.enter();
    await voiceFails(w);
    w.micro = '502';
    await vi.advanceTimersByTimeAsync(9000);
    expect(w.asked.micro).toBeGreaterThan(0);
    // A 502 of the proxy is a service that is down, not an empty list: the message stays.
    expect(w.s.failure).not.toBe('');
    w.micro = 'ok';
    await vi.advanceTimersByTimeAsync(3000);
    expect(w.s.failure).toBe('');
  });

  it('a 502 poll with nothing on screen says the voice service no longer answers', async () => {
    const w = world({ detection: true });
    w.micro = '502';
    await w.s.enter();
    await vi.advanceTimersByTimeAsync(3000);
    expect(w.s.failure).toBe('Le service voix ne répond plus.');
  });

  it('a voice failure goes when a poll answers again', async () => {
    const w = world({ detection: true });
    await w.s.enter();
    await voiceFails(w);
    await vi.advanceTimersByTimeAsync(3000);
    expect(w.s.failure).toBe('');
  });

  it('detection off: a voice failure goes when the service answers again', async () => {
    const w = world({ detection: false });
    w.apps = ['discord.exe'];
    await w.s.enter();
    // Nothing on screen: nothing is asked, as before.
    await vi.advanceTimersByTimeAsync(6000);
    expect(w.asked.micro).toBe(0);
    await voiceFails(w);
    await vi.advanceTimersByTimeAsync(3000);
    expect(w.asked.micro).toBeGreaterThan(0);
    expect(w.s.failure).toBe('');
    // The answer is for the return of the service only: another app on the microphone changes nothing.
    expect(w.s.busy).toBe(false);
    expect(w.s.capturing).toBe(true);
    expect(out.open).toHaveBeenCalledTimes(1);
    // The message gone, the poll stops.
    const asked = w.asked.micro;
    await vi.advanceTimersByTimeAsync(9000);
    expect(w.asked.micro).toBe(asked);
  });

  it('detection off, the service still down: the poll goes on, and the microphone is left alone', async () => {
    const w = world({ detection: false });
    await w.s.enter();
    await voiceFails(w);
    w.micro = '502';
    await vi.advanceTimersByTimeAsync(9000);
    expect(w.asked.micro).toBeGreaterThan(1);
    expect(w.s.failure).not.toBe('');
    expect(w.s.busy).toBe(false);
    expect(out.open).toHaveBeenCalledTimes(1);
  });

  it('a voice service that hangs: the poll gives up at its guard and says so once', async () => {
    const w = world({ detection: true });
    w.micro = 'hang';
    await w.s.enter();
    await vi.advanceTimersByTimeAsync(3000);
    expect(w.asked.micro).toBe(1);
    expect(w.s.failure).toBe('');
    // 3 s after it left, the poll gives up: its request is cut, and the screen says so.
    await vi.advanceTimersByTimeAsync(3000);
    expect(w.s.failure).toBe('Le service voix ne répond plus.');
    expect(w.signals[0]?.aborted).toBe(true);
    // Its guard freed it: the next turns ask again, and still say nothing more.
    await refused(w);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(w.asked.micro).toBeGreaterThan(2);
    expect(w.s.failure).toContain('Plafond');
  });

  it('a 404 poll is no detection, not a failure', async () => {
    const w = world({ detection: true });
    w.micro = '404';
    w.apps = ['discord.exe'];
    await w.s.enter();
    await vi.advanceTimersByTimeAsync(9000);
    expect(w.asked.micro).toBeGreaterThan(0);
    expect(w.s.failure).toBe('');
    expect(w.s.busy).toBe(false);
  });

  it('a 404 poll shows the service answers: it clears the message the poll itself put', async () => {
    const w = world({ detection: true });
    w.micro = '502';
    await w.s.enter();
    await vi.advanceTimersByTimeAsync(3000);
    expect(w.s.failure).toBe('Le service voix ne répond plus.');
    w.micro = '404';
    await vi.advanceTimersByTimeAsync(3000);
    expect(w.s.failure).toBe('');
  });

  it('a 404 poll does not clear a failure of her voice: only a real answer does', async () => {
    const w = world({ detection: true });
    await w.s.enter();
    await voiceFails(w);
    w.micro = '404';
    await vi.advanceTimersByTimeAsync(9000);
    expect(w.s.failure).toMatch(/voix/i);
    w.micro = 'ok';
    await vi.advanceTimersByTimeAsync(3000);
    expect(w.s.failure).toBe('');
  });
});

describe('a server failure', () => {
  it('a server failure goes when the live stream comes back', async () => {
    const w = world();
    await w.s.enter();
    await serverFails(w);
    w.link!(false);
    await flushAll();
    expect(w.s.failure).toContain('Coupure non transmise');
    w.link!(true);
    await flushAll();
    expect(w.s.failure).toBe('');
  });

  it.each(['taken', 'gone'] as const)('a server failure goes when a beat answers %s', async (answer) => {
    const w = world();
    await w.s.enter();
    await serverFails(w);
    w.beat = answer;
    await vi.advanceTimersByTimeAsync(29_000);
    expect(w.s.failure).toContain('Coupure non transmise');
    await vi.advanceTimersByTimeAsync(1000);
    expect(w.s.failure).toBe('');
  });

  it('a beat that does not answer keeps it', async () => {
    const w = world();
    await w.s.enter();
    await serverFails(w);
    w.beat = 'throw';
    await vi.advanceTimersByTimeAsync(90_000);
    expect(w.s.failure).toContain('Coupure non transmise');
  });

  it('a reply of a later turn, said, shows the server answers', async () => {
    const w = world();
    await w.s.enter();
    await serverFails(w, 1);
    words(w, 2, 1);
    await flushAll();
    expect(w.s.failure).toBe('');
  });
});

describe('what stays', () => {
  it('a refusal stays until she speaks', async () => {
    const w = world({ detection: true });
    await w.s.enter();
    await refused(w);
    w.link!(false);
    w.link!(true);
    w.beat = 'taken';
    await vi.advanceTimersByTimeAsync(60_000);
    expect(w.asked.micro).toBeGreaterThan(0);
    expect(w.s.failure).toContain('Plafond');
    words(w, 4, 1);
    await flushAll();
    expect(w.s.failure).toBe('');
  });

  it('a failure of the other service stays: the server answering does not clear the voice', async () => {
    const w = world();
    await w.s.enter();
    await voiceFails(w);
    // The voice service is still down while the server comes back: its poll, detection off, does not clear it either.
    w.micro = '502';
    w.link!(false);
    w.link!(true);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(w.s.failure).toMatch(/voix/i);
    w.beat = 'gone';
    await vi.advanceTimersByTimeAsync(30_000);
    expect(w.s.failure).toMatch(/voix/i);
  });

  it('a failure of the other service stays: the voice answering does not clear the server', async () => {
    const w = world({ detection: true });
    await w.s.enter();
    await serverFails(w);
    await vi.advanceTimersByTimeAsync(9000);
    expect(w.asked.micro).toBeGreaterThan(0);
    expect(w.s.failure).toContain('Coupure non transmise');
    w.micro = '404';
    await vi.advanceTimersByTimeAsync(9000);
    expect(w.s.failure).toContain('Coupure non transmise');
  });
});

describe('a message is cleared only by a more recent reply', () => {
  it('a voice failure goes when a later reply is said: the voice answers', async () => {
    const w = world();
    await w.s.enter();
    await voiceFails(w, 1);
    words(w, 2, 1);
    // Reply 1 is only read on screen for a moment before reply 2 comes.
    await vi.advanceTimersByTimeAsync(5000);
    expect(w.s.failure).toBe('');
  });

  it('a service failure with no reply: the words of a reply received before it do not clear it', async () => {
    const w = world({ detection: true });
    await w.s.enter();
    // Reply 1 sounds its first sentence, its second waits.
    words(w, 1, 1);
    words(w, 1, 2);
    await flushAll();
    expect(out.ends).toHaveLength(1);
    w.micro = '502';
    await vi.advanceTimersByTimeAsync(3000);
    expect(w.s.failure).toBe('Le service voix ne répond plus.');
    endSentence();
    await flushAll();
    expect(out.ends).toHaveLength(1); // the second sentence of reply 1 sounds
    expect(w.s.failure).toBe('Le service voix ne répond plus.');
  });

  it('a service failure with no reply: a reply received after it clears it, once said', async () => {
    const w = world({ detection: true });
    await w.s.enter();
    words(w, 1, 1);
    await flushAll();
    w.micro = '502';
    await vi.advanceTimersByTimeAsync(3000);
    expect(w.s.failure).toBe('Le service voix ne répond plus.');
    w.micro = 'hang';
    w.live!({ type: 'speech-end', id: 1, why: 'reply' });
    words(w, 2, 1);
    endSentence();
    await flushAll();
    expect(w.s.failure).toBe('');
  });

  it('an error then the words of its own reply: the message stays', async () => {
    // A reply whose words are held back, then its error: « réfléchit » off, the message, then the first sound.
    const w = world();
    w.tts = 'held';
    const sent = vi.fn();
    let fail: () => void = () => {};
    w.s.core.send = vi.fn(async (_t, _o, on) => {
      sent();
      on({ type: 'reply', id: 7 });
      await new Promise<void>((r) => (fail = r));
      throw new Error('hors ligne');
    }) as typeof w.s.core.send;
    await w.s.enter();
    await said(w);
    await vi.waitFor(() => expect(sent).toHaveBeenCalled());
    words(w, 7, 1);
    await flushAll();
    fail();
    await flushAll();
    expect(w.s.failure).toContain('Sa réponse n’est pas venue');
    // Its words reach their first sound only now.
    w.pending.forEach((release) => release());
    await flushAll();
    expect(out.ends.length).toBeGreaterThan(0);
    expect(w.s.failure).toContain('Sa réponse n’est pas venue');
  });

  it('an error then the next reply: it clears the message', async () => {
    const w = world();
    w.tts = 'held';
    let fail: () => void = () => {};
    w.s.core.send = vi.fn(async (_t, _o, on) => {
      on({ type: 'reply', id: 7 });
      await new Promise<void>((r) => (fail = r));
      throw new Error('hors ligne');
    }) as typeof w.s.core.send;
    await w.s.enter();
    await said(w);
    await vi.waitFor(() => expect(w.s.core.send).toHaveBeenCalled());
    words(w, 7, 1);
    await flushAll();
    fail();
    await flushAll();
    expect(w.s.failure).toContain('Sa réponse n’est pas venue');
    // Reply 7 sounds its words (the message stays), then reply 8 is said.
    w.tts = 'ok';
    w.pending.forEach((release) => release());
    await flushAll();
    endSentence();
    words(w, 8, 1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(w.s.failure).toBe('');
  });

  it('an error during a suspension: the phrase that resumes does not clear it', async () => {
    const w = world({ detection: true });
    w.heard = '';
    await w.s.enter();
    words(w, 1, 1);
    words(w, 1, 2);
    await flushAll();
    expect(out.ends).toHaveLength(1);
    // A sound over her voice: she falls silent, and waits for the verdict on it, which is slow.
    w.micro = '502';
    w.stt = 'held';
    await said(w);
    await vi.advanceTimersByTimeAsync(3000);
    expect(w.s.failure).toBe('Le service voix ne répond plus.');
    const sounds = out.ends.length;
    // It was not for her: she goes on with her reply, and its words do not clear a message older than her return.
    w.pending.splice(0).forEach((release) => release());
    await vi.advanceTimersByTimeAsync(1000);
    expect(out.ends.length).toBe(sounds + 1); // her reply sounds again
    expect(w.s.subtitle).toMatch(/^phrase/);
    expect(w.s.failure).toBe('Le service voix ne répond plus.');
  });
});

/** Alone on a model: no stream comes back, no beat answers; the model answers as the test sets it. */
function alone() {
  const w = world({
    detection: true,
    settings: { brain: 'alone', model: { ...DEFAULTS.model, name: 'test' } },
  });
  const m = { answer: 'ok' as 'ok' | '502' | 'hang' };
  const voice = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (!String(url).includes('/chat/completions')) return voice(url, init);
      if (m.answer === '502') return new Response('', { status: 502 });
      if (m.answer === 'hang')
        return new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
        );
      const frame = JSON.stringify({ choices: [{ delta: { content: 'Je suis là.' } }] });
      return new Response(`data: ${frame}\n\ndata: [DONE]\n\n`);
    }),
  );
  return { w, m };
}

describe('alone, on a model', () => {
  it('a model that fails: no service to wait for, the message stays until the next reply is said', async () => {
    const { w, m } = alone();
    m.answer = '502';
    await w.s.enter();
    await said(w);
    await flushAll();
    expect(w.s.failure).toBe('Le modèle a répondu 502.');
    // The voice service answers its polls, and beats answer nothing alone: neither clears it.
    await vi.advanceTimersByTimeAsync(90_000);
    expect(w.asked.micro).toBeGreaterThan(0);
    expect(w.s.failure).toBe('Le modèle a répondu 502.');
    m.answer = 'ok';
    await said(w);
    await vi.advanceTimersByTimeAsync(1000);
    expect(w.s.subtitle).toBe('Je suis là.');
    expect(w.s.failure).toBe('');
  });

  it('a model that hangs: the guard says it, a server failure, kept until the next reply is said', async () => {
    const { w, m } = alone();
    m.answer = 'hang';
    await w.s.enter();
    await said(w);
    await vi.advanceTimersByTimeAsync(60_000);
    const guard = 'Sa réponse n’est pas venue : aucune phrase en 60 s';
    expect(w.s.failure).toBe(guard);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(w.s.failure).toBe(guard);
    m.answer = 'ok';
    await said(w);
    await vi.advanceTimersByTimeAsync(1000);
    expect(w.s.subtitle).toBe('Je suis là.');
    expect(w.s.failure).toBe('');
  });
});

describe('the mute', () => {
  it('a message shown before it: what she does not say clears nothing, the first reply she says after does', async () => {
    const w = world();
    await w.s.enter();
    await serverFails(w, 1);
    w.beat = 'throw';
    w.s.toggleMute();
    // A reply that comes under the mute is not said.
    words(w, 2, 1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(w.s.subtitle).not.toMatch(/^phrase/);
    expect(w.s.failure).toContain('Coupure non transmise');
    w.s.toggleMute();
    await flushAll();
    expect(w.s.failure).toContain('Coupure non transmise');
    words(w, 3, 1);
    await flushAll();
    expect(w.s.failure).toBe('');
  });

  it('under the mute, the poll goes on: a voice failure goes when the service answers, the microphone stays closed', async () => {
    const w = world({ detection: true });
    await w.s.enter();
    await voiceFails(w);
    w.micro = '502';
    w.s.toggleMute();
    await vi.advanceTimersByTimeAsync(6000);
    expect(w.asked.micro).toBeGreaterThan(0);
    expect(w.s.failure).toMatch(/voix/i);
    w.micro = 'ok';
    await vi.advanceTimersByTimeAsync(3000);
    expect(w.s.failure).toBe('');
    expect(w.s.silenced).toBe(true);
    expect(w.s.capturing).toBe(false);
  });
});

/** He talks into the microphone: loud frames, then silence, 32 ms each, as the worklet gives them. */
async function said(w: ReturnType<typeof world>, loud = 20, quiet = 40) {
  const onFrame = (out.open.mock.calls.at(-1) as unknown as [unknown, (f: Float32Array) => void])[1];
  const hi = new Float32Array(512).fill(0.3);
  const lo = new Float32Array(512);
  for (let i = 0; i < loud + quiet; i++) {
    await vi.advanceTimersByTimeAsync(32);
    onFrame(i < loud ? hi : lo);
  }
  void w;
}
