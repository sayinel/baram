import { useLayoutEffect, useRef, useState } from "react";

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
import { clampPopupToBounds } from "./pdf-popup-position";

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
  const ref = useRef<HTMLDivElement | null>(null);

  // §274.1 앵커는 선택 영역의 오른쪽-아래 모서리라, 페이지 오른쪽 여백 근처에서
  // 드래그를 끝내면 팝업이 창 밖으로 나가 잘린다. 그려진 뒤 자기 크기와 보이는
  // 영역을 재서 물린다.
  //
  // 보정량을 state로 들고 style prop에 함께 실어 보낸다. 첫 구현은
  // useLayoutEffect에서 el.style에 직접 썼는데, 그때 내가 "재렌더가 덮어써서
  // 안 먹혔다"고 단정한 것은 **틀렸다** — React는 style prop의 값이 실제로
  // 달라질 때만 DOM에 다시 쓰므로, 앵커가 그대로면 명령형으로 쓴 값은 살아
  // 남는다(옛 구현으로 되돌려 뮤테이션했더니 이 파일의 테스트가 전부 통과했다).
  // 실앱에서 안 먹힌 진짜 이유는 아직 측정 중이다(아래 임시 진단 로그).
  //
  // 그래도 state 쪽이 옳다: 앵커가 바뀌는 경로에서 React가 style을 다시 쓰면
  // 명령형 보정은 실제로 지워지고, 그 조합은 이 컴포넌트에서 도달 가능하다.
  const [offset, setOffset] = useState({ dx: 0, dy: 0 });

  // 계산은 **보정 없는 앵커 기준**이라 멱등이다(현재 offset을 빼서 원위치를
  // 복원한 뒤 다시 물린다). 값이 실제로 달라질 때만 setState하므로 한 번
  // 수렴하면 더 이상 렌더를 만들지 않는다.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // jsdom(및 아직 레이아웃 전)은 모든 rect가 0이다 — 보정할 것이 없다.
    if (rect.width === 0 && rect.height === 0) return;

    const bounds = visibleBoundsOf(el.closest(".pdf-preview-scroll"));

    // 지금 그려진 위치에서 현재 보정을 되돌린 것이 "앵커가 원한 위치"다.
    const rawLeft = rect.left - offset.dx;
    const rawTop = rect.top - offset.dy;
    const clamped = clampPopupToBounds({
      bounds,
      desired: { left: rawLeft, top: rawTop },
      size: { height: rect.height, width: rect.width },
    });
    const next = { dx: clamped.left - rawLeft, dy: clamped.top - rawTop };
    if (next.dx !== offset.dx || next.dy !== offset.dy) setOffset(next);
    // 레이아웃만 바뀌는 경우(창 리사이즈)는 다시 돌지 않는다 — 팝업은 다음
    // 상호작용에서 닫히므로 지금은 허용 가능한 한계다.
  }, [offset.dx, offset.dy, anchor.left, anchor.top]);

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
      ref={ref}
      // 보정을 style prop 자체에 담는다 — 그래야 재렌더가 덮어써도 살아남는다.
      style={{ left: anchor.left + offset.dx, top: anchor.top + offset.dy }}
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

      {/* §274.2 참조 복사는 **이미 만들어진** 하이라이트에서만 제공한다.
          초안(색을 아직 안 고른 상태)에서 누르면 동반 노트에 문단만 생기고
          사이드카에는 아무것도 안 들어가, 그 참조는 가리킬 하이라이트가 없는
          채로 남는다 — 다른 문서에 붙여 Cmd+Click하면 PDF로 점프하지 못하고
          동반 노트가 열린다(use-navigation.ts의 fallback). 사용자가 실사용에서
          정확히 그 상태를 보고했다.

          "먼저 참조를 복사하고 나중에 색을 고른다"는 흐름(§274 I2)을 지탱하려고
          만든 경로였지만, 색을 안 고르면 끊어진 참조가 남는 것이 기본 결과였다.
          참조는 하이라이트를 가리키는 것이므로, 하이라이트가 생긴 뒤에만
          제공하는 편이 모델과도 맞는다. */}
      {existing && (
        <button
          className="btn-unstyled pdf-hl-action-btn"
          data-testid="pdf-hl-copy-ref"
          onClick={onCopyRef}
          type="button"
        >
          {t("pdfHighlight.copyRef")}
        </button>
      )}
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

/**
 * §274.1 스크롤 컨테이너의 **보이는** 영역.
 *
 * ‼️ getBoundingClientRect가 아니다. 그것은 border box라 세로 스크롤바 폭을
 * **포함**한다 — overflow:auto 컨테이너에서 그 값을 경계로 쓰면, 팝업이
 * 계산상으로는 "안에 들어갔는데" 실제로는 스크롤바 아래로 들어가 잘린다.
 * 실측(사용자 재현): 팝업 오른쪽 끝 1258, 컨테이너 rect 오른쪽 1266 —
 * 여유 8px이 있는데도 화면에서는 잘렸다. 조상 체인 전체에 overflow:hidden도
 * clip-path도 contain도 없었으므로 남는 설명은 스크롤바뿐이었다.
 *
 * clientWidth/clientHeight는 padding box에서 스크롤바를 뺀 값이고,
 * clientLeft/clientTop은 border 두께다 — 둘을 합치면 실제로 그려지는 영역이
 * 나온다.
 */
function visibleBoundsOf(scroller: Element | null): {
  bottom: number;
  left: number;
  right: number;
  top: number;
} {
  if (!scroller) {
    return {
      bottom: window.innerHeight,
      left: 0,
      right: window.innerWidth,
      top: 0,
    };
  }
  const rect = scroller.getBoundingClientRect();
  const left = rect.left + scroller.clientLeft;
  const top = rect.top + scroller.clientTop;
  return {
    bottom: top + scroller.clientHeight,
    left,
    right: left + scroller.clientWidth,
    top,
  };
}
