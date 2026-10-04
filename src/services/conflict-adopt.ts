// §3.6 Put the file's text into ONE tab — the conflicted one — after a conflict
// action wrote it (Apply) or read it (Reload).
//
// The active tab's document is installed into its live view right here, not by
// a content-refresh request. That request is served by a passive effect; a tab
// switch landing in between would make the outgoing-tab handling write the old
// document into the cache and `openFiles` and clear the stale mark, leaving a
// clean tab whose screen and cache disagree with the disk.
import type { Editor } from "@tiptap/core";

import { useEditorStore } from "../stores/editor/editor";
import { useFileStore } from "../stores/file/file";
import { installFreshDocument } from "../utils/editor/install-fresh-document";
import {
  isTabLoading,
  loadedTabId,
  markBaselinePending,
} from "../utils/editor/programmatic-update";
import { isMarkdownFile } from "../utils/file-type";

/**
 * Whether `adoptDiskTextIntoTab` has somewhere to put the text. Callers ask
 * before they change anything on disk or in the stores.
 *
 * - a loading tab: no — a progressive load would keep appending old blocks;
 * - a background tab: yes — it is marked stale and re-reads the text on return;
 * - the active tab on a source surface with a buffer: yes, the buffer;
 * - the active markdown tab with a live view (complete keep-alive editor, or
 *   the shared editor while it holds this tab): yes;
 * - the active markdown tab with no such view: no — a stale mark is not read
 *   until a switch, and that switch writes the old document first.
 */
export function adoptable(tabId: string): boolean {
  if (isTabLoading(tabId)) return false;
  const { activeTabId, sourceBufferAccess, tabs } = useEditorStore.getState();
  const tab = tabs.find((t) => t.id === tabId);
  if (!tab) return false;
  if (activeTabId !== tabId) return true;
  if (onSourceSurface(tabId, tab.filePath)) {
    return sourceBufferAccess?.hasSourceBuffer?.(tabId) === true;
  }
  return liveViewOf(tabId) !== null;
}

/**
 * Make `text` the tab's saved content: the cache, the buffer of a source
 * surface, clean flags, and the document — installed into the live view of an
 * active tab, or marked stale for a background one. Flags are cleared BEFORE
 * the install so the first transaction after it captures the baseline against
 * a clean tab. Returns false (and changes nothing) when `adoptable` is false.
 */
export function adoptDiskTextIntoTab(
  tabId: string,
  path: string,
  text: string,
): boolean {
  if (!adoptable(tabId)) return false;
  const editorStore = useEditorStore.getState();
  useFileStore.getState().setFileContent(path, text);
  if (onSourceSurface(tabId, path)) {
    editorStore.sourceBufferAccess?.setSourceBuffer(tabId, text);
  }
  editorStore.markDirty(tabId, false);
  editorStore.markSourceEdited(tabId, false);

  if (editorStore.activeTabId !== tabId) {
    editorStore.markContentStale(tabId);
    return true;
  }
  // A markdown tab in source mode keeps its ProseMirror view alive underneath;
  // it gets the text too, so it does not keep the document from before.
  const view = isMarkdownFile(path) ? liveViewOf(tabId) : null;
  if (view) {
    installFreshDocument(view, text);
    markBaselinePending(tabId);
  }
  return true;
}

/** The live editor that holds this tab's document, if any. */
function liveViewOf(tabId: string): Editor | null {
  const access = useEditorStore.getState().documentSurfaceAccess;
  if (!access) return null;
  const pooled = access.keepaliveEditor(tabId);
  if (pooled && !pooled.isDestroyed && access.isKeepaliveComplete(tabId)) {
    return pooled;
  }
  if (loadedTabId() === tabId && !access.editor.isDestroyed) {
    return access.editor;
  }
  return null;
}

function onSourceSurface(tabId: string, path: string): boolean {
  return (
    !isMarkdownFile(path) ||
    useEditorStore.getState().sourceModeTabs.includes(tabId)
  );
}
