/** A bfcache page is paused, not destroyed. Keep its UI drafts and subscriptions. */
export function bindPageLifecycle(target: Window, callbacks: { pause(): void; resume(): void; dispose(): void }): () => void {
  const hide = (event: PageTransitionEvent) => { callbacks.pause(); if (!event.persisted) callbacks.dispose(); };
  const show = (event: PageTransitionEvent) => { if (event.persisted) callbacks.resume(); };
  target.addEventListener('pagehide', hide); target.addEventListener('pageshow', show);
  return () => { target.removeEventListener('pagehide', hide); target.removeEventListener('pageshow', show); };
}
