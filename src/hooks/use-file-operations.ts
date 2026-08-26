// §3.6 File operation hooks — new, open, save, saveAs, close, openFolder
import { useCallback } from "react";

import { open, save } from "@tauri-apps/plugin-dialog";

import type { Editor } from "@tiptap/core";

import { readFile, updateFileIndex, writeFile } from "../ipc/invoke";
import { prosemirrorToMarkdown } from "../pipeline/pm-to-md";
import { notifyFileSave } from "../plugins/plugin-lifecycle";
import { isFileTab, useEditorStore } from "../stores/editor/editor";
import { useLinkStore } from "../stores/editor/link";
import { useSnapshotStore } from "../stores/editor/snapshot";
import { openFolder, useFileStore } from "../stores/file/file";
import { useSettingsStore } from "../stores/settings/store";
import { useUIStore } from "../stores/ui/ui";
import { isBinaryViewerFile, isMarkdownFile } from "../utils/file-type";
import { isJournalPath } from "../utils/journal/journal";
import { notifyJournalChanged } from "../utils/journal/journal-events";
import { logger } from "../utils/logger";
import { openFileByPath } from "../utils/open-file";
import { basename } from "../utils/path-utils";

interface UseFileOperationsParams {
  editor: Editor | null;
  getSourceBuffer: (tabId: string) => string;
  /** §287 소스 모드인 탭들 — 저장 대상 탭 자신의 모드를 물어본다. */
  sourceModeTabs: ReadonlySet<string>;
}

/**
 * §Phase5: Show the conflict modal for a file that changed externally while dirty.
 * The modal is driven by UIStore — ConflictModalWrapper in App.tsx renders it.
 */
export function showConflictModal(
  filePath: string,
  externalMtime: number,
  base: string,
): void {
  useUIStore.getState().openConflictModal(filePath, externalMtime, base);
}

/**
 * Auto-reload a file from disk when an external change is detected and the tab
 * is not dirty. Updates openFiles, syncs mtime, and triggers editor refresh via
 * contentRefreshKey.
 */
export async function triggerAutoReload(
  filePath: string,
  externalMtime: number,
): Promise<void> {
  // PDFs are binary — keep the "" cache sentinel; the mtime bump below
  // refreshes the viewer iframe instead.
  const isBinary = isBinaryViewerFile(filePath);
  const freshContent = isBinary ? "" : await readFile(filePath);

  // §312 ‼️ 캐시를 덮기 **전에** 잡는다. 이 값이 "버퍼가 갈라졌는가"의 유일한 기준선인데,
  // setFileContent가 먼저 돌면 그 자리에 이미 새 내용이 들어와 모든 버퍼가 갈라져 보인다.
  const cachedBefore = useFileStore.getState().openFiles.get(filePath);

  // Update the in-memory content cache
  useFileStore.getState().setFileContent(filePath, freshContent);

  // §312 그리고 그 파일을 보여주는 소스 표면들. ‼️ 바이너리의 "" 센티널은 내용이
  // 아니라 자리 표시라 버퍼에 넣으면 남의 텍스트를 지운다.
  if (!isBinary) syncSourceBuffers(filePath, freshContent, cachedBefore);

  // Sync mtime so the next auto-save doesn't see a false conflict
  useFileStore.getState().updateLastSaveMtime(filePath, externalMtime);

  // Signal the editor to re-read from openFiles
  useEditorStore.getState().requestContentRefresh();

  // Surface a transient toast so the reload isn't silent (esp. with auto-save on)
  useUIStore
    .getState()
    .showToast(`Reloaded external changes: ${basename(filePath)}`);

  logger.info("[triggerAutoReload] auto-reloaded", filePath);
}

