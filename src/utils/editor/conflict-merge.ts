// §3.6 The conflict modal's merge, for the tab that holds the file — not the active tab.
//
// The modal opens for any tab marked dirty (`isDirty`) whose file changed on disk, active or not
// (`use-file-watcher.ts`). The merge used to take its local side from the active editor and, on apply,
// to reload the active tab from its `openFiles` text and mark it clean: with the conflicted file in the
// background, another tab's document was merged into the file, and the active tab lost its unsaved
// edits without a word. Here both ends look up the tab that shows the file.
import type { MergeResult } from "../../ipc/types";
import type { Editor } from "@tiptap/core";

import { readFile, writeFile } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor/editor";
import { useSnapshotStore } from "../../stores/editor/snapshot";
import { useFileStore } from "../../stores/file/file";
import { isMarkdownFile } from "../file-type";
import { logger } from "../logger";
import { liveViewOf, locateOpenTabSurface } from "./open-tab-surface";
import { editorHoldsWholeDocument } from "./programmatic-update";
import { serializeEditorState, serializeLiveDoc } from "./serialize-live-doc";

/**
 * Writes the merged text to `filePath` and makes the tab that shows the file show it, clean — the disk
 * now holds what it holds. Other tabs are not touched.
 *
 * - A source-mode or non-markdown tab takes it into its source buffer.
 * - The active tab re-reads it from `openFiles` (`requestContentRefresh`, for this path only). If its
 *   install has not finished, that marks it stale, and the text is read once it has.
 * - A background tab is marked stale: it parses `openFiles` when it comes back instead of restoring the
 *   cached document, and a stale tab's save and the close guard write that text.
 *
 * With no tab left showing the file (closed during the merge), only the disk is written. A failed
 * write throws before anything is recorded or changed.
 */
export async function applyConflictMerge(
  filePath: string,
  merged: string,
): Promise<void> {
  await writeFile(filePath, merged);
  // §71 A conflict-merge write is a real content change.
  useSnapshotStore.getState().markPendingAutoSnapshot();
  const editorStore = useEditorStore.getState();
  const tab = editorStore.tabs.find((t) => t.filePath === filePath);
  if (!tab) return;
  const fileStore = useFileStore.getState();
  fileStore.setFileContent(filePath, merged);
  fileStore.updateLastSaveMtime(filePath, Date.now(), merged);
  if (
    !isMarkdownFile(filePath) ||
    editorStore.sourceModeTabs.includes(tab.id)
  ) {
    editorStore.sourceBufferAccess?.setSourceBuffer(tab.id, merged);
    editorStore.markSourceEdited(tab.id, false);
  } else if (tab.id === editorStore.activeTabId) {
    editorStore.requestContentRefresh("fresh", filePath);
  } else {
    editorStore.markContentStale(tab.id);
  }
  useEditorStore.getState().markDirty(tab.id, false);
}

/**
 * The local side of a merge: the text of the tab that shows `filePath`, wherever its document is
 * (`locateOpenTabSurface`) — its source buffer for a source-mode or non-markdown tab, the editor that
 * holds it, its keep-alive editor, its tab-switch cache, or its `openFiles` text when only that is to be
 * trusted (a load still filling the tab reads that text too). A cache whose text says something else is
 * still the tab's document: what went to the disk and the text only is on the other side of the merge,
 * from the disk. `editor` is the active editor, read only with no surface access registered. `null`
 * when no tab shows the file, or nothing holds its text.
 */
export function conflictLocalText(
  filePath: string,
  editor: Editor | null,
): null | string {
  const { documentSurfaceAccess, sourceBufferAccess, sourceModeTabs, tabs } =
    useEditorStore.getState();
  const tab = tabs.find((t) => t.filePath === filePath);
  if (!tab) return null;
  if (!isMarkdownFile(filePath) || sourceModeTabs.includes(tab.id)) {
    return sourceBufferAccess?.getSourceBuffer(tab.id) ?? null;
  }
  const text = useFileStore.getState().openFiles.get(filePath) ?? null;
  if (documentSurfaceAccess === null) {
    return editor && editorHoldsWholeDocument(tab.id)
      ? serializeLiveDoc(editor)
      : text;
  }
  const surface = locateOpenTabSurface(tab.id, liveViewOf(tab.id));
  switch (surface.kind) {
    case "cache":
      return serializeEditorState(surface.state);
    case "keepalive":
      return serializeLiveDoc(surface.editor);
    case "source":
      return surface.access?.getSourceBuffer(tab.id) ?? null;
    case "text":
      return text;
    case "view":
      return serializeEditorState(surface.view.state);
  }
}

/**
 * The base of the merge for a conflict on `filePath`: the disk text the tab's text descends from
 * (`diskTexts`), or `null` with no record. Not `openFiles`: a tab left with unsaved edits puts them
 * there, and so do the in-app writes into a tab's document — with those in the base, the merge reads
 * the edits as unchanged on the local side and takes the other program's text for them without asking.
 */
export function mergeBaseOf(filePath: string): null | string {
  return useFileStore.getState().diskTexts.get(filePath) ?? null;
}

/**
 * The merge to show when there is no base to merge against — none recorded, or an empty one. The
 * 3-way merge reads an empty base as two insertions at the same place and keeps both, one after the
 * other, without asking (`merge_texts` in src-tauri/src/snapshot/merge.rs). So the whole file is one
 * question instead, unless the two sides already agree. Split at "\n" and joined back with it, each
 * side's text stays as it is.
 */
export function mergeWithoutBase(local: string, external: string): MergeResult {
  if (local === external) {
    return {
      finalNewline: false,
      lineEnding: "\n",
      segments: [{ kind: "unchanged", lines: local.split("\n") }],
    };
  }
  return {
    finalNewline: false,
    lineEnding: "\n",
    segments: [
      {
        base: [],
        external: external.split("\n"),
        kind: "conflict",
        local: local.split("\n"),
      },
    ],
  };
}

/**
 * Reads `filePath` and records what it holds as its disk text (`diskTexts`) — after "Keep Local Edits",
 * when the disk holds the other program's text and the user chose to keep their edits over it, so a
 * later merge counts its lines as declined rather than as the other side's new change. `declinedMtime`
 * is the mtime of the change the user answered: if another change has been reported since, the read may
 * have found that one, which nobody declined, and nothing is recorded (a change reported only after the
 * read is not caught). Only while a tab shows the file, as the record is kept for those.
 */
export async function noteDiskTextFromRead(
  filePath: string,
  declinedMtime: number,
): Promise<void> {
  try {
    const text = await readFile(filePath);
    const reported = useFileStore.getState().getFileMtime(filePath);
    if ((reported?.canReloadMtime ?? 0) !== declinedMtime) return;
    if (useEditorStore.getState().tabs.some((t) => t.filePath === filePath)) {
      useFileStore.getState().noteDiskText(filePath, text);
    }
  } catch (err) {
    logger.warn("[conflict] could not read the file after the choice", err);
  }
}
