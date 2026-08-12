// §274 하이라이트 선택 팝업 — 색 선택 + 참조/텍스트 복사 + (기존 하이라이트를
// 클릭했을 때만) 삭제. 순수 표시 컴포넌트다: 좌표 계산·클립보드·IPC는 부모
// (use-pdf-highlights.ts)가 맡고, 여기는 콜백을 그대로 전달만 한다.
import type { HighlightColor, StoredHighlight } from "./pdf-highlight-sidecar";

import { Trash2 } from "lucide-react";

import { useTranslation } from "../../../i18n/useTranslation";
import { HIGHLIGHT_COLORS } from "./pdf-highlight-sidecar";

export interface PdfSelectionPopupProps {
  /** .pdf-page 기준 페이지 로컬 좌표. */
  anchor: { left: number; top: number };
  /** 이미 만들어진 하이라이트를 클릭한 경우에만 채워진다 — Delete 노출 여부를 가른다. */
  existing: null | StoredHighlight;
  onCopyRef: () => void;
  onCopyText: () => void;
  onDelete: () => void;
  onPickColor: (color: HighlightColor) => void;
}

export function PdfSelectionPopup({
  anchor,
  existing,
  onCopyRef,
  onCopyText,
  onDelete,
  onPickColor,
}: PdfSelectionPopupProps) {
  const { t } = useTranslation();

  return (
    <div
      aria-label={t("pdfHighlight.color")}
      className="pdf-hl-popup"
      // 팝업 내부 클릭이 .pdf-page의 mousedown 히트 테스트로 버블돼 팝업을
      // 스스로 닫아버리는 것을 막는다 — PdfPage.tsx는 mousedown에서 판정한다.
      onMouseDown={(e) => e.stopPropagation()}
      style={{ left: anchor.left, top: anchor.top }}
    >
      <div className="pdf-hl-swatch-row" role="group">
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            aria-label={color}
            aria-pressed={existing?.color === color}
            // 배열 join으로 조립한다 — 멀티라인 템플릿 리터럴 안의 trailing
            // space는 prettier 재포맷에서 조용히 사라질 수 있어(겪어봄) 클래스
            // 두 개가 공백 없이 붙어버리는 사고가 난다.
            className={[
              "btn-unstyled",
              "pdf-hl-swatch",
              `pdf-hl-swatch-${color}`,
              existing?.color === color ? "active" : null,
            ]
              .filter(Boolean)
              .join(" ")}
            data-testid={`pdf-hl-color-${color}`}
            key={color}
            onClick={() => onPickColor(color)}
            title={color}
            type="button"
          />
        ))}
      </div>

      <div className="pdf-hl-divider" />

      <button
        className="btn-unstyled pdf-hl-action-btn"
        data-testid="pdf-hl-copy-ref"
        onClick={onCopyRef}
        type="button"
      >
        {t("pdfHighlight.copyRef")}
      </button>
      <button
        className="btn-unstyled pdf-hl-action-btn"
        data-testid="pdf-hl-copy-text"
        onClick={onCopyText}
        type="button"
      >
        {t("pdfHighlight.copyText")}
      </button>

      {existing && (
        <button
          aria-label={t("pdfHighlight.delete")}
          className="btn-unstyled icon-btn pdf-hl-delete-btn"
          data-testid="pdf-hl-delete"
          onClick={onDelete}
          title={t("pdfHighlight.delete")}
          type="button"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}