export function useFileOperations({
  editor,
  getSourceBuffer,
  sourceModeTabs,
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
        { name: "HTML", extensions: ["html", "htm"] },
        { name: "PDF", extensions: ["pdf"] },
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg"],
        },
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
      // PDFs are binary — never read through the UTF-8 IPC (viewer loads
      // them via asset:). Cache "" so tab switching treats the tab as loaded.
      const content = isBinaryViewerFile(selected)
        ? ""
        : await readFile(selected);
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
    // ‼️ Asked as "is this a file?", not "is this the graph?". A non-file tab falls into
    // the `!filePath` branch below, which offers Save As and then rewrites the tab into a
    // file tab — so an enumerated check here hands every future tab type a save path.
    if (!isFileTab(saveTab)) return;
    // PDF tabs are read-only viewers — writing the source buffer (which holds
    // another tab's text) into a .pdf would destroy the binary.
    if (isBinaryViewerFile(saveTab.filePath)) return;

    const isCode = saveTab.filePath && !isMarkdownFile(saveTab.filePath);
    const md =
      isCode || sourceModeTabs.has(saveTab.id)
        ? getSourceBuffer(saveTab.id)
        : prosemirrorToMarkdown(editor.state.doc);

    if (saveTab.filePath) {
      // Existing file — save directly
      try {
        await writeFile(saveTab.filePath, md);
        useSnapshotStore.getState().markPendingAutoSnapshot();
        useFileStore
          .getState()
          .updateLastSaveMtime(saveTab.filePath, Date.now());
        setFileContent(saveTab.filePath, md);
        markDirty(saveTab.id, false);
        notifyFileSave(saveTab.filePath);
        // §56 Refresh journal sidebars in real time on a manual save.
        if (
          isJournalPath(
            saveTab.filePath,
            useFileStore.getState().rootPath,
            useSettingsStore.getState().journalDirectory,
          )
        ) {
          notifyJournalChanged();
        }
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
        useSnapshotStore.getState().markPendingAutoSnapshot();
        useFileStore.getState().updateLastSaveMtime(savePath, Date.now());
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
  }, [editor, sourceModeTabs, getSourceBuffer, setFileContent, markDirty]);

  const handleSaveAs = useCallback(async () => {
    if (!editor) return;
    const { tabs: currentTabs, activeTabId: tabId } = useEditorStore.getState();
    const saveAsTab = currentTabs.find((t) => t.id === tabId);
    if (!saveAsTab) return;
    // Same inversion as `handleSave` — see the note there.
    if (!isFileTab(saveAsTab)) return;
    // PDF tabs are read-only viewers — Save As would write text, not the PDF.
    if (isBinaryViewerFile(saveAsTab.filePath)) return;

    const isCode = saveAsTab.filePath && !isMarkdownFile(saveAsTab.filePath);
    const md =
      isCode || sourceModeTabs.has(saveAsTab.id)
        ? getSourceBuffer(saveAsTab.id)
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
      useSnapshotStore.getState().markPendingAutoSnapshot();
      useFileStore.getState().updateLastSaveMtime(savePath, Date.now());
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
  }, [editor, sourceModeTabs, getSourceBuffer, setFileContent, markDirty]);

  const handleCloseTab = useCallback(() => {
    const { activeTabId: tabId, tabs } = useEditorStore.getState();
    if (!tabId) return;
    const tab = tabs.find((t) => t.id === tabId);
    if (tab?.isDirty && tab.filePath) {
      // §close-guard: file-backed tab — auto-save may not have fired yet; flush
      // and close without a prompt (Cmd+W keeps its quick save-and-close flow).
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
      // §close-guard: Untitled tab has no file to auto-save to — use the shared
      // 3-button modal (identical UI to app quit and the tab X-button).
      useUIStore.getState().openUnsavedModal({ intent: "closeTab", tabId });
      return;
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
    try {
      await openFileByPath(filePath);
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

/**
 * §312 Push freshly-read disk content into the source buffers that show it.
 *
 * ‼️ `openFiles` + `contentRefreshKey`만 갱신하면 소스 표면은 낡은 채로 남는다. 그 탭의
 * 저장 경로는 openFiles가 아니라 이 버퍼를 읽으므로(`handleSave`의 `isCode ||
 * sourceModeTabs.has(...)` 갈래), 리로드 직후의 Cmd+S가 **낡은 버퍼로 디스크의 변경을
 * 덮는다.**
 *
 * 조건이 `handleSave`의 읽기 조건과 **같아야** 한다 — 저장이 버퍼를 읽는 탭에서만
 * 버퍼를 갱신한다. 두 조건이 갈라지면 한쪽이 반드시 낡는다.
 *
 * ‼️ 그러나 **갈라진 버퍼는 건드리지 않는다.** 버퍼가 `cachedContent`(리로드 직전에 알고
 * 있던 그 파일의 내용)와 다르면 그것은 아직 저장되지 않은 편집이다. 마크다운 소스 모드의
 * 타이핑은 탭을 dirty로 만들지 않으므로(tab-surface-renderers.tsx:108) 워처의 "clean일
 * 때만 리로드" 관문이 그 텍스트를 지켜 주지 못하고, 여기서 덮으면 사용자가 방금 친 글자가
 * 버퍼와 화면에서 함께 사라진다 — 충돌 모달조차 뜨지 않는다. 갈라진 버퍼는 그대로 두는
 * 것이 맞고, 그 상황을 사용자에게 알리는 일은 `showConflictModal` 경로의 몫이다.
 *
 * 버퍼가 아직 없는 탭(로딩 중인 코드 탭)도 같은 규칙에 걸려 건너뛴다 — 갱신하지 않아도
 * 그 표면은 마운트할 때 새 캐시에서 내용을 받는다.
 */
function syncSourceBuffers(
  filePath: string,
  freshContent: string,
  cachedContent: string | undefined,
): void {
  const { sourceBufferAccess, sourceModeTabs, tabs } =
    useEditorStore.getState();
  if (!sourceBufferAccess) return;

  // 비마크다운 탭은 항상 코드 표면이다 — 토글 집합에 들어가지 않는다.
  const alwaysSource = !isMarkdownFile(filePath);
  for (const tab of tabs) {
    if (tab.filePath !== filePath) continue;
    if (!alwaysSource && !sourceModeTabs.includes(tab.id)) continue;
    if (sourceBufferAccess.getSourceBuffer(tab.id) !== cachedContent) continue;
    sourceBufferAccess.setSourceBuffer(tab.id, freshContent);
  }
}
