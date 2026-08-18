// §286 유지 표면의 kind별 실제 컴포넌트.
//
// TabSurface.tsx에서 분리한 이유는 이 저장소의 기존 규칙과 같다(table-insert-coords.ts 헤더
// 참조): 컴포넌트 파일은 컴포넌트만 export해야 react-refresh가 동작한다.
import type { ReactNode } from "react";
import { Suspense } from "react";

import type { RetainedKind } from "../../hooks/use-retained-tabs";
import type { PdfFindApi } from "./pdf/use-pdf-find";

import { PdfPreviewLazy } from "./pdf/PdfPreviewLazy";

/** 표면 하나가 자기 탭에 대해 아는 전부. 활성 탭 정보는 여기 없다(§288 규칙 2). */
export interface TabSurfaceContext {
  active: boolean;
  /** 자기 탭의 절대 경로. 파일 탭이 아니면 "". */
  filePath: string;
  /** 자기 탭의 마지막 저장 mtime — 뷰어 리로드 키. */
  refreshKey: number;
  tabId: string;
}

/** App이 표면에 내려줘야 하는 배선. 활성 탭 파생값은 여기 없다(§288 규칙 2). */
export interface TabSurfaceDeps {
  /** §272 활성 PDF가 자기 find API를 App으로 끌어올리는 통로. */
  onPdfFindApiChange: (api: null | PdfFindApi) => void;
  onTogglePdfFind: () => void;
  /** §272 PDF 찾기 바가 열려 있는가. */
  pdfFindOpen: boolean;
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
    code: () => null,
    graph: () => null,
    html: () => null,
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
    plugin: () => null,
  };
}
