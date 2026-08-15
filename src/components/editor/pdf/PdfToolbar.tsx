// §276.1 PDF 툴바 — 상주, 문서 단위. 페이지 이전/다음 + 카운터, 찾기 토글,
// 텍스트/영역 하이라이트 모드 토글 두 개(§276.3, §276.3.1). PdfFindBar/
// PdfSelectionPopup과 같은 순수 표시 컴포넌트 — 상태와 IPC는 부모
// (PdfPreview)가 맡는다.
//
// §274 UX fix round 2는 이 자리를 예약해 두었던 토글을 disabled +
// "coming soon" 상태로 두는 대신 완전히 제거했다 — disabled 버튼이
// "하이라이트가 꺼져 있다"로 두 번 읽혔기 때문이다. `onToggle*Mode`가
// 없으면(vault 밖/단일 파일 모드 — 하이라이트 자체가 지원되지 않는다) 두
// 버튼 모두 아예 렌더하지 않는다 — 같은 "고장난 것처럼 보이는 컨트롤
// 금지" 판단을 그대로 적용한다.
//
// §276.3.1 — 원래 설계(§276.3)는 텍스트에 모드가 필요 없다고 했다(선택이
// 곧 진입점). 사용자가 그 흠을 짚었다: 평범한 드래그 선택 + `Cmd+C`가 PDF
// 리더에서 아주 흔한 동작인데, 모드가 없으면 매번 하이라이트 팝업이
// 뜬다. 그래서 텍스트도 모드가 됐다 — 두 토글은 상호 배타적이다(부모의
// use-pdf-highlight-mode.ts가 하나의 enum으로 보장한다, 이 컴포넌트는 그
// 결과만 받는다).
import {
  ChevronLeft,
  ChevronRight,
  Highlighter,
  Search,
  SquareDashedMousePointer,
} from "lucide-react";

import { useTranslation } from "../../../i18n/useTranslation";

interface PdfToolbarProps {
  /** §276.3 raw 토글 상태 — aria-pressed가 반영하는 값. Alt-hold 같은
   * 일시적 캡처 상태는 여기 섞이지 않는다(부모가 이미 분리해서 내려준다). */
  areaMode?: boolean;
  /** 1-based. */
  currentPage: number;
  onNextPage: () => void;
  onPrevPage: () => void;
  /** §276.3 없으면(vault 밖 등) 버튼을 렌더하지 않는다. */
  onToggleAreaMode?: () => void;
  onToggleFind: () => void;
  /** §276.3.1 없으면(vault 밖 등) 버튼을 렌더하지 않는다 — onToggleAreaMode와
   * 같은 게이트. */
  onToggleTextMode?: () => void;
  pageCount: number;
  /** §276.3.1 raw 토글 상태 — areaMode와 대칭. */
  textMode?: boolean;
}

export function PdfToolbar({
  areaMode,
  currentPage,
  onNextPage,
  onPrevPage,
  onToggleAreaMode,
  onToggleFind,
  onToggleTextMode,
  pageCount,
  textMode,
}: PdfToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className="pdf-toolbar" role="toolbar">
      <button
        aria-label={t("pdfToolbar.prevPage")}
        className="btn-unstyled icon-btn pdf-toolbar-nav-btn"
        data-testid="pdf-prev-page"
        disabled={currentPage <= 1}
        onClick={onPrevPage}
        title={t("pdfToolbar.prevPage")}
        type="button"
      >
        <ChevronLeft size={16} />
      </button>

      <span className="pdf-toolbar-page-count">
        {currentPage} / {pageCount}
      </span>

      <button
        aria-label={t("pdfToolbar.nextPage")}
        className="btn-unstyled icon-btn pdf-toolbar-nav-btn"
        data-testid="pdf-next-page"
        disabled={currentPage >= pageCount}
        onClick={onNextPage}
        title={t("pdfToolbar.nextPage")}
        type="button"
      >
        <ChevronRight size={16} />
      </button>

      <div className="pdf-toolbar-divider" />

      <button
        aria-label={t("pdfToolbar.find")}
        className="btn-unstyled icon-btn pdf-toolbar-btn"
        data-testid="pdf-toggle-find"
        onClick={onToggleFind}
        title={t("pdfToolbar.find")}
        type="button"
      >
        <Search size={16} />
      </button>

      {onToggleTextMode && (
        <button
          aria-label={t("pdfToolbar.textMode")}
          aria-pressed={textMode ?? false}
          className={[
            "btn-unstyled",
            "icon-btn",
            "pdf-toolbar-btn",
            textMode ? "active" : null,
          ]
            .filter(Boolean)
            .join(" ")}
          data-testid="pdf-text-mode"
          onClick={onToggleTextMode}
          title={t("pdfToolbar.textMode")}
          type="button"
        >
          <Highlighter size={16} />
        </button>
      )}

      {onToggleAreaMode && (
        <button
          aria-label={t("pdfToolbar.areaMode")}
          aria-pressed={areaMode ?? false}
          className={[
            "btn-unstyled",
            "icon-btn",
            "pdf-toolbar-btn",
            areaMode ? "active" : null,
          ]
            .filter(Boolean)
            .join(" ")}
          data-testid="pdf-area-mode"
          onClick={onToggleAreaMode}
          title={t("pdfToolbar.areaMode")}
          type="button"
        >
          <SquareDashedMousePointer size={16} />
        </button>
      )}
    </div>
  );
}
