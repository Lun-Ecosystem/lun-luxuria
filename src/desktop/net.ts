import { isTauri } from '@tauri-apps/api/core';
import { fetch as windowFetch } from '@tauri-apps/plugin-http';
import { isLocalHost } from '../local.ts';

/** In the window: true. In a browser tab nothing from this folder runs. */
export const inWindow = isTauri();

const VOICE = 'http://127.0.0.1:8793';

const pathOf = (input: RequestInfo | URL) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

/**
 * Where the browser's proxy sent the page's paths, the window sends them itself. The server and the model go
 * through the window's fetch, which needs no CORS; the voice stays on the page's own fetch, on this machine, so
 * the audio never crosses into the window.
 */
export function routes(server: () => string, http: typeof fetch, native: typeof fetch) {
  return {
    server: ((input, init) => {
      const path = pathOf(input);
      return http(path.startsWith('/') ? server().replace(/\/+$/, '') + path : path, init);
    }) as typeof fetch,
    voice: ((input, init) => {
      const path = pathOf(input);
      return native(path.startsWith('/voix/') ? VOICE + path.slice('/voix'.length) : path, init);
    }) as typeof fetch,
  };
}

/** The page's fetches: rerouted in the window, untouched in a browser tab. */
export function pageNet(server: () => string): { server: typeof fetch; voice: typeof fetch } {
  const native: typeof fetch = (...a) => fetch(...a);
  return inWindow ? routes(server, windowFetch, native) : { server: native, voice: native };
}

/** The device's token goes with every request: never in clear across the network. */
export function serverWarning(url: string): string | undefined {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'http:' && protocol !== 'https:') return 'Adresse illisible.';
    if (protocol === 'http:' && !isLocalHost(hostname))
      return 'Le jeton de cet appareil partirait en clair : cette adresse doit être en https.';
    return undefined;
  } catch {
    return 'Adresse illisible.';
  }
}
