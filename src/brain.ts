export type SpeechWhy = 'reply' | 'ritual' | 'p0' | 'spontaneous';

export type LiveEvent =
  | { type: 'speech'; id: number; n: number; text: string; why: SpeechWhy }
  | { type: 'speech-end'; id: number; why: SpeechWhy }
  | { type: 'message'; threadId: string; id: number };

export interface Message {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  status: 'pending' | 'ok' | 'partial' | 'error';
  surface: string;
  at: string;
  error?: string;
}

export type SendEvent =
  | { type: 'user'; message: Message }
  | { type: 'reply'; id: number }
  | { type: 'delta'; text: string }
  | { type: 'done'; message: Message };

/** `muted` and `silentAnnounce` are sent only when true: an older server refuses a field it does not know. */
export type PresenceFlags = { busy?: boolean; ritual?: boolean; muted?: boolean; silentAnnounce?: boolean };

export type SendOptions = { surface: 'voice' | 'desktop'; confidence?: number };

/**
 * What decides what is said. The body only sends text and signals, and says the sentences it gets back
 * on `live`: alone on a model (`local.ts`) or linked to a server (`core.ts`).
 */
export interface Brain {
  /** A beat resolves to `gone` when the server did not take it: the body, still there, announces itself again. */
  presence(state: 'started' | 'beat' | 'stopped', opts?: PresenceFlags): Promise<unknown>;
  /** Ends when the turn ends; `on` hears the stored fragment first, then the id of the reply. */
  send(text: string, opts: SendOptions, on: (e: SendEvent) => void): Promise<void>;
  /** What was really heard of a reply; empty if nothing was. */
  cut(id: number, said: string): Promise<unknown>;
  /** The sentence was not over: it and its reply leave the thread and the context. */
  withdraw(userId: number): Promise<unknown>;
  thread(): Promise<Message[]>;
  /** Runs until `signal`; a lost connection is only reported. */
  live(on: (e: LiveEvent) => void, link: (up: boolean) => void, signal: AbortSignal): Promise<void>;
}

/** Splits a server-sent stream into its frames, whatever the size of the chunks. */
export async function* frames(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: string }> {
  const reader = body
    .pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>)
    .getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value.replaceAll('\r\n', '\n');
    let end: number;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      if (data.length > 0) yield { event, data: data.join('\n') };
    }
  }
}
