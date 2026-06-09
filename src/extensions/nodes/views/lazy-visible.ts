// §perf-large-file: run a callback the first time an element scrolls into view.
// Used to defer heavy NodeView work (CodeMirror, Mermaid) on large documents.

/**
 * Invokes `cb` once, the first time `el` is near the viewport.
 * Pre-fires 200px early to avoid blank flashes while scrolling.
 * Degrades to immediate invocation when IntersectionObserver is unavailable.
 * Returns a disposer that disconnects the observer.
 */
export function onFirstVisible(el: HTMLElement, cb: () => void): () => void {
  if (typeof IntersectionObserver === "undefined") {
    cb();
    return () => {};
  }
  let fired = false;
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && !fired) {
          fired = true;
          io.disconnect();
          cb();
        }
      }
    },
    { rootMargin: "200px 0px" },
  );
  io.observe(el);
  return () => io.disconnect();
}
