import { missingToEnter } from '../arrival.ts';
import type { Session } from '../session.svelte.ts';

/**
 * In the window, the page enters by itself once nothing is missing: the window plays sound without a click. It
 * waits for the voice service's first verdict, so the welcome does not leave into a service still starting. Once
 * only: a reload, after a change of brain or server, enters again.
 */
export function enterFollows(session: Session): void {
  let done = false;
  $effect(() => {
    if (done || session.entered) return;
    if (session.voiceStatus === 'unknown' || session.voiceStatus === 'starting') return;
    if (missingToEnter(session.settings, session.token)) return;
    done = true;
    void session.enter();
  });
}
