// §perf-large-file C3.2: run a callback the first time an element scrolls into
// view, serialized through an idle-scheduled mount queue.
//
// Design:
//   - ONE shared IntersectionObserver (module-level, lazy-created) replaces the
//     previous per-element observer instances (~296 for CONTEXT.md).
//   - When an intersection fires the callback is pushed into a mount queue
//     drained one entry per scheduleIdle tick — so a burst of simultaneous
//     intersections (fast scroll) does not block the main thread.
//   - The queue drains most-recently-intersected first: the block the user just
//     scrolled TO mounts before blocks already scrolled past.
//   - Direct interaction paths (selectNode / setSelection in code-block-
//     node-view.ts) call ensureCM() synchronously — they bypass this file
//     entirely and are unaffected by the queue.

import { scheduleIdle } from "../../../utils/editor/progressive-load";

// ---------------------------------------------------------------------------
// Shared IntersectionObserver (lazy-created once)
// ---------------------------------------------------------------------------

// element → {cb, disposer-handle-id}
const elementMap = new Map<Element, () => void>();
let sharedIO: IntersectionObserver | null = null;

function getSharedObserver(): IntersectionObserver {
  if (sharedIO) return sharedIO;
  sharedIO = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const cb = elementMap.get(entry.target);
        if (cb) {
          elementMap.delete(entry.target);
          sharedIO?.unobserve(entry.target);
          enqueueMountCallback(entry.target, cb);
        }
      }
    },
    { rootMargin: "200px 0px" },
  );
  return sharedIO;
}

// ---------------------------------------------------------------------------
// Mount queue: drained one callback per scheduleIdle tick.
// Most-recently-intersected is at the front (unshift on enqueue).
// ---------------------------------------------------------------------------

/** ‼️ The ELEMENT is kept alongside the callback, not just the callback. The
 *  queue is app-wide, and `flushPendingVisibility` has to be able to wake only
 *  the blocks inside the document being exported — see its own note. */
const mountQueue: Array<[Element, () => void]> = [];
let drainScheduled = false;

/** Expose the mount queue length for test assertions. */
export function _mountQueueLength(): number {
  return mountQueue.length;
}

/** Reset module state between tests. */
export function _resetForTest(): void {
  elementMap.clear();
  mountQueue.length = 0;
  drainScheduled = false;
  if (sharedIO) {
    sharedIO.disconnect();
    sharedIO = null;
  }
}

// ---------------------------------------------------------------------------
// Public API — same signature as before so callers need no changes.
// ---------------------------------------------------------------------------

/**
 * Mount everything now, whether or not it has ever been near the viewport.
 *
 * §5.12 export: the whole point of this module is that a block below the fold
 * costs nothing until the reader scrolls to it. An EXPORT reads the whole
 * document at once, from a viewport that will never move — so every heavy block
 * the reader happened not to visit was captured as its placeholder (raw code
 * under a `<select>`, an empty `.math-block-katex`, an empty `.mermaid-block`).
 * That is the defect this exists to close, and the caller is
 * `captureEditorHTML`.
 *
 * ‼️ This is deliberately expensive: it constructs every CodeMirror instance and
 * every KaTeX/Mermaid render in the document, and they stay mounted afterwards.
 * That cost is acceptable for an explicit one-off Export command and is NOT
 * acceptable anywhere on the typing or scrolling path. There is no other caller.
 *
 * Mounting is synchronous here, but what each callback STARTS is not (CodeMirror
 * language modes, `import("katex")`, `mermaid.render` are all async) — the
 * caller has to wait for the result separately.
 *
 * `root` restricts the flush to elements INSIDE it. ‼️ Not optional in spirit:
 * this queue is app-wide, and Journal's photo tiles register on it too
 * (components/journal/use-photo-thumb.ts). Without the filter, an export would
 * spend its wake budget on thumbnails belonging to a retained Journal tab —
 * firing the very IPC stampede the queue exists to spread out, while the
 * document's own blocks stay unmounted.
 *
 * `limit` caps how many callbacks run in this call, and exists because the work
 * is synchronous: a document with hundreds of code blocks would build hundreds
 * of CodeMirror views in one task, freezing the window before the export
 * dialog's own "Exporting…" state has had a chance to paint. The caller drives
 * the rest in later batches (see settleHeavyBlocks). Returns how many ran, so
 * the caller can tell "more to come" from "that was everything".
 */
