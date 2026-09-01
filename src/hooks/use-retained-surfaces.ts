// §286/§298 vim §8 / §260 Phase 4b — the active tab's surface computation
// (`resolveSurfaceKind`), the retained-tabs mount set built on top of it, the
// per-surface renderer bundle, and the editor-surface-blocked gate that all
// read off the same answer.
import { useEffect, useMemo } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { PdfFindApi } from "../components/editor/pdf/use-pdf-find";
import type { PluginFileViewer } from "../plugins/plugin-ui-store";
import type { EditorTab } from "../stores/editor/editor";
import type { SurfaceKind } from "../utils/editor/surface-kind";
import type { Editor } from "@tiptap/react";

import {
  createTabSurfaceRenderers,
  type TabSurfaceRenderers,
} from "../components/editor/tab-surface-renderers";
import {
  type EditorMode,
  editorModeForSurfaceKind,
  vimSurfaceForMode,
} from "../components/layout/StatusBar";
import { setWysiwygVimStatusOwner } from "../extensions/plugins/vim/vim-status";
import { pluginLoader } from "../plugins/plugin-loader";
import { matchFileViewer } from "../plugins/plugin-ui-store";
import { isFileTab, useEditorStore } from "../stores/editor/editor";
import { editorSurfaceBlockReason } from "../utils/editor/active-tab";
import { resolveSurfaceKind } from "../utils/editor/surface-kind";
import { getLanguageForFile } from "../utils/file-type";
import { type RetainedEntry, useRetainedTabs } from "./use-retained-tabs";

interface UseRetainedSurfacesParams {
  activeEditor: Editor | null;
  activeTab: EditorTab | undefined;
  activeTabId: null | string;
  fileViewers: PluginFileViewer[];
  getSourceBuffer: (tabId: string) => string;
  handleTogglePdfFind: () => void;
  hasSourceBuffer: (tabId: string) => boolean;
  htmlSourceTabs: ReadonlySet<string>;
  isCodeFile: boolean;
  isHtmlSourceView: boolean;
  isPdfTab: boolean;
  isSourceMode: boolean;
  markDirty: (tabId: string, dirty: boolean) => void;
  pdfFindOpen: boolean;
  rootPath: null | string;
  scrollOffsets: MutableRefObject<Map<string, number>>;
  setPdfFindApi: Dispatch<SetStateAction<null | PdfFindApi>>;
  setSourceBuffer: (tabId: string, content: string) => void;
  sourceCursorOffsetFor: (tabId: string) => number;
  sourceModeTabs: ReadonlySet<string>;
}

interface UseRetainedSurfacesReturn {
  isMarkdownSurfaceActive: boolean;
  retainedTabs: RetainedEntry[];
  statusBarMode: EditorMode;
  surfaceKind: SurfaceKind;
  tabSurfaceRenderers: TabSurfaceRenderers;
}

