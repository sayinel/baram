// §394 spec 0073 D7 — whether a rendered block is on screen NOW, for `invalidate` and debounced
// redraws: a visible block draws again at once, any other is marked stale and draws when it comes
// into view. A hidden tab's editor is `display: none`, which an IntersectionObserver reports as not
// intersecting — so a hidden tab's blocks do not draw (D7 "숨은 탭에서는 그리지 않는다"). The FIRST
// draw goes through `onFirstVisible` instead (`lazy-visible.ts`), because that queue is what export
// wakes (`flushPendingVisibility`).

const callbacks = new Map<Element, (visible: boolean) => void>();
let observer: IntersectionObserver | null = null;

/** Test-only: drop the observer and every watch. */
export function __resetVisibility(): void {
  observer?.disconnect();
  observer = null;
  callbacks.clear();
}

/** Call `onChange` with every change of `el`'s visibility. Returns the disposer. */
export function watchVisibility(
  el: Element,
  onChange: (visible: boolean) => void,
): () => void {
  if (typeof IntersectionObserver === "undefined") {
    onChange(true);
    return () => {};
  }
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        callbacks.get(entry.target)?.(entry.isIntersecting);
      }
    },
    { rootMargin: "200px 0px" },
  );
  callbacks.set(el, onChange);
  observer.observe(el);
  return () => {
    callbacks.delete(el);
    observer?.unobserve(el);
  };
}
