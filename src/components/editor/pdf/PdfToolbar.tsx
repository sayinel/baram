// §276.1 PDF 툴바 — 상주, 문서 단위. 페이지 이전/다음 + 카운터, 찾기 토글,
// 영역 하이라이트 모드 토글(§276.3: 2차 구현이지만 슬롯은 지금 확보한다 —
// 나중에 끼워 넣으면 툴바 레이아웃을 다시 짜야 한다. 이번 PR에서는 disabled +
// "coming soon" title만 붙인다). PdfFindBar/PdfSelectionPopup과 같은 순수
// 표시 컴포넌트 — 상태와 IPC는 부모(PdfPreview)가 맡는다.
//
// §274 UX fix (defect 3) — 사용자가 실제로 본 문제: disabled 하이라이트
// 버튼이 하나뿐이라 "하이라이트 기능이 꺼져 있다"로 읽힌다. 실제로는 텍스트
// 하이라이트는 이미 동작한다(텍스트를 선택하면 팝업이 뜬다) — 진입점이
// 툴바에 없을 뿐이다. 여기서 고치는 건 그 오해뿐이다: areaMode 라벨을
// "이미지/영역"으로 명시하고, 텍스트 하이라이트용 힌트를 하나 추가한다.
// 힌트는 클릭 동작이 없다 — 그래서 <button>이 아니라 title만 있는 정적
// 아이콘이다(cursor:help로 구분, pdf.css). 새 콜백을 PdfPreview까지
// 끌어올려 toast를 띄우는 대안도 검토했지만, 이 컴포넌트의 "순수 표시"
// 계약(이 파일 헤더 참조)을 건드리지 않고도 hover 하나로 충분히
// 발견 가능해진다.
import {
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Highlighter,
  Search,
} from "lucide-react";

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

      {/* §274 UX fix (defect 3) — 클릭 동작이 없는 정적 힌트라 button이
          아니라 title을 가진 아이콘 span이다. */}
      <span
        aria-label={t("pdfToolbar.textHighlightHint")}
        className="pdf-toolbar-hint"
        data-testid="pdf-text-highlight-hint"
        role="img"
        title={t("pdfToolbar.textHighlightHint")}
      >
        <CircleHelp size={14} />
      </span>
    </div>
  );
}
