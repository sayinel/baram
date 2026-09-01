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

/** File lifecycle actions — shared verbatim by keybindings and the native menu. */
interface UseAppCommandsFileOps {
  handleCloseFolder: () => void;
  handleCloseTab: () => void;
  handleNewFile: (name?: string) => void;
  handleOpenFile: () => Promise<void>;
  handleOpenFilePath: (filePath: string) => Promise<void>;
  handleOpenFolder: () => Promise<void>;
  handleSave: () => Promise<void>;
  handleSaveAs: () => Promise<void>;
}

/** Back/forward history — global keyboard and the native menu's Go entries. */
interface UseAppCommandsNavigation {
  handleGoBack: () => void;
  handleGoForward: () => void;
}

/** Find/replace routing state each of the three inner hooks touches a slice of. */
interface UseAppCommandsFind {
  findReplaceOpen: boolean;
  routeFindReplaceOpen: Dispatch<SetStateAction<boolean>>;
  setFindReplaceMode: Dispatch<SetStateAction<"find" | "replace">>;
}

interface UseAppCommandsParams {
  activeEditor: Editor | null;
  fileOps: UseAppCommandsFileOps;
  find: UseAppCommandsFind;
  handleToggleSourceMode: () => void;
  inlineAI: UseInlineAIReturn;
  isSourceMode: boolean;
  navigation: UseAppCommandsNavigation;
  tabSwitcher: UseAppCommandsTabSwitcher;
}

/** Cmd+Tab-style MRU switcher state — global keyboard owns this exclusively. */
interface UseAppCommandsTabSwitcher {
  setTabSwitcherIndex: Dispatch<SetStateAction<number>>;
  setTabSwitcherOpen: Dispatch<SetStateAction<boolean>>;
  tabSwitcherMruRef: React.MutableRefObject<EditorTab[]>;
  tabSwitcherOpen: boolean;
}

export function useAppCommands({
  activeEditor,
  fileOps,
  find,
  handleToggleSourceMode,
  inlineAI,
  isSourceMode,
  navigation,
  tabSwitcher,
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
    handleCloseFolder: fileOps.handleCloseFolder,
    handleCloseTab: fileOps.handleCloseTab,
    handleNewFile: fileOps.handleNewFile,
    handleOpenFile: fileOps.handleOpenFile,
    handleOpenFolder: fileOps.handleOpenFolder,
    handleSave: fileOps.handleSave,
    handleSaveAs: fileOps.handleSaveAs,
    inlineAI,
    setFindReplaceMode: find.setFindReplaceMode,
    setFindReplaceOpen: find.routeFindReplaceOpen,
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
    findReplaceOpen: find.findReplaceOpen,
    handleGoBack: navigation.handleGoBack,
    handleGoForward: navigation.handleGoForward,
    isSourceMode,
    setTabSwitcherIndex: tabSwitcher.setTabSwitcherIndex,
    setTabSwitcherOpen: tabSwitcher.setTabSwitcherOpen,
    tabSwitcherMruRef: tabSwitcher.tabSwitcherMruRef,
    tabSwitcherOpen: tabSwitcher.tabSwitcherOpen,
  });

  // Native menu event listener (Tauri menu bar → frontend dispatch)
  useMenuEventHandler({
    editor: activeEditor,
    handleCloseFolder: fileOps.handleCloseFolder,
    handleCloseTab: fileOps.handleCloseTab,
    handleGoBack: navigation.handleGoBack,
    handleGoForward: navigation.handleGoForward,
    handleNewFile: fileOps.handleNewFile,
    handleOpenFile: fileOps.handleOpenFile,
    handleOpenFilePath: fileOps.handleOpenFilePath,
    handleOpenFolder: fileOps.handleOpenFolder,
    handleSave: fileOps.handleSave,
    handleSaveAs: fileOps.handleSaveAs,
    setFindReplaceOpen: find.routeFindReplaceOpen,
    toggleCommandPalette,
    toggleQuickSwitcher,
    toggleSettings,
    toggleSidebar,
    toggleSourceMode: handleToggleSourceMode,
  });
}
