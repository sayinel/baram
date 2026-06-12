// §perf-large-file C3.5: Hybrid DOM keep-alive for large documents
//
// Owns a pool (LRU cap = 1) of {tabId, editor} pairs.
// When a document is large (childCount ≥ LARGE_DOC_BLOCK_THRESHOLD), its
// Editor instance is kept alive so tab switches cost ~0 ms (visibility toggle
// only, no updateState, no re-parse). The pool is bounded to avoid unbounded
// memory growth; eviction destroys the old editor fully.

import { useCallback, useRef } from "react";

import type { Editor } from "@tiptap/react";

import { logger } from "../utils/logger";

// [MODERATE-8] Plan specifies 500 top-level blocks as the keep-alive threshold.
// The commit that introduced keep-alive used 200 without documented justification.
// Restoring to 500 per plan §perf-large-file C3.5 to limit the dual-editor
// overhead to genuinely large documents.
export const LARGE_DOC_BLOCK_THRESHOLD = 500;
export const KEEPALIVE_LRU_CAP = 1;

/** Called before an evicted editor is destroyed, allowing React to unmount first. */
export type EvictionCallback = (tabId: string, editor: Editor) => void;

export interface KeepaliveEntry {
  editor: Editor;
  tabId: string;
}

export interface KeepalivePool {
  /**
   * Acquire a keep-alive slot for tabId using the supplied editor.
   * If the pool is at capacity, the LRU entry is evicted (editor destroyed).
   */
  acquire: (tabId: string, editor: Editor) => void;
  /**
   * Returns the tabId that currently owns the active (visible) slot,
   * or null when no slot is active.
   */
  activeFor: (activeTabId: null | string) => Editor | null;
  /**
   * Destroy all pooled editors. Used for App unmount / HMR cleanup.
   */
  destroyAll: () => void;
  /** Returns the keep-alive editor for the given tab, or null if not pooled. */
  get: (tabId: string) => Editor | null;
  /** True when tabId has a live keep-alive slot. */
  has: (tabId: string) => boolean;
  /** Returns all tabIds currently held in the pool. */
  keys: () => string[];
  /**
   * Release a keep-alive slot (e.g. when the tab is closed).
   * Destroys the associated editor.
   */
  release: (tabId: string) => void;
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
 * Returns a stable KeepalivePool reference backed by a ref so that callers
 * that close over it never see a stale version.
 */
export function useLargeDocKeepalive(
  onEvict?: EvictionCallback,
): KeepalivePool {
  // LRU list — most recently used is last. Max length = KEEPALIVE_LRU_CAP.
  const entriesRef = useRef<KeepaliveEntry[]>([]);
  // Stable ref for the eviction callback so acquire doesn't re-create.
  const onEvictRef = useRef(onEvict);
  onEvictRef.current = onEvict;

  const get = useCallback((tabId: string): Editor | null => {
    const entry = entriesRef.current.find((e) => e.tabId === tabId);
    return entry?.editor ?? null;
  }, []);

  const has = useCallback((tabId: string): boolean => {
    return entriesRef.current.some((e) => e.tabId === tabId);
  }, []);

  const acquire = useCallback((tabId: string, editor: Editor) => {
    // Don't re-acquire if already pooled for this tab.
    if (entriesRef.current.some((e) => e.tabId === tabId)) return;

    // Evict LRU entries beyond the cap (oldest = first in array).
    // [MODERATE-9] Notify via onEvict before destroying so React can
    // unmount EditorContent before the editor instance is destroyed.
    while (entriesRef.current.length >= KEEPALIVE_LRU_CAP) {
      const evicted = entriesRef.current.shift()!;
      logger.info(
        `[Baram Perf] keepalive: evict editor tabId=${evicted.tabId}`,
      );
      onEvictRef.current?.(evicted.tabId, evicted.editor);
      if (!evicted.editor.isDestroyed) evicted.editor.destroy();
    }

    logger.info(
      `[Baram Perf] keepalive: +1 editor tabId=${tabId} (${editor.state.doc.childCount} blocks)`,
    );
    entriesRef.current.push({ tabId, editor });
  }, []);

  const release = useCallback((tabId: string) => {
    const idx = entriesRef.current.findIndex((e) => e.tabId === tabId);
    if (idx === -1) return;
    const [removed] = entriesRef.current.splice(idx, 1);
    logger.info(`[Baram Perf] keepalive: -1 editor tabId=${tabId}`);
    // [MODERATE-9] Notify before destroy so React can unmount EditorContent.
    onEvictRef.current?.(removed.tabId, removed.editor);
    if (!removed.editor.isDestroyed) removed.editor.destroy();
  }, []);

  const activeFor = useCallback(
    (activeTabId: null | string): Editor | null => {
      if (!activeTabId) return null;
      return get(activeTabId);
    },
    [get],
  );

  // [MAJOR-4] Return all pooled tabIds so callers can check for closed tabs.
  const keys = useCallback((): string[] => {
    return entriesRef.current.map((e) => e.tabId);
  }, []);

  // [MINOR-11] Destroy all pooled editors (App unmount / HMR cleanup).
  const destroyAll = useCallback(() => {
    for (const entry of entriesRef.current) {
      if (!entry.editor.isDestroyed) {
        logger.info(`[Baram Perf] keepalive: destroyAll tabId=${entry.tabId}`);
        entry.editor.destroy();
      }
    }
    entriesRef.current = [];
  }, []);

  // Return a stable object backed by the same callbacks.
  const poolRef = useRef<KeepalivePool>({
    get,
    has,
    acquire,
    release,
    activeFor,
    keys,
    destroyAll,
  });
  // Keep function refs up to date (useCallback refs are stable, but belt-and-suspenders).
  poolRef.current = { get, has, acquire, release, activeFor, keys, destroyAll };

  return poolRef.current;
}
