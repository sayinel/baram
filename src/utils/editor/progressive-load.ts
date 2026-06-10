// §perf-large-file C2: progressive document rendering — render the first
// chunk immediately, then append the rest in non-blocking idle callbacks.
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";

/** Transaction meta flag set on every append EXCEPT the last. Decoration
 *  plugins that rebuild over the whole doc skip the rebuild when it is set. */
export const PROGRESSIVE_LOAD_META = "baramProgressiveLoad";

export const FIRST_CHUNK_BLOCKS = 80;
export const REST_CHUNK_BLOCKS = 150;

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

export const scheduleIdle: ScheduleFn = (cb) => {
  const g = globalThis as unknown as {
    cancelIdleCallback?: (id: number) => void;
    requestIdleCallback?: (
      cb: () => void,
      opts?: { timeout: number },
    ) => number;
  };
  if (typeof g.requestIdleCallback === "function") {
    const id = g.requestIdleCallback(cb, { timeout: 100 });
    return () => g.cancelIdleCallback?.(id);
  }
  const id = setTimeout(cb, 0);
  return () => clearTimeout(id);
};

export interface ProgressiveLoadHandle {
  cancel(): void;
}

/**
 * Append `chunks` of block nodes to the END of the editor's document, one
 * chunk per scheduled tick, yielding between chunks. Every chunk except the
 * last carries PROGRESSIVE_LOAD_META so heavy decoration plugins skip their
 * whole-doc rebuild; the last chunk omits it, triggering exactly one rebuild.
 * Appends are not added to undo history. Calls onComplete after the last chunk.
 */
export function appendChunksProgressively(
  editor: Editor,
  chunks: PMNode[][],
  opts: { onComplete: () => void; schedule?: ScheduleFn },
): ProgressiveLoadHandle {
  const schedule = opts.schedule ?? scheduleIdle;
  let i = 0;
  let cancelled = false;
  let cancelTick: () => void = () => {};

  const step = () => {
    if (cancelled) return;
    if (i >= chunks.length) {
      opts.onComplete();
      return;
    }
    const chunk = chunks[i];
    const isLast = i === chunks.length - 1;
    i += 1;

    const { state } = editor.view;
    const tr = state.tr.insert(state.doc.content.size, chunk);
    tr.setMeta("addToHistory", false);
    if (!isLast) tr.setMeta(PROGRESSIVE_LOAD_META, true);
    editor.view.dispatch(tr);

    cancelTick = schedule(step);
  };

  cancelTick = schedule(step);
  return {
    cancel() {
      cancelled = true;
      cancelTick();
    },
  };
}
