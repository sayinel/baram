// §4.3 File tree — delete + inline creation hook
import { useCallback, useState } from "react";

import type { FileEntry } from "../../../stores/file/file";
import type { CreatingEntryState } from "../file-tree-types";

import {
  createDir,
  deleteDir,
  deleteFile,
  writeFile,
} from "../../../ipc/invoke";
import { useEditorStore } from "../../../stores/editor/editor";
import { useLinkStore } from "../../../stores/editor/link";
import { useFileStore } from "../../../stores/file/file";
import { showConfirm } from "../../../utils/confirm-dialog";
import { logger } from "../../../utils/logger";

interface UseFileTreeCrudReturn {
  creatingEntry: CreatingEntryState | null;
  handleCancelCreate: () => void;
  handleConfirmCreate: (name: string) => Promise<void>;
  handleDelete: (path: string) => Promise<void>;
  handleStartCreate: (parentPath: string, isDir: boolean) => void;
}

export function useFileTreeCrud(): UseFileTreeCrudReturn {
  const rootPath = useFileStore((s) => s.rootPath);
  const expandDir = useFileStore((s) => s.expandDir);
  const addFileEntry = useFileStore((s) => s.addFileEntry);
  const removeFileEntry = useFileStore((s) => s.removeFileEntry);
  const setFileContent = useFileStore((s) => s.setFileContent);
  const openTab = useEditorStore((s) => s.openTab);
  const closeTab = useEditorStore((s) => s.closeTab);
  const [creatingEntry, setCreatingEntry] = useState<CreatingEntryState | null>(
    null,
  );

  const handleDelete = useCallback(
    async (path: string): Promise<void> => {
      if (!rootPath) return;
      const entry = findEntryByPath(useFileStore.getState().fileTree, path);
      if (!entry) return;
      const confirmed = await showConfirm(
        entry.isDir
          ? `Delete folder "${entry.name}" and all its contents?`
          : `Delete file "${entry.name}"?`,
      );
      if (!confirmed) return;
      try {
        if (entry.isDir) await deleteDir(path);
        else await deleteFile(path);
        const { tabs: currentTabs } = useEditorStore.getState();
        for (const tab of currentTabs) {
          if (tab.filePath === path || tab.filePath?.startsWith(path + "/"))
            closeTab(tab.id);
        }
        removeFileEntry(path);
        useLinkStore.getState().invalidate();
      } catch (err) {
        logger.error("[FileTree] Delete failed:", err);
      }
    },
    [rootPath, closeTab, removeFileEntry],
  );

  const handleStartCreate = useCallback(
    (parentPath: string, isDir: boolean): void => {
      if (parentPath !== rootPath) {
        expandDir(parentPath);
      }
      setCreatingEntry({ parentPath, isDir });
    },
    [rootPath, expandDir],
  );

  const handleConfirmCreate = useCallback(
    async (name: string): Promise<void> => {
      if (!creatingEntry || !name.trim()) {
        setCreatingEntry(null);
        return;
      }
      const { parentPath, isDir } = creatingEntry;
      const fullPath = parentPath + "/" + name.trim();
      setCreatingEntry(null);
      try {
        if (isDir) {
          await createDir(fullPath);
          addFileEntry(parentPath, {
            name: name.trim(),
            path: fullPath,
            isDir: true,
            children: [],
          });
        } else {
          await writeFile(fullPath, "");
          addFileEntry(parentPath, {
            name: name.trim(),
            path: fullPath,
            isDir: false,
          });
          setFileContent(fullPath, "");
          openTab({
            id: crypto.randomUUID(),
            filePath: fullPath,
            title: name.trim(),
            isDirty: false,
            isPinned: false,
          });
        }
      } catch (err) {
        logger.error("[FileTree] Create failed:", err);
      }
    },
    [creatingEntry, addFileEntry, setFileContent, openTab],
  );

  const handleCancelCreate = useCallback(
    (): void => setCreatingEntry(null),
    [],
  );

  return {
    creatingEntry,
    handleStartCreate,
    handleConfirmCreate,
    handleCancelCreate,
    handleDelete,
  };
}

/** Find an entry by path in a recursive file tree */
function findEntryByPath(entries: FileEntry[], path: string): FileEntry | null {
  for (const e of entries) {
    if (e.path === path) return e;
    if (e.isDir && e.children) {
      const found = findEntryByPath(e.children, path);
      if (found) return found;
    }
  }
  return null;
}
