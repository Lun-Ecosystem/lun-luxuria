import { describe, expect, it, vi } from 'vitest';
import type { LiveEvent, SendEvent } from './brain.ts';
import { LocalBrain, sentences, spoken, unsafeAddress } from './local.ts';
import { DEFAULTS, type Settings } from './settings.ts';

const settings = (model: Partial<Settings['model']> = {}): Settings => ({
  ...DEFAULTS,
  agent: { name: 'Mira', context: 'Sois brève.' },
  model: { ...DEFAULTS.model, name: 'test', ...model },
});

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: (k: string) => data.get(k) ?? null,
    set: (k: string, v: string) => void data.set(k, v),
  };
}

/** A model that streams these pieces, then its usage. */
function model(pieces: string[], tokens: number | undefined = 10) {
  const frames = [
    ...pieces.map((content) => JSON.stringify({ choices: [{ delta: { content } }] })),
    ...(tokens === undefined ? [] : [JSON.stringify({ choices: [], usage: { total_tokens: tokens } })]),
    '[DONE]',
  ];
  return vi.fn<typeof fetch>(
    async () => new Response(frames.map((f) => `data: ${f}\n\n`).join(''), { status: 200 }),
  );
}

function harness(
  f: typeof fetch,
  opts: { s?: Settings; store?: ReturnType<typeof memory>; now?: () => Date } = {},
) {
  const store = opts.store ?? memory();
  const brain = new LocalBrain(() => opts.s ?? settings(), store, f, opts.now);
  const heard: LiveEvent[] = [];
  const ctl = new AbortController();
  void brain.live(
    (e) => heard.push(e),
    () => {},
    ctl.signal,
  );
  const turn = async (text: string) => {
    const events: SendEvent[] = [];
    await brain.send(text, { surface: 'voice' }, (e) => events.push(e));
    return events;
  };
  return { brain, store, heard, turn };
}

const bodyOf = (f: ReturnType<typeof model>, call = 0) =>
  JSON.parse(f.mock.calls[call]![1]!.body as string) as {
    model: string;
    messages: { role: string; content: string }[];
  };

describe('sentences', () => {
  it('cuts on what ends a sentence, not on a number or a title', () => {
    expect(sentences('Salut. Ça coûte 3.5 € ? Oui ! M. Durand arr')).toEqual({
      done: ['Salut.', 'Ça coûte 3.5 € ?', 'Oui !'],
      rest: 'M. Durand arr',
    });
  });

  it('says the marks a model writes, and leaves the text it means', () => {
    expect(
      [
        '*Il pleut.',
        'Prends.*',
        '_Il pleut.',
        'Prends._',
        '![une carte](u.png)',
        '- [ ] acheter',
        '+ plus',
        '> > dit-il',
        '~~barré~~',
        '2*3*4 font 24',
        'ma_variable_longue',
      ].map(spoken),
    ).toEqual([
      'Il pleut.',
      'Prends.',
      'Il pleut.',
      'Prends.',
      'une carte',
      'acheter',
      'plus',
      'dit-il',
      'barré',
      '2*3*4 font 24',
      'ma_variable_longue',
    ]);
  });

  it('keeps a list number and a closing emphasis with their sentence', () => {
    expect(sentences('1. Acheter du pain.\n**Il pleut.** Prends').done).toEqual([
      '1. Acheter du pain.',
      '**Il pleut.**',
    ]);
  });
});

describe('unsafeAddress', () => {
  it('keeps a key off a clear line beyond this machine', () => {
    expect(unsafeAddress('http://127.0.0.1:11434/v1', 'k')).toBeUndefined();
    expect(unsafeAddress('https://exemple.org/v1', 'k')).toBeUndefined();
    expect(unsafeAddress('http://exemple.org/v1', '')).toBeUndefined();
    expect(unsafeAddress('http://exemple.org/v1', 'k')).toMatch(/https/);
    expect(unsafeAddress('file:///etc', '')).toMatch(/illisible/);
    expect(unsafeAddress('pas une adresse', '')).toMatch(/illisible/);
  });
});

