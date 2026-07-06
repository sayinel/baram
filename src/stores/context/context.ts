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
import { resolveZettelDir } from "../../utils/zettelkasten/zettelkasten";
import { useSettingsStore } from "../settings/store";
import { tauriStorage } from "../system/tauri-storage";
import {
  refreshZettelIndex,
  useZettelIndexStore,
} from "../zettelkasten/zettel-index";

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

interface AddContextOpts {
  alias?: string;
  color?: string;
  label?: string;
  vaultType?: VaultType;
}

interface ContextState {
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

  contexts: ContextInfo[];

  /**
   * §89 Ensure a FileContext exists for the given file path.
   * Returns existing vault/folder context if the file belongs to one.
   * Creates a new FileContext otherwise (or returns the existing one for that path).
   */
  ensureFileContext: (filePath: string) => Promise<ContextInfo>;
  /**
   * §85 M2b: Ensure a journal vault context exists and is active.
   * Creates one if not present; activates it if not already active.
   */
  ensureJournalContext: (journalDir: string) => Promise<ContextInfo>;
  /**
   * §92 Generic space-aware variant of ensureJournalContext: ensures a vault
   * context of the given vaultType exists at `dir` (creates+activates if missing,
   * activates if already present).
   */
  ensureSpaceContext: (
    vaultType: VaultType,
    dir: string,
    opts?: { color?: string; label?: string },
  ) => Promise<ContextInfo>;
  getContextForPath: (filePath: string) => ContextInfo | null;
  journalContext: () => ContextInfo | null;
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

// --- Types ---

function generateId(): string {
  return `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function labelFromPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * §85 Pin journal context to position 1 (right after the first non-journal context).
 * Returns a reordered copy if journal exists at index > 1, otherwise returns null.
 */
function pinJournalToSecond(contexts: ContextInfo[]): ContextInfo[] | null {
  const journalIdx = contexts.findIndex(
    (c) => c.contextType === "vault" && c.vaultType === "journal",
  );
  if (journalIdx > 1) {
    const reordered = [...contexts];
    const [journal] = reordered.splice(journalIdx, 1);
    reordered.splice(1, 0, journal);
    return reordered;
  }
  return null;
}

/**
 * §95/§98 M1: Keep the zettel id index scoped to the active zettel space.
 * When the newly active context's path is under the configured zettel dir,
 * refresh the index (covers switching INTO the space via the context tab
 * bar, not just the workspace preset). Otherwise clear it, so stale
 * id→title mappings from a previously active zettel space never leak into
 * an unrelated vault. No-op when the zettelkasten feature is disabled.
 *
 * Note: `resolveZettelDir`'s first (rootPath) argument is unused — only
 * absolute directory settings are supported — so we pass `null` here to
 * avoid importing the file store (which itself imports this module).
 */
function syncZettelIndexForContext(ctx: ContextInfo | null): void {
  const { zettelkastenEnabled, zettelkastenDirectory } =
    useSettingsStore.getState();
  if (!zettelkastenEnabled) return;

  const zettelDir = resolveZettelDir(null, zettelkastenDirectory);
  if (!zettelDir) return;

  const prefix = `${zettelDir}/`;
  const inZettelSpace =
    !!ctx && (ctx.path === zettelDir || ctx.path.startsWith(prefix));

  if (inZettelSpace) {
    refreshZettelIndex(zettelDir).catch((err) =>
      logger.error("[contextStore] Failed to refresh zettel index:", err),
    );
  } else {
    useZettelIndexStore.getState().clear();
  }
}

// --- Store ---

export const useContextStore = create<ContextState>()(
  persist(
    (set, get) => ({
      contexts: [],
      activeContextId: null,

      activeContext: () => {
        const { contexts, activeContextId } = get();
        return contexts.find((c) => c.id === activeContextId) ?? null;
      },

      vaultContexts: () => {
        return get().contexts.filter((c) => c.contextType === "vault");
      },

      journalContext: () => get().spaceContext("journal"),

      spaceContext: (vaultType) =>
        get().contexts.find(
          (c) => c.contextType === "vault" && c.vaultType === vaultType,
        ) ?? null,

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
        const fileName = filePath.split("/").pop() ?? filePath;
        return get().addContext("file", filePath, {
          label: fileName,
          color: "#9ca3af", // gray for standalone files
        });
      },

      ensureJournalContext: async (journalDir: string) => {
        const wasExisting = get().spaceContext("journal") !== null;
        const ctx = await get().ensureSpaceContext("journal", journalDir, {
          label: "journal",
          color: "#10b981",
        });
        // §85 Pin journal context to position 1 (after first vault) — only
        // needed when we just created it; an existing context is already pinned.
        if (!wasExisting) {
          const pinned = pinJournalToSecond(get().contexts);
          if (pinned) set({ contexts: pinned });
        }
        return ctx;
      },

      ensureSpaceContext: async (vaultType, dir, opts) => {
        const existing = get().contexts.find(
          (c) => c.contextType === "vault" && c.vaultType === vaultType,
        );
        if (existing) {
          // Activate if not active — use local-only to avoid stale ID IPC failures
          if (get().activeContextId !== existing.id) {
            get()._setActiveContextLocal(existing.id);
          }
          return existing;
        }
        // Create new vault context of the given type
        const created = await get().addContext("vault", dir, {
          vaultType,
          label: opts?.label ?? vaultType,
          color: opts?.color,
        });
        // Activate the newly created context
        if (get().activeContextId !== created.id) {
          get()._setActiveContextLocal(created.id);
        }
        return created;
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
          // Vault/Folder: must match with trailing separator to avoid
          // "/Users/me/work" matching "/Users/me/workspace/note.md"
          const prefix = ctx.path.endsWith("/") ? ctx.path : ctx.path + "/";
          if (filePath.startsWith(prefix) && ctx.path.length > bestLen) {
            best = ctx;
            bestLen = ctx.path.length;
          }
        }
        return best;
      },

      addContext: async (type, path, opts) => {
        const { contexts } = get();
        const colorIndex = contexts.length % DEFAULT_COLORS.length;
        const info: ContextInfo = {
          id: generateId(),
          contextType: type,
          path,
          label: opts?.label ?? labelFromPath(path),
          color: opts?.color ?? DEFAULT_COLORS[colorIndex],
          alias:
            opts?.alias ?? (type === "vault" ? labelFromPath(path) : undefined),
          vaultType: opts?.vaultType,
          addedAt: Date.now(),
        };

        try {
          const saved = await ipcAddContext(info);
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
          // §85 Ensure journal stays at position 1 after any add
          const pinned = pinJournalToSecond(get().contexts);
          if (pinned) set({ contexts: pinned });
          return saved;
        } catch (err) {
          logger.error("[contextStore] addContext failed:", err);
          throw err;
        }
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
    },
  ),
);
