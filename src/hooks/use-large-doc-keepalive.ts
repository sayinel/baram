// §perf-large-file C3.5: Hybrid DOM keep-alive for large documents
//
// Owns a pool (LRU cap = 1) of {tabId, editor} pairs.
// When a document is large (childCount ≥ LARGE_DOC_BLOCK_THRESHOLD), its
// Editor instance is kept alive so tab switches cost ~0 ms (visibility toggle
// only, no updateState, no re-parse). The pool is bounded to avoid unbounded
// memory growth; eviction destroys the old editor fully.

import { useRef } from "react";

import type { Editor } from "@tiptap/react";

import { logger } from "../utils/logger";

// [MODERATE-8] Plan specifies 500 top-level blocks as the keep-alive threshold.
// The commit that introduced keep-alive used 200 without documented justification.
// Restoring to 500 per plan §perf-large-file C3.5 to limit the dual-editor
// overhead to genuinely large documents.
export const LARGE_DOC_BLOCK_THRESHOLD = 500;
export const KEEPALIVE_LRU_CAP = 1;

export interface CreateKeepalivePoolOpts {
  onEvict?: EvictionCallback;
}

/** Called before an evicted/released/destroyed editor is destroyed,
 *  allowing React to unmount EditorContent first. */
export type EvictionCallback = (tabId: string, editor: Editor) => void;

export interface KeepaliveEntry {
  /** True once the progressive load has completed (finishLoad called). */
  complete: boolean;
  editor: Editor;
  tabId: string;
}

export interface KeepalivePool {
  /**
   * Acquire a keep-alive slot for tabId using the supplied editor.
   * The entry starts with `complete=false`; call `markComplete` after load.
   * If the pool is at capacity, the LRU entry is evicted (editor destroyed).
   */
  acquire: (tabId: string, editor: Editor) => void;
  /**
   * Returns the keep-alive editor for the given tab ONLY if the entry is
   * complete. Returns null for incomplete entries so the caller falls
   * through to a fresh load.
   */
  activeFor: (activeTabId: null | string) => Editor | null;
  /** Destroy all pooled editors. Used for App unmount / HMR cleanup. */
  destroyAll: () => void;
  /** Returns the keep-alive editor for the given tab, or null if not pooled. */
  get: (tabId: string) => Editor | null;
  /** True when tabId has a live keep-alive slot (complete or not). */
  has: (tabId: string) => boolean;
  /** True when tabId has a COMPLETE keep-alive slot. */
  isComplete: (tabId: string) => boolean;
  /** Returns all tabIds currently held in the pool. */
  keys: () => string[];
  /** Mark an entry as complete (progressive load finished). */
  markComplete: (tabId: string) => void;
  /**
   * Release a keep-alive slot (e.g. when the tab is closed or entry is
   * incomplete on switch-back). Calls onEvict then destroys the editor.
   */
  release: (tabId: string) => void;
}

// ---------------------------------------------------------------------------
// Pool factory — plain function used by both the hook and tests [M10 residual]
// ---------------------------------------------------------------------------

