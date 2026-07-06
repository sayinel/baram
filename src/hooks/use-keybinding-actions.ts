// §settings Keybinding actions hook — register command handlers + global keyboard shortcuts
import { useEffect } from "react";

import type { EditorTab } from "../stores/editor/editor";
import type { SidebarPanel } from "../stores/ui/ui";
import type { Editor } from "@tiptap/core";

import {
  dispatchFoldAll,
  dispatchUnfoldAll,
  toggleFoldAtCursor,
} from "../extensions/plugins/fold";
import { normalizeKeyEvent } from "../keybindings/key-utils";
import {
  clearActions,
  getAction,
  registerAction,
} from "../keybindings/keybinding-actions";
import { findCommandByKey } from "../keybindings/use-keybindings";
import {
  ensureJournalFile,
  openFileInTab,
} from "../services/journal-file-service";
import {
  createZettelNote,
  promoteFleeting,
} from "../services/zettelkasten-service";
import { useAIStore } from "../stores/ai/ai";
import { useEditorStore } from "../stores/editor/editor";
import { useBookmarkStore } from "../stores/file/bookmark";
import { useFileStore } from "../stores/file/file";
import { useWorkspaceStore } from "../stores/file/workspace";
import { useSettingsStore } from "../stores/settings/store";
import { useUIStore } from "../stores/ui/ui";
import { getSelectedText } from "../utils/ai-commands";
import { isDateString } from "../utils/journal/journal";
import { logger } from "../utils/logger";
import { showTableGridPicker } from "../utils/table-grid-picker";
import { resolveZettelDir } from "../utils/zettelkasten/zettelkasten";

interface UseGlobalKeyboardParams {
  editor: Editor | null;
  findReplaceOpen: boolean;
  handleGoBack: () => void;
  handleGoForward: () => void;
  isSourceMode: boolean;
  setTabSwitcherIndex: (v: ((prev: number) => number) | number) => void;
  setTabSwitcherOpen: (v: boolean) => void;
  tabSwitcherMruRef: React.MutableRefObject<EditorTab[]>;
  tabSwitcherOpen: boolean;
}

interface UseKeybindingActionsParams {
  editor: Editor | null;
  handleCloseFolder: () => void;
  handleCloseTab: () => void;
  handleNewFile: (name?: string) => void;
  handleOpenFile: () => Promise<void>;
  handleOpenFolder: () => Promise<void>;
  handleSave: () => Promise<void>;
  handleSaveAs: () => Promise<void>;
  inlineAI: { activate: () => void };
  setFindReplaceMode: (mode: "find" | "replace") => void;
  setFindReplaceOpen: (open: boolean) => void;
  setSidebarPanel: (panel: SidebarPanel) => void;
  toggleCommandPalette: () => void;
  toggleQuickSwitcher: () => void;
  toggleSettings: () => void;
  toggleSidebar: () => void;
  toggleSourceMode: () => void;
}

