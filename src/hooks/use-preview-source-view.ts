// §5.1/§287 Preview ↔ source toggle for HTML / plugin-previewed text tabs,
// with Cmd+/ routing to the markdown source-mode toggle otherwise.
import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";

import { writeFile } from "../ipc/invoke";
import { matchFileViewer, usePluginUIStore } from "../plugins/plugin-ui-store";
import { isFileTab, useEditorStore } from "../stores/editor/editor";
import { useSnapshotStore } from "../stores/editor/snapshot";
import { useFileStore } from "../stores/file/file";
import {
  isBinaryViewerFile,
  isHtmlFile,
  isMarkdownFile,
} from "../utils/file-type";

interface UsePreviewSourceViewParams {
  getSourceBuffer: (tabId: string) => string;
  htmlSourceTabs: ReadonlySet<string>;
  markDirty: (tabId: string, dirty: boolean) => void;
  setHtmlSourceTabs: Dispatch<SetStateAction<Set<string>>>;
  toggleSourceMode: () => void;
}

interface UsePreviewSourceViewReturn {
  handleToggleSourceMode: () => void;
  toggleHtmlView: () => void;
}

export function usePreviewSourceView({
  getSourceBuffer,
  htmlSourceTabs,
  markDirty,
  setHtmlSourceTabs,
  toggleSourceMode,
}: UsePreviewSourceViewParams): UsePreviewSourceViewReturn {
  // Toggle rendered preview ↔ raw source for the active HTML / plugin-viewed
  // text tab. The preview loads the file from disk (asset: protocol), so when
  // leaving source view with unsaved edits, flush them first — the mtime bump
  // then reloads the preview with the fresh content.
  const toggleHtmlView = useCallback(() => {
    const { activeTabId: tabId, tabs: currentTabs } = useEditorStore.getState();
    const tab = currentTabs.find((t) => t.id === tabId);
    if (!tab || !isFileTab(tab) || !isPreviewToggleFile(tab.filePath)) return;
    const leavingSourceView = htmlSourceTabs.has(tab.id);
    if (leavingSourceView && tab.isDirty && tab.filePath) {
      const filePath = tab.filePath;
      const content = getSourceBuffer(tab.id);
      void writeFile(filePath, content)
        .then(() => {
          useFileStore.getState().updateLastSaveMtime(filePath, Date.now());
          useFileStore.getState().setFileContent(filePath, content);
          markDirty(tab.id, false);
          useSnapshotStore.getState().markPendingAutoSnapshot();
        })
        .catch(() => {
          // Save failed — keep dirty state; preview shows last saved version
        });
    }
    setHtmlSourceTabs((prev) => {
      const next = new Set(prev);
      if (next.has(tab.id)) next.delete(tab.id);
      else next.add(tab.id);
      return next;
    });
  }, [htmlSourceTabs, markDirty, getSourceBuffer, setHtmlSourceTabs]);

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
