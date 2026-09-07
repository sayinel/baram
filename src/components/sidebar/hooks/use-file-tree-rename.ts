// §33 Inline rename with wikilink auto-update
import { useCallback, useState } from "react";

import type { FileEntry } from "../../../stores/file/file";

import { type Locale, t } from "../../../i18n";
import {
  readFile,
  renameFileWithLinks,
  renameNamespace,
} from "../../../ipc/invoke";
import { useEditorStore } from "../../../stores/editor/editor";
import { useLinkStore } from "../../../stores/editor/link";
import { useFileStore } from "../../../stores/file/file";
import { useSettingsStore } from "../../../stores/settings/store";
import { useUIStore } from "../../../stores/ui/ui";
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

      // §61 Namespace rename (directory + relative wikilink updates) vs single
      // file rename. One decision, read three times below — it used to be two
      // near-identical branches, which is how the try grew to cover both the
      // IPC call and the local state updates.
      const isNamespaceRename = isDir && !!rootPath;

      // issue 263: ONLY the IPC call belongs inside the try whose catch says
      // the rename failed. A throw from here means nothing happened on disk,
      // and that is the only case in which "Rename failed" is true.
      let result: { updatedFiles: string[] };
      try {
        result = isNamespaceRename
          ? await renameNamespace(oldPath, newPath, rootPath)
          : await renameFileWithLinks(oldPath, newPath);
      } catch (err) {
        logger.error("[FileTree] Rename failed:", err);
        // issue 263: the backend now refuses a rename it cannot complete (the
        // link index is still being built, the file is outside every context)
        // instead of renaming and leaving references stale. The reason has to
        // reach the user, not only the log — the tree simply keeps the old
        // name otherwise.
        const { locale } = useSettingsStore.getState();
        useUIStore.getState().showToast(
          t("fileTree.rename.failed.toast", locale as Locale, {
            message: String(err),
          }),
          "error",
        );
        return;
      }

      // The file is already renamed on disk by now. Reporting a local-state
      // failure as "Rename failed" would tell the user the opposite of what
      // happened, so this half only logs.
      try {
        renameFileEntry(oldPath, newPath, newName);
        if (isNamespaceRename) {
          useEditorStore.getState().renameDirInTabs(oldPath, newPath);
        } else {
          renameTab(oldPath, newPath, newName);
        }
        // The renamed file's cached content is already under newPath:
        // `renameFileEntry` re-keys openFiles (`rekeyOpenFilesPrefix`,
        // stores/file/file-tree-ops.ts). Read the map after it.
        const { openFiles } = useFileStore.getState();
        // Reload content for files that had wikilinks updated
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
      } catch (err) {
        logger.error(
          "[FileTree] Rename committed, local state update failed:",
          err,
        );
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
