// §5.1/§287 Preview ↔ source toggle for HTML / plugin-previewed text tabs,
// with Cmd+/ routing to the markdown source-mode toggle otherwise.
import { useCallback } from "react";

import { writeFile } from "../ipc/invoke";
import { matchFileViewer, usePluginUIStore } from "../plugins/plugin-ui-store";
import { isFileTab, useEditorStore } from "../stores/editor/editor";
import { useSnapshotStore } from "../stores/editor/snapshot";
import { useFileStore } from "../stores/file/file";
import { asTabSave } from "../utils/editor/tab-save-in-flight";
import {
  isBinaryViewerFile,
  isHtmlFile,
  isMarkdownFile,
} from "../utils/file-type";

interface UsePreviewSourceViewParams {
  getSourceBuffer: (tabId: string) => string;
  markDirty: (tabId: string, dirty: boolean) => void;
  toggleSourceMode: () => void;
}

interface UsePreviewSourceViewReturn {
  handleToggleSourceMode: () => void;
  toggleHtmlView: () => void;
}

export function usePreviewSourceView({
  getSourceBuffer,
  markDirty,
  toggleSourceMode,
}: UsePreviewSourceViewParams): UsePreviewSourceViewReturn {
  // Toggle rendered preview ↔ raw source for the active HTML / plugin-viewed text tab. The set
  // it changes is the store's `previewSourceTabs` (§392), and each direction sets it explicitly
  // rather than flipping it — see the preview → source branch.
  const toggleHtmlView = useCallback(() => {
    const {
      activeTabId: tabId,
      previewSourceTabs,
      setPreviewSourceForTab,
      tabs: currentTabs,
    } = useEditorStore.getState();
    const tab = currentTabs.find((t) => t.id === tabId);
    if (!tab || !isFileTab(tab) || !isPreviewToggleFile(tab.filePath)) return;

    if (!previewSourceTabs.includes(tab.id)) {
      // §392 spec 0071 §6.6 (D16) — preview → source. The code surface reads the buffer IN
      // RENDER, so a change an editable viewer has not handed over yet is taken here, before
      // the store changes. A take that fails has already switched the tab (§7.4); setting it
      // again below is then a no-op — a flip would switch it back.
      getSourceBuffer(tab.id);
      setPreviewSourceForTab(tab.id, true);
      return;
    }

    // Source → preview. An HTML preview (and a draw-only viewer) loads the file from disk
    // (asset: protocol), so unsaved edits are flushed first — the mtime bump then reloads it
    // with the fresh content. An editing viewer mounts from the buffer instead (§392 §6.1).
    if (tab.isDirty && tab.filePath) {
      const filePath = tab.filePath;
      const content = getSourceBuffer(tab.id);
      void asTabSave(filePath, tab.id, () => writeFile(filePath, content))
        .then((savedAt) => {
          useFileStore
            .getState()
            .updateLastSaveMtime(filePath, savedAt ?? Date.now());
          // §3.5 (#798) · §392 spec 0071 D17 — the cache and dirty follow the write only while the
          // buffer still holds what was written: text typed while the write ran is not on disk,
          // and the preview this toggle puts up can be an editing mount whose change, reported
          // during the write, may already have been taken by another read (a zoom tick), leaving
          // D15 no mark to refuse on. This read takes a change still pending, so it is compared too.
          if (getSourceBuffer(tab.id) !== content) return;
          useFileStore.getState().setFileContent(filePath, content);
          markDirty(tab.id, false);
          useSnapshotStore.getState().markPendingAutoSnapshot();
        })
        .catch(() => {
          // Save failed — keep dirty state; preview shows last saved version
        });
    }
    setPreviewSourceForTab(tab.id, false);
  }, [getSourceBuffer, markDirty]);

  // Cmd+/ — route to the preview/source toggle when an HTML or plugin-viewed
  // text tab is active; otherwise fall through to the markdown source-mode
  // toggle.
  const handleToggleSourceMode = useCallback(() => {
    const { activeTabId: tabId, tabs: currentTabs } = useEditorStore.getState();
    const tab = currentTabs.find((t) => t.id === tabId);
    if (tab && isFileTab(tab) && isPreviewToggleFile(tab.filePath)) {
      toggleHtmlView();
      return;
    }
    toggleSourceMode();
  }, [toggleHtmlView, toggleSourceMode]);

  return { handleToggleSourceMode, toggleHtmlView };
}

// A tab that toggles between rendered preview and raw source: HTML (built-in
// iframe preview) or any TEXT file a viewer plugin claims (e.g. SVG via the
// built-in media-viewer). Binary files never toggle — they have no source
// view. Reads the plugin registry non-reactively: callers are user-action
// callbacks, and the render path derives the same answer reactively.
function isPreviewToggleFile(filePath: string | undefined): boolean {
  if (!filePath || isMarkdownFile(filePath) || isBinaryViewerFile(filePath)) {
    return false;
  }
  if (isHtmlFile(filePath)) return true;
  return !!matchFileViewer(usePluginUIStore.getState().fileViewers, filePath);
}
