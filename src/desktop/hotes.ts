import { invoke } from '@tauri-apps/api/core';
import { isLocalHost } from '../local.ts';
import type { Session } from '../session.svelte.ts';
import type { Call } from './corps.svelte.ts';

export const OFF_MACHINE =
  'Cette adresse est hors de ce poste : la fenêtre ne la joint qu’une fois confirmée.';
export const CONFIRMED = 'Confirmée pour la fenêtre.';
export const CHECKING = 'Vérification…';

/**
 * The origin to confirm for the window, or null: this computer, or not an address. Read by the URL parser, never
 * by the text: `http://127.0.0.1@example.com` goes to example.com. Rust reads it again, and its word wins.
 */
export function offMachine(url: string): string | null {
  try {
    const { protocol, hostname, origin } = new URL(url);
    return (protocol === 'http:' || protocol === 'https:') && !isLocalHost(hostname) ? origin : null;
  } catch {
    return null;
  }
}

const said = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The origins the person confirmed, as the window keeps them; none when it cannot say, on the closed side. */
export async function readHosts(session: Session, call: Call = invoke): Promise<void> {
  const hosts = await Promise.resolve(call('net_hosts', {})).catch(() => null);
  // Once each: the screens list them by origin.
  session.hosts = Array.isArray(hosts)
    ? [...new Set(hosts.filter((h): h is string => typeof h === 'string'))]
    : [];
}

/** The system's box, opened by the window: only the person lets it reach an address off this computer. Its refusal, said. */
export async function confirmHost(session: Session, url: string, call: Call = invoke): Promise<string> {
  try {
    await call('net_host_confirm', { url });
  } catch (err) {
    return said(err);
  }
  await readHosts(session, call);
  return '';
}

export async function forgetHost(session: Session, origin: string, call: Call = invoke): Promise<string> {
  try {
    await call('net_host_forget', { origin });
  } catch (err) {
    return said(err);
  }
  await readHosts(session, call);
  return '';
}
