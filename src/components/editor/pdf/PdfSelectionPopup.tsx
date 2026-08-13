// §274 하이라이트 선택 팝업 — 색 선택 + 참조/텍스트 복사 + (기존 하이라이트를
// 클릭했을 때만) 삭제. 순수 표시 컴포넌트다: 좌표 계산·클립보드·IPC는 부모
// (use-pdf-highlights.ts)가 맡고, 여기는 콜백을 그대로 전달만 한다.
import type {
  HighlightColor,
  HighlightKind,
  StoredHighlight,
} from "./pdf-highlight-sidecar";

import { Trash2 } from "lucide-react";

import { useTranslation } from "../../../i18n/useTranslation";
import { HIGHLIGHT_COLORS } from "./pdf-highlight-sidecar";

export interface PdfSelectionPopupProps {
  /** .pdf-page 기준 페이지 로컬 좌표. */
  anchor: { left: number; top: number };
  /** 이미 만들어진 하이라이트를 클릭한 경우에만 채워진다 — Delete 노출 여부를 가른다. */
  existing: null | StoredHighlight;
  /** §276.3 새 초안이면 앞으로 만들 kind, 기존이면 existing.kind — "Copy
   * text" 노출 여부를 가른다(영역 하이라이트에는 복사할 원문이 없다). */
  highlightKind: HighlightKind;
  onCopyRef: () => void;
  onCopyText: () => void;
  onDelete: () => void;
  onPickColor: (color: HighlightColor) => void;
}

export function PdfSelectionPopup({
  anchor,
  existing,
  highlightKind,
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
      // §274 UX fix (defect 1) — 색 선택/삭제는 브라우저의 네이티브 텍스트
      // 선택을 지우지 않는다. stopPropagation이 없으면 스와치 클릭의
      // mouseup이 document까지 버블돼 use-pdf-highlights.ts의 mouseup
      // 리스너가 (여전히 non-collapsed인) 같은 선택을 다시 읽어 팝업을
      // 방금 닫은 그 자리에 즉시 재생성한다.
      onMouseUp={(e) => e.stopPropagation()}
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
      {/* §276.3 영역 하이라이트에는 복사할 원문이 없다 — 사이드카에 저장된
          건 좌표뿐이고, 동반 노트의 문단은 우리가 지어낸 라벨이다. 그
          라벨을 "Copy text"로 내주면 사용자가 진짜 PDF 내용인 것처럼 붙여넣게
          된다. Copy reference는 그대로 유효하다("이 페이지의 이 영역"을
          가리키는 참조는 의미가 있다). */}
      {highlightKind !== "area" && (
        <button
          className="btn-unstyled pdf-hl-action-btn"
          data-testid="pdf-hl-copy-text"
          onClick={onCopyText}
          type="button"
        >
          {t("pdfHighlight.copyText")}
        </button>
      )}

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
