// §276.1 PDF 툴바 — 상주, 문서 단위. 페이지 이전/다음 + 카운터, 찾기 토글.
// PdfFindBar/PdfSelectionPopup과 같은 순수 표시 컴포넌트 — 상태와 IPC는
// 부모(PdfPreview)가 맡는다.
//
// §274 UX fix round 2 — §276.3이 영역 하이라이트용으로 미리 예약해 두었던
// disabled 토글과, §274 UX fix round 1이 그 옆에 붙인 텍스트 하이라이트
// 힌트(`?` 아이콘)를 모두 제거했다. 사용자가 실제로 겪은 문제: disabled
// 버튼이 "하이라이트가 꺼져 있다"로 두 번 읽혔고, 그 옆 정체를 알 수 없는
// `?` 아이콘은 설명이 아니라 새로운 의문을 만들었다(오히려 발견성을
// 해쳤다). 영역 하이라이트를 실제로 만들 때 툴바 레이아웃을 다시 짜는
// 비용이, 지금 당장 고장난 것처럼 보이는 컨트롤을 계속 보여주는 비용보다
// 낫다는 것이 사용자의 판단이다.
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

import { useTranslation } from "../../../i18n/useTranslation";

interface PdfToolbarProps {
  /** 1-based. */
  currentPage: number;
  onNextPage: () => void;
  onPrevPage: () => void;
  onToggleFind: () => void;
  pageCount: number;
}

export function PdfToolbar({
  currentPage,
  onNextPage,
  onPrevPage,
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
    </div>
  );
}
