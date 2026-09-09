import type { ContextInfo, ContextType, VaultType } from "../../ipc/types";

// §81 Context Store — manages vault/folder/file contexts
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  addContext as ipcAddContext,
  removeContext as ipcRemoveContext,
  setActiveContext as ipcSetActiveContext,
  updateContextAlias as ipcUpdateContextAlias,
  updateContextColor as ipcUpdateContextColor,
  updateContextLabel as ipcUpdateContextLabel,
} from "../../ipc/context";
import { logger } from "../../utils/logger";
import { basename, stripTrailingSeparators } from "../../utils/path-utils";
import { noteHydrationFailure } from "../system/hydration";
import { tauriStorage } from "../system/tauri-storage";
import { createSpaceSlice, syncZettelIndexForContext } from "./space-slice";

// --- Constants ---

const DEFAULT_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ef4444",
  "#06b6d4",
];

// --- Helpers ---

export interface ContextState {
  /**
   * issue 598: `addContext` that also says whether THIS call appended `context`
   * to the store — false when the backend deduped to a context already held,
   * or to one another call mirrored in meanwhile. A caller that has to undo
   * its own registration (a refused space move) may only remove what it
   * inserted, or a concurrent, legitimate add of the same directory would be
   * taken with it.
   */
  _addContextTracked: (
    type: ContextType,
    rawPath: string,
    opts?: AddContextOpts,
  ) => Promise<{ context: ContextInfo; inserted: boolean }>;
  /** §81 Set active context locally without IPC — used by switchContext */
  _setActiveContextLocal: (id: string) => void;
  // Derived
  activeContext: () => ContextInfo | null;

  // State
  activeContextId: null | string;
  // Actions
  addContext: (
    type: ContextType,
    path: string,
    opts?: AddContextOpts,
  ) => Promise<ContextInfo>;

  /**
   * §81 Drop every context in ONE state transition — the workspace-close path.
   *
   * ‼️ Deliberately NOT a loop over `removeContext`. Removing the *active* context
   * hands `activeContextId` down to the next survivor, and the cross-store
   * subscription in `stores/file/file.ts` turns every such hand-off into
   * `setRootPath(ctx.path)`. Closing N contexts one at a time therefore puts back a
   * `rootPath` the caller just cleared, and the final hand-off — to `null` — cannot
   * undo it, because that subscription early-returns when no context is active. The
   * intermediate "some other context is active now" states are artifacts of the
   * loop; nobody asked for them, so this makes none of them.
   */
  clearAllContexts: () => void;

  contexts: ContextInfo[];

  /**
   * §89 Ensure a FileContext exists for the given file path.
   * Returns existing vault/folder context if the file belongs to one.
   * Creates a new FileContext otherwise (or returns the existing one for that path).
   */
  ensureFileContext: (filePath: string) => Promise<ContextInfo>;
  /**
   * §85 M2b: `ensureSpaceContext` for the journal space, with its label and
   * colour. Activates unless `activate: false` (register only).
   */
  ensureJournalContext: (
    journalDir: string,
    opts?: { activate?: boolean },
  ) => Promise<ContextInfo>;
  /**
   * §92 Generic space-aware variant of ensureJournalContext: ensures a vault
   * context of the given vaultType exists at `dir` (creates+activates if missing,
   * activates if already present).
   *
   * issue 598: "present" means present AT `dir`. A space context found at another
   * path is the same space whose directory setting moved; the new directory is
   * registered (label, colour and alias carried over) and the old registration is
   * retired, and its open tabs are re-homed (files under the old directory get a
   * FileContext each; other tabs follow the space). If the old one was the active
   * context, or activation was asked for, the app switches to the new directory
   * the way the tab bar does (Rust root, file tree, link index) — a local-only
   * activation would leave Rust's root and the tree on the old directory, and
   * retiring the active context would otherwise hand activation to whatever
   * context comes next, which no caller asked for. Rejects when `dir` is already
   * registered as a different context: a space cannot take over a plain vault or
   * the other space.
   */
  ensureSpaceContext: (
    vaultType: VaultType,
    dir: string,
    /**
     * `activate` defaults to true. Pass false to REGISTER only: the backend needs the
     * directory to permit writes there, but the subscription in `stores/file/file.ts`
     * syncs `rootPath` without loading the tree, so activating from a caller that is
     * not switching spaces leaves `rootPath` pointing away from the tree on screen.
     */
    opts?: { activate?: boolean; color?: string; label?: string },
  ) => Promise<ContextInfo>;
  getContextForPath: (filePath: string) => ContextInfo | null;
  journalContext: () => ContextInfo | null;
  /**
   * §85/§93 Pin the space tabs (Zettelkasten, then Journal) to the front of the
   * tab bar; a no-op transition when they already are. Every path that adds or
   * replaces a context commits the order through here.
   */
  pinSpaceTabs: () => void;
  removeContext: (id: string) => Promise<void>;
  /** TODO §82: wire up drag-to-reorder in ContextTabBar */
  reorderContexts: (ids: string[]) => void;
  setActiveContext: (id: string) => Promise<void>;
  /** §92 Generic space-aware variant of journalContext: first context with the given vaultType. */
  spaceContext: (vaultType: VaultType) => ContextInfo | null;
  updateContextAlias: (id: string, alias: string) => void;
  updateContextColor: (id: string, color: string) => void;
  updateContextLabel: (id: string, label: string) => void;
  vaultContexts: () => ContextInfo[];
}

