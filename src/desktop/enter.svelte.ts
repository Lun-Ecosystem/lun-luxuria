import { missingToEnter } from '../arrival.ts';
import type { Session } from '../session.svelte.ts';

/**
 * In the window, the page enters by itself when nothing is missing at launch: the window plays sound without a
 * click. It waits for the voice service's first verdict, so the welcome does not leave into a service still
 * starting. Decided at launch: a field filled on the arrival enters by its own button, never under the typing.
 * True when it will enter by itself.
 */
export function enterFollows(session: Session): boolean {
  if (missingToEnter(session.settings, session.token)) return false;
  let done = false;
  $effect(() => {
    if (done || session.entered) return;
    if (session.voiceStatus === 'unknown' || session.voiceStatus === 'starting') return;
    done = true;
    void session.enter();
  });
  return true;
}