export function useGlobalKeyboard({
  editor,
  findReplaceOpen,
  handleGoBack,
  handleGoForward,
  isSourceMode,
  setTabSwitcherIndex,
  setTabSwitcherOpen,
  tabSwitcherMruRef,
  tabSwitcherOpen,
}: UseGlobalKeyboardParams) {
  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // §39 Escape closes tab switcher without switching
      if (e.key === "Escape" && tabSwitcherOpen) {
        e.preventDefault();
        setTabSwitcherOpen(false);
        return;
      }

      // §39 Ctrl+Tab — MRU tab switcher popup
      if (e.ctrlKey && !e.metaKey && e.key === "Tab") {
        e.preventDefault();
        const { mruOrder, tabs: currentTabs } = useEditorStore.getState();
        if (mruOrder.length <= 1) return;

        if (!tabSwitcherOpen) {
          // Freeze MRU order and open the switcher
          const mruTabs = mruOrder
            .map((id) => currentTabs.find((t) => t.id === id))
            .filter((t): t is EditorTab => t !== undefined);
          if (mruTabs.length <= 1) return;
          tabSwitcherMruRef.current = mruTabs;
          setTabSwitcherIndex(e.shiftKey ? mruTabs.length - 1 : 1);
          setTabSwitcherOpen(true);
        } else {
          // Navigate within the open switcher
          const len = tabSwitcherMruRef.current.length;
          setTabSwitcherIndex((prev: number) =>
            e.shiftKey ? (prev - 1 + len) % len : (prev + 1) % len,
          );
        }
        return;
      }

      // §37 Ctrl+- — navigate back (macOS: ⌃-, Windows/Linux: Alt+←)
      if (
        (e.ctrlKey &&
          !e.shiftKey &&
          !e.metaKey &&
          (e.key === "-" || e.code === "Minus")) ||
        (!e.metaKey && e.altKey && e.key === "ArrowLeft")
      ) {
        e.preventDefault();
        handleGoBack();
        return;
      }

      // §37 Ctrl+Shift+- — navigate forward (macOS: ⌃⇧-, Windows/Linux: Alt+→)
      // Note: Shift+- produces key="_" on most keyboards, so check both
      if (
        (e.ctrlKey &&
          e.shiftKey &&
          !e.metaKey &&
          (e.key === "_" || e.key === "-" || e.code === "Minus")) ||
        (!e.metaKey && e.altKey && e.key === "ArrowRight")
      ) {
        e.preventDefault();
        handleGoForward();
        return;
      }

      // §56b Alt+Left / Alt+Right — previous/next day journal
      if (
        e.altKey &&
        !mod &&
        !e.shiftKey &&
        (e.code === "ArrowLeft" || e.code === "ArrowRight")
      ) {
        const {
          journalEnabled,
          journalDirectory,
          journalFilenameFormat,
          journalTemplatePath,
          journalUseHierarchy,
        } = useSettingsStore.getState();
        const es = useEditorStore.getState();
        const activeTab = es.tabs.find((t) => t.id === es.activeTabId);
        const basename =
          activeTab?.filePath?.split("/").pop()?.replace(/\.md$/, "") ?? "";
        if (
          journalEnabled &&
          journalDirectory &&
          activeTab?.filePath &&
          isDateString(basename)
        ) {
          e.preventDefault();
          const [y, m, d] = basename.split("-").map(Number);
          const target = new Date(y, m - 1, d);
          const delta = e.code === "ArrowLeft" ? -1 : 1;
          target.setDate(target.getDate() + delta);

          (async () => {
            try {
              const { rootPath } = useFileStore.getState();
              const result = await ensureJournalFile(target, {
                journalDirectory,
                journalFilenameFormat,
                journalTemplatePath,
                journalUseHierarchy,
                rootPath,
              });
              if (!result) return;
              await openFileInTab(result.path, result.content);
            } catch (err) {
              logger.error("[JournalNav] Failed:", err);
            }
          })();
          return;
        }
      }

      // §5.5 Cmd+Enter — add row after in table (context-dependent)
      if (mod && e.key === "Enter" && editor && editor.isActive("table")) {
        e.preventDefault();
        editor.chain().focus().addRowAfter().run();
        return;
      }

      // --- Registry-based dispatch for all other shortcuts ---
      const isMac = navigator.platform.includes("Mac");
      const normalized = normalizeKeyEvent(e, isMac);
      if (!normalized) return;

      const overrides = useSettingsStore.getState().keybindingOverrides;
      const command = findCommandByKey(normalized, overrides);
      if (command) {
        const action = getAction(command.id);
        if (action) {
          e.preventDefault();
          action();
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setTabSwitcherOpen/setTabSwitcherIndex are stable store actions, tabSwitcherMruRef is a stable ref
  }, [
    handleGoBack,
    handleGoForward,
    editor,
    tabSwitcherOpen,
    isSourceMode,
    findReplaceOpen,
  ]);
}

