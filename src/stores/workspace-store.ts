// §52 Workspace 프리셋 스토어
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { tauriStorage } from "./tauri-storage";
import { useUIStore } from "./ui-store";

// --- Types ---

export interface WorkspaceLayout {
  sidebarOpen: boolean;
  sidebarPanel: "files" | "outline" | "search" | "backlinks" | "bookmarks" | "graph" | "git";
  rightPanelOpen: boolean;
  rightPanelMode: "chat" | "help" | "none";
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
    id: "skills",
    name: "Skills 편집",
    description: "파일 트리와 AI 채팅을 함께 사용합니다.",
    builtIn: true,
    layout: {
      sidebarOpen: true,
      sidebarPanel: "files",
      rightPanelOpen: true,
      rightPanelMode: "chat",
    },
  },
  {
    id: "research",
    name: "리서치",
    description: "파일 트리, 에디터, AI 채팅으로 리서치합니다.",
    builtIn: true,
    layout: {
      sidebarOpen: true,
      sidebarPanel: "backlinks",
      rightPanelOpen: true,
      rightPanelMode: "chat",
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

    set({ activePresetId: id });
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
