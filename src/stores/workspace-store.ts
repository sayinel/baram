// §52 Workspace 프리셋 스토어
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { tauriStorage } from "./tauri-storage";
import { useUIStore } from "./ui-store";
import { useSettingsStore } from "./settings-store";
import { useFileStore } from "./file-store";
import { useEditorStore } from "./editor-store";
import { readFile, writeFile, createDir, listDir } from "../ipc/invoke";
import { getJournalFilePath, getHierarchicalJournalPath, resolveJournalDir, generateDefaultJournal, applyJournalTemplate } from "../utils/journal";
import { buildFileTree } from "./file-store";

// --- Types ---

export interface WorkspaceLayout {
  sidebarOpen: boolean;
  sidebarPanel: "files" | "outline" | "search" | "backlinks" | "bookmarks" | "graph" | "git" | "calendar" | "tags" | "snapshots" | "skills-gallery";
  rightPanelOpen: boolean;
  rightPanelMode: "chat" | "help" | "memories" | "photo-gallery" | "properties" | "none";
}

export interface WorkspacePreset {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  layout: WorkspaceLayout;
}

// --- Built-in Presets (§4.3) ---

export const BUILTIN_PRESETS: WorkspacePreset[] = [
  {
    id: "writing",
    name: "글쓰기",
    description: "사이드바를 숨기고 에디터에 집중합니다.",
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
    name: "저널",
    description: "캘린더와 오늘의 저널, Memories View를 함께 엽니다.",
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
    name: "Skills 편집",
    description: "LLM Skills 파일 편집에 최적화된 레이아웃입니다.",
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
  activePresetId: string | null;
  customPresets: WorkspacePreset[];

  applyPreset: (id: string) => void;
  saveCustomPreset: (name: string, description?: string) => string;
  deleteCustomPreset: (id: string) => void;
  renameCustomPreset: (id: string, name: string) => void;
  getAllPresets: () => WorkspacePreset[];
  getPreset: (id: string) => WorkspacePreset | undefined;
}

export const useWorkspaceStore = create<WorkspaceState>()(persist((set, get) => ({
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
            const entries = await listDir(originalRoot, true);
            const tree = buildFileTree(entries, originalRoot);
            useFileStore.getState().setFileTree(tree);
          } catch (err) {
            console.error("[Workspace] Failed to restore file tree:", err);
          }
        })();
      }
    }

    set({ activePresetId: id });

    // §56 Journal preset: auto-open today's journal + scope FileTree
    if (id === "journal") {
      const { journalEnabled, journalDirectory, journalFilenameFormat, journalTemplatePath, journalUseHierarchy } =
        useSettingsStore.getState();
      const { rootPath } = useFileStore.getState();
      const resolvedDir = resolveJournalDir(rootPath, journalDirectory);
      if (journalEnabled && resolvedDir) {
        const date = new Date();
        const journalPath = journalUseHierarchy
          ? getHierarchicalJournalPath(resolvedDir, date, journalFilenameFormat)
          : getJournalFilePath(rootPath, journalDirectory, date, journalFilenameFormat);
        if (!journalPath) return;
        (async () => {
          try {
            let exists = true;
            try {
              await readFile(journalPath);
            } catch {
              exists = false;
            }
            if (!exists) {
              const parentDir = journalPath.substring(0, journalPath.lastIndexOf("/"));
              await createDir(parentDir);
              let content: string;
              if (journalTemplatePath) {
                try {
                  const tpl = await readFile(journalTemplatePath);
                  content = applyJournalTemplate(tpl, date);
                } catch {
                  content = generateDefaultJournal(date);
                }
              } else {
                content = generateDefaultJournal(date);
              }
              await writeFile(journalPath, content);
            }
            // Open the journal file
            const { tabs } = useEditorStore.getState();
            const existing = tabs.find((t: { filePath?: string }) => t.filePath === journalPath);
            if (existing) {
              useEditorStore.getState().setActiveTab(existing.id);
            } else {
              const content = await readFile(journalPath);
              const fileName = journalPath.split("/").pop() ?? "Unknown";
              useFileStore.getState().setFileContent(journalPath, content);
              useEditorStore.getState().openTab({
                id: crypto.randomUUID(),
                filePath: journalPath,
                title: fileName,
                isDirty: false,
                isPinned: false,
              });
            }

            // §56 Scope FileTree to journal directory
            useFileStore.getState().enterJournalScope(resolvedDir);
            const entries = await listDir(resolvedDir, true);
            const tree = buildFileTree(entries, resolvedDir);
            useFileStore.getState().setFileTree(tree);
          } catch (err) {
            console.error("[Workspace] Failed to open journal:", err);
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
      activePresetId: state.activePresetId === id ? null : state.activePresetId,
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
}), {
  name: "baram:workspace",
  storage: createJSONStorage(() => tauriStorage),
  partialize: (state) => ({
    activePresetId: state.activePresetId,
    customPresets: state.customPresets,
  }),
  version: 1,
}));