export function useKeybindingActions({
  editor,
  handleCloseFolder,
  handleCloseTab,
  handleNewFile,
  handleOpenFile,
  handleOpenFolder,
  handleSave,
  handleSaveAs,
  inlineAI,
  setFindReplaceMode,
  setFindReplaceOpen,
  setSidebarPanel,
  toggleCommandPalette,
  toggleQuickSwitcher,
  toggleSettings,
  toggleSidebar,
  toggleSourceMode,
}: UseKeybindingActionsParams) {
  // §39 Tab switcher state — managed locally within this hook
  // (state was previously in App; moved here since only keyboard shortcuts use it)

  // §settings: Register keybinding actions — maps command IDs to handler functions
  useEffect(() => {
    clearActions();

    // File
    registerAction("file.new", () => handleNewFile());
    registerAction("file.open", () => handleOpenFile());
    registerAction("file.openFolder", () => handleOpenFolder());
    registerAction("file.save", () => handleSave());
    registerAction("file.saveAs", () => handleSaveAs());
    registerAction("file.closeTab", () => handleCloseTab());
    registerAction("file.closeFolder", () => handleCloseFolder());

    // Edit
    registerAction("edit.find", () => {
      setFindReplaceMode("find");
      setFindReplaceOpen(true);
    });
    registerAction("edit.findReplace", () => {
      setFindReplaceMode("replace");
      setFindReplaceOpen(true);
    });
    registerAction("edit.toggleFold", () => {
      if (editor?.view) toggleFoldAtCursor(editor.view);
    });
    registerAction("edit.foldAll", () => {
      if (editor?.view) dispatchFoldAll(editor.view);
    });
    registerAction("edit.unfoldAll", () => {
      if (editor?.view) dispatchUnfoldAll(editor.view);
    });

    // View
    registerAction("view.sourceMode", () => toggleSourceMode());
    registerAction("view.toggleSidebar", () => toggleSidebar());
    registerAction("view.commandPalette", () => toggleCommandPalette());
    registerAction("view.quickSwitcher", () => toggleQuickSwitcher());
    registerAction("view.settings", () => toggleSettings());
    registerAction("view.bookmark", () => {
      const bs = useBookmarkStore.getState();
      const es = useEditorStore.getState();
      const fs = useFileStore.getState();
      const activeTab = es.tabs.find((t) => t.id === es.activeTabId);
      if (activeTab?.filePath && fs.rootPath) {
        const fileName =
          activeTab.filePath.split("/").pop() ?? activeTab.filePath;
        bs.addBookmark({
          type: "file",
          filePath: activeTab.filePath,
          label: fileName,
          group: "Default",
        });
        bs.saveBookmarks(fs.rootPath);
      }
    });

    // Search
    registerAction("search.globalSearch", () => {
      const ui = useUIStore.getState();
      if (!ui.sidebarOpen) ui.toggleSidebar();
      setSidebarPanel("search");
    });
    registerAction("search.backlinks", () => {
      const ui = useUIStore.getState();
      if (!ui.sidebarOpen) ui.toggleSidebar();
      setSidebarPanel("backlinks");
    });

    // Insert
    registerAction("insert.table", () => {
      if (editor && !editor.isActive("table")) {
        const { from } = editor.state.selection;
        const coords = editor.view.coordsAtPos(from);
        showTableGridPicker(coords.left, coords.bottom + 4).then((result) => {
          if (!result) return;
          editor
            .chain()
            .focus()
            .insertTable({
              rows: result.rows,
              cols: result.cols,
              withHeaderRow: true,
            })
            .run();
        });
      }
    });
    registerAction("insert.inlineAI", () => inlineAI.activate());

    // AI
    registerAction("ai.chatPanel", () =>
      useUIStore.getState().toggleRightPanel(),
    );
    registerAction("ai.ghostText", () => {
      const ai = useAIStore.getState();
      ai.setGhostTextEnabled(!ai.ghostTextEnabled);
    });
    registerAction("ai.skillTest", () =>
      useUIStore.getState().toggleSkillTestDialog(),
    );

    // Workspace
    registerAction("workspace.writing", () =>
      useWorkspaceStore.getState().applyPreset("writing"),
    );
    registerAction("workspace.journal", () =>
      useWorkspaceStore.getState().applyPreset("journal"),
    );
    registerAction("workspace.skills", () =>
      useWorkspaceStore.getState().applyPreset("skills"),
    );

    // Journal
    registerAction("journal.quickCapture", () =>
      useUIStore.getState().toggleQuickCapture(),
    );

    registerAction("journal.openToday", () => {
      (async () => {
        try {
          const {
            journalEnabled,
            journalDirectory,
            journalFilenameFormat,
            journalTemplatePath,
            journalUseHierarchy,
          } = useSettingsStore.getState();
          if (!journalEnabled || !journalDirectory) return;
          const { rootPath } = useFileStore.getState();
          const result = await ensureJournalFile(new Date(), {
            journalDirectory,
            journalFilenameFormat,
            journalTemplatePath,
            journalUseHierarchy,
            rootPath,
          });
          if (!result) return;
          await openFileInTab(result.path, result.content);
        } catch (err) {
          logger.error("[JournalShortcut] Failed:", err);
        }
      })();
    });

    registerAction("journal.memories", () => {
      const ui = useUIStore.getState();
      if (!ui.rightPanelOpen) {
        ui.setRightPanelMode("memories");
        ui.toggleRightPanel();
      } else if (ui.rightPanelMode === "memories") {
        ui.toggleRightPanel();
      } else {
        ui.setRightPanelMode("memories");
      }
    });

    registerAction("journal.photoGallery", () => {
      const ui = useUIStore.getState();
      if (ui.rightPanelMode === "photo-gallery" && ui.rightPanelOpen) {
        ui.toggleRightPanel();
      } else {
        ui.setRightPanelMode("photo-gallery");
        if (!ui.rightPanelOpen) ui.toggleRightPanel();
      }
    });

    // §94 Zettelkasten
    registerAction("zettelkasten.newNote", () => {
      const { zettelkastenEnabled, zettelkastenDirectory } =
        useSettingsStore.getState();
      const { rootPath } = useFileStore.getState();
      const dir = resolveZettelDir(rootPath, zettelkastenDirectory);
      if (!zettelkastenEnabled || !dir) {
        logger.warn("[Zettel] newNote: space not enabled/configured");
        return;
      }
      useUIStore.getState().openZettelTitleDialog((title) => {
        createZettelNote(dir, title).catch((err) =>
          logger.error("[Zettel] newNote failed:", err),
        );
      });
    });

    registerAction("zettelkasten.promote", () => {
      const { zettelkastenEnabled, zettelkastenDirectory } =
        useSettingsStore.getState();
      const { rootPath } = useFileStore.getState();
      const dir = resolveZettelDir(rootPath, zettelkastenDirectory);
      const es = useEditorStore.getState();
      const tab = es.tabs.find((t) => t.id === es.activeTabId);
      if (
        !zettelkastenEnabled ||
        !dir ||
        !tab?.filePath?.startsWith(`${dir}/inbox/`)
      ) {
        logger.warn("[Zettel] promote: active file is not an inbox note");
        return;
      }
      const fleetingPath = tab.filePath;
      useUIStore.getState().openZettelTitleDialog((title) => {
        promoteFleeting(dir, fleetingPath, title).catch((err) =>
          logger.error("[Zettel] promote failed:", err),
        );
      });
    });

    // §94 New note from selection — extract the selected text into a new
    // permanent zettel note and replace the selection with an [[id]] link.
    registerAction("zettelkasten.newFromSelection", () => {
      const { zettelkastenEnabled, zettelkastenDirectory } =
        useSettingsStore.getState();
      const { rootPath } = useFileStore.getState();
      const dir = resolveZettelDir(rootPath, zettelkastenDirectory);
      if (!zettelkastenEnabled || !dir || !editor) {
        logger.warn("[Zettel] newFromSelection: space not enabled/configured");
        return;
      }
      const activeEditor = editor;
      const selectionText = getSelectedText(activeEditor);
      if (!selectionText.trim()) {
        logger.warn("[Zettel] newFromSelection: selection is empty");
        return;
      }
      const initialTitle = (selectionText.split("\n")[0] ?? "")
        .trim()
        .slice(0, 60);
      useUIStore.getState().openZettelTitleDialog((title) => {
        // openTab=false: stay on the current document — this note's own
        // selection is about to be replaced below, so the shared editor
        // must not be swapped to the newly created note first.
        createZettelNote(dir, title, selectionText, false)
          .then((result) => {
            if (!result) return;
            activeEditor
              .chain()
              .focus()
              .deleteSelection()
              .insertWikilink({ target: result.id })
              .run();
          })
          .catch((err) =>
            logger.error("[Zettel] newFromSelection failed:", err),
          );
      }, initialTitle);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setFindReplaceOpen/setFindReplaceMode are stable store actions
  }, [
    toggleSourceMode,
    toggleSidebar,
    toggleCommandPalette,
    toggleQuickSwitcher,
    toggleSettings,
    setSidebarPanel,
    handleNewFile,
    handleOpenFile,
    handleOpenFolder,
    handleSave,
    handleSaveAs,
    handleCloseTab,
    handleCloseFolder,
    inlineAI,
    editor,
  ]);
}