/** Create a keepalive pool backed by a plain mutable array. */
export function createKeepalivePool(opts: CreateKeepalivePoolOpts = {}) {
  const entries: KeepaliveEntry[] = [];

  const get = (tabId: string): Editor | null => {
    const entry = entries.find((e) => e.tabId === tabId);
    return entry?.editor ?? null;
  };

  const has = (tabId: string): boolean =>
    entries.some((e) => e.tabId === tabId);

  const isComplete = (tabId: string): boolean => {
    const entry = entries.find((e) => e.tabId === tabId);
    return entry?.complete ?? false;
  };

  const markComplete = (tabId: string): void => {
    const entry = entries.find((e) => e.tabId === tabId);
    if (entry) entry.complete = true;
  };

  const acquire = (tabId: string, editor: Editor) => {
    // Don't re-acquire if already pooled for this tab.
    if (entries.some((e) => e.tabId === tabId)) return;

    // Evict LRU entries beyond the cap (oldest = first in array).
    while (entries.length >= KEEPALIVE_LRU_CAP) {
      const evicted = entries.shift()!;
      logger.info(
        `[Baram Perf] keepalive: evict editor tabId=${evicted.tabId}`,
      );
      opts.onEvict?.(evicted.tabId, evicted.editor);
      if (!evicted.editor.isDestroyed) evicted.editor.destroy();
    }

    logger.info(
      `[Baram Perf] keepalive: +1 editor tabId=${tabId} (${editor.state.doc.childCount} blocks)`,
    );
    entries.push({ tabId, editor, complete: false });
  };

  const release = (tabId: string) => {
    const idx = entries.findIndex((e) => e.tabId === tabId);
    if (idx === -1) return;
    const [removed] = entries.splice(idx, 1);
    logger.info(`[Baram Perf] keepalive: -1 editor tabId=${tabId}`);
    opts.onEvict?.(removed.tabId, removed.editor);
    if (!removed.editor.isDestroyed) removed.editor.destroy();
  };

  const activeFor = (activeTabId: null | string): Editor | null => {
    if (!activeTabId) return null;
    // Only return complete entries — incomplete ones must re-load.
    const entry = entries.find((e) => e.tabId === activeTabId);
    return entry?.complete ? entry.editor : null;
  };

  const keys = (): string[] => entries.map((e) => e.tabId);

  const destroyAll = () => {
    // [NEW-CRITICAL-A fix] Invoke onEvict per entry before destroying,
    // so React can unmount EditorContent before editor.destroy().
    for (const entry of entries) {
      opts.onEvict?.(entry.tabId, entry.editor);
      if (!entry.editor.isDestroyed) {
        logger.info(`[Baram Perf] keepalive: destroyAll tabId=${entry.tabId}`);
        entry.editor.destroy();
      }
    }
    entries.length = 0;
  };

  return {
    get,
    has,
    isComplete,
    markComplete,
    acquire,
    release,
    activeFor,
    keys,
    destroyAll,
    /** @internal — exposed for testing only */
    _entries: entries,
  };
}

/**
 * Resolve which editor should be used for a given tab.
 * Pure function — extracted for unit testing.
 */
export function resolveTabEditor(
  tabId: null | string,
  pool: Pick<KeepalivePool, "get">,
  sharedEditor: Editor | null,
): Editor | null {
  if (!tabId) return sharedEditor;
  const keepAliveEditor = pool.get(tabId);
  return keepAliveEditor ?? sharedEditor;
}

/**
 * useLargeDocKeepalive — manages the keep-alive editor pool.
 *
 * Returns a STABLE KeepalivePool reference (same object identity across
 * renders) so useEffect deps that include it don't re-fire spuriously.
 */
export function useLargeDocKeepalive(
  onEvict?: EvictionCallback,
): KeepalivePool {
  // Stable ref for the eviction callback — the pool factory captures it
  // via the opts closure; we update it each render so it always points at
  // the latest React callback without re-creating the pool.
  const onEvictRef = useRef(onEvict);
  onEvictRef.current = onEvict;

  // [NEW-CRITICAL-A fix] Create the pool ONCE and store it in a ref.
  // The useCallbacks that were here before were already stable (empty deps)
  // but the poolRef.current reassignment created a new object identity each
  // render, causing useEffect([keepalive]) to fire cleanup (destroyAll) on
  // every commit. Now we create the pool once via createKeepalivePool and
  // never replace it.
  const poolRef = useRef<KeepalivePool | null>(null);
  if (!poolRef.current) {
    poolRef.current = createKeepalivePool({
      // Trampoline through the ref so the pool always calls the latest callback
      onEvict: (tabId, editor) => onEvictRef.current?.(tabId, editor),
    });
  }

  return poolRef.current;
}
