import { useEffect } from "react";

import type { EditorTab } from "../stores/editor/editor";
import type { Editor } from "@tiptap/core";

// §settings Global keyboard shortcuts hook — window-level keydown handling
import { chainWithVimExternalEdit } from "../extensions/plugins/vim/vim-keys";
import { normalizeKeyEvent } from "../keybindings/key-utils";
import { getAction } from "../keybindings/keybinding-actions";
import { findCommandByKey } from "../keybindings/use-keybindings";
import {
  ensureJournalFile,
  openFileInTab,
} from "../services/journal-file-service";
import { useEditorStore } from "../stores/editor/editor";
import { useFileStore } from "../stores/file/file";
import { useSettingsStore } from "../stores/settings/store";
import { useUIStore } from "../stores/ui/ui";
import { isDateString } from "../utils/journal/journal";
import { logger } from "../utils/logger";

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
        chainWithVimExternalEdit(editor).focus().addRowAfter().run();
        return;
      }

      // --- Registry-based dispatch for all other shortcuts ---
      const isMac = navigator.platform.includes("Mac");
      const normalized = normalizeKeyEvent(e, isMac);
      if (!normalized) return;

      const overrides = useSettingsStore.getState().keybindingOverrides;
      const command = findCommandByKey(normalized, overrides);

      // §298 vim S3 — the source editor swallows Mod-/ (preventDefault) so
      // vim's Prec.highest handler cannot eat it; the event still bubbles
      // here with defaultPrevented=true. The source-mode toggle is the ONE
      // command that must survive that, or the user is trapped in source
      // mode. Runs before the guard below (Codex plan-review correction).
      if (isSourceMode && command?.id === "view.sourceMode") {
        const action = getAction(command.id);
        if (action) {
          e.preventDefault();
          action();
        }
        return;
      }

      // §298 vim S3 — guard SCOPED to a live vim source session. The vim
      // adapter stopPropagations the keys it handles (they never reach
      // window); what arrives here defaultPrevented are CM-keymap-handled
      // keys from the source editor, which must not double-fire registry
      // commands during a vim session. Deliberately NOT a blanket
      // defaultPrevented guard: WYSIWYG extensions also preventDefault
      // (e.g. Mod+Shift+B blockquote) and their long-standing double-fire
      // semantics (blockquote + backlinks) are outside this change's scope
      // (Codex final gate — a blanket guard regressed that key).
      const isVimSourceEvent =
        e.defaultPrevented &&
        e.target instanceof Element &&
        e.target.closest(".source-code-editor") !== null &&
        useUIStore.getState().vimStatus?.surface === "source";
      if (isVimSourceEvent) return;

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
