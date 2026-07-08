// §52 Workspace 프리셋 스토어
import type { VaultType } from "../../ipc/types";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { type Locale, t } from "../../i18n";
import { getSpace } from "../../spaces";
import { resolveJournalDir } from "../../utils/journal/journal";
import { logger } from "../../utils/logger";
import {
  ensureZettelkastenScaffold,
  resolveZettelDir,
} from "../../utils/zettelkasten/zettelkasten";
import { useContextStore } from "../context/context";
import { useSettingsStore } from "../settings/store";
import { tauriStorage } from "../system/tauri-storage";
import { type RightPanelMode, type SidebarPanel, useUIStore } from "../ui/ui";
import { refreshZettelIndex } from "../zettelkasten/zettel-index";
import { switchContext, useFileStore } from "./file";

// --- Types ---

export interface WorkspaceLayout {
  rightPanelMode: RightPanelMode;
  rightPanelOpen: boolean;
  sidebarOpen: boolean;
  sidebarPanel: SidebarPanel;
}

export interface WorkspacePreset {
  builtIn: boolean;
  description: string;
  id: string;
  layout: WorkspaceLayout;
  name: string;
}

// --- Built-in Presets (§4.3) ---

export const BUILTIN_PRESETS: WorkspacePreset[] = [
  {
    id: "writing",
    name: "Writing",
    description: "Hide sidebar and focus on the editor.",
    builtIn: true,
    layout: {
      sidebarOpen: false,
      sidebarPanel: "files",
      rightPanelOpen: false,
      rightPanelMode: "none",
    },
  },
  {
    id: "zettelkasten",
    name: "Zettel",
    description: "Capture ideas fast and refine them into linked notes.",
    builtIn: true,
    layout: getSpace("zettelkasten")?.layout ?? {
      sidebarOpen: true,
      sidebarPanel: "files",
      rightPanelOpen: false,
      rightPanelMode: "none",
    },
  },
  {
    id: "journal",
    name: "Journal",
    description: "Open calendar, today's journal, and Memories view together.",
    builtIn: true,
    layout: {
      sidebarOpen: true,
      sidebarPanel: "calendar",
      rightPanelOpen: true,
      rightPanelMode: "memories",
    },
  },
  {
    id: "skills",
    name: "Skills",
    description: "Layout optimized for editing LLM Skills files.",
    builtIn: true,
    layout: {
      sidebarOpen: true,
      sidebarPanel: "files",
      rightPanelOpen: true,
      rightPanelMode: "properties",
    },
  },
];

// --- Store ---

interface WorkspaceState {
  activePresetId: null | string;
  applyPreset: (id: string) => void;

  customPresets: WorkspacePreset[];
  deleteCustomPreset: (id: string) => void;
  getAllPresets: () => WorkspacePreset[];
  getPreset: (id: string) => undefined | WorkspacePreset;
  renameCustomPreset: (id: string, name: string) => void;
  /**
   * §82 Revert to the Writing space when the context backing the current
   * space (journal/zettelkasten) is closed from the context tab bar.
   */
  revertSpaceIfContextClosed: (closedVaultType?: VaultType) => void;
  saveCustomPreset: (name: string, description?: string) => string;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      activePresetId: null,
      customPresets: [],

