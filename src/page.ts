/**
 * The page leaving and coming back. `leave` at every hide; `back` only when the browser brings the page
 * back from its history cache, because a beat after a stop does not reopen a presence; `shown` each time
 * the page is in front again, after a tab switch or a frozen tab waking up. Returns the stop.
 */
export function watchPage(leave: () => void, back: () => void, shown: () => void): () => void {
  const show = (e: PageTransitionEvent) => {
    if (e.persisted) back();
  };
  const visible = () => {
    if (document.visibilityState === 'visible') shown();
  };
  addEventListener('pagehide', leave);
  addEventListener('pageshow', show);
  document.addEventListener('visibilitychange', visible);
  return () => {
    removeEventListener('pagehide', leave);
    removeEventListener('pageshow', show);
    document.removeEventListener('visibilitychange', visible);
  };
}

/** One run at a time: a call while one is under way gets that run, not a second one. */
export function single<T>(run: () => Promise<T>): () => Promise<T> {
  let current: Promise<T> | null = null;
  return () =>
    (current ??= run().finally(() => {
      current = null;
    }));
}
