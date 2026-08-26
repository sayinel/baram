import type { BacklinkEntry, UnlinkedMention } from "../../ipc/types";

// §29 링크 인덱스 스토어 — 백링크, 링크 그래프 프론트엔드 캐시
// §34 언링크드 멘션 상태 추가
import { create } from "zustand";

/**
 * §313 One pending scroll request. Written as a whole so the three target kinds
 * can never be set at the same time — the consumers test them in a fixed
 * `if / else if` order, so a leftover block id used to shadow a fresh line
 * request for a different file entirely.
 */
export interface PendingScrollRecord {
  blockId: null | string;
  heading: null | string;
  line: null | number;
  originTabId: null | string;
  path: string;
}

interface LinkState {
  /** Backlinks for the currently viewed file */
  backlinks: BacklinkEntry[];
  /** Path of the file whose backlinks are cached */
  cachedPath: null | string;
  /** Clear all cached data */
  clear: () => void;
  /** §313 Drop the pending scroll request entirely (target, address and origin). */
  clearPendingScroll: () => void;
  /** Last error from IPC */
  error: null | string;
  /** Monotonic counter — incremented when the Rust index changes, triggers refetch */
  indexVersion: number;
  /** Signal that the Rust index was updated — triggers Backlinks refetch */
  invalidate: () => void;

  /** Whether backlinks are being loaded */
  loading: boolean;
  /** §275.6 Highlight id to scroll to + flash once its PDF's PdfPreview mounts
   * and its sidecar has loaded (consumed by use-pdf-highlight-flash.ts) */
  pendingPdfHighlightId: null | string;
  /** §30c Block ID to scroll to after block ref navigation */
  pendingScrollBlockId: null | string;
  /** Heading text to scroll to after cross-file navigation (consumed by afterDocLoad) */
  pendingScrollHeading: null | string;
  /** Markdown line number to scroll to after backlink navigation (1-based) */
  pendingScrollLine: null | number;
  /**
   * §313 The tab that was active when the request was made.
   *
   * Distinguishes "the target file is ALREADY on screen" (no tab switch will
   * run, so the same-tab consumer must deliver) from "a tab switch is about to
   * run" (it delivers, and consuming here would scroll the outgoing document).
   * Comparing the active tab's *path* alone cannot tell those apart: React
   * batches the `setActiveTab` into the same commit, so the store already
   * reports the incoming tab while the editor still holds the outgoing doc.
   */
  pendingScrollOriginTabId: null | string;
  /**
   * §313 The absolute path a pending scroll request is addressed to.
   *
   * `null` means unaddressed — the legacy setters below (wikilink / block-ref
   * navigation, which handle their own same-file case) leave it that way and
   * whichever tab lands consumes the request, as before.
   */
  pendingScrollPath: null | string;
  /** §313 Monotonic — bumped by every addressed request so an already-active tab sees one. */
  pendingScrollRequest: number;
  /** Set backlinks data (called after IPC response) */
  setBacklinks: (path: string, entries: BacklinkEntry[]) => void;
  /** Set error state */
  setError: (error: null | string) => void;
  /** Set loading state */
  setLoading: (loading: boolean) => void;
  /** Set pending PDF highlight id (consumed by use-pdf-highlight-flash.ts) */
  setPendingPdfHighlightId: (id: null | string) => void;
  /** §313 Record an addressed scroll request. Policy lives in utils/editor/pending-scroll.ts. */
  setPendingScroll: (record: PendingScrollRecord) => void;
  /** Set pending scroll block ID (consumed by App.tsx after tab switch) */
  setPendingScrollBlockId: (id: null | string) => void;
  /** Set pending scroll heading (consumed by afterDocLoad after tab switch) */
  setPendingScrollHeading: (heading: null | string) => void;
  /** Set pending scroll line (consumed by App.tsx after tab switch) */
  setPendingScrollLine: (line: null | number) => void;
  /** §34 Set unlinked mentions data */
  setUnlinkedMentions: (entries: UnlinkedMention[]) => void;
  /** §34 Unlinked mentions for the currently viewed file */
  unlinkedMentions: UnlinkedMention[];
}

export const useLinkStore = create<LinkState>((set, get) => ({
  backlinks: [],
  unlinkedMentions: [],
  loading: false,
  error: null,
  cachedPath: null,
  indexVersion: 0,

  setBacklinks: (path, entries) =>
    set({ backlinks: entries, cachedPath: path, loading: false, error: null }),

  setUnlinkedMentions: (entries) => set({ unlinkedMentions: entries }),

  setLoading: (loading) => set({ loading }),

  setError: (error) => set({ error, loading: false }),

  clear: () =>
    set({
      backlinks: [],
      unlinkedMentions: [],
      loading: false,
      error: null,
      cachedPath: null,
    }),

  invalidate: () => set({ indexVersion: get().indexVersion + 1 }),

  pendingScrollLine: null,
  setPendingScrollLine: (line) => set({ pendingScrollLine: line }),
  pendingScrollBlockId: null,
  setPendingScrollBlockId: (id) => set({ pendingScrollBlockId: id }),
  pendingScrollHeading: null,
  setPendingScrollHeading: (heading) => set({ pendingScrollHeading: heading }),

  pendingScrollOriginTabId: null,
  pendingScrollPath: null,
  pendingScrollRequest: 0,

  clearPendingScroll: () =>
    set({
      pendingScrollBlockId: null,
      pendingScrollHeading: null,
      pendingScrollLine: null,
      pendingScrollOriginTabId: null,
      pendingScrollPath: null,
    }),

  setPendingScroll: (record) =>
    set((state) => ({
      pendingScrollBlockId: record.blockId,
      pendingScrollHeading: record.heading,
      pendingScrollLine: record.line,
      pendingScrollOriginTabId: record.originTabId,
      pendingScrollPath: record.path,
      pendingScrollRequest: state.pendingScrollRequest + 1,
    })),
  pendingPdfHighlightId: null,
  setPendingPdfHighlightId: (id) => set({ pendingPdfHighlightId: id }),
}));