describe('LocalBrain', () => {
  it('says the turn in the order the body needs: user, reply, sentences, end', async () => {
    const f = model(['Bon', 'jour. Comment ', 'vas-tu']);
    const { heard, turn } = harness(f as unknown as typeof fetch);
    const events = await turn('Salut');
    expect(events.map((e) => e.type).slice(0, 2)).toEqual(['user', 'reply']);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      message: { status: 'ok', text: 'Bonjour. Comment vas-tu' },
    });
    expect(heard.filter((e) => e.type !== 'message')).toEqual([
      { type: 'speech', id: 2, n: 1, text: 'Bonjour.', why: 'reply' },
      { type: 'speech', id: 2, n: 2, text: 'Comment vas-tu', why: 'reply' },
      { type: 'speech-end', id: 2, why: 'reply' },
    ]);
  });

  it('says the reply without its markdown, and the thread keeps it written', async () => {
    const text =
      '## Le temps\n**Il pleut.** Prends un `parapluie`.\n- _vraiment_ utile\n1. Voir [la carte](https://x.test/m)\n---\n> Bonne journée.';
    const f = model([text.slice(0, 20), text.slice(20)]);
    const { heard, turn } = harness(f as unknown as typeof fetch);
    const events = await turn('Météo ?');
    expect(events.at(-1)).toMatchObject({ type: 'done', message: { text } });
    const said = heard.flatMap((e) => (e.type === 'speech' ? [e] : []));
    expect(said.map((e) => e.text)).toEqual([
      'Le temps',
      'Il pleut.',
      'Prends un parapluie.',
      'vraiment utile',
      'Voir la carte',
      'Bonne journée.',
    ]);
    expect(said.map((e) => e.n)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('names the agent in the system turn, sends the key, keeps what was said in the context', async () => {
    const f = model(['Oui.']);
    const { turn } = harness(f as unknown as typeof fetch, {
      s: settings({ key: 'k', url: 'https://x.test/v1/' }),
    });
    await turn('Un');
    await turn('Deux');
    expect(f.mock.calls[0]![0]).toBe('https://x.test/v1/chat/completions');
    expect((f.mock.calls[0]![1]!.headers as Record<string, string>).authorization).toBe('Bearer k');
    const { model: name, messages } = bodyOf(f, 1);
    expect(name).toBe('test');
    expect(messages).toEqual([
      { role: 'system', content: 'Tu t’appelles Mira. Sois brève.' },
      { role: 'user', content: 'Un' },
      { role: 'assistant', content: 'Oui.' },
      { role: 'user', content: 'Deux' },
    ]);
  });

  it('calls nothing without a model, and says why in the turn', async () => {
    const f = model(['x']);
    const { turn } = harness(f as unknown as typeof fetch, { s: settings({ name: '' }) });
    const events = await turn('Salut');
    expect(f).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ type: 'done', message: { status: 'error' } });
  });

  it('stops before the call once the cap is reached; 0 means no cap', async () => {
    const f = model(['Oui.'], 60);
    const capped = harness(f as unknown as typeof fetch, { s: settings({ tokensPerDay: 100 }) });
    await capped.turn('Un');
    await capped.turn('Deux');
    const last = await capped.turn('Trois');
    expect(f).toHaveBeenCalledTimes(2);
    expect(last.at(-1)).toMatchObject({ message: { error: expect.stringMatching(/plafond/i) as string } });

    const free = model(['Oui.'], 1_000_000);
    const open = harness(free as unknown as typeof fetch, { s: settings({ tokensPerDay: 0 }) });
    await open.turn('Un');
    await open.turn('Deux');
    expect(free).toHaveBeenCalledTimes(2);
  });

  it('counts a call without a usage figure, and the cap comes back the next day', async () => {
    let now = new Date(2026, 10, 6, 12);
    const f = model(['Une réponse.'], undefined);
    const s = settings({ tokensPerDay: 1 });
    const { turn, store } = harness(f as unknown as typeof fetch, { s, now: () => now });
    await turn('Salut');
    await turn('Encore');
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.parse(store.data.get('luxuria.spent')!)).toMatchObject({
      tokens: expect.any(Number) as number,
    });
    now = new Date(2026, 10, 7, 9);
    await turn('Demain');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('a withdrawal aborts the call and leaves no trace in the thread or the context', async () => {
    const seen: AbortSignal[] = [];
    const f = vi.fn<typeof fetch>((...[, init]) => {
      seen.push(init!.signal!);
      return new Promise<Response>((_, reject) =>
        init!.signal!.addEventListener('abort', () => reject(new DOMException('stop', 'AbortError'))),
      );
    });
    const { brain, heard } = harness(f as unknown as typeof fetch);
    const events: SendEvent[] = [];
    const sent = brain.send('Je voudrais', { surface: 'voice' }, (e) => events.push(e));
    const user = events.find((e) => e.type === 'user')!;
    await brain.withdraw(user.message.id);
    await sent;
    expect(seen[0]!.aborted).toBe(true);
    expect(await brain.thread()).toEqual([]);
    expect(heard.some((e) => e.type === 'speech')).toBe(false);
  });

  it('a cut keeps only what was heard; nothing heard leaves nothing', async () => {
    const { brain, turn } = harness(model(['Une longue réponse.']) as unknown as typeof fetch);
    const first = await turn('Un');
    const id = (first.find((e) => e.type === 'reply') as { id: number }).id;
    await brain.cut(id, 'Une');
    expect((await brain.thread()).at(-1)).toMatchObject({ id, text: 'Une', status: 'partial' });
    await brain.cut(id, '');
    expect((await brain.thread()).map((m) => m.role)).toEqual(['user']);
  });

  it('a failing model ends the speech and says so', async () => {
    const f = vi.fn(async () => new Response('non', { status: 401 }));
    const { heard, turn } = harness(f as unknown as typeof fetch);
    const events = await turn('Salut');
    expect(events.at(-1)).toMatchObject({ message: { status: 'error', error: 'Le modèle a répondu 401.' } });
    expect(heard).toContainEqual({ type: 'speech-end', id: 2, why: 'reply' });
  });

  it('keeps the current day only: on reading, and on the disk', async () => {
    let now = new Date(2026, 10, 6, 22);
    const store = memory();
    const first = harness(model(['Oui.']) as unknown as typeof fetch, { store, now: () => now });
    await first.turn('Hier');
    expect(await first.brain.thread()).toHaveLength(2);
    now = new Date(2026, 10, 7, 8);
    const f = model(['Bonjour.']);
    const next = harness(f as unknown as typeof fetch, { store, now: () => now });
    expect(await next.brain.thread()).toEqual([]);
    expect(store.data.get('luxuria.thread')).toBe('[]');
    await next.turn('Salut');
    expect(bodyOf(f).messages.map((m) => m.content)).not.toContain('Hier');
  });

  it('a reply left unfinished by a closed window does not come back', async () => {
    const at = new Date().toISOString();
    const store = memory({
      'luxuria.thread': JSON.stringify([
        { id: 1, role: 'user', text: 'Salut', status: 'ok', surface: 'voice', at },
        { id: 2, role: 'assistant', text: 'Bon', status: 'pending', surface: 'voice', at },
      ]),
    });
    const { brain, turn } = harness(model(['Oui.']) as unknown as typeof fetch, { store });
    expect((await brain.thread()).map((m) => m.id)).toEqual([1]);
    const events = await turn('Encore');
    expect((events[0] as { message: { id: number } }).message.id).toBe(3);
  });
});
