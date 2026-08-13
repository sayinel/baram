// §276.1 PDF 툴바 — 상주, 문서 단위. 페이지 이전/다음 + 카운터, 찾기 토글,
// 영역 하이라이트 모드 토글(§276.3). PdfFindBar/PdfSelectionPopup과 같은
// 순수 표시 컴포넌트 — 상태와 IPC는 부모(PdfPreview)가 맡는다.
//
// §274 UX fix round 2는 §276.3이 미리 예약해 두었던 이 토글을 disabled +
// "coming soon" 상태로 두는 대신 완전히 제거했다 — disabled 버튼이
// "하이라이트가 꺼져 있다"로 두 번 읽혔기 때문이다. §276.3이 실제로
// 구현되며 다시 돌아온다: 이제 정말로 뭔가를 한다는 점이 그때와 다르다.
// 텍스트 하이라이트는 버튼이 없다(선택이 곧 진입점, §276.3 설계) — 이
// 토글의 tooltip 문구가 "영역"과 "드래그"를 명시하는 이유가 그 비대칭을
// 헷갈리지 않게 하기 위해서다. `onToggleAreaMode`가 없으면(vault 밖/단일
// 파일 모드 — 하이라이트 자체가 지원되지 않는다) 버튼을 아예 렌더하지
// 않는다 — 같은 "고장난 것처럼 보이는 컨트롤 금지" 판단을 그대로 적용한다.
import {
  ChevronLeft,
  ChevronRight,
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
  pageCount: number;
}

export function PdfToolbar({
  areaMode,
  currentPage,
  onNextPage,
  onPrevPage,
  onToggleAreaMode,
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
