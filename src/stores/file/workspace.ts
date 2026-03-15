// §52 Workspace 프리셋 스토어
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { listDir, setVaultRoot } from "../../ipc/invoke";
import {
  ensureJournalFile,
  openFileInTab,
} from "../../services/journal-file-service";
import { resolveJournalDir } from "../../utils/journal/journal";
import { logger } from "../../utils/logger";
import { useSettingsStore } from "../settings/store";
import { tauriStorage } from "../system/tauri-storage";
import { useUIStore } from "../ui/ui";
import { useFileStore } from "./file";
import { buildFileTree } from "./file";

// --- Types ---

export interface WorkspaceLayout {
  rightPanelMode:
    | "chat"
    | "help"
    | "memories"
    | "none"
    | "photo-gallery"
    | "properties";
  rightPanelOpen: boolean;
  sidebarOpen: boolean;
  sidebarPanel:
    | "backlinks"
    | "bookmarks"
    | "calendar"
    | "files"
    | "git"
    | "graph"
    | "outline"
    | "plugins"
    | "search"
    | "skills-gallery"
    | "snapshots"
    | "tags";
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
    name: "Skills Editing",
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

        const ui = useUIStore.getState();
        const { layout } = preset;

        // Apply layout to ui-store
        if (ui.sidebarOpen !== layout.sidebarOpen) ui.toggleSidebar();
        ui.setSidebarPanel(layout.sidebarPanel);
        if (ui.rightPanelOpen !== layout.rightPanelOpen) ui.toggleRightPanel();
        ui.setRightPanelMode(layout.rightPanelMode);

        // §56 Exit journal scope when switching away from journal preset
        const fileStore = useFileStore.getState();
        if (id !== "journal" && fileStore.isJournalScoped) {
          const originalRoot = fileStore.originalRootPath;
          fileStore.exitJournalScope();
          if (originalRoot) {
            (async () => {
              try {
                await setVaultRoot(originalRoot);
                const entries = await listDir(originalRoot, true);
                const tree = buildFileTree(entries, originalRoot);
                useFileStore.getState().setFileTree(tree);
              } catch (err) {
                logger.error("[Workspace] Failed to restore file tree:", err);
              }
            })();
          }
        }

        set({ activePresetId: id });

        // §56 Journal preset: auto-open today's journal + scope FileTree
        if (id === "journal") {
          const {
            journalEnabled,
            journalDirectory,
            journalFilenameFormat,
            journalTemplatePath,
            journalUseHierarchy,
          } = useSettingsStore.getState();
          const { rootPath } = useFileStore.getState();
          const resolvedDir = resolveJournalDir(rootPath, journalDirectory);
          if (journalEnabled && resolvedDir) {
            (async () => {
              try {
                // Set vault root to journal directory BEFORE any file operations
                await setVaultRoot(resolvedDir);

                const result = await ensureJournalFile(new Date(), {
                  journalDirectory,
                  journalFilenameFormat,
                  journalTemplatePath,
                  journalUseHierarchy,
                  rootPath,
                });
                if (result) {
                  await openFileInTab(result.path, result.content);
                }

                // §56 Scope FileTree to journal directory
                useFileStore.getState().enterJournalScope(resolvedDir);
                const entries = await listDir(resolvedDir, true);
                const tree = buildFileTree(entries, resolvedDir);
                useFileStore.getState().setFileTree(tree);
              } catch (err) {
                logger.error("[Workspace] Failed to open journal:", err);
              }
            })();
          }
        }
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
