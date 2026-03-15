// §33 Inline rename with wikilink auto-update
import { useCallback, useState } from "react";

import type { FileEntry } from "../../../stores/file/file";

import {
  readFile,
  renameFileWithLinks,
  renameNamespace,
} from "../../../ipc/invoke";
import { useEditorStore } from "../../../stores/editor/editor";
import { useLinkStore } from "../../../stores/editor/link";
import { useFileStore } from "../../../stores/file/file";
import { logger } from "../../../utils/logger";

interface UseFileTreeRenameReturn {
  handleCancelRename: () => void;
  handleConfirmRename: (oldPath: string, newName: string) => Promise<void>;
  handleStartRename: (path: string) => void;
  renamingPath: null | string;
  setRenamingPath: (path: null | string) => void;
}

export function useFileTreeRename(
  treeRef: React.RefObject<HTMLDivElement | null>,
): UseFileTreeRenameReturn {
  const [renamingPath, setRenamingPath] = useState<null | string>(null);
  const fileTree = useFileStore((s) => s.fileTree);
  const rootPath = useFileStore((s) => s.rootPath);
  const renameFileEntry = useFileStore((s) => s.renameFileEntry);
  const renameTab = useEditorStore((s) => s.renameTab);

  const handleStartRename = useCallback(
    (path: string): void => setRenamingPath(path),
    [],
  );

  const handleCancelRename = useCallback((): void => {
    setRenamingPath(null);
    treeRef.current?.focus();
  }, [treeRef]);

  const handleConfirmRename = useCallback(
    async (oldPath: string, newName: string): Promise<void> => {
      setRenamingPath(null);
      treeRef.current?.focus();
      const parts = oldPath.split("/");
      const oldName = parts[parts.length - 1];
      if (newName === oldName || !newName.trim()) return;
      const newPath =
        oldPath.substring(0, oldPath.length - oldName.length) + newName;

      // Check if this is a directory rename
      const isDir = ((): boolean => {
        function find(entries: FileEntry[]): boolean {
          for (const e of entries) {
            if (e.path === oldPath) return e.isDir;
            if (e.isDir && e.children && find(e.children)) return true;
          }
          return false;
        }
        return find(fileTree);
      })();

      try {
        if (isDir && rootPath) {
          // §61 Namespace rename: directory + relative wikilink updates
          const result = await renameNamespace(oldPath, newPath, rootPath);
          renameFileEntry(oldPath, newPath, newName);
          useEditorStore.getState().renameDirInTabs(oldPath, newPath);
          // Reload content for files that had wikilinks updated
          const { openFiles } = useFileStore.getState();
          for (const updatedFile of result.updatedFiles) {
            if (openFiles.has(updatedFile)) {
              try {
                const newContent = await readFile(updatedFile);
                useFileStore.getState().setFileContent(updatedFile, newContent);
              } catch {
                /* ignore */
              }
            }
          }
          useLinkStore.getState().invalidate();
        } else {
          // Single file rename (existing behavior)
          const result = await renameFileWithLinks(oldPath, newPath);
          renameFileEntry(oldPath, newPath, newName);
          renameTab(oldPath, newPath, newName);
          const { openFiles } = useFileStore.getState();
          if (openFiles.has(oldPath)) {
            const content = openFiles.get(oldPath)!;
            useFileStore.getState().removeFileContent(oldPath);
            useFileStore.getState().setFileContent(newPath, content);
          }
          for (const updatedFile of result.updatedFiles) {
            if (openFiles.has(updatedFile)) {
              try {
                const newContent = await readFile(updatedFile);
                useFileStore.getState().setFileContent(updatedFile, newContent);
              } catch {
                /* ignore */
              }
            }
          }
          useLinkStore.getState().invalidate();
        }
      } catch (err) {
        logger.error("[FileTree] Rename failed:", err);
      }
    },
    [treeRef, renameFileEntry, renameTab, fileTree, rootPath],
  );

  return {
    renamingPath,
    setRenamingPath,
    handleStartRename,
    handleCancelRename,
    handleConfirmRename,
  };
}
