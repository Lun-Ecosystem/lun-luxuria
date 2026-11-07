import {
  frames,
  type Brain,
  type LiveEvent,
  type Message,
  type SendEvent,
  type SendOptions,
} from './brain.ts';

export const MAIN = 'main';
/**
 * This page, drawn when the module loads: two tabs on one device are two presences to the server. A
 * duplicated tab loads the module again and draws its own; a page restored from history keeps it.
 * getRandomValues, not randomUUID: it also works on a page served without https.
 */
const TAB = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
  b.toString(16).padStart(2, '0'),
).join('');

export class CoreError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** The brain when linked to a core: text and signals, never a sound. */
export class CoreClient implements Brain {
  #token: string | null;
  #fetch: typeof fetch;

  constructor(token: string | null, f: typeof fetch = (...a) => fetch(...a)) {
    this.#token = token;
    this.#fetch = f;
  }

  get token(): string | null {
    return this.#token;
  }

  async #call(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await this.#fetch(`/api${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(this.#token ? { authorization: `Bearer ${this.#token}` } : {}),
      },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new CoreError(res.status, body.error ?? `Le serveur a répondu ${res.status}.`);
    }
    return res;
  }

  async pair(code: string): Promise<void> {
    const res = await this.#call('/pair', {
      method: 'POST',
      body: JSON.stringify({ code, client: 'luxuria', name: "Lun'Luxuria" }),
    });
    this.#token = ((await res.json()) as { token: string }).token;
  }

  async presence(
    state: 'started' | 'beat' | 'stopped',
    opts: { busy?: boolean; ritual?: boolean } = {},
  ): Promise<'taken' | 'gone' | undefined> {
    try {
      await this.#call('/presence', {
        method: 'POST',
        body: JSON.stringify({ state, ...opts, tab: TAB }),
        // Sent as the page closes: the browser finishes it instead of cutting it with the page.
        ...(state === 'stopped' ? { keepalive: true } : {}),
      });
    } catch (err) {
      // 410: no presence open for this tab any more, it ended while the page slept.
      if (state === 'beat' && err instanceof CoreError && err.status === 410) return 'gone';
      throw err;
    }
    return state === 'beat' ? 'taken' : undefined;
  }

  async send(text: string, opts: SendOptions, on: (e: SendEvent) => void): Promise<void> {
    const res = await this.#call(`/threads/${MAIN}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text, speak: true, ...opts }),
    });
    for await (const { event, data } of frames(res.body!)) {
      const parsed: unknown = JSON.parse(data);
      if (event === 'user') on({ type: 'user', message: parsed as Message });
      else if (event === 'reply') on({ type: 'reply', id: (parsed as { id: number }).id });
      else if (event === 'delta') on({ type: 'delta', text: (parsed as { text: string }).text });
      else if (event === 'done') on({ type: 'done', message: parsed as Message });
    }
  }

  cut(id: number, said: string) {
    return this.#call(`/threads/${MAIN}/messages/${id}/cut`, {
      method: 'POST',
      body: JSON.stringify({ said }),
    });
  }

  withdraw(userId: number) {
    return this.#call(`/threads/${MAIN}/messages/${userId}/withdraw`, { method: 'POST' });
  }

  async thread(): Promise<Message[]> {
    const res = await this.#call(`/threads/${MAIN}/messages?limit=50`);
    return ((await res.json()) as { items: Message[] }).items;
  }

  /** A lost connection comes back after a pause. */
  async live(on: (e: LiveEvent) => void, link: (up: boolean) => void, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const res = await this.#fetch('/api/live', {
          signal,
          headers: this.#token ? { authorization: `Bearer ${this.#token}` } : {},
        });
        if (!res.ok || !res.body) throw new CoreError(res.status, 'live');
        link(true);
        for await (const { data } of frames(res.body)) on(JSON.parse(data) as LiveEvent);
      } catch {
        // Below: unreachable is a normal state, and it retries on its own.
      }
      if (signal.aborted) return;
      link(false);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
