// §perf-large-file C2/C3.3: progressive document rendering — render the first
// chunk immediately, then append the rest in non-blocking idle callbacks.
//
// C3.3 additions:
//   - Input-pressure deferral: if the user typed/scrolled within INPUT_QUIET_MS,
//     the step reschedules without appending any blocks.
//   - Adaptive chunk size: each append's wall time is measured; if it exceeds
//     CHUNK_TIME_BUDGET_MS the next chunk is halved (floor: MIN_CHUNK_BLOCKS);
//     if it is under half the budget, chunk size grows back toward restChunkSize.
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";

/** Transaction meta flag set on every append EXCEPT the last. Decoration
 *  plugins that rebuild over the whole doc skip the rebuild when it is set. */
export const PROGRESSIVE_LOAD_META = "baramProgressiveLoad";

export const FIRST_CHUNK_BLOCKS = 80;
export const REST_CHUNK_BLOCKS = 150;

// §perf-large-file C3.3 constants
/** If user input occurred within this window (ms), defer the next chunk. */
export const INPUT_QUIET_MS = 100;
/** Target max ms per append chunk. Above this → halve chunk size. */
export const CHUNK_TIME_BUDGET_MS = 50;
/** Minimum chunk size after repeated halving. */
export const MIN_CHUNK_BLOCKS = 25;

/** Schedule `cb` to run when the main thread is idle. Returns a canceller.
 *  Falls back to setTimeout where requestIdleCallback is unavailable. */
export type ScheduleFn = (cb: () => void) => () => void;

/** Split a flat block array into [firstChunk, ...restChunks]. */
export function chunkBlocks<T>(
  blocks: T[],
  firstChunkSize: number,
  restChunkSize: number,
): T[][] {
  if (blocks.length === 0) return [];
  const chunks: T[][] = [blocks.slice(0, firstChunkSize)];
  for (let i = firstChunkSize; i < blocks.length; i += restChunkSize) {
    chunks.push(blocks.slice(i, i + restChunkSize));
  }
  return chunks;
}

/** Fallback timeout (ms) for requestIdleCallback when the browser is busy. */
const IDLE_TIMEOUT_MS = 100;

export const scheduleIdle: ScheduleFn = (cb) => {
  const g = globalThis as unknown as {
    cancelIdleCallback?: (id: number) => void;
    requestIdleCallback?: (
      cb: () => void,
      opts?: { timeout: number },
    ) => number;
  };
  if (typeof g.requestIdleCallback === "function") {
    const id = g.requestIdleCallback(cb, { timeout: IDLE_TIMEOUT_MS });
    return () => g.cancelIdleCallback?.(id);
  }
  const id = setTimeout(cb, 0);
  return () => clearTimeout(id);
};

/** Options for appendChunksProgressively. */
export interface AppendChunksOpts {
  /**
   * `now` function (injectable for tests). Defaults to `Date.now`.
   * Used for input-pressure quiet-window and chunk-time measurement.
   */
  now?: () => number;
  /** Called after the last chunk is appended (or immediately if chunks empty). */
  onComplete: () => void;
  /** Custom scheduler (injectable for tests). Defaults to scheduleIdle. */
  schedule?: ScheduleFn;
}

// ---------------------------------------------------------------------------
// §perf-large-file C3.3 — input-pressure tracking
// ---------------------------------------------------------------------------

export interface ProgressiveLoadHandle {
  cancel(): void;
}

/**
 * Append `chunks` of block nodes to the END of the editor's document, one
 * adaptive chunk per scheduled tick, yielding between chunks.
 *
 * C3.3 behaviour:
 *   - If the user typed/scrolled/clicked within INPUT_QUIET_MS, the step
 *     reschedules without appending (input wins).
 *   - Each append's wall time is measured; if > CHUNK_TIME_BUDGET_MS the next
 *     chunk size is halved (floor MIN_CHUNK_BLOCKS); if < budget/2 it grows
 *     back toward restChunkSize.
 *   - The last append always omits PROGRESSIVE_LOAD_META, triggering exactly
 *     one full decoration rebuild.
 *
 * Appends are not added to undo history. Calls onComplete after the last chunk
 * (or immediately if chunks is empty).
 */
export function appendChunksProgressively(
  editor: Editor,
  chunks: PMNode[][],
  opts: AppendChunksOpts,
): ProgressiveLoadHandle {
  const schedule = opts.schedule ?? scheduleIdle;
  const now = opts.now ?? (() => Date.now());

  // Flatten pre-split chunks into a single block list. The caller still passes
  // pre-split chunks (from chunkBlocks) but we drive chunk boundaries
  // adaptively from here.
  const blocks: PMNode[] = chunks.flat();
  const restChunkSize = REST_CHUNK_BLOCKS;

  let cursor = 0;
  let currentChunkSize = restChunkSize;
  let cancelled = false;
  let cancelTick: () => void = () => {};

  // --- input-pressure tracking ---
  let lastInputTime = -Infinity;

  function notePressure() {
    lastInputTime = now();
  }

  // Install listeners while the fill is active; removed on completion/cancel.
  const AC =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const listenerOpts = AC
    ? { capture: true, passive: true, signal: AC.signal }
    : { capture: true, passive: true };

  if (typeof window !== "undefined") {
    window.addEventListener("keydown", notePressure, listenerOpts);
    window.addEventListener("wheel", notePressure, listenerOpts);
    window.addEventListener("pointerdown", notePressure, listenerOpts);
  }

  function removeListeners() {
    if (AC) {
      AC.abort();
    } else if (typeof window !== "undefined") {
      window.removeEventListener("keydown", notePressure, { capture: true });
      window.removeEventListener("wheel", notePressure, { capture: true });
      window.removeEventListener("pointerdown", notePressure, {
        capture: true,
      });
    }
  }

  // --- step ---
  const step = () => {
    if (cancelled || editor.isDestroyed) {
      removeListeners();
      return;
    }

    if (cursor >= blocks.length) {
      removeListeners();
      opts.onComplete();
      return;
    }

    // Input-pressure deferral: if the user just typed/scrolled, wait.
    if (now() - lastInputTime < INPUT_QUIET_MS) {
      cancelTick = schedule(step);
      return;
    }

    const end = Math.min(cursor + currentChunkSize, blocks.length);
    const chunk = blocks.slice(cursor, end);
    const isLast = end >= blocks.length;
    cursor = end;

    const t0 = now();
    const { state } = editor.view;
    const tr = state.tr.insert(state.doc.content.size, chunk);
    tr.setMeta("addToHistory", false);
    if (!isLast) tr.setMeta(PROGRESSIVE_LOAD_META, true);
    editor.view.dispatch(tr);
    const elapsed = now() - t0;

    // Adaptive chunk size adjustment.
    if (elapsed > CHUNK_TIME_BUDGET_MS) {
      currentChunkSize = Math.max(
        MIN_CHUNK_BLOCKS,
        Math.floor(currentChunkSize / 2),
      );
    } else if (
      elapsed < CHUNK_TIME_BUDGET_MS / 2 &&
      currentChunkSize < restChunkSize
    ) {
      currentChunkSize = Math.min(
        restChunkSize,
        currentChunkSize + Math.ceil(restChunkSize / 4),
      );
    }

    if (!isLast) {
      cancelTick = schedule(step);
    } else {
      removeListeners();
      opts.onComplete();
    }
  };

  cancelTick = schedule(step);

  return {
    cancel() {
      cancelled = true;
      cancelTick();
      removeListeners();
    },
  };
}