      applyPreset: (id) => {
        const preset = get().getPreset(id);
        if (!preset) return;

        // §93 The Zettel space needs the feature enabled + a directory set.
        // Guide the user with a toast instead of switching into an empty space.
        if (id === "zettelkasten") {
          const { locale, zettelkastenDirectory, zettelkastenEnabled } =
            useSettingsStore.getState();
          if (!zettelkastenEnabled) {
            useUIStore
              .getState()
              .showToast(t("space.zettel.disabled", locale as Locale));
            return;
          }
          if (
            !resolveZettelDir(
              useFileStore.getState().rootPath,
              zettelkastenDirectory,
            )
          ) {
            useUIStore
              .getState()
              .showToast(t("space.zettel.noDirectory", locale as Locale));
            return;
          }
        }

        const ui = useUIStore.getState();
        const { layout } = preset;

        // Apply layout to ui-store.
        // §82 Preserve an open folder tree across space switches: a preset may
        // OPEN the sidebar but must never force-close one the user has open.
        if (layout.sidebarOpen && !ui.sidebarOpen) ui.toggleSidebar();
        ui.setSidebarPanel(layout.sidebarPanel);
        if (ui.rightPanelOpen !== layout.rightPanelOpen) ui.toggleRightPanel();
        ui.setRightPanelMode(layout.rightPanelMode);

        // §85 M2b: When switching away from journal, activate the first non-journal context
        if (id !== "journal") {
          const contextStore = useContextStore.getState();
          const activeCtx = contextStore.activeContext();
          if (activeCtx?.vaultType === "journal") {
            const firstNonJournal = contextStore.contexts.find(
              (c) => c.vaultType !== "journal",
            );
            if (firstNonJournal) {
              contextStore
                .setActiveContext(firstNonJournal.id)
                .catch((err) =>
                  logger.error(
                    "[Workspace] Failed to switch from journal:",
                    err,
                  ),
                );
            }
          }
        }

        set({ activePresetId: id });

        // §85 M2b: Journal preset — activate journal context + open today's file
        if (id === "journal") {
          const { journalEnabled, journalDirectory } =
            useSettingsStore.getState();
          const { rootPath } = useFileStore.getState();
          const resolvedDir = resolveJournalDir(rootPath, journalDirectory);
          if (journalEnabled && resolvedDir) {
            (async () => {
              try {
                await useContextStore
                  .getState()
                  .ensureJournalContext(resolvedDir);
                await getSpace("journal")?.newFileFlow?.();
                // File tree switch handled by contextStore subscription in file.ts
              } catch (err) {
                logger.error("[Workspace] Failed to open journal:", err);
              }
            })();
          }
        }

        // §93 Zettelkasten preset — activate context + ensure scaffold folders
        if (id === "zettelkasten") {
          const { zettelkastenEnabled, zettelkastenDirectory } =
            useSettingsStore.getState();
          const { rootPath } = useFileStore.getState();
          const resolvedDir = resolveZettelDir(rootPath, zettelkastenDirectory);
          if (zettelkastenEnabled && resolvedDir) {
            (async () => {
              try {
                // Register the zettel dir as a context FIRST — createDir/writeFile
                // are vault-constrained (check_vault → validate_path_any), so the
                // scaffold folders can only be created after the dir is a
                // registered context. (Otherwise createDir throws "Access denied",
                // aborting this whole block: no folders, no context, no index.)
                const ctx = await useContextStore
                  .getState()
                  .ensureSpaceContext("zettelkasten", resolvedDir, {
                    label: "Zettel",
                  });
                await ensureZettelkastenScaffold(resolvedDir);
                await refreshZettelIndex(resolvedDir);
                // Load the file tree for the zettel dir — ensureSpaceContext
                // activates the context locally but does NOT load its tree
                // (only switchContext/openFolder do). Without this the sidebar
                // keeps showing the previous vault's tree until the user clicks
                // the context tab. inbox/ + notes/ now exist, so load them here.
                await switchContext(ctx.id);
                await getSpace("zettelkasten")?.startup?.();
              } catch (err) {
                logger.error("[Workspace] Failed to open zettelkasten:", err);
              }
            })();
          }
        }
      },

      revertSpaceIfContextClosed: (closedVaultType) => {
        // The Journal/Zettelkasten spaces are each backed by a single context
        // (maxInstances=1). When the user closes that context from the tab bar
        // while its space is the active one, fall back to the Writing space so
        // the layout + space indicator no longer point at a space that is gone.
        if (
          closedVaultType !== "journal" &&
          closedVaultType !== "zettelkasten"
        ) {
          return;
        }
        // Preset ids ("journal"/"zettelkasten") match the VaultType strings.
        if (get().activePresetId !== closedVaultType) return;
        // applyPreset preserves an open folder tree (it never force-closes the
        // sidebar), so reverting to Writing keeps the tree exactly as it was.
        get().applyPreset("writing");
      },

      saveCustomPreset: (name, description) => {
        const ui = useUIStore.getState();
        const id = `custom-${Date.now()}`;
        const preset: WorkspacePreset = {
          id,
          name,
          description: description ?? "",
          builtIn: false,
          layout: {
            sidebarOpen: ui.sidebarOpen,
            sidebarPanel: ui.sidebarPanel,
            rightPanelOpen: ui.rightPanelOpen,
            rightPanelMode: ui.rightPanelMode,
          },
        };
        set((state) => ({
          customPresets: [...state.customPresets, preset],
          activePresetId: id,
        }));
        return id;
      },

      deleteCustomPreset: (id) => {
        set((state) => ({
          customPresets: state.customPresets.filter((p) => p.id !== id),
          activePresetId:
            state.activePresetId === id ? null : state.activePresetId,
        }));
      },

      renameCustomPreset: (id, name) => {
        set((state) => ({
          customPresets: state.customPresets.map((p) =>
            p.id === id ? { ...p, name } : p,
          ),
        }));
      },

      getAllPresets: () => [...BUILTIN_PRESETS, ...get().customPresets],

      getPreset: (id) => {
        const builtin = BUILTIN_PRESETS.find((p) => p.id === id);
        if (builtin) return builtin;
        return get().customPresets.find((p) => p.id === id);
      },
    }),
    {
      name: "baram:workspace",
      storage: createJSONStorage(() => tauriStorage),
      partialize: (state) => ({
        activePresetId: state.activePresetId,
        customPresets: state.customPresets,
      }),
      version: 1,
    },
  ),
);
