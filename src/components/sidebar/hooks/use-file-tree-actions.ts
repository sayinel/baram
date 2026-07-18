// §4.3 File tree — context-menu action handlers
import { useCallback } from "react";

import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import { useFileStore } from "../../../stores/file/file";
import { flattenFileTree } from "../../../utils/file-search";
import { toRelativePath, toWikilinkLabel } from "../file-tree-clipboard";

export interface UseFileTreeActionsReturn {
  copyPath: (path: string) => Promise<void>;
  copyRelativePath: (path: string) => Promise<void>;
  copyWikilink: (path: string) => Promise<void>;
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

  return { copyPath, copyRelativePath, copyWikilink };
}
