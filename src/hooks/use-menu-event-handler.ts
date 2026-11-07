import { useEffect } from "react";

import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";

import type { Editor } from "@tiptap/react";

// Native menu event handler hook — dispatches Tauri menu-event payloads to app actions
import { MENU_FEATURE_MAP } from "../ipc/menu-enabled";
import { handleRecentMenuEvent } from "../ipc/recent-menu";
import { getAction } from "../keybindings/keybinding-actions";
import { useEditorStore } from "../stores/editor/editor";
import { useWorkspaceStore } from "../stores/file/workspace";
import { useSettingsStore } from "../stores/settings/store";
import { useUIStore } from "../stores/ui/ui";
import {
  isInsertMenuCommand,
  runInsertMenuCommand,
  sayInsertNeedsTheDocument,
} from "../utils/editor/insert-menu-commands";
import { featureReady } from "../utils/feature-gate";
import { BARAM_HOMEPAGE, type HelpDoc, helpDocUrl } from "../utils/help-urls";
import { requestReload } from "./use-close-guard";

export interface MenuEventHandlerDeps {
  editor: Editor | null;
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
  setFindReplaceOpen: React.Dispatch<React.SetStateAction<boolean>>;
  toggleCommandPalette: () => void;
  toggleQuickSwitcher: () => void;
  toggleSettings: () => void;
  toggleSidebar: () => void;
  toggleSourceMode: () => void;
}

/**
 * Help 문서를 현재 앱 언어로 연다.
 *
 * ‼️ 로케일을 훅 마운트 시점에 캡처하면 사용자가 언어를 바꾼 뒤에도 옛 언어로 열린다.
 * 메뉴 이벤트는 콜백이므로 `getState()` 로 그때의 값을 읽는다.
 */
function openHelpDoc(doc: HelpDoc): void {
  const { locale } = useSettingsStore.getState();
  openUrl(helpDocUrl(doc, locale === "ko" ? "ko" : "en")).catch(() => {});
}

/**
 * Hook that listens for native Tauri menu-event and dispatches
 * to the appropriate handler based on the event payload string.
 */
