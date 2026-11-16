import { invoke } from '@tauri-apps/api/core';
import { tick } from 'svelte';
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

/** The last read asked, by session: a read answering after a newer one says nothing. */
const lastRead = new WeakMap<Session, number>();
let reads = 0;

/**
 * The origins the person confirmed, as the window keeps them. When it cannot say, none, on the closed side, and
 * why in `hostsSaid`: never « none confirmed ».
 */
export async function readHosts(session: Session, call: Call = invoke): Promise<void> {
  const read = ++reads;
  lastRead.set(session, read);
  let hosts: unknown;
  let said = '';
  try {
    hosts = await call('net_hosts', {});
  } catch (err) {
    said = String(err);
  }
  if (lastRead.get(session) !== read) return;
  const list = Array.isArray(hosts) ? hosts.filter((h): h is string => typeof h === 'string') : null;
  session.hostsSaid = list ? '' : said || 'La fenêtre a répondu autre chose qu’une liste.';
  // Once each: the screens list them by origin.
  session.hosts = list ? [...new Set(list)] : [];
}

/** The system's box, opened by the window: only the person lets it reach an address off this computer. Its refusal, said. */
export async function confirmHost(session: Session, url: string, call: Call = invoke): Promise<string> {
  try {
    await call('net_host_confirm', { url });
  } catch (err) {
    return String(err);
  }
  await readHosts(session, call);
  return '';
}

export async function forgetHost(session: Session, origin: string, call: Call = invoke): Promise<string> {
  try {
    await call('net_host_forget', { origin });
  } catch (err) {
    return String(err);
  }
  await readHosts(session, call);
  return '';
}

/** What a screen keeps of its host buttons: the origin being asked, and Rust's refusal by origin. */
export interface HostButtons {
  busy: string;
  said: Record<string, string>;
}

/**
 * A host button's call: one at a time, Rust's refusal said on its origin. When the button goes with the answer,
 * the focus moves to the button now at its place in `area`, or to `title` when none is left: never to the body.
 */
export async function hostCall(
  state: HostButtons,
  origin: string,
  button: HTMLElement,
  ask: () => Promise<string>,
  area: HTMLElement | null = button.parentElement,
  title?: HTMLElement | null,
): Promise<void> {
  if (state.busy) return;
  const at = area ? [...area.querySelectorAll('button')].indexOf(button as HTMLButtonElement) : -1;
  state.busy = origin;
  try {
    state.said[origin] = await ask();
  } finally {
    state.busy = '';
  }
  await tick();
  if (button.isConnected) return;
  const buttons = area?.querySelectorAll('button') ?? [];
  const next: HTMLElement | null | undefined = buttons[Math.min(at, buttons.length - 1)] ?? title;
  // A title takes the focus only when asked to.
  if (next && next === title) next.tabIndex = -1;
  next?.focus();
}