export function useRetainedSurfaces({
  activeEditor,
  activeTab,
  activeTabId,
  fileViewers,
  getSourceBuffer,
  handleTogglePdfFind,
  hasSourceBuffer,
  htmlSourceTabs,
  isCodeFile,
  isHtmlSourceView,
  isPdfTab,
  isSourceMode,
  markDirty,
  pdfFindOpen,
  rootPath,
  scrollOffsets,
  setPdfFindApi,
  setSourceBuffer,
  sourceCursorOffsetFor,
  sourceModeTabs,
}: UseRetainedSurfacesParams): UseRetainedSurfacesReturn {
  // §286/§298 vim §8 — ONE surface computation (`resolveSurfaceKind`, `utils/editor/
  // surface-kind.ts`) now feeds the StatusBar, the wysiwyg status owner below, the
  // `isMarkdownSurfaceActive` gate, and the render chain further down — a single answer to
  // "what is the active tab showing" instead of four hand-written chains that had to agree.
  const surfaceKind: SurfaceKind = resolveSurfaceKind({
    activeTabId,
    fileViewers,
    isHtmlSourceView,
    isSourceMode,
    rootPath,
    tab: activeTab,
  });
  // Only the wysiwyg surface appoints an owner: the source surface (markdown source mode
  // AND non-markdown code tabs) has its own feeder, and graph/preview/plugin own no vim
  // surface — a hidden Tiptap view update must never overwrite them (S5-a review).
  const statusBarMode: EditorMode = editorModeForSurfaceKind(surfaceKind);
  useEffect(() => {
    setWysiwygVimStatusOwner(
      vimSurfaceForMode(statusBarMode) === "wysiwyg" ? activeEditor : null,
    );
  }, [activeEditor, statusBarMode]);

  // §285 유지 집합 — 마운트를 유지할 탭과 그 표면 종류.
  //
  // `pluginPreviewTabs`를 여기서 만드는 이유: 뷰어 레지스트리를 아는 것은 App뿐이다.
  // SVG처럼 **텍스트인데 플러그인이 그리는** 파일은 판정 함수만 보면 `code`로 떨어지는데,
  // 프리뷰 상태에서는 유지 대상이 아니다(§290에서 플러그인 뷰어를 제외했다).
  const tabs = useEditorStore((s) => s.tabs);
  const pluginPreviewTabs = useMemo(() => {
    const set = new Set<string>();
    for (const t of tabs) {
      if (isFileTab(t) && matchFileViewer(fileViewers, t.filePath)) {
        set.add(t.id);
      }
    }
    return set;
  }, [tabs, fileViewers]);
  const tabSurfaceRenderers = useMemo(
    () =>
      createTabSurfaceRenderers({
        codeLanguageFor: (filePath) =>
          getLanguageForFile(filePath) ?? undefined,
        getSourceBuffer,
        hasSourceBuffer,
        markDirty,
        onPdfFindApiChange: setPdfFindApi,
        onTogglePdfFind: handleTogglePdfFind,
        pdfFindOpen,
        scrollOffsets,
        pluginIdFor: (tabId) =>
          useEditorStore.getState().tabs.find((t) => t.id === tabId)
            ?.pluginId ?? "",
        setSourceBuffer,
        sourceCursorOffsetFor,
      }),
    [
      getSourceBuffer,
      hasSourceBuffer,
      handleTogglePdfFind,
      markDirty,
      pdfFindOpen,
      scrollOffsets,
      setPdfFindApi,
      setSourceBuffer,
      sourceCursorOffsetFor,
    ],
  );

  // §286 MRU는 스토어가 관리한다(touchMru). 유지 집합은 그 순서의 순수 함수여야 한다 —
  // 렌더 도중 직전 결과를 기억하던 구현이 표면을 반복 재마운트했다(use-retained-tabs.ts).
  const mruOrder = useEditorStore((s) => s.mruOrder);
  const retainedTabs = useRetainedTabs(
    mruOrder,
    tabs,
    sourceModeTabs,
    htmlSourceTabs,
    pluginPreviewTabs,
  );

  // §286 마크다운 표면이 지금 보여야 하는가.
  //
  // 예전엔 아래 render 삼항 사슬의 마지막 else 조건을 손으로 그대로 부정한 별도 식이었다 —
  // "새 갈래를 추가하면 여기도 고쳐야 한다"는 사람이 지켜야 하는 계약이었던 것을,
  // `surfaceKind`가 단일 판정으로 대체했다(우선순위·이력은 `resolveSurfaceKind` docblock 참조).
  const isMarkdownSurfaceActive = surfaceKind === "markdown";

  // §260 Phase 4b — the policy and its rationale now live in `editorSurfaceBlockReason`, with
  // tests. It moved out because nothing imports `App`, so this gate was unverified.
  useEffect(() => {
    pluginLoader.setEditorSurfaceBlocked(
      editorSurfaceBlockReason({
        activeTab,
        isCodeFile,
        isPdfTab,
        isSourceMode,
      }),
    );
  }, [activeTab, isCodeFile, isPdfTab, isSourceMode]);

  return {
    isMarkdownSurfaceActive,
    retainedTabs,
    statusBarMode,
    surfaceKind,
    tabSurfaceRenderers,
  };
}
