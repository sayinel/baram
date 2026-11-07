// §39 A reload that arrives while a tab's document is on its way has nowhere to go: the editor does
// not hold that document yet, and the install on its way carries the text from before the reload.
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { liveViewOf } from "../../utils/editor/open-tab-surface";
import { patchEditorContent } from "../../utils/editor/patch-editor-content";

/**
 * Called when a tab's content has been installed in an editor. The stale flag on the active tab
 * means a reload came during the install (`reloadReachesDocument`, `sync-open-surfaces.ts`): a flag
 * set before it was consumed when the switch began. So the document takes the text now, as one
 * transaction, which leaves the undo history alone.
 */
export function rereadMissedReload(tabId: string): void {
  const { activeTabId, clearContentStale, staleContentTabs, tabs } =
    useEditorStore.getState();
  if (tabId !== activeTabId || !staleContentTabs.includes(tabId)) return;
  clearContentStale(tabId);
  const tab = tabs.find((t) => t.id === tabId);
  const text = tab
    ? useFileStore.getState().openFiles.get(tab.filePath || tabId)
    : undefined;
  const view = liveViewOf(tabId);
  if (view && text !== undefined) patchEditorContent(view, text);
}
