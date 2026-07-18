// §4.3 File tree — shared move logic (used by DnD and Move-to-folder modal)
import { useCallback } from "react";

import { renameFile } from "../../../ipc/invoke";
import { useEditorStore } from "../../../stores/editor/editor";
import { useLinkStore } from "../../../stores/editor/link";
import { useFileStore } from "../../../stores/file/file";
import { showAlert } from "../../../utils/confirm-dialog";
import { logger } from "../../../utils/logger";
import { planMultiMove, pruneNestedPaths } from "../file-tree-multi-ops";

export interface UseFileTreeMoveReturn {
  moveEntries: (sourcePaths: string[], targetPath: string) => Promise<void>;
}

export function useFileTreeMove(): UseFileTreeMoveReturn {
  const moveEntries = useCallback(
    async (sourcePaths: string[], targetPath: string): Promise<void> => {
      const root = useFileStore.getState().rootPath;
      if (!root) return;
      const pruned = pruneNestedPaths(new Set(sourcePaths));
      const { moves } = planMultiMove(pruned, targetPath, root);
      if (moves.length === 0) return;
      const { moveFileEntry } = useFileStore.getState();
      const { renameTab } = useEditorStore.getState();
      const failed: string[] = [];
      for (const { from, to } of moves) {
        try {
          await renameFile(from, to);
          moveFileEntry(from, targetPath);
          const { tabs } = useEditorStore.getState();
          for (const tab of tabs) {
            if (tab.filePath === from) {
              renameTab(from, to, to.split("/").pop() ?? "");
            } else if (tab.filePath?.startsWith(from + "/")) {
              renameTab(
                tab.filePath,
                to + tab.filePath.slice(from.length),
                tab.title,
              );
            }
          }
        } catch (err) {
          logger.error("[FileTree] Move failed:", from, err);
          failed.push(from.split("/").pop() ?? from);
        }
      }
      useLinkStore.getState().invalidate();
      if (failed.length > 0) {
        await showAlert(`Failed to move: ${failed.join(", ")}`);
      }
    },
    [],
  );
  return { moveEntries };
}