interface AddContextOpts {
  alias?: string;
  color?: string;
  label?: string;
  vaultType?: VaultType;
}

// --- Types ---

/**
 * A context path with trailing separators removed — the string every "is this file inside
 * that context, and where?" answer must be measured against.
 *
 * Exported because §260's `locateInContext` slices a relative path at exactly this
 * boundary. While it used the RAW `path.length` and this rule stripped separators, a
 * stored root with two trailing slashes made the two disagree and ate the first character
 * of the relative path — silently aiming a `files` plugin at a different file (Phase 4a
 * security re-review, LOW-4). One rule, one place.
 */
export function contextRootOf(path: string): string {
  // Delegates rather than repeating the regex: #306 needed the same rule in three more places,
  // so it now lives in `path-utils` with the boundary helpers built on it. This name stays
  // because callers read it as "the context's root".
  return stripTrailingSeparators(path);
}

function generateId(): string {
  return `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// --- Store ---

export const useContextStore = create<ContextState>()(
  persist(
    (set, get) => ({
      ...createSpaceSlice(set, get),
      contexts: [],
      activeContextId: null,

      activeContext: () => {
        const { contexts, activeContextId } = get();
        return contexts.find((c) => c.id === activeContextId) ?? null;
      },

      vaultContexts: () => {
        return get().contexts.filter((c) => c.contextType === "vault");
      },

      ensureFileContext: async (filePath: string) => {
        const { contexts } = get();

        // Check if file belongs to an existing vault/folder context
        const parent = get().getContextForPath(filePath);
        if (parent && parent.contextType !== "file") return parent;

        // Check if a FileContext already exists for this exact path
        const existing = contexts.find(
          (c) => c.contextType === "file" && c.path === filePath,
        );
        if (existing) return existing;

        // Create new FileContext
        return get().addContext("file", filePath, {
          label: basename(filePath),
          color: "#9ca3af", // gray for standalone files
        });
      },

      getContextForPath: (filePath: string) => {
        const { contexts } = get();
        let best: ContextInfo | null = null;
        let bestLen = -1;
        for (const ctx of contexts) {
          // File context: exact path match only
          if (ctx.contextType === "file") {
            if (filePath === ctx.path) return ctx;
            continue;
          }
          // Vault/Folder: the root must be followed by a SEPARATOR, or
          // "/Users/me/work" would match "/Users/me/workspace/note.md".
          //
          // Either separator satisfies it, tested at the boundary rather than inferred
          // from the root (§260 Phase 4a code review, I3). The original appended "/",
          // which on Windows — where both sides are backslash-delimited — matched
          // nothing, so every caller silently got "no context". Inferring the separator
          // from the root instead (`path.includes("\\") ? "\\" : "/"`) fixed Windows but
          // broke POSIX, where a backslash is a legal character in a directory name:
          // a vault at `/home/me/my\dir` would have inferred `"\\"` and then never
          // matched its own files.
          const root = contextRootOf(ctx.path);
          const boundary = filePath[root.length];
          const contains =
            filePath.startsWith(root) &&
            (boundary === "/" || boundary === "\\");
          if (contains && root.length > bestLen) {
            best = ctx;
            bestLen = root.length;
          }
        }
        return best;
      },

      addContext: async (type, rawPath, opts) =>
        (await get()._addContextTracked(type, rawPath, opts)).context,

      _addContextTracked: async (type, rawPath, opts) => {
        const { contexts } = get();
        const colorIndex = contexts.length % DEFAULT_COLORS.length;
        // §260 Phase 4a security re-review (LOW-2) — normalise trailing separators ONCE,
        // here, where a path enters the store. Five consumers currently compute a
        // relative remainder as `filePath.slice(ctx.path.length + 1)` or similar
        // (`getContextForPath`, §260's `locateInContext`, `chat-context`,
        // `wikilink-suggest`), so a stored root with a trailing separator was an
        // off-by-one in each of them — and `journalDirectory` is a user-editable settings
        // field that can carry one (its zettelkasten twin strips, `resolveJournalDir`
        // does not). One point of truth beats five compensations.
        const path = contextRootOf(rawPath) || rawPath;
        // The last path segment names the context; the filesystem root has none,
        // so it is named by itself rather than by an empty string.
        const defaultName = basename(path) || path;
        const info: ContextInfo = {
          id: generateId(),
          contextType: type,
          path,
          label: opts?.label ?? defaultName,
          color: opts?.color ?? DEFAULT_COLORS[colorIndex],
          alias: opts?.alias ?? (type === "vault" ? defaultName : undefined),
          vaultType: opts?.vaultType,
          addedAt: Date.now(),
        };

        try {
          const saved = await ipcAddContext(info);
          // §88 The backend dedups by CANONICAL path and returns the entry that
          // already covers it (`context/manager.rs`), so `saved` can be a context this
          // store already holds — the vault root, a folder added with "+", or a
          // symlink/case variant of either. Appending it produced a second entry with
          // an id it already had (duplicate React keys in the tab bar) and grew the
          // persisted list once per call.
          const deduped = get().contexts.find((c) => c.id === saved.id);
          if (deduped) return { context: deduped, inserted: false };
          set((state) => {
            const next = [...state.contexts, saved];
            // Auto-activate first context
            const shouldActivate =
              state.activeContextId === null && next.length === 1;
            return {
              contexts: next,
              activeContextId: shouldActivate
                ? saved.id
                : state.activeContextId,
            };
          });
          // §85/§93 Keep the space tabs pinned to the front after any add
          get().pinSpaceTabs();
          return { context: saved, inserted: true };
        } catch (err) {
          logger.error("[contextStore] addContext failed:", err);
          throw err;
        }
      },

      clearAllContexts: () => {
        const { activeContextId, contexts } = get();
        // Equality gate: without it, closing an already-empty workspace (the
        // ContextTabBar/VaultTab "last context is gone" path) hands every subscriber
        // a fresh state root for no change at all.
        if (contexts.length === 0 && activeContextId === null) return;

        const ids = contexts.map((c) => c.id);
        // Frontend state first, in a single transition — see the interface note.
        set({ activeContextId: null, contexts: [] });
        // Rust hears about all of them. A context it never knew (persisted by an
        // older session) is not an error here, same as in `removeContext`.
        for (const id of ids) void ipcRemoveContext(id).catch(() => {});
      },

      removeContext: async (id) => {
        // Remove from Rust backend — ignore errors (context may not exist
        // in Rust if it was persisted from a previous session)
        await ipcRemoveContext(id).catch(() => {});

        // Always remove from frontend state
        set((state) => {
          const next = state.contexts.filter((c) => c.id !== id);
          let nextActiveId = state.activeContextId;
          if (state.activeContextId === id) {
            nextActiveId = next[0]?.id ?? null;
          }
          return { contexts: next, activeContextId: nextActiveId };
        });
      },

      setActiveContext: async (id) => {
        try {
          await ipcSetActiveContext(id);
          set({ activeContextId: id });
          syncZettelIndexForContext(get().activeContext());
        } catch (err) {
          logger.error("[contextStore] setActiveContext failed:", err);
          throw err;
        }
      },

      /** §81 Set active context locally (no IPC) — used by switchContext in file.ts */
      _setActiveContextLocal: (id: string) => {
        set({ activeContextId: id });
        syncZettelIndexForContext(get().activeContext());
      },

      reorderContexts: (ids) => {
        set((state) => {
          const map = new Map(state.contexts.map((c) => [c.id, c]));
          const reordered = ids
            .map((id) => map.get(id))
            .filter((c): c is ContextInfo => c !== undefined);
          return { contexts: reordered };
        });
      },

      updateContextAlias: (id, alias) => {
        set((state) => ({
          contexts: state.contexts.map((c) =>
            c.id === id ? { ...c, alias } : c,
          ),
        }));
        // §88 Sync to Rust (non-blocking, ignore failures for stale IDs)
        ipcUpdateContextAlias(id, alias ?? "").catch(() => {});
      },

      updateContextLabel: (id, label) => {
        set((state) => ({
          contexts: state.contexts.map((c) =>
            c.id === id ? { ...c, label } : c,
          ),
        }));
        // §88 Sync to Rust
        ipcUpdateContextLabel(id, label).catch(() => {});
      },

      updateContextColor: (id, color) => {
        set((state) => ({
          contexts: state.contexts.map((c) =>
            c.id === id ? { ...c, color } : c,
          ),
        }));
        // §88 Sync to Rust
        ipcUpdateContextColor(id, color).catch(() => {});
      },
    }),
    {
      // §81 App workspace persistence — stored in app_data_dir as "baram:context".
      // This serves the same role as app-workspace.json in the design spec (§12.3).
      // Format: { contexts: ContextInfo[], activeContextId: string | null }
      name: "baram:context",
      storage: createJSONStorage(() => tauriStorage),
      partialize: (state) => ({
        contexts: state.contexts,
        activeContextId: state.activeContextId,
      }),
      version: 1,
      // issue 597: a failed read (corrupt config.json) would otherwise leave
      // `hasHydrated()` false for good and hold the startup barrier forever.
      onRehydrateStorage: () => (_state, error) => {
        if (error) noteHydrationFailure(useContextStore.persist);
      },
    },
  ),
);
