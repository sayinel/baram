// §4.3 File tree — context-menu action handlers
import { useCallback } from "react";

import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

import type { FileEntry } from "../../../stores/file/file";

import { copyFile } from "../../../ipc/invoke";
import { useFileStore } from "../../../stores/file/file";
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
  revealInFileManager: (path: string) => Promise<void>;
}

export function useFileTreeActions(): UseFileTreeActionsReturn {
  const copyPath = useCallback(async (path: string): Promise<void> => {
    await writeText(path);
  }, []);

  const copyRelativePath = useCallback(async (path: string): Promise<void> => {
    const root = useFileStore.getState().rootPath;
    if (!root) return;
    await writeText(toRelativePath(path, root));
  }, []);

  const copyWikilink = useCallback(async (path: string): Promise<void> => {
    const { rootPath: root, fileTree } = useFileStore.getState();
    if (!root) return;
    const allPaths = flattenFileTree(fileTree, root).map((f) => f.path);
    await writeText(`[[${toWikilinkLabel(path, root, allPaths)}]]`);
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

  return {
    copyPath,
    copyRelativePath,
    copyWikilink,
    duplicateFile,
    revealInFileManager,
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
