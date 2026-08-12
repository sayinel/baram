// §276.1 PDF 툴바 — 상주, 문서 단위. 페이지 이전/다음 + 카운터, 찾기 토글,
// 영역 하이라이트 모드 토글(§276.3: 2차 구현이지만 슬롯은 지금 확보한다 —
// 나중에 끼워 넣으면 툴바 레이아웃을 다시 짜야 한다. 이번 PR에서는 disabled +
// "coming soon" title만 붙인다). PdfFindBar/PdfSelectionPopup과 같은 순수
// 표시 컴포넌트 — 상태와 IPC는 부모(PdfPreview)가 맡는다.
import { ChevronLeft, ChevronRight, Highlighter, Search } from "lucide-react";

import { useTranslation } from "../../../i18n/useTranslation";

interface PdfToolbarProps {
  /** §276.3 2차 구현 — 토글은 지금 렌더하되 항상 disabled. */
  areaMode: boolean;
  /** 1-based. */
  currentPage: number;
  onNextPage: () => void;
  onPrevPage: () => void;
  onToggleArea: () => void;
  onToggleFind: () => void;
  pageCount: number;
}

export function PdfToolbar({
  areaMode,
  currentPage,
  onNextPage,
  onPrevPage,
  onToggleArea,
  onToggleFind,
  pageCount,
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

      <button
        aria-label={t("pdfToolbar.areaMode")}
        aria-pressed={areaMode}
        className="btn-unstyled icon-btn pdf-toolbar-btn"
        data-testid="pdf-area-mode"
        disabled
        onClick={onToggleArea}
        title={t("pdfToolbar.areaMode")}
        type="button"
      >
        <Highlighter size={16} />
      </button>
    </div>
  );
}
