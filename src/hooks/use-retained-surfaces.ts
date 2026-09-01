// §286/§298 vim §8 / §260 Phase 4b — the active tab's surface computation
// (`resolveSurfaceKind`), the retained-tabs mount set built on top of it, the
// per-surface renderer bundle, and the editor-surface-blocked gate that all
// read off the same answer.
import { useEffect, useMemo } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { PdfFindApi } from "../components/editor/pdf/use-pdf-find";
import type { SurfaceKind } from "../utils/editor/surface-kind";
import type { ActiveSurfaceSnapshot } from "./use-active-tab-surface";
import type { Editor } from "@tiptap/react";

import {
  createTabSurfaceRenderers,
  type TabSurfaceRenderers,
} from "../components/editor/tab-surface-renderers";
import { setWysiwygVimStatusOwner } from "../extensions/plugins/vim/vim-status";
import { pluginLoader } from "../plugins/plugin-loader";
import { matchFileViewer } from "../plugins/plugin-ui-store";
import { isFileTab, useEditorStore } from "../stores/editor/editor";
import { editorSurfaceBlockReason } from "../utils/editor/active-tab";
import {
  type EditorMode,
  editorModeForSurfaceKind,
  vimSurfaceForMode,
} from "../utils/editor/editor-mode";
import { resolveSurfaceKind } from "../utils/editor/surface-kind";
import { getLanguageForFile } from "../utils/file-type";
import { type RetainedEntry, useRetainedTabs } from "./use-retained-tabs";

/**
 * Params, regrouped around origin rather than the old monolith's flat call site
 * (quality review HIGH finding — this hook used to take 20 loose fields). Only
 * genuinely EPHEMERAL cross-hook state travels as a parameter now:
 * - `activeEditor`, `scrollOffsets` — instances/refs App.tsx owns.
 * - `sourceBuffers`, `pdfFind` — callbacks from sibling hooks (`useSourceMode`,
 *   `useFindReplaceRouting`) this hook has no way to read itself.
 * - `sourceModeTabs` — the underlying tab-id array IS store-owned, but the
 *   `ReadonlySet` handed out by `useSourceMode` is a memoized view of it whose
 *   reference stability its consumers' memos depend on (see the Set memo's
 *   comment in use-source-mode.ts); building a second Set here would fork that
 *   identity, so the one view travels as a parameter. `isSourceMode` is NOT a
 *   parameter — it is derived below from this set and the snapshot's
 *   `activeTabId`, so the two can never disagree.
 *
 * Everything else the old param list carried (`activeTab`, `activeTabId`,
 * `fileViewers`, `htmlSourceTabs`, `isCodeFile`, `isHtmlSourceView`, `isPdfTab`,
 * `markDirty`, `rootPath`) is `useActiveTabSurface`'s own derived state, not
 * this hook's or the store's — it arrives as the one `activeSurface` snapshot
 * instead of nine more loose fields. `isCodeFile`/`isPdfTab`/`isHtmlSourceView`
 * are formulas (not raw store fields), so re-deriving them here from scratch
 * would risk the exact "two call sites quietly disagree" defect the
 * `isCodeFile` doc comment in `use-active-tab-surface.ts` already warns about.
 */
interface UseRetainedSurfacesParams {
  activeEditor: Editor | null;
  activeSurface: ActiveSurfaceSnapshot;
  pdfFind: {
    onToggle: () => void;
    open: boolean;
    setApi: Dispatch<SetStateAction<null | PdfFindApi>>;
  };
  scrollOffsets: MutableRefObject<Map<string, number>>;
  sourceBuffers: {
    cursorOffsetFor: (tabId: string) => number;
    get: (tabId: string) => string;
    has: (tabId: string) => boolean;
    set: (tabId: string, content: string) => void;
  };
  sourceModeTabs: ReadonlySet<string>;
}

interface UseRetainedSurfacesReturn {
  retainedTabs: RetainedEntry[];
  statusBarMode: EditorMode;
  surfaceKind: SurfaceKind;
  tabSurfaceRenderers: TabSurfaceRenderers;
}

export function useRetainedSurfaces({
  activeEditor,
  activeSurface,
  pdfFind,
  scrollOffsets,
  sourceBuffers,
  sourceModeTabs,
}: UseRetainedSurfacesParams): UseRetainedSurfacesReturn {
  // Derived, not passed: mirrors useSourceMode's own derivation exactly, so a
  // caller can never hand this hook an `isSourceMode` that disagrees with the
  // set it came from (quality review LOW).
  const isSourceMode =
    activeSurface.activeTabId !== null &&
    sourceModeTabs.has(activeSurface.activeTabId);
  // Field-level locals, not `activeSurface` itself, feed the memo/effect deps
  // below — an object-identity dep would re-fire every render, since App.tsx
  // rebuilds the snapshot object fresh each render even though these
  // individual fields are themselves stable/equality-gated.
  const {
    activeTab,
    activeTabId,
    fileViewers,
    htmlSourceTabs,
    isCodeFile,
    isHtmlSourceView,
    isPdfTab,
    markDirty,
    rootPath,
  } = activeSurface;

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
        getSourceBuffer: sourceBuffers.get,
        hasSourceBuffer: sourceBuffers.has,
        markDirty,
        onPdfFindApiChange: pdfFind.setApi,
        onTogglePdfFind: pdfFind.onToggle,
        pdfFindOpen: pdfFind.open,
        scrollOffsets,
        pluginIdFor: (tabId) =>
          useEditorStore.getState().tabs.find((t) => t.id === tabId)
            ?.pluginId ?? "",
        setSourceBuffer: sourceBuffers.set,
        sourceCursorOffsetFor: sourceBuffers.cursorOffsetFor,
      }),
    [
      sourceBuffers.get,
      sourceBuffers.has,
      sourceBuffers.set,
      sourceBuffers.cursorOffsetFor,
      markDirty,
      pdfFind.onToggle,
      pdfFind.open,
      pdfFind.setApi,
      scrollOffsets,
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
    retainedTabs,
    statusBarMode,
    surfaceKind,
    tabSurfaceRenderers,
  };
}
