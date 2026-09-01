// §4.2/§286 The editor area — the per-surface-kind render chain (home/empty/
// graph/image/preview/pdf), the retained-tabs mount set, and the always-on
// MarkdownSurface. One component so App.tsx doesn't own the render fan-out.
import { Suspense } from "react";
import type {
  Dispatch,
  MutableRefObject,
  ReactNode,
  SetStateAction,
} from "react";

import type { SourceCodeEditorRef } from "../../components/editor/SourceCodeEditor";
import type { UseInlineAIReturn } from "../../hooks/use-inline-ai";
import type { RetainedEntry } from "../../hooks/use-retained-tabs";
import type { PluginFileViewer } from "../../plugins/plugin-ui-store";
import type { SurfaceKind } from "../../utils/editor/surface-kind";
import type { PdfFindApi } from "../editor/pdf/use-pdf-find";
import type { TabSurfaceRenderers } from "../editor/tab-surface-renderers";
import type { Editor } from "@tiptap/react";

import { useTranslation } from "../../i18n/useTranslation";
import { MarkdownSurface } from "../editor/MarkdownSurface";
import { PdfFindBar } from "../editor/pdf/PdfFindBar";
import { PluginViewerHost } from "../editor/PluginViewerHost";
import { TabSurface } from "../editor/TabSurface";
import { HomeSurface } from "../onboarding/HomeSurface";
import { GraphViewLazy } from "../sidebar/GraphViewLazy";

interface EditorAreaProps {
  activeEditor: Editor | null;
  activeKeepaliveEditor: Editor | null;
  activeTabFilePath: null | string;
  activeTabId: null | string;
  editor: Editor | null;
  findReplaceMode: "find" | "replace";
  findReplaceOpen: boolean;
  handleNewFile: () => void;
  handleOpenFile: () => void;
  handleOpenFolder: () => void;
  handleOpenRecentFile: (path: string) => void;
  handleOpenRecentFolder: (path: string) => void;
  inlineAI: UseInlineAIReturn;
  isMarkdownSurfaceActive: boolean;
  isParsing: boolean;
  mountedKeepaliveEditor: Editor | null;
  pdfFindApi: null | PdfFindApi;
  pdfFindOpen: boolean;
  pluginViewer: null | PluginFileViewer;
  previewFileMtime: number;
  previewToggleButton: ReactNode;
  retainedTabs: RetainedEntry[];
  scrollOffsets: MutableRefObject<Map<string, number>>;
  setFindReplaceMode: Dispatch<SetStateAction<"find" | "replace">>;
  setFindReplaceOpen: Dispatch<SetStateAction<boolean>>;
  setPdfFindOpen: Dispatch<SetStateAction<boolean>>;
  sourceEditorRef: React.RefObject<null | SourceCodeEditorRef>;
  surfaceKind: SurfaceKind;
  tabSurfaceRenderers: TabSurfaceRenderers;
}

