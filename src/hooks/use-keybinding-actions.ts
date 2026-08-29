import { useEffect } from "react";

import type { SidebarPanel } from "../stores/ui/ui";
import type { Editor } from "@tiptap/core";

import {
  dispatchFoldAll,
  dispatchUnfoldAll,
  toggleFoldAtCursor,
} from "../extensions/plugins/fold";
// §settings Keybinding actions hook — register command handlers
import { chainWithVimExternalEdit } from "../extensions/plugins/vim/vim-keys";
import { type Locale, t } from "../i18n";
import { readFile } from "../ipc/invoke";
import {
  clearActions,
  registerAction,
} from "../keybindings/keybinding-actions";
import {
  ensureJournalFile,
  openFileInTab,
} from "../services/journal-file-service";
import {
  createMoc,
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
import { registerEditorMutationTask } from "../utils/editor/mutation-tasks";
import { resolveJournalDir } from "../utils/journal/journal";
import { logger } from "../utils/logger";
import { showTableGridPicker } from "../utils/table-grid-picker";
import { firstBodyLine } from "../utils/zettelkasten/parse-note-title";
import {
  firstNonEmptyLine,
  getSelectionMarkdown,
} from "../utils/zettelkasten/selection-markdown";
import { resolveZettelDir } from "../utils/zettelkasten/zettelkasten";
import { requestReload } from "./use-close-guard";

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
    registerAction("view.reload", () => requestReload());
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
        void bs.saveBookmarks(fs.rootPath);
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
        // §298 §12-9b (design §5c): the picker resolves after an unbounded
        // gap — a dead task must not insert into whatever doc is live then.
        const task = registerEditorMutationTask(editor.view);
        showTableGridPicker(coords.left, coords.bottom + 4).then((result) => {
          const live = task.isLive();
          task.finish();
          if (!result || !live) return;
          chainWithVimExternalEdit(editor)
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
    registerAction("workspace.zettelkasten", () =>
      useWorkspaceStore.getState().applyPreset("zettelkasten"),
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
            locale,
          } = useSettingsStore.getState();
          const { rootPath } = useFileStore.getState();
          // §85 Say why nothing opened. A shortcut that returns silently is
          // indistinguishable from one that is not bound — the same two cases the
          // journal preset now reports (workspace.ts), worded identically.
          if (!journalEnabled) {
            useUIStore
              .getState()
              .showToast(t("space.journal.disabled", locale as Locale));
            return;
          }
          if (!resolveJournalDir(rootPath, journalDirectory)) {
            useUIStore
              .getState()
              .showToast(t("space.journal.noDirectory", locale as Locale));
            return;
          }
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
          // Surface it — a logger-only failure is invisible to the user — but keep the
          // raw text out of the toast: Tauri rejects with a bare string, so `String(err)`
          // would put an untranslated absolute path on screen (the project's idiom:
          // localized key in the toast, raw message in the log — see stores/file/file.ts).
          logger.error("[JournalShortcut] Failed:", err);
          useUIStore
            .getState()
            .showToast(
              t(
                "space.journal.openFailed",
                useSettingsStore.getState().locale as Locale,
              ),
              "error",
            );
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
      useUIStore.getState().openZettelTitleDialog({
        onSubmit: (title) =>
          createZettelNote(dir, title).catch((err) =>
            logger.error("[Zettel] newNote failed:", err),
          ),
        title: "New Zettel",
        description: "Create a permanent atomic note in notes/.",
        confirmLabel: "Create",
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
      // §102 Prefill the title with the fleeting note's first body line so the
      // user can confirm/tweak instead of typing from scratch.
      void (async () => {
        let initialTitle = "";
        try {
          const raw = await readFile(fleetingPath);
          initialTitle = firstBodyLine(raw).slice(0, 80);
        } catch {
          /* fall back to an empty title */
        }
        useUIStore.getState().openZettelTitleDialog({
          onSubmit: (title) =>
            promoteFleeting(dir, fleetingPath, title).catch((err) =>
              logger.error("[Zettel] promote failed:", err),
            ),
          title: "Promote to Permanent Note",
          description: "Move this fleeting note from inbox/ to notes/.",
          confirmLabel: "Promote",
          initialTitle,
        });
      })();
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
      // §95/§99 M5: mirror zettelkasten.promote's gate — only insert an
      // [[id]] link into a document that is itself inside the zettel space.
      const es = useEditorStore.getState();
      const activeTab = es.tabs.find((t) => t.id === es.activeTabId);
      if (!activeTab?.filePath?.startsWith(`${dir}/`)) {
        logger.warn(
          "[Zettel] newFromSelection: active file is not in the zettel space",
        );
        return;
      }
      const activeEditor = editor;
      // §95 Use block-separated text (not the shared getSelectedText) so a
      // multi-paragraph selection keeps its paragraph breaks in the note body.
      const selectionText = getSelectionMarkdown(activeEditor);
      if (!selectionText.trim()) {
        logger.warn("[Zettel] newFromSelection: selection is empty");
        return;
      }
      // Seed the title with just the first few words of the selection — a long
      // selection should not dump its whole first line into the title field.
      const initialTitle = firstNonEmptyLine(selectionText)
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3)
        .join(" ")
        .slice(0, 40);
      // §298 §12-9b (design §5c): dialog + note creation are async gaps; the
      // selection replacement must not land after a state install re-targets
      // the shared editor. Registered before the dialog opens so a swap
      // DURING the dialog also kills it.
      const task = registerEditorMutationTask(activeEditor.view);
      useUIStore.getState().openZettelTitleDialog({
        onSubmit: (title) => {
          // openTab=false: stay on the current document — this note's own
          // selection is about to be replaced below, so the shared editor
          // must not be swapped to the newly created note first.
          createZettelNote(dir, title, selectionText, false)
            .then((result) => {
              const live = task.isLive();
              task.finish();
              if (!result || !live) return;
              chainWithVimExternalEdit(activeEditor)
                .focus()
                .deleteSelection()
                .insertWikilink({ target: result.id })
                .run();
            })
            .catch((err) =>
              logger.error("[Zettel] newFromSelection failed:", err),
            );
        },
        title: "New Note from Selection",
        description:
          "Create a note from the selection and replace it with a link.",
        confirmLabel: "Create",
        initialTitle,
      });
    });

    // §97 New MOC (Map of Content) — a #moc-tagged index note. Discovery of
    // MOCs reuses the existing tag search; no dedicated sidebar panel here.
    registerAction("zettelkasten.newMoc", () => {
      const { zettelkastenEnabled, zettelkastenDirectory } =
        useSettingsStore.getState();
      const { rootPath } = useFileStore.getState();
      const dir = resolveZettelDir(rootPath, zettelkastenDirectory);
      if (!zettelkastenEnabled || !dir) {
        logger.warn("[Zettel] newMoc: space not enabled/configured");
        return;
      }
      useUIStore.getState().openZettelTitleDialog({
        onSubmit: (title) =>
          createMoc(dir, title).catch((err) =>
            logger.error("[Zettel] newMoc failed:", err),
          ),
        title: "New MOC",
        description: "Create a #moc index note.",
        confirmLabel: "Create",
      });
    });
    // §272 Fix round 1 — I4: setFindReplaceOpen used to be a raw useState
    // setter (always stable) — the comment below was true then. It is no
    // longer true: App.tsx now passes routeFindReplaceOpen, a
    // useCallback(…, [isPdfTab]) wrapper, so its identity changes whenever
    // isPdfTab flips. It must be a real dep so edit.find's registered
    // closure picks up the current wrapper instead of a stale one — without
    // this, Cmd+F on a PDF tab would only work by accident (only because
    // `inlineAI` below happens to be unmemoized and re-runs this effect
    // every render regardless).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setFindReplaceMode is still a stable store action
  }, [
    toggleSourceMode,
    toggleSidebar,
    toggleCommandPalette,
    toggleQuickSwitcher,
    toggleSettings,
    setSidebarPanel,
    setFindReplaceOpen,
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
