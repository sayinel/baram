// §69/§89 Active-tab file-type derivations — the active tab's id/path/object
// plus every file-type flag the render branches, `resolveSurfaceKind`, and the
// retained-tabs set read off it.
import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { PluginFileViewer } from "../plugins/plugin-ui-store";
import type { EditorTab } from "../stores/editor/editor";

import { useShallow } from "zustand/shallow";

import { matchFileViewer, usePluginUIStore } from "../plugins/plugin-ui-store";
import { isFileTab, useEditorStore } from "../stores/editor/editor";
import { useFileStore } from "../stores/file/file";
import {
  isBinaryViewerFile,
  isHtmlFile,
  isImageFile,
  isMarkdownFile,
  isPdfFile,
} from "../utils/file-type";

interface UseActiveTabSurfaceReturn {
  activeTab: EditorTab | undefined;
  activeTabFilePath: null | string;
  activeTabId: null | string;
  fileViewers: PluginFileViewer[];
  htmlSourceTabs: ReadonlySet<string>;
  isCodeFile: boolean;
  isEditableTextFile: boolean;
  isHtmlSourceView: boolean;
  isHtmlTab: boolean;
  isImageTab: boolean;
  isPdfTab: boolean;
  isPluginPreviewTab: boolean;
  markDirty: (tabId: string, dirty: boolean) => void;
  pluginViewer: null | PluginFileViewer;
  previewFileMtime: number;
  rootPath: null | string;
  setHtmlSourceTabs: Dispatch<SetStateAction<Set<string>>>;
}

export function useActiveTabSurface(): UseActiveTabSurfaceReturn {
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const activeTabFilePath = useEditorStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab && isFileTab(tab) ? tab.filePath : null;
  });
  // The whole tab, not a boolean: `editorSurfaceBlockReason` asks `isFileTab` itself, which is
  // what makes "a tab kind that does not exist yet is blocked" a property of the tested
  // function rather than of this untested component.
  const activeTab = useEditorStore(
    useShallow((s) => s.tabs.find((t) => t.id === s.activeTabId)),
  );
  const markDirty = useEditorStore((s) => s.markDirty);
  const rootPath = useFileStore((s) => s.rootPath);

  // Derived: non-markdown code file detection for rendering branch
  const isCodeFile = !!activeTabFilePath && !isMarkdownFile(activeTabFilePath);
  // ‼️ "Not markdown" is NOT the same question as "may the text editor write this".
  // `isCodeFile` answers the first — a PDF passes it, because a PDF is not markdown —
  // and the non-markdown auto-save effect below used it as if it answered the second,
  // so a PDF that went dirty was a PDF about to be overwritten with
  // `sourceContentRef.current`. `autoSave` defaults to true, so that path was live.
  //
  // Named rather than inlined at the one call site on purpose: the next effect that
  // writes files must be able to ask this question by name instead of rediscovering it.
  // Guarding call sites one by one is what leaves the following one exposed.
  const isEditableTextFile =
    isCodeFile && !isBinaryViewerFile(activeTabFilePath);

  // PDF file viewer — read-only, built-in (PDF.js)
  const isPdfTab = !!activeTabFilePath && isPdfFile(activeTabFilePath);
  // Raster images — binary, rendered by a "viewer" plugin (built-in
  // media-viewer). The binary guards hold with or without a plugin.
  const isImageTab = !!activeTabFilePath && isImageFile(activeTabFilePath);

  // Plugin-registered file viewer matching the active tab (§69 "viewer")
  const fileViewers = usePluginUIStore((s) => s.fileViewers);
  const pluginViewer = matchFileViewer(
    fileViewers,
    activeTabFilePath ?? undefined,
  );
  // Text files a plugin claims (e.g. SVG) get the same preview ↔ source
  // toggle as HTML; binary files (images) are preview-only.
  const isPluginPreviewTab =
    !!pluginViewer && isCodeFile && !isPdfTab && !isImageTab;

  // HTML file viewer — rendered preview (default) vs raw source, tracked
  // per tab so toggling one tab doesn't affect others.
  const isHtmlTab = !!activeTabFilePath && isHtmlFile(activeTabFilePath);
  const [htmlSourceTabs, setHtmlSourceTabs] = useState<Set<string>>(
    () => new Set(),
  );
  const isHtmlSourceView = !!activeTabId && htmlSourceTabs.has(activeTabId);

  // Viewers reload whenever the file's saved/reloaded mtime bumps
  // (manual save, auto-save, toggle-flush, or external auto-reload)
  const previewFileMtime = useFileStore((s) =>
    (isHtmlTab || isPdfTab || isImageTab || isPluginPreviewTab) &&
    activeTabFilePath
      ? (s.fileMtimes.get(activeTabFilePath)?.lastSaveMtime ?? 0)
      : 0,
  );

  return {
    activeTab,
    activeTabFilePath,
    activeTabId,
    fileViewers,
    htmlSourceTabs,
    isCodeFile,
    isEditableTextFile,
    isHtmlSourceView,
    isHtmlTab,
    isImageTab,
    isPdfTab,
    isPluginPreviewTab,
    markDirty,
    pluginViewer,
    previewFileMtime,
    rootPath,
    setHtmlSourceTabs,
  };
}