export function useMenuEventHandler({
  editor,
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
  setFindReplaceOpen,
  toggleCommandPalette,
  toggleQuickSwitcher,
  toggleSettings,
  toggleSidebar,
  toggleSourceMode,
}: MenuEventHandlerDeps): void {
  useEffect(() => {
    // Only what is sent here: a listener with no target also hears what is sent to a file window.
    const unlisten = listen<string>(
      "menu-event",
      async (event) => {
        if (handleRecentMenuEvent(event.payload)) return;
        // §341 The native menu is greyed out for a disabled feature (Rust
        // `update_menu_enabled`), but that lives outside the webview and is
        // unobserved here — this is the second layer, so a bypassed disable
        // still says why instead of acting.
        const feature = MENU_FEATURE_MAP[event.payload];
        if (feature && !featureReady(feature)) return;
        if (isInsertMenuCommand(event.payload)) {
          // In source mode the document is out of sight and not what gets saved, and coming back
          // replaces it with the buffer, so what this inserted would be gone.
          const { activeTabId, sourceModeTabs } = useEditorStore.getState();
          if (activeTabId && sourceModeTabs.includes(activeTabId)) {
            sayInsertNeedsTheDocument();
          } else {
            await runInsertMenuCommand(event.payload, editor);
          }
          return;
        }
        switch (event.payload) {
          case "app_about":
            useUIStore.getState().toggleAbout();
            break;
          // --- Edit menu handlers ---
          case "edit_find_replace":
            setFindReplaceOpen((prev) => !prev);
            break;
          case "export_doc":
            useUIStore.getState().openExportDialog("pdf");
            break;
          case "file_close_folder":
            handleCloseFolder();
            break;
          case "file_close_tab":
            handleCloseTab();
            break;
          case "file_new":
            handleNewFile();
            break;
          case "file_open":
            handleOpenFile();
            break;
          case "file_open_folder":
            handleOpenFolder();
            break;
          case "file_save":
            handleSave();
            break;
          case "file_save_as":
            handleSaveAs();
            break;
          case "file_settings":
            toggleSettings();
            break;
          case "go_back":
            handleGoBack();
            break;
          case "go_forward":
            handleGoForward();
            break;
          case "go_palette":
          case "view_palette":
            toggleCommandPalette();
            break;
          case "go_quick_switcher":
          case "go_switch_doc":
            toggleQuickSwitcher();
            break;
          case "help_faq":
            openHelpDoc("faq");
            break;
          case "help_homepage":
            openUrl(BARAM_HOMEPAGE).catch(() => {});
            break;

          case "help_report":
            openUrl("https://github.com/sayinel/baram/issues").catch(() => {});
            break;
          case "help_shortcuts":
            openHelpDoc("shortcuts");
            break;
          // --- Help menu handlers ---
          case "help_user_guide":
            openHelpDoc("guide");
            break;
          // --- View menu: right panel handlers ---
          case "view_ai_chat": {
            const uiAI = useUIStore.getState();
            if (!uiAI.rightPanelOpen) {
              uiAI.setRightPanelMode("chat");
              uiAI.toggleRightPanel();
            } else if (uiAI.rightPanelMode === "chat") {
              uiAI.toggleRightPanel();
            } else {
              uiAI.setRightPanelMode("chat");
            }
            break;
          }

          case "view_backlinks": {
            const uiBL = useUIStore.getState();
            if (!uiBL.sidebarOpen) uiBL.toggleSidebar();
            uiBL.setSidebarPanel("backlinks");
            break;
          }
          case "view_calendar": {
            const uiCAL = useUIStore.getState();
            if (!uiCAL.sidebarOpen) uiCAL.toggleSidebar();
            uiCAL.setSidebarPanel("calendar");
            break;
          }
          case "view_git": {
            const uiGIT = useUIStore.getState();
            if (!uiGIT.sidebarOpen) uiGIT.toggleSidebar();
            uiGIT.setSidebarPanel("git");
            break;
          }
          // --- View menu: sidebar panel handlers ---
          case "view_global_search": {
            const uiGS = useUIStore.getState();
            if (!uiGS.sidebarOpen) uiGS.toggleSidebar();
            uiGS.setSidebarPanel("search");
            break;
          }
          case "view_graph": {
            const uiGR = useUIStore.getState();
            if (!uiGR.sidebarOpen) uiGR.toggleSidebar();
            uiGR.setSidebarPanel("graph");
            break;
          }
          case "view_inline_ai":
            getAction("insert.inlineAI")?.();
            break;
          case "view_outline": {
            const uiOL = useUIStore.getState();
            if (!uiOL.sidebarOpen) uiOL.toggleSidebar();
            uiOL.setSidebarPanel("outline");
            break;
          }
          case "view_reload":
            void requestReload();
            break;

          case "view_sidebar":
            toggleSidebar();
            break;
          case "view_skills_gallery": {
            const uiSG = useUIStore.getState();
            if (!uiSG.sidebarOpen) uiSG.toggleSidebar();
            uiSG.setSidebarPanel("skills-gallery");
            break;
          }
          case "view_source":
            toggleSourceMode();
            break;

          case "view_tags": {
            const uiTAG = useUIStore.getState();
            if (!uiTAG.sidebarOpen) uiTAG.toggleSidebar();
            uiTAG.setSidebarPanel("tags");
            break;
          }
          case "view_version_history": {
            const uiVH = useUIStore.getState();
            if (!uiVH.sidebarOpen) uiVH.toggleSidebar();
            uiVH.setSidebarPanel("snapshots");
            break;
          }

          // --- Workspace menu handlers (§52) ---
          case "workspace_focus":
            useWorkspaceStore.getState().applyPreset("focus");
            break;
          case "workspace_journal":
            useWorkspaceStore.getState().applyPreset("journal");
            break;
          case "workspace_skills":
            useWorkspaceStore.getState().applyPreset("skills");
            break;
          case "workspace_writing":
            useWorkspaceStore.getState().applyPreset("writing");
            break;
          case "workspace_zettel":
            useWorkspaceStore.getState().applyPreset("zettelkasten");
            break;
        }
      },
      { target: "main" },
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [
    handleNewFile,
    handleOpenFile,
    handleOpenFolder,
    handleSave,
    handleSaveAs,
    handleCloseTab,
    handleCloseFolder,
    handleGoBack,
    handleGoForward,
    handleOpenFilePath,
    toggleSourceMode,
    toggleSidebar,
    toggleCommandPalette,
    toggleQuickSwitcher,
    toggleSettings,
    editor,
    setFindReplaceOpen,
  ]);
}
