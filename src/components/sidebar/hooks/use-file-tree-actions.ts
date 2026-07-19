// §4.3 File tree — context-menu action handlers
import { useCallback } from "react";

import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

import type { FileEntry } from "../../../stores/file/file";

import { copyFile, readFile } from "../../../ipc/invoke";
import { useEditorStore } from "../../../stores/editor/editor";
import { useSnapshotStore } from "../../../stores/editor/snapshot";
import { useFileStore } from "../../../stores/file/file";
import { useUIStore } from "../../../stores/ui/ui";
import { flattenFileTree } from "../../../utils/file-search";
import { logger } from "../../../utils/logger";
import {
  basename,
  dirname,
  resolveNameConflict,
} from "../../../utils/path-utils";
import { toRelativePath, toWikilinkLabel } from "../file-tree-clipboard";

export interface UseFileTreeActionsReturn {
  copyPath: (path: string) => Promise<void>;
  copyRelativePath: (path: string) => Promise<void>;
  copyWikilink: (path: string) => Promise<void>;
  duplicateFile: (path: string) => Promise<void>;
  exportFile: (path: string) => Promise<void>;
  openInNewTab: (path: string) => Promise<boolean>;
  revealInFileManager: (path: string) => Promise<void>;
  showVersionHistory: (absPath: string) => void;
}

export function useFileTreeActions(): UseFileTreeActionsReturn {
  const copyPath = useCallback(async (path: string): Promise<void> => {
    try {
      await writeText(path);
    } catch (err) {
      logger.error("[FileTree] Copy failed:", err);
    }
  }, []);

  const copyRelativePath = useCallback(async (path: string): Promise<void> => {
    const root = useFileStore.getState().rootPath;
    if (!root) return;
    try {
      await writeText(toRelativePath(path, root));
    } catch (err) {
      logger.error("[FileTree] Copy failed:", err);
    }
  }, []);

  const copyWikilink = useCallback(async (path: string): Promise<void> => {
    const { rootPath: root, fileTree } = useFileStore.getState();
    if (!root) return;
    const allPaths = flattenFileTree(fileTree, root).map((f) => f.path);
    try {
      await writeText(`[[${toWikilinkLabel(path, root, allPaths)}]]`);
    } catch (err) {
      logger.error("[FileTree] Copy failed:", err);
    }
  }, []);

  const duplicateFile = useCallback(async (path: string): Promise<void> => {
    const { fileTree, rootPath: root, addFileEntry } = useFileStore.getState();
    if (!root) return;
    const parent = dirname(path);
    const name = basename(path);
    // 같은 폴더의 기존 이름 수집
    const siblings = collectSiblingNames(fileTree, parent, root);
    const newName = resolveNameConflict(name, siblings);
    const newPath = parent + "/" + newName;
    try {
      await copyFile(path, newPath);
      addFileEntry(parent, { name: newName, path: newPath, isDir: false });
    } catch (err) {
      logger.error("[FileTree] Duplicate failed:", err);
    }
  }, []);

  const revealInFileManager = useCallback(
    async (path: string): Promise<void> => {
      try {
        await revealItemInDir(path);
      } catch (err) {
        logger.error("[FileTree] Reveal failed:", err);
      }
    },
    [],
  );

  const openInNewTab = useCallback(async (path: string): Promise<boolean> => {
    const editorState = useEditorStore.getState();
    const existing = editorState.tabs.find((t) => t.filePath === path);
    if (existing) {
      editorState.setActiveTab(existing.id);
      return true;
    }
    try {
      const content = await readFile(path);
      useFileStore.getState().setFileContent(path, content);
      editorState.openTab({
        contextId: "",
        id: crypto.randomUUID(),
        filePath: path,
        title: basename(path),
        isDirty: false,
        isPinned: false,
      });
      return true;
    } catch (err) {
      logger.error("[FileTree] Open in new tab failed:", err);
      return false;
    }
  }, []);

  const exportFile = useCallback(
    async (path: string): Promise<void> => {
      const opened = await openInNewTab(path);
      if (!opened) return;
      useUIStore.getState().openExportDialog("pdf");
    },
    [openInNewTab],
  );

  const showVersionHistory = useCallback((absPath: string): void => {
    const root = useFileStore.getState().rootPath;
    if (!root) return;
    const relPath = absPath.startsWith(root + "/")
      ? absPath.slice(root.length + 1)
      : absPath;
    void useSnapshotStore.getState().loadFileHistory(root, relPath);
    useUIStore.getState().setSidebarPanel("snapshots");
  }, []);

  return {
    copyPath,
    copyRelativePath,
    copyWikilink,
    duplicateFile,
    exportFile,
    openInNewTab,
    revealInFileManager,
    showVersionHistory,
  };
}

function collectSiblingNames(
  tree: FileEntry[],
  parentPath: string,
  rootPath: string,
): Set<string> {
  if (parentPath === rootPath) {
    return new Set(tree.map((e) => e.name));
  }
  const parent = findEntry(tree, parentPath);
  return new Set((parent?.children ?? []).map((c) => c.name));
}

function findEntry(tree: FileEntry[], path: string): FileEntry | null {
  for (const e of tree) {
    if (e.path === path) return e;
    if (e.isDir && e.children) {
      const found = findEntry(e.children, path);
      if (found) return found;
    }
  }
  return null;
}
