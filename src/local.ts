import {
  frames,
  type Brain,
  type LiveEvent,
  type Message,
  type SendEvent,
  type SendOptions,
} from './brain.ts';
import type { Settings } from './settings.ts';

const THREAD_KEY = 'luxuria.thread';
const SPENT_KEY = 'luxuria.spent';
const CONTEXT_MESSAGES = 30;
const TIMEOUT_MS = 60_000;
const MAIN = 'main';

type Spent = { day: string; tokens: number };

export interface LocalStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

// A dot in « 3.5 » or after « M. » does not end a sentence.
// Not after a title, nor after a list number at the start of a line; a closing emphasis stays with its sentence.
const SENTENCE_END = /(?<!\b(?:M|Mme|Dr))(?<!(?:^|\n)[ \t]*\d+)[.!?…]+["»)*_`]*\s+|\n+/g;

/** What the model writes in markdown, said without its marks: the thread keeps them. */
const SPOKEN: [RegExp, string][] = [
  [/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1'], // a link or an image says its text
  [/^[ \t]*([-*_])[ \t]*(?:\1[ \t]*){2,}$/gm, ''], // a rule
  [/^[ \t]*(?:(?:#{1,6}|>[ \t>]*|[-*+•]|\d+[.)])[ \t]+)(?:\[[ xX]\][ \t]+)?/gm, ''], // title, quote, bullet, number, box
  [/(?<![\p{L}\p{N}])(\*{1,3})(?=\S)([^*\n]*?\S)\1(?![\p{L}\p{N}])/gu, '$2'], // not 2*3*4
  [/(^|[^\p{L}\p{N}_])(_{1,2})(?=\S)([^_\n]*?\S)\2(?![\p{L}\p{N}_])/gu, '$1$3'],
  [/(?<=\S)\*{2,}|\*{2,}(?=\S)|`|~~/g, ''],
  // An emphasis across two sentences: its half stays on each one.
  [/^[*_]{1,3}(?=\S)|(?<=\S)[*_]{1,3}(?=[,.;:!?…»")]*$)/g, ''],
  [/[ \t]{2,}/g, ' '],
];
export const spoken = (text: string): string =>
  SPOKEN.reduce((t, [re, to]) => t.replace(re, to), text).trim();

/** The whole sentences of what the model has written so far, and what is still being written. */
export function sentences(text: string): { done: string[]; rest: string } {
  const done: string[] = [];
  let from = 0;
  for (const m of text.matchAll(SENTENCE_END)) {
    const sentence = text.slice(from, m.index + m[0].length).trim();
    if (sentence) done.push(sentence);
    from = m.index + m[0].length;
  }
  return { done, rest: text.slice(from) };
}

export const isLocalHost = (host: string) => host === '127.0.0.1' || host === 'localhost' || host === '[::1]';

/** A key never travels in clear beyond this machine; undefined when the address is fine. */
export function unsafeAddress(url: string, key: string): string | undefined {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'http:' && protocol !== 'https:') return 'Adresse du modèle illisible.';
    if (key && protocol === 'http:' && !isLocalHost(hostname))
      return 'La clé ne part pas en clair : cette adresse doit être en https.';
    return undefined;
  } catch {
    return 'Adresse du modèle illisible.';
  }
}

/**
 * The brain when nothing else thinks for it: one model, a name and a tone from the settings, a thread
 * that keeps the current day only, and a cap checked before each call.
 */
export class LocalBrain implements Brain {
  #settings: () => Settings;
  #store: LocalStore;
  #fetch: typeof fetch;
  #now: () => Date;
  #messages: Message[] = [];
  #nextId = 1;
  #spent: Spent;
  #running = new Map<number, AbortController>();
  #live: ((e: LiveEvent) => void) | null = null;

  constructor(
    settings: () => Settings,
    store: LocalStore,
    f: typeof fetch = (...a) => fetch(...a),
    now: () => Date = () => new Date(),
  ) {
    this.#settings = settings;
    this.#store = store;
    this.#fetch = f;
    this.#now = now;
    this.#spent = { day: this.#day(now()), tokens: 0 };
    this.#read();
  }

  #day(at: Date): string {
    return at.toDateString();
  }

  #read(): void {
    try {
      const saved = JSON.parse(this.#store.get(THREAD_KEY) ?? '[]') as Message[];
      // A reply left unfinished by a closed window is not a reply.
      this.#messages = saved.filter((m) => m.status !== 'pending');
      this.#nextId = Math.max(0, ...saved.map((m) => m.id)) + 1;
      const spent = JSON.parse(this.#store.get(SPENT_KEY) ?? 'null') as Spent | null;
      if (spent?.day === this.#spent.day) this.#spent = spent;
    } catch {
      this.#messages = [];
    }
    this.#keepToday();
  }

  /** Only the current day stays: in the thread, in the context, on the disk. */
  #keepToday(): void {
    const today = this.#day(this.#now());
    this.#messages = this.#messages.filter(
      (m) => m.status === 'pending' || this.#day(new Date(m.at)) === today,
    );
    this.#save();
  }

  #save(): void {
    this.#store.set(THREAD_KEY, JSON.stringify(this.#messages));
  }

  #add(role: Message['role'], text: string, surface: string, status: Message['status']): Message {
    const message: Message = {
      id: this.#nextId++,
      role,
      text,
      status,
      surface,
      at: this.#now().toISOString(),
    };
    this.#messages.push(message);
    return message;
  }

  #spend(tokens: number): void {
    const day = this.#day(this.#now());
    this.#spent = { day, tokens: (this.#spent.day === day ? this.#spent.tokens : 0) + tokens };
    this.#store.set(SPENT_KEY, JSON.stringify(this.#spent));
  }

  /** Why no call can leave now; undefined when one can. */
  #refusal(): string | undefined {
    const { model } = this.#settings();
    if (!model.name.trim()) return 'Aucun modèle choisi : à régler dans les Réglages.';
    const unsafe = unsafeAddress(model.url, model.key);
    if (unsafe) return unsafe;
    const spent = this.#spent.day === this.#day(this.#now()) ? this.#spent.tokens : 0;
    if (model.tokensPerDay > 0 && spent >= model.tokensPerDay)
      return 'Plafond du jour atteint : à relever dans les Réglages, ou à demain.';
    return undefined;
  }

  #context(): { role: Message['role'] | 'system'; content: string }[] {
    const { agent } = this.#settings();
    const said = this.#messages
      .filter((m) => m.text && (m.status === 'ok' || m.status === 'partial'))
      .slice(-CONTEXT_MESSAGES)
      .map((m) => ({ role: m.role, content: m.text }));
    return [{ role: 'system', content: `Tu t’appelles ${agent.name}. ${agent.context}`.trim() }, ...said];
  }

  async presence(): Promise<void> {}

  async send(text: string, opts: SendOptions, on: (e: SendEvent) => void): Promise<void> {
    this.#keepToday();
    const user = this.#add('user', text, opts.surface, 'ok');
    on({ type: 'user', message: user });
    const context = this.#context();
    const reply = this.#add('assistant', '', opts.surface, 'pending');
    on({ type: 'reply', id: reply.id });
    this.#save();
    const abort = new AbortController();
    this.#running.set(reply.id, abort);
    const finish = (status: 'ok' | 'error', error?: string) => {
      reply.status = status;
      if (error) reply.error = error;
      this.#save();
      this.#live?.({ type: 'speech-end', id: reply.id, why: 'reply' });
      on({ type: 'done', message: { ...reply } });
      this.#live?.({ type: 'message', threadId: MAIN, id: reply.id });
    };

    const refused = this.#refusal();
    if (refused) return finish('error', refused);

    let usage: number | undefined;
    try {
      const { model } = this.#settings();
      const res = await this.#fetch(`${model.url.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(TIMEOUT_MS)]),
        headers: {
          'content-type': 'application/json',
          ...(model.key ? { authorization: `Bearer ${model.key}` } : {}),
        },
        body: JSON.stringify({
          model: model.name,
          stream: true,
          stream_options: { include_usage: true },
          messages: context,
        }),
      });
      if (!res.ok || !res.body) return finish('error', `Le modèle a répondu ${res.status}.`);
      let n = 0;
      let pending = '';
      const say = (sentence: string) => {
        const text = spoken(sentence);
        if (text) this.#live?.({ type: 'speech', id: reply.id, n: ++n, text, why: 'reply' });
      };
      for await (const { data } of frames(res.body)) {
        if (data === '[DONE]') continue;
        const chunk = JSON.parse(data) as {
          choices?: { delta?: { content?: string | null } }[];
          usage?: { total_tokens?: number } | null;
        };
        usage = chunk.usage?.total_tokens ?? usage;
        const delta = chunk.choices?.[0]?.delta?.content;
        if (!delta) continue;
        reply.text += delta;
        on({ type: 'delta', text: delta });
        const { done, rest } = sentences(pending + delta);
        pending = rest;
        done.forEach(say);
      }
      if (pending.trim()) say(pending.trim());
      if (!reply.text.trim()) return finish('error', 'Le modèle n’a rien répondu.');
      finish('ok');
    } catch (err) {
      // Withdrawn or cut: whoever aborted has already settled the message.
      if (!abort.signal.aborted)
        finish(
          'error',
          err instanceof Error && err.name === 'TimeoutError' ? 'Le modèle ne répond pas.' : String(err),
        );
    } finally {
      this.#running.delete(reply.id);
      // shortcut: without a usage figure (a call cut short, some servers), about 4 characters a token.
      const chars = context.reduce((sum, m) => sum + m.content.length, 0) + reply.text.length;
      this.#spend(usage ?? Math.ceil(chars / 4));
    }
  }

  async cut(id: number, said: string): Promise<void> {
    this.#running.get(id)?.abort();
    const reply = this.#messages.find((m) => m.id === id);
    if (!reply) return;
    if (said) Object.assign(reply, { text: said, status: 'partial' });
    else this.#messages = this.#messages.filter((m) => m !== reply);
    this.#save();
    this.#live?.({ type: 'message', threadId: MAIN, id });
  }

  async withdraw(userId: number): Promise<void> {
    const at = this.#messages.findIndex((m) => m.id === userId);
    if (at < 0) return;
    const next = this.#messages[at + 1];
    const reply = next?.role === 'assistant' ? next : undefined;
    if (reply) this.#running.get(reply.id)?.abort();
    this.#messages = this.#messages.filter((m) => m.id !== userId && m !== reply);
    this.#save();
    this.#live?.({ type: 'message', threadId: MAIN, id: userId });
  }

  async thread(): Promise<Message[]> {
    this.#keepToday();
    return this.#messages.map((m) => ({ ...m }));
  }

  async live(on: (e: LiveEvent) => void, link: (up: boolean) => void, signal: AbortSignal): Promise<void> {
    this.#live = on;
    link(true);
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    this.#live = null;
  }
}
