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
          enqueueMountCallback(cb);
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

const mountQueue: Array<() => void> = [];
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
      const idx = mountQueue.indexOf(cb);
      if (idx !== -1) mountQueue.splice(idx, 1);
    }
  };
}

// ---------------------------------------------------------------------------
// Test helpers (exported for unit tests only — not part of public API)
// ---------------------------------------------------------------------------

function enqueueMountCallback(cb: () => void): void {
  // Most-recently-intersected first — put at front so visible block mounts next.
  mountQueue.unshift(cb);
  scheduleDrain();
}

function scheduleDrain(): void {
  if (drainScheduled || mountQueue.length === 0) return;
  drainScheduled = true;
  scheduleIdle(() => {
    drainScheduled = false;
    const cb = mountQueue.shift();
    if (cb) cb();
    // If more remain, schedule the next drain tick.
    if (mountQueue.length > 0) scheduleDrain();
  });
}
