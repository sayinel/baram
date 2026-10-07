// §392 spec 0071 — App's wiring of what an editing mount touches, without App (nothing imports
// App, and it builds the whole editor — plan 0121 P14). The buffer and the take
// (`useSourceMode`), the re-arm (`useCodeAutoSave`), the preview ↔ source toggle
// (`usePreviewSourceView`), the save paths (`useFileOperations`), the surface decision
// (`useActiveTabSurface` + `resolveSurfaceKind`) and the host are the real ones. Two pieces of
// App are stood in for, and a third is written out again here rather than imported:
// - the retained code surface, by `CodeProbe`, which reads the buffer IN RENDER the way
//   `tab-surface-renderers.tsx` passes `content={deps.getSourceBuffer(tabId)}` — the read D16
//   is about;
// - the tab activation's buffer fill (`use-tab-switching.ts`), by `fill` in
//   `viewer-edit-fixtures.ts`, which a test calls itself — this harness switches no tabs;
// - EditorArea's branch condition for when the host is drawn (`kind` is `image` or `preview`
//   and the tab has a plugin viewer), re-implemented in the component below, with the two
//   inputs App would supply fixed: `isSourceMode: false` and `rootPath: "/v"`.
// A test file using this mocks `ipc/invoke` and `@tauri-apps/api/core` itself.
import { useMemo } from "react";

import type { HarnessApi } from "./viewer-edit-fixtures";
import type { Editor } from "@tiptap/core";

import { useActiveTabSurface } from "../../../hooks/use-active-tab-surface";
import { useCodeAutoSave } from "../../../hooks/use-code-auto-save";
import { useFileOperations } from "../../../hooks/use-file-operations";
import { usePreviewSourceView } from "../../../hooks/use-preview-source-view";
import { useSourceMode } from "../../../hooks/use-source-mode";
import { resolveSurfaceKind } from "../../../utils/editor/surface-kind";
import { PluginViewerHost } from "../PluginViewerHost";

/** The editor `useFileOperations` is handed. Saving a code tab never serializes it. */
const NO_EDITOR = {} as unknown as Editor;

interface ViewerEditHarnessProps {
  /** Called with App's handlers on every render — the test presses them through its probe. */
  expose: (api: HarnessApi) => void;
  /** Called on each render of the code-surface stand-in. */
  onCodeRender: () => void;
  /** Called on each render of the harness root — "the app rendered". */
  onRender: () => void;
}

export function ViewerEditHarness({
  expose,
  onCodeRender,
  onRender,
}: ViewerEditHarnessProps) {
  onRender();
  const surface = useActiveTabSurface();
  const {
    bufferVersion,
    getSourceBuffer,
    hasSourceBuffer,
    sourceModeTabs,
    toggleSourceMode,
  } = useSourceMode({ editor: null });
  const { rearmForViewerEdit } = useCodeAutoSave({
    bufferVersion,
    getSourceBuffer,
    isEditableTextFile: surface.isEditableTextFile,
    markDirty: surface.markDirty,
    sourceModeTabs,
  });
  const { toggleHtmlView } = usePreviewSourceView({
    getSourceBuffer,
    markDirty: surface.markDirty,
    toggleSourceMode,
  });
  const fileOps = useFileOperations({
    editor: NO_EDITOR,
    getSourceBuffer,
    sourceModeTabs,
  });
  expose({ fileOps, toggle: toggleHtmlView });
  const viewerEdit = useMemo(
    () => ({
      getSourceBuffer,
      hasSourceBuffer,
      rearmAutoSave: rearmForViewerEdit,
    }),
    [getSourceBuffer, hasSourceBuffer, rearmForViewerEdit],
  );

  const {
    activeTab,
    activeTabFilePath,
    activeTabId,
    fileViewers,
    isHtmlSourceView,
    pluginViewer,
    previewFileMtime,
  } = surface;
  const kind = resolveSurfaceKind({
    activeTabId,
    fileViewers,
    isHtmlSourceView,
    isSourceMode: false,
    rootPath: "/v",
    tab: activeTab,
  });
  if (
    (kind === "image" || kind === "preview") &&
    pluginViewer &&
    activeTabId &&
    activeTabFilePath
  ) {
    return (
      <PluginViewerHost
        edit={viewerEdit}
        filePath={activeTabFilePath}
        refreshKey={previewFileMtime}
        tabId={activeTabId}
        viewer={pluginViewer}
      />
    );
  }
  if (kind === "source" && activeTabId) {
    return (
      <CodeProbe
        onRender={onCodeRender}
        read={getSourceBuffer}
        tabId={activeTabId}
      />
    );
  }
  return null;
}

/** The retained code surface's one read that matters here: the buffer, in render. */
function CodeProbe({
  onRender,
  read,
  tabId,
}: {
  onRender: () => void;
  read: (tabId: string) => string;
  tabId: string;
}) {
  onRender();
  return <pre className="code-probe">{read(tabId)}</pre>;
}
