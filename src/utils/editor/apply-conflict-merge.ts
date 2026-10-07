// §3.6 Apply a conflict merge: write the merged text, and put it in the tab that asked
// for it — only if that tab is still the one showing the file and still holds what it
// held when the merge was applied (issue 795, with #798's save-still-current rule).
//
// The write takes a moment. If the user typed in the meantime, refreshing the editor
// from the merged text would drop that typing, and marking the tab clean would hide it
// from the next save; if they switched tabs, the active tab is a different document
// that this merge must not touch. In both cases the file still gets the merge and the
// cache — the disk baseline — follows it, while the tab keeps its own text and stays
// dirty.
import type { Editor } from "@tiptap/core";

import { writeFile } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor/editor";
import { useSnapshotStore } from "../../stores/editor/snapshot";
import { useFileStore } from "../../stores/file/file";
import { asTabSave } from "./tab-save-in-flight";

export async function applyConflictMerge(
  filePath: string,
  merged: string,
  editor: Editor | null,
  markDirty: (tabId: string, dirty: boolean) => void,
): Promise<void> {
  const { activeTabId, tabs } = useEditorStore.getState();
  const owner = tabs.find(
    (t) => t.id === activeTabId && t.filePath === filePath,
  );
  const live = editor && !editor.isDestroyed ? editor : null;
  const docAtApply = live?.state.doc;

  const savedAt = owner
    ? await asTabSave(filePath, owner.id, () => writeFile(filePath, merged))
    : await writeFile(filePath, merged);
  useFileStore.getState().setFileContent(filePath, merged);
  useFileStore
    .getState()
    .updateLastSaveMtime(
      filePath,
      typeof savedAt === "number" && savedAt > 0 ? savedAt : Date.now(),
    );
  // §71 A conflict-merge write is a real content change.
  useSnapshotStore.getState().markPendingAutoSnapshot();

  if (!owner || !live || docAtApply === undefined) return;
  const now = useEditorStore.getState();
  const stillOwns =
    now.activeTabId === owner.id &&
    now.tabs.some((t) => t.id === owner.id && t.filePath === filePath);
  if (!stillOwns || live.state.doc !== docAtApply) return;
  now.requestContentRefresh("fresh", filePath);
  markDirty(owner.id, false);
}
