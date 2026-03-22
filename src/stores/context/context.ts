import type { ContextInfo, ContextType, VaultType } from "../../ipc/types";

// §81 Context Store — manages vault/folder/file contexts
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  addContext as ipcAddContext,
  getContexts as ipcGetContexts,
  removeContext as ipcRemoveContext,
  setActiveContext as ipcSetActiveContext,
} from "../../ipc/context";
import { logger } from "../../utils/logger";
import { tauriStorage } from "../system/tauri-storage";

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
  getContextForPath: (filePath: string) => ContextInfo | null;
  journalContext: () => ContextInfo | null;
  removeContext: (id: string) => Promise<void>;
  reorderContexts: (ids: string[]) => void;
  restoreFromBackend: () => Promise<void>;

  setActiveContext: (id: string) => Promise<void>;
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

      journalContext: () => {
        return (
          get().contexts.find(
            (c) => c.contextType === "vault" && c.vaultType === "journal",
          ) ?? null
        );
      },

      getContextForPath: (filePath: string) => {
        const { contexts } = get();
        let best: ContextInfo | null = null;
        let bestLen = -1;
        for (const ctx of contexts) {
          if (filePath.startsWith(ctx.path) && ctx.path.length > bestLen) {
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
          alias: opts?.alias,
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
          return saved;
        } catch (err) {
          logger.error("[contextStore] addContext failed:", err);
          throw err;
        }
      },

      removeContext: async (id) => {
        try {
          await ipcRemoveContext(id);
          set((state) => {
            const next = state.contexts.filter((c) => c.id !== id);
            let nextActiveId = state.activeContextId;
            if (state.activeContextId === id) {
              // Fall back to the first remaining context
              nextActiveId = next[0]?.id ?? null;
            }
            return { contexts: next, activeContextId: nextActiveId };
          });
        } catch (err) {
          logger.error("[contextStore] removeContext failed:", err);
          throw err;
        }
      },

      setActiveContext: async (id) => {
        try {
          await ipcSetActiveContext(id);
          set({ activeContextId: id });
        } catch (err) {
          logger.error("[contextStore] setActiveContext failed:", err);
          throw err;
        }
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

      updateContextLabel: (id, label) => {
        set((state) => ({
          contexts: state.contexts.map((c) =>
            c.id === id ? { ...c, label } : c,
          ),
        }));
      },

      updateContextColor: (id, color) => {
        set((state) => ({
          contexts: state.contexts.map((c) =>
            c.id === id ? { ...c, color } : c,
          ),
        }));
      },

      restoreFromBackend: async () => {
        try {
          const contexts = await ipcGetContexts();
          set({ contexts });
        } catch (err) {
          logger.error("[contextStore] restoreFromBackend failed:", err);
        }
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