export function flushPendingVisibility(
  limit = Number.POSITIVE_INFINITY,
  root?: ParentNode,
): number {
  const wanted = (el: Element) => !root || root.contains(el);

  // Already-intersected work first — it was queued because it is nearest the
  // viewport, and the queue's own order is meaningful.
  //
  // `drainScheduled` is deliberately NOT cleared. An idle drain may already be
  // queued; clearing the flag would let the next intersection schedule a
  // second one, and two drains running against one queue is exactly the
  // un-serialized burst this module exists to prevent. The scheduled callback
  // resets the flag itself when it runs, finding the queue short or empty —
  // which is harmless.
  const queued: Array<() => void> = [];
  for (let i = 0; i < mountQueue.length && queued.length < limit;) {
    if (wanted(mountQueue[i][0])) queued.push(mountQueue.splice(i, 1)[0][1]);
    else i++;
  }

  // Snapshot before invoking anything: a callback may mount a NodeView that
  // registers further elements, and mutating the map while iterating it would
  // skip entries.
  const budget = limit - queued.length;
  const observed: Array<() => void> = [];
  for (const [el, cb] of elementMap) {
    if (observed.length >= budget) break;
    if (!wanted(el)) continue;
    observed.push(cb);
    elementMap.delete(el);
    sharedIO?.unobserve(el);
  }

  // ‼️ Each callback is isolated. These entries have ALREADY been removed from
  // the observer and the queue, so an exception escaping the loop would not
  // just skip the rest of this batch — it would drop those blocks permanently,
  // and the export would wait out its whole stall budget before printing them
  // empty. One NodeView that cannot mount must cost only itself.
  const run = (cb: () => void) => {
    try {
      cb();
    } catch (err) {
      console.error("[lazy-visible] deferred mount failed", err);
    }
  };
  for (const cb of queued) run(cb);
  for (const cb of observed) run(cb);
  return queued.length + observed.length;
}

/**
 * Invokes `cb` once, the first time `el` is near the viewport, serialized
 * through an idle-scheduled mount queue (one CM mount per idle tick).
 * Pre-fires 200px early (rootMargin on the shared observer).
 * Degrades to immediate invocation when IntersectionObserver is unavailable.
 * Returns a disposer that removes the element from the queue/observer.
 */
export function onFirstVisible(el: HTMLElement, cb: () => void): () => void {
  if (typeof IntersectionObserver === "undefined") {
    cb();
    return () => {};
  }

  elementMap.set(el, cb);
  getSharedObserver().observe(el);

  return () => {
    if (elementMap.has(el)) {
      elementMap.delete(el);
      sharedIO?.unobserve(el);
    } else {
      // Already moved to queue — remove from queue if still pending.
      const idx = mountQueue.findIndex(([, queued]) => queued === cb);
      if (idx !== -1) mountQueue.splice(idx, 1);
    }
  };
}

// ---------------------------------------------------------------------------
// Test helpers (exported for unit tests only — not part of public API)
// ---------------------------------------------------------------------------

function enqueueMountCallback(el: Element, cb: () => void): void {
  // Most-recently-intersected first — put at front so visible block mounts next.
  mountQueue.unshift([el, cb]);
  scheduleDrain();
}

function scheduleDrain(): void {
  if (drainScheduled || mountQueue.length === 0) return;
  drainScheduled = true;
  scheduleIdle(() => {
    drainScheduled = false;
    const entry = mountQueue.shift();
    if (entry) entry[1]();
    // If more remain, schedule the next drain tick.
    if (mountQueue.length > 0) scheduleDrain();
  });
}
