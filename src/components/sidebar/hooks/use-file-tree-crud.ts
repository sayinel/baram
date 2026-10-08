// §4.3 File tree — delete + inline creation hook
import { useCallback, useState } from "react";

import type { FileEntry } from "../../../stores/file/file";
import type { CreatingEntryState } from "../file-tree-types";

import { type Locale, t } from "../../../i18n";
import {
  createDir,
  createFile,
  deleteDir,
  deleteFile,
  isFileExistsError,
} from "../../../ipc/invoke";
import { useEditorStore } from "../../../stores/editor/editor";
import { useLinkStore } from "../../../stores/editor/link";
import { useFileStore } from "../../../stores/file/file";
import { useSettingsStore } from "../../../stores/settings/store";
import { useUIStore } from "../../../stores/ui/ui";
import { showAlert, showConfirm } from "../../../utils/confirm-dialog";
import { logger } from "../../../utils/logger";
import { pruneNestedPaths } from "../file-tree-multi-ops";

interface UseFileTreeCrudReturn {
  creatingEntry: CreatingEntryState | null;
  handleCancelCreate: () => void;
  handleConfirmCreate: (name: string) => Promise<void>;
  handleDelete: (path: string) => Promise<void>;
  handleDeleteMany: (paths: string[]) => Promise<void>;
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
          ? `Move folder "${entry.name}" and all its contents to Trash?`
          : `Move file "${entry.name}" to Trash?`,
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

  const handleDeleteMany = useCallback(
    async (paths: string[]): Promise<void> => {
      if (!rootPath || paths.length === 0) return;
      const targets = pruneNestedPaths(new Set(paths));
      if (targets.length === 1) {
        await handleDelete(targets[0]);
        return;
      }
      const entries = targets
        .map((p) => findEntryByPath(useFileStore.getState().fileTree, p))
        .filter((e): e is FileEntry => e !== null);
      if (entries.length === 0) return;
      const hasDir = entries.some((e) => e.isDir);
      const confirmed = await showConfirm(
        hasDir
          ? `Move ${entries.length} items (including folders) to Trash?`
          : `Move ${entries.length} items to Trash?`,
      );
      if (!confirmed) return;
      const failed: string[] = [];
      for (const entry of entries) {
        try {
          if (entry.isDir) await deleteDir(entry.path);
          else await deleteFile(entry.path);
          const { tabs: currentTabs } = useEditorStore.getState();
          for (const tab of currentTabs) {
            if (
              tab.filePath === entry.path ||
              tab.filePath?.startsWith(entry.path + "/")
            )
              closeTab(tab.id);
          }
          removeFileEntry(entry.path);
        } catch (err) {
          logger.error("[FileTree] Delete failed:", entry.path, err);
          failed.push(entry.name);
        }
      }
      useLinkStore.getState().invalidate();
      if (failed.length > 0) {
        await showAlert(`Failed to move to Trash: ${failed.join(", ")}`);
      }
    },
    [rootPath, closeTab, removeFileEntry, handleDelete],
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
          // `createFile`, never `writeFile`: the latter replaces whatever is at the path,
          // and a name typed here is no evidence the path is free. Typing an existing file's
          // exact name emptied it on disk, set its open buffer to "" and brought its tab to
          // the front; on a volume that ignores case (the macOS and Windows default) a name
          // differing only in case emptied the same file and opened a second tab on it,
          // leaving the first tab's buffer stale. A check against the tree could not have
          // caught the second — it compares names exactly — nor a dot-file it hides. The OS
          // refuses a taken path instead, and nothing below runs.
          try {
            await createFile(fullPath, "");
          } catch (err) {
            if (!isFileExistsError(err)) throw err;
            const { locale } = useSettingsStore.getState();
            useUIStore.getState().showToast(
              t("fileTree.create.exists.toast", locale as Locale, {
                name: name.trim(),
              }),
              "error",
            );
            return;
          }
          addFileEntry(parentPath, {
            name: name.trim(),
            path: fullPath,
            isDir: false,
          });
          // §29 #824 `createFile` put the new file in the link index before it
          // resolved.
          setFileContent(fullPath, "");
          openTab({
            contextId: "",
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
    handleDeleteMany,
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
