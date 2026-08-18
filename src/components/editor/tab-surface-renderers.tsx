// §286 유지 표면의 kind별 실제 컴포넌트.
//
// TabSurface.tsx에서 분리한 이유는 이 저장소의 기존 규칙과 같다(table-insert-coords.ts 헤더
// 참조): 컴포넌트 파일은 컴포넌트만 export해야 react-refresh가 동작한다.
import type { ReactNode, RefObject } from "react";
import { Suspense } from "react";

import type { RetainedKind } from "../../hooks/use-retained-tabs";
import type { PdfFindApi } from "./pdf/use-pdf-find";
import type { SourceCodeEditorRef } from "./SourceCodeEditor";

import { isMarkdownFile } from "../../utils/file-type";
import { PluginDetailTabLazy } from "../plugins/PluginDetailTabLazy";
import { GraphViewLazy } from "../sidebar/GraphViewLazy";
import { HtmlPreview } from "./HtmlPreview";
import { PdfPreviewLazy } from "./pdf/PdfPreviewLazy";
import { SourceCodeEditor } from "./SourceCodeEditor";

/** 표면 하나가 자기 탭에 대해 아는 전부. 활성 탭 정보는 여기 없다(§288 규칙 2). */
export interface TabSurfaceContext {
  active: boolean;
  /** §291 코드 표면의 스크롤 요소를 얻기 위한 ref — TabSurface가 소유한다. */
  codeEditorRef: RefObject<null | SourceCodeEditorRef>;
  /** 자기 탭의 절대 경로. 파일 탭이 아니면 "". */
  filePath: string;
  /** 자기 탭의 마지막 저장 mtime — 뷰어 리로드 키. */
  refreshKey: number;
  tabId: string;
}

/** App이 표면에 내려줘야 하는 배선. 활성 탭 파생값은 여기 없다(§288 규칙 2). */
export interface TabSurfaceDeps {
  /** 파일 경로 → CodeMirror 언어 이름. */
  codeLanguageFor: (filePath: string) => string | undefined;
  getSourceBuffer: (tabId: string) => string;
  /** 자기 탭을 dirty로 표시 — 활성 탭이 아니라 편집이 일어난 탭이다. */
  markDirty: (tabId: string, dirty: boolean) => void;
  /** §272 활성 PDF가 자기 find API를 App으로 끌어올리는 통로. */
  onPdfFindApiChange: (api: null | PdfFindApi) => void;
  onTogglePdfFind: () => void;
  /** §272 PDF 찾기 바가 열려 있는가. */
  pdfFindOpen: boolean;
  /** §69 플러그인 탭이 보여줄 플러그인 id — 자기 탭에서 읽는다. */
  pluginIdFor: (tabId: string) => string;
  setSourceBuffer: (tabId: string, content: string) => void;
  sourceCursorOffsetFor: (tabId: string) => number;
}

export type TabSurfaceRenderers = Record<
  RetainedKind,
  (ctx: TabSurfaceContext) => ReactNode
>;

/**
 * kind별 실제 표면.
 *
 * 레지스트리를 두는 이유는 테스트 편의가 아니라 **격리**다. `vi.mock`으로 pdfjs 경로 전체를
 * 덮는 방식은 이 저장소가 이미 사고를 낸 패턴이다 — PDF 찾기가 4,988개 초록 아래에서 `0/0`인
 * 채 실앱에서 완전히 죽어 있었다. 주입은 검사 대상을 "TabSurface의 배선"으로 좁히면서 pdfjs
 * 실물 경로는 손대지 않는다.
 */
export function createTabSurfaceRenderers(
  deps: TabSurfaceDeps,
): TabSurfaceRenderers {
  return {
    // ‼️ content/onChange/커서가 전부 **자기 tabId**를 쓴다. 예전에는 전역 버퍼 하나였고
    // 편집 영역이 코드 표면을 하나만 마운트한다는 사실에 기대고 있었다(§287).
    code: ({ codeEditorRef, filePath, tabId }) => (
      <Suspense fallback={null}>
        <SourceCodeEditor
          content={deps.getSourceBuffer(tabId)}
          initialCursorOffset={deps.sourceCursorOffsetFor(tabId)}
          language={deps.codeLanguageFor(filePath)}
          onChange={(next) => {
            deps.setSourceBuffer(tabId, next);
            // ‼️ 마크다운은 여기서 dirty로 표시하지 않는다 — 예전 두 갈래의 비대칭을 그대로
            // 보존한 것이다. 마크다운의 dirty는 use-auto-save가 Tiptap `update` 트랜잭션에서
            // 판정하고(내용이 실제로 달라졌는지 비교까지 한다), 소스 모드에서 돌아올 때 그
            // 경로가 돈다. 여기서 같이 표시하면 두 곳이 같은 상태를 쓰게 된다.
            if (!isMarkdownFile(filePath)) deps.markDirty(tabId, true);
          }}
          ref={codeEditorRef}
        />
      </Suspense>
    ),
    graph: () => (
      <Suspense fallback={null}>
        <GraphViewLazy />
      </Suspense>
    ),
    html: ({ active, filePath, refreshKey }) => (
      <HtmlPreview
        active={active}
        filePath={filePath}
        refreshKey={refreshKey}
        title={filePath}
      />
    ),
    pdf: ({ active, filePath, refreshKey }) => (
      <Suspense fallback={null}>
        <PdfPreviewLazy
          active={active}
          filePath={filePath}
          // ‼️ 활성 표면만 find API를 끌어올린다. 숨은 PDF까지 올리면 마지막으로 마운트된
          // 문서가 App의 단일 pdfFindApi를 차지해, 찾기 바가 보이지 않는 문서를 검색한다.
          findOpen={active ? deps.pdfFindOpen : false}
          onFindApiChange={active ? deps.onPdfFindApiChange : undefined}
          onToggleFind={active ? deps.onTogglePdfFind : undefined}
          refreshKey={refreshKey}
          title={filePath}
        />
      </Suspense>
    ),
    plugin: ({ tabId }) => (
      <Suspense fallback={null}>
        <PluginDetailTabLazy pluginId={deps.pluginIdFor(tabId)} />
      </Suspense>
    ),
  };
}
