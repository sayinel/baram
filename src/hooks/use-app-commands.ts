// §4.2 App-level command wiring — keybindings, global keyboard shortcuts, and
// the native Tauri menu, plus the UI-store toggle actions they share. Bundled
// together because those toggle actions are consumed only by these three
// hooks (confirmed by the Tier-3 analysis) — nothing else in App needs them.
import type { Dispatch, SetStateAction } from "react";

import type { EditorTab } from "../stores/editor/editor";
import type { UseInlineAIReturn } from "./use-inline-ai";
import type { Editor } from "@tiptap/react";

import { useShallow } from "zustand/shallow";

import { useUIStore } from "../stores/ui/ui";
import { useGlobalKeyboard } from "./use-global-keyboard";
import { useKeybindingActions } from "./use-keybinding-actions";
import { useMenuEventHandler } from "./use-menu-event-handler";

interface UseAppCommandsParams {
  activeEditor: Editor | null;
  findReplaceOpen: boolean;
  handleCloseFolder: () => void;
  handleCloseTab: () => void;
  handleGoBack: () => void;
  handleGoForward: () => void;
  handleNewFile: (name?: string) => void;
  handleOpenFile: () => Promise<void>;
  handleOpenFilePath: (filePath: string) => Promise<void>;
  handleOpenFolder: () => Promise<void>;
  handleSave: () => Promise<void>;
  handleSaveAs: () => Promise<void>;
  handleToggleSourceMode: () => void;
  inlineAI: UseInlineAIReturn;
  isSourceMode: boolean;
  routeFindReplaceOpen: Dispatch<SetStateAction<boolean>>;
  setFindReplaceMode: Dispatch<SetStateAction<"find" | "replace">>;
  setTabSwitcherIndex: Dispatch<SetStateAction<number>>;
  setTabSwitcherOpen: Dispatch<SetStateAction<boolean>>;
  tabSwitcherMruRef: React.MutableRefObject<EditorTab[]>;
  tabSwitcherOpen: boolean;
}

export function useAppCommands({
  activeEditor,
  findReplaceOpen,
  handleCloseFolder,
  handleCloseTab,
  handleGoBack,
  handleGoForward,
  handleNewFile,
  handleOpenFile,
  handleOpenFilePath,
  handleOpenFolder,
  handleSave,
  handleSaveAs,
  handleToggleSourceMode,
  inlineAI,
  isSourceMode,
  routeFindReplaceOpen,
  setFindReplaceMode,
  setTabSwitcherIndex,
  setTabSwitcherOpen,
  tabSwitcherMruRef,
  tabSwitcherOpen,
}: UseAppCommandsParams): void {
  const {
    toggleSidebar,
    toggleCommandPalette,
    toggleQuickSwitcher,
    toggleSettings,
    setSidebarPanel,
  } = useUIStore(
    useShallow((s) => ({
      toggleSidebar: s.toggleSidebar,
      toggleCommandPalette: s.toggleCommandPalette,
      toggleQuickSwitcher: s.toggleQuickSwitcher,
      toggleSettings: s.toggleSettings,
      setSidebarPanel: s.setSidebarPanel,
    })),
  );

  // --- Keybinding actions registration ---
  useKeybindingActions({
    editor: activeEditor,
    handleCloseFolder,
    handleCloseTab,
    handleNewFile,
    handleOpenFile,
    handleOpenFolder,
    handleSave,
    handleSaveAs,
    inlineAI,
    setFindReplaceMode,
    setFindReplaceOpen: routeFindReplaceOpen,
    setSidebarPanel,
    toggleCommandPalette,
    toggleQuickSwitcher,
    toggleSettings,
    toggleSidebar,
    toggleSourceMode: handleToggleSourceMode,
  });

  // --- Global keyboard shortcuts ---
  useGlobalKeyboard({
    editor: activeEditor,
    findReplaceOpen,
    handleGoBack,
    handleGoForward,
    isSourceMode,
    setTabSwitcherIndex,
    setTabSwitcherOpen,
    tabSwitcherMruRef,
    tabSwitcherOpen,
  });

  // Native menu event listener (Tauri menu bar → frontend dispatch)
  useMenuEventHandler({
    editor: activeEditor,
    handleCloseFolder,
    handleCloseTab,
    handleGoBack,
    handleGoForward,
    handleNewFile,
    handleOpenFile,
    handleOpenFilePath,
    handleOpenFolder,
    handleSave,
    handleSaveAs,
    setFindReplaceOpen: routeFindReplaceOpen,
    toggleCommandPalette,
    toggleQuickSwitcher,
    toggleSettings,
    toggleSidebar,
    toggleSourceMode: handleToggleSourceMode,
  });
}
