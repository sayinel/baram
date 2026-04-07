// §3.6 File operation hooks — new, open, save, saveAs, close, openFolder
import { useCallback } from "react";

import { ask, open, save } from "@tauri-apps/plugin-dialog";

import type { Editor } from "@tiptap/core";

import { readFile, updateFileIndex, writeFile } from "../ipc/invoke";
import { prosemirrorToMarkdown } from "../pipeline/pm-to-md";
import { notifyFileOpen, notifyFileSave } from "../plugins/plugin-lifecycle";
import { useContextStore } from "../stores/context/context";
import { isGraphTab } from "../stores/editor/editor";
import { useEditorStore } from "../stores/editor/editor";
import { useLinkStore } from "../stores/editor/link";
import { openFolder, useFileStore } from "../stores/file/file";
import { useSettingsStore } from "../stores/settings/store";
import { isMarkdownFile } from "../utils/file-type";
import { logger } from "../utils/logger";

interface UseFileOperationsParams {
  editor: Editor | null;
  isSourceMode: boolean;
  sourceContentRef: React.RefObject<string>;
}

export function useFileOperations({
  editor,
  isSourceMode,
  sourceContentRef,
}: UseFileOperationsParams) {
  const openTab = useEditorStore((s) => s.openTab);
  const markDirty = useEditorStore((s) => s.markDirty);
  const { setFileContent } = useFileStore();

  const handleNewFile = useCallback(
    (name?: string) => {
      const id = crypto.randomUUID();
      let title: string;
      if (name) {
        title = name;
      } else {
        const { tabs: currentTabs } = useEditorStore.getState();
        const tabNumber =
          currentTabs.filter((t) => t.title.startsWith("Untitled")).length + 1;
        title = tabNumber === 1 ? "Untitled" : `Untitled ${tabNumber}`;
      }
      useFileStore.getState().setFileContent(id, "");
      openTab({
        contextId: "",
        id,
        filePath: "",
        title,
        isDirty: false,
        isPinned: false,
      });
    },
    [openTab],
  );

  const handleOpenFile = useCallback(async () => {
    const selected = await open({
      filters: [
        { name: "Markdown", extensions: ["md", "markdown", "mdx"] },
        { name: "Text", extensions: ["txt", "text"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (!selected) return;

    // Check if already open
    const { tabs: currentTabs } = useEditorStore.getState();
    const existing = currentTabs.find((t) => t.filePath === selected);
    if (existing) {
      useEditorStore.getState().setActiveTab(existing.id);
      return;
    }

    try {
      const content = await readFile(selected);
      const fileName = selected.split("/").pop() ?? "Unknown";
      setFileContent(selected, content);
      openTab({
        contextId: "",
        id: crypto.randomUUID(),
        filePath: selected,
        title: fileName,
        isDirty: false,
        isPinned: false,
      });
    } catch (err) {
      logger.error("[App] Failed to open file:", err);
    }
  }, [setFileContent, openTab]);

  const handleSave = useCallback(async () => {
    if (!editor) return;
    const { tabs: currentTabs, activeTabId: tabId } = useEditorStore.getState();
    const saveTab = currentTabs.find((t) => t.id === tabId);
    if (!saveTab) return;
    if (isGraphTab(saveTab)) return;

    const isCode = saveTab.filePath && !isMarkdownFile(saveTab.filePath);
    const md =
      isCode || isSourceMode
        ? sourceContentRef.current
        : prosemirrorToMarkdown(editor.state.doc);

    if (saveTab.filePath) {
      // Existing file — save directly
      try {
        await writeFile(saveTab.filePath, md);
        setFileContent(saveTab.filePath, md);
        markDirty(saveTab.id, false);
        notifyFileSave(saveTab.filePath);
        // Only index markdown files (link indexing not relevant for code files)
        if (!isCode) {
          updateFileIndex(saveTab.filePath)
            .then(() => useLinkStore.getState().invalidate())
            .catch(() => {});
        }
      } catch (err) {
        logger.error("[App] Failed to save:", err);
      }
    } else {
      // Untitled — Save As dialog
      const savePath = await save({
        filters: [
          { name: "Markdown", extensions: ["md"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (!savePath) return;

      try {
        await writeFile(savePath, md);
        if (!isCode) {
          updateFileIndex(savePath)
            .then(() => useLinkStore.getState().invalidate())
            .catch(() => {});
        }
        // Update tab with real path
        const fileName = savePath.split("/").pop() ?? "Unknown";
        // Remove old untitled content
        useFileStore.getState().removeFileContent(saveTab.id);
        setFileContent(savePath, md);
        // Update the tab in store
        useEditorStore.setState((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === saveTab.id
              ? { ...t, filePath: savePath, title: fileName, isDirty: false }
              : t,
          ),
        }));
      } catch (err) {
        logger.error("[App] Failed to save as:", err);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sourceContentRef is a stable ref
  }, [editor, isSourceMode, setFileContent, markDirty]);

  const handleSaveAs = useCallback(async () => {
    if (!editor) return;
    const { tabs: currentTabs, activeTabId: tabId } = useEditorStore.getState();
    const saveAsTab = currentTabs.find((t) => t.id === tabId);
    if (!saveAsTab) return;
    if (isGraphTab(saveAsTab)) return;

    const isCode = saveAsTab.filePath && !isMarkdownFile(saveAsTab.filePath);
    const md =
      isCode || isSourceMode
        ? sourceContentRef.current
        : prosemirrorToMarkdown(editor.state.doc);
    const savePath = await save({
      filters: [
        { name: "Markdown", extensions: ["md"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (!savePath) return;

    try {
      await writeFile(savePath, md);
      if (!isCode) {
        updateFileIndex(savePath)
          .then(() => useLinkStore.getState().invalidate())
          .catch(() => {});
      }
      const fileName = savePath.split("/").pop() ?? "Unknown";
      if (!saveAsTab.filePath) {
        useFileStore.getState().removeFileContent(saveAsTab.id);
      }
      setFileContent(savePath, md);
      useEditorStore.setState((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === saveAsTab.id
            ? { ...t, filePath: savePath, title: fileName }
            : t,
        ),
      }));
      markDirty(saveAsTab.id, false);
      notifyFileSave(savePath);
    } catch (err) {
      logger.error("[App] Failed to save as:", err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sourceContentRef is a stable ref
  }, [editor, isSourceMode, setFileContent, markDirty]);

  const handleCloseTab = useCallback(async () => {
    const { activeTabId: tabId, tabs } = useEditorStore.getState();
    if (!tabId) return;
    const tab = tabs.find((t) => t.id === tabId);
    if (tab?.isDirty && tab.filePath) {
      // Auto-save may not have fired yet — flush before closing
      handleSave().then(
        () => {
          useEditorStore.getState().closeTab(tabId);
        },
        () => {
          // save failed — keep tab open, user retains their changes
        },
      );
      return;
    }
    if (tab?.isDirty && !tab.filePath) {
      // Untitled dirty tab — prompt before discarding (no file to auto-save to)
      const confirmed = await ask(
        "You have unsaved changes. Close without saving?",
        { title: "Unsaved Changes", kind: "warning" },
      );
      if (!confirmed) return;
    }
    useEditorStore.getState().closeTab(tabId);
  }, [handleSave]);

  const handleOpenFolder = useCallback(async () => {
    const selected = await open({ directory: true });
    if (selected) {
      try {
        await openFolder(selected);
        useSettingsStore.getState().addRecentFolder(selected);
      } catch (err) {
        logger.error("[App] Failed to open folder:", err);
      }
    }
  }, []);

  const handleOpenRecentFolder = useCallback(async (path: string) => {
    // Called at app startup — errors must not crash the app; vault stays uninitialized
    try {
      await openFolder(path);
      useSettingsStore.getState().addRecentFolder(path);
    } catch (err) {
      logger.error("[App] Failed to open recent folder:", err);
    }
  }, []);

  // Open file by path — used by macOS file association (Finder → Baram)
  const handleOpenFilePath = useCallback(async (filePath: string) => {
    const { tabs: currentTabs } = useEditorStore.getState();
    const existing = currentTabs.find((t) => t.filePath === filePath);
    if (existing) {
      useEditorStore.getState().setActiveTab(existing.id);
      return;
    }

    try {
      // §89 Ensure context exists — vault/folder for internal files,
      // FileContext for external files. Must happen before readFile
      // so Rust check_vault passes.
      const contextStore = useContextStore.getState();
      const context = await contextStore.ensureFileContext(filePath);
      const contextId = context.id;

      const content = await readFile(filePath);
      const fileName = filePath.split("/").pop() ?? "Unknown";
      useFileStore.getState().setFileContent(filePath, content);

      useEditorStore.getState().openTab({
        contextId,
        id: crypto.randomUUID(),
        filePath,
        title: fileName,
        isDirty: false,
        isPinned: false,
      });
      notifyFileOpen(filePath);
      useSettingsStore.getState().addRecentFile(filePath);
      useSettingsStore.getState().setLastOpenedFile(filePath);
    } catch (err) {
      logger.error("[App] Failed to open file:", err);
    }
  }, []);

  const handleOpenRecentFile = useCallback(
    async (path: string) => {
      await handleOpenFilePath(path);
    },
    [handleOpenFilePath],
  );

  const handleCloseFolder = useCallback(() => {
    useFileStore.getState().closeFolder();
  }, []);

  return {
    handleCloseFolder,
    handleCloseTab,
    handleNewFile,
    handleOpenFile,
    handleOpenFilePath,
    handleOpenFolder,
    handleOpenRecentFile,
    handleOpenRecentFolder,
    handleSave,
    handleSaveAs,
  };
}
