import { invoke } from '@tauri-apps/api/core';
import type { Session } from '../session.svelte.ts';
import type { Settings } from '../settings.ts';

const PRESENT_POLL_MS = 30_000;
/** Away, the first input is caught sooner: an urgency is said aloud only once the presence is back. */
const AWAY_POLL_MS = 3000;

/** No input for the set delay: away. Switched off, always present. */
export function isAway(idleMs: number, away: Settings['away']): boolean {
  return away.on && idleMs >= away.minutes * 60_000;
}

/**
 * The time since the last key or mouse input on the whole session, read by the window, or since a phrase was
 * heard or written, whichever is shorter. A locked session takes no input, so it counts too. Unreadable, the
 * person counts as present, as before this existed. Returns the stop.
 */
export function awayFollows(
  session: Session,
  idle: () => Promise<number> = () => invoke<number>('idle_ms'),
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const tick = async () => {
    const ms = Math.min(await idle().catch(() => 0), Date.now() - session.heardAt);
    if (stopped) return;
    void session.setAway(isAway(ms, session.settings.away));
    timer = setTimeout(() => void tick(), session.away ? AWAY_POLL_MS : PRESENT_POLL_MS);
  };
  void tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
