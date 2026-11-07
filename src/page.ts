/**
 * The page leaving and coming back. `leave` at every hide; `back` only when the browser brings the page
 * back from its history cache, because a beat after a stop does not reopen a presence. Returns the stop.
 */
export function watchPage(leave: () => void, back: () => void): () => void {
  const show = (e: PageTransitionEvent) => {
    if (e.persisted) back();
  };
  addEventListener('pagehide', leave);
  addEventListener('pageshow', show);
  return () => {
    removeEventListener('pagehide', leave);
    removeEventListener('pageshow', show);
  };
}
