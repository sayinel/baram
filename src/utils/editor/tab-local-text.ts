// §3.6 A tab's own unsaved text, read wherever its document lives.
//
// The conflict modal acts on the tab whose file changed, which is often not the
// active one. Serializing the shared editor reads whatever document is installed
// there — another tab's, when the conflicted tab is in the background. This
// reads the tab's text from the surface that holds it, in the authority order of
// the block ID rename landing (`block-id-rename-landing.ts`, `land`), and says
// "unavailable" instead of inventing an empty string when it cannot.
import { isFileTab, useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { isBinaryViewerFile, isMarkdownFile } from "../file-type";
import { isTabLoading, loadedTabId } from "./programmatic-update";
import { serializeEditorState, serializeLiveDoc } from "./serialize-live-doc";

export type TabLocalText =
  | { filePath: string; kind: "text"; tabId: string; text: string }
  | { kind: "unavailable"; reason: UnavailableReason; tabId: string };

export type UnavailableReason =
  | "ambiguous"
  | "binary"
  | "loading"
  | "no-surface"
  | "no-tab"
  | "no-text"
  | "source-unreachable";

/**
 * The text the tab would save right now, or why it cannot be read yet.
 *
 * Order (each step only when the ones above did not decide):
 * 1. no file tab → `no-tab`; 2. a binary viewer → `binary`; 3. another tab
 * holds the same path → `ambiguous`; 4. a source surface (code file, or
 * markdown in source mode) → its buffer, or `source-unreachable` when the
 * buffer does not exist; 5. a load still appending → `loading`; 6. a stale tab
 * or an incomplete keep-alive entry → the cached file text; 7. no registered
 * document surfaces → `no-surface`; 8. a complete keep-alive editor; 9. the
 * shared editor while it holds this tab (`loadedTabId`) — after 8, because a
 * keep-alive resume also marks its tab loaded while the shared editor holds
 * something else; 10. the cached EditorState; 11. the cached file text.
 */
export function readTabLocalText(tabId: string): TabLocalText {
  const editorStore = useEditorStore.getState();
  const tab = editorStore.tabs.find((t) => t.id === tabId);
  const unavailable = (reason: UnavailableReason): TabLocalText => ({
    kind: "unavailable",
    reason,
    tabId,
  });
  if (!isFileTab(tab) || !tab.filePath) return unavailable("no-tab");
  const filePath = tab.filePath;
  const found = (text: string): TabLocalText => ({
    filePath,
    kind: "text",
    tabId,
    text,
  });
  const fileText = (): TabLocalText => {
    const text = useFileStore.getState().openFiles.get(filePath);
    return text === undefined ? unavailable("no-text") : found(text);
  };

  if (isBinaryViewerFile(filePath)) return unavailable("binary");
  if (editorStore.tabs.some((t) => t.id !== tabId && t.filePath === filePath)) {
    return unavailable("ambiguous");
  }

  const { documentSurfaceAccess: access, sourceBufferAccess } = editorStore;
  if (!isMarkdownFile(filePath) || editorStore.sourceModeTabs.includes(tabId)) {
    // Without `hasSourceBuffer` a missing buffer would read as "" — unsaved
    // text replaced by nothing. Missing is unavailable, never empty.
    if (sourceBufferAccess?.hasSourceBuffer?.(tabId) !== true) {
      return unavailable("source-unreachable");
    }
    return found(sourceBufferAccess.getSourceBuffer(tabId));
  }

  if (isTabLoading(tabId)) return unavailable("loading");

  const pooled = access?.keepaliveEditor(tabId) ?? null;
  if (
    editorStore.staleContentTabs.includes(tabId) ||
    (pooled !== null && access !== null && !access.isKeepaliveComplete(tabId))
  ) {
    return fileText();
  }

  if (access === null) return unavailable("no-surface");

  if (pooled && !pooled.isDestroyed) return found(serializeLiveDoc(pooled));

  if (loadedTabId() === tabId && !access.editor.isDestroyed) {
    return found(serializeLiveDoc(access.editor));
  }

  const cached = access.editorStateCache.get(tabId);
  if (cached) return found(serializeEditorState(cached));

  return fileText();
}