export function EditorArea({
  activeEditor,
  activeKeepaliveEditor,
  activeTabFilePath,
  activeTabId,
  editor,
  findReplaceMode,
  findReplaceOpen,
  handleNewFile,
  handleOpenFile,
  handleOpenFolder,
  handleOpenRecentFile,
  handleOpenRecentFolder,
  inlineAI,
  isMarkdownSurfaceActive,
  isParsing,
  mountedKeepaliveEditor,
  pdfFindApi,
  pdfFindOpen,
  pluginViewer,
  previewFileMtime,
  previewToggleButton,
  retainedTabs,
  scrollOffsets,
  setFindReplaceMode,
  setFindReplaceOpen,
  setPdfFindOpen,
  sourceEditorRef,
  surfaceKind,
  tabSurfaceRenderers,
}: EditorAreaProps) {
  const { t } = useTranslation();

  return (
    <div className="editor-area">
      {surfaceKind === "home" ? (
        <HomeSurface
          onNewFile={handleNewFile}
          onOpenFile={handleOpenFile}
          onOpenFolder={handleOpenFolder}
          onOpenRecentFile={handleOpenRecentFile}
          onOpenRecentFolder={handleOpenRecentFolder}
        />
      ) : surfaceKind === "empty" ? (
        <div className="editor-area-scroll" data-editor-scroll>
          <div className="empty-workspace">
            <p>{t("home.emptyWorkspace")}</p>
          </div>
        </div>
      ) : surfaceKind === "graph" ? (
        // §286 그래프는 유지 대상이 아니다 — cytoscape가 0×0 컨테이너에서 자기 카메라를
        // 흔들어, 세 번의 수정에도 실앱에서 계속 깨졌다(use-retained-tabs.ts 참조).
        <div className="editor-area-scroll" data-editor-scroll>
          <Suspense fallback={null}>
            <GraphViewLazy />
          </Suspense>
        </div>
      ) : surfaceKind === "image" && activeTabFilePath ? (
        <div
          className="editor-area-scroll plugin-viewer-scroll"
          data-editor-scroll
        >
          {pluginViewer ? (
            <PluginViewerHost
              filePath={activeTabFilePath}
              refreshKey={previewFileMtime}
              viewer={pluginViewer}
            />
          ) : (
            <div className="viewer-missing">{t("viewer.noPlugin")}</div>
          )}
        </div>
      ) : surfaceKind === "preview" && pluginViewer ? (
        // §290 플러그인이 그리는 프리뷰는 유지하지 않는다 — 공개 viewer 계약에
        // 가시성 신호가 없어, 마운트를 유지하면 미디어 뷰어가 숨은 탭에서 계속
        // 재생된다(dev/backlog.md 참조). 활성일 때만 렌더한다. (HTML 프리뷰는
        // `surfaceKind === "preview"`에도 속하지만 `pluginViewer`가 없으므로 여기서
        // 걸러지고 유지 풀의 HtmlPreview가 그린다 — retainedKindForTab 참조.)
        <div
          className="editor-area-scroll plugin-viewer-scroll"
          data-editor-scroll
        >
          {previewToggleButton}
          <PluginViewerHost
            filePath={activeTabFilePath!}
            refreshKey={previewFileMtime}
            viewer={pluginViewer}
          />
        </div>
      ) : null}
      {/* §272 활성 PDF의 찾기 바 — 표면 바깥(FindReplaceBar와 같은 자리)에 그린다.
          유지 집합에는 PDF가 여러 개 있을 수 있으므로 여기 하나만 존재해야 한다. */}
      {surfaceKind === "pdf" && pdfFindOpen && pdfFindApi && (
        <PdfFindBar
          currentIdx={pdfFindApi.currentIdx}
          matchCount={pdfFindApi.matchCount}
          onClose={() => setPdfFindOpen(false)}
          onNext={pdfFindApi.onNext}
          onPrev={pdfFindApi.onPrev}
          onQueryChange={pdfFindApi.onQueryChange}
        />
      )}
      {/* §286 유지 집합 — 활성만 보이고 나머지는 마운트된 채 숨는다. */}
      {retainedTabs.map((entry) => (
        <TabSurface
          active={entry.tabId === activeTabId}
          entry={entry}
          key={`${entry.kind}-${entry.tabId}`}
          overlay={previewToggleButton}
          renderers={tabSurfaceRenderers}
          scrollOffsets={scrollOffsets}
          sourceEditorRef={sourceEditorRef}
        />
      ))}
      <MarkdownSurface
        active={isMarkdownSurfaceActive}
        activeEditor={activeEditor}
        activeKeepaliveEditor={activeKeepaliveEditor}
        editor={editor}
        findReplaceMode={findReplaceMode}
        findReplaceOpen={findReplaceOpen}
        inlineAI={inlineAI}
        isParsing={isParsing}
        mountedKeepaliveEditor={mountedKeepaliveEditor}
        onFindReplaceClose={() => setFindReplaceOpen(false)}
        onFindReplaceModeChange={setFindReplaceMode}
        scrollOffsets={scrollOffsets}
        tabId={activeTabId}
      />
    </div>
  );
}
