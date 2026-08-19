// §276.3 영역 하이라이트 — 텍스트 하이라이트(선택 즉시 팝업)와 생성
// 제스처가 겹칠 수 없다(텍스트 레이어가 최상단이라 캔버스 드래그를 먼저
// 먹는다, §274.2). 그래서 진입점을 분리한다: 툴바 모드 토글 또는
// Alt+드래그 — 둘 다 이 훅의 같은 onPageMouseDown으로 들어온다(단일 코드
// 경로). 생성이 끝난 뒤의 관리(색 변경/삭제/복사)는 완전히 통합돼 있으므로
// 이 훅은 그 부분을 전혀 모른다 — 드래그가 끝나면 payload를 하나
// 콜백(onAreaHighlightDrawn)으로 넘기고, 팝업을 실제로 여는 것은
// use-pdf-highlights.ts(usePdfSelectionPopup의 onNewSelection과 정확히
// 같은 자리)다.
//
// §276.3.1 토글 자체(모드가 "area"인지)는 더 이상 이 훅이 갖지 않는다 —
// 세 상태(none/text/area)가 하나의 enum(use-pdf-highlight-mode.ts)으로
// 옮겨졌기 때문이다. 이 훅은 그 enum의 "area" 값 여부(areaModeOn)를
// 파라미터로 받아 자신의 Alt-hold 추적과 OR로 묶기만 한다 — 토글이 어디서
// 오는지는 이 훅의 관심사가 아니다.
//
// Splitter.tsx와 같은 패턴 — mousedown 클로저 안에서 document
// mousemove/mouseup을 그때그때 붙이고 뗀다(useEffect로 "dragging" state를
// 감시하며 리스너를 여닫는 방식 대신). 드래그 취소(cancelDragRef)만
// 예외적으로 상태 밖에 둔다 — Escape 키다운과 "areaCaptureActive가 false로
// 바뀜"(모드 전환 또는 Alt 릴리즈, §276.3이 둘 다 명시한 취소 경로) 두
// 곳에서 같은 취소 함수를 불러야 하기 때문이다.
import { useCallback, useEffect, useRef, useState } from "react";

import type { PdfRect, ViewportLike } from "./pdf-highlight-geom";
import type { LocalRect } from "./pdf-highlight-path";

import { useTranslation } from "../../../i18n/useTranslation";
import {
  isMeaningfulDrag,
  localRectFromDragPoints,
  rectFromDragPoints,
} from "./pdf-area-drag";
import { clientRectToPdf } from "./pdf-highlight-geom";
import { POPUP_ANCHOR_GAP } from "./use-pdf-selection-popup";

export interface AreaDrawnPayload {
  anchor: { left: number; top: number };
  pageNumber: number;
  /** 항상 길이 1 — 영역 하이라이트는 사각형 하나다. */
  rects: PdfRect[];
  /** §273.1 동반 노트 문단으로 쓸 합성 라벨(예: "Area highlight (page 3)"). */
  text: string;
}

export interface UsePdfAreaHighlightResult {
  /** areaModeOn || altHeld — 이 값이 true인 동안 텍스트 레이어를 비활성화하고
   * (PdfPage.tsx) mousedown을 이 훅으로도 보내야 한다(PdfPreview.tsx). */
  areaCaptureActive: boolean;
  /** 드래그 중인 페이지 + 페이지 로컬 미리보기 사각형. 드래그 중이 아니면 null. */
  dragPreview: null | { pageNumber: number; rect: LocalRect };
  onPageMouseDown: (
    pageNumber: number,
    viewport: ViewportLike,
    pageOrigin: { left: number; top: number },
    clientX: number,
    clientY: number,
  ) => void;
}

export function usePdfAreaHighlight({
  active,
  areaModeOn,
  onAreaHighlightDrawn,
}: {
  /**
   * §288 규칙 1 — 이 PDF 표면이 지금 화면에 보이는가.
   *
   * 아래 Alt 추적은 document 전역이고 모드와 무관하게 항상 붙는다. 숨은 표면까지 듣게 두면
   * 사용자가 **다른 탭에서** Alt를 누를 때마다 보이지 않는 PDF가 영역 선택 모드로 들어간다.
   */
  active: boolean;
  /** §276.3.1 use-pdf-highlight-mode.ts의 `mode === "area"` — 툴바 토글의
   * raw 상태다. aria-pressed는 이 값만 반영해야 한다(Alt를 누르고 있다고
   * 토글 버튼이 눌린 것처럼 보이면 안 된다) — 그 판단은 호출부의 몫이라 이
   * 훅은 그대로 받기만 한다. */
  areaModeOn: boolean;
  onAreaHighlightDrawn: (payload: AreaDrawnPayload) => void;
}): UsePdfAreaHighlightResult {
  const { t } = useTranslation();
  const [altHeld, setAltHeld] = useState(false);
  const [dragPreview, setDragPreview] = useState<null | {
    pageNumber: number;
    rect: LocalRect;
  }>(null);
  // 지금 진행 중인 드래그를 아무것도 만들지 않고 정리하는 함수. 드래그가
  // 없으면 null — Escape/모드-OFF 핸들러가 no-op 가드로 쓴다.
  const cancelDragRef = useRef<(() => void) | null>(null);

  const areaCaptureActive = areaModeOn || altHeld;

  // Alt 홀드 추적 + Escape. 하나의 keydown 리스너에 모은다 — 마운트 동안
  // 항상 붙어 있고 모드와 무관하다(Escape는 드래그가 없으면 아무것도 안
  // 한다). blur에서도 altHeld를 반드시 끈다 — Alt+Tab으로 창을 떠나면
  // keyup이 이 문서에 도착하지 않아 안 그러면 눌림 상태가 영원히 고정된다.
  useEffect(() => {
    if (!active) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Alt") setAltHeld(true);
      else if (e.key === "Escape") cancelDragRef.current?.();
    }
    function handleKeyUp(e: KeyboardEvent) {
      if (e.key === "Alt") setAltHeld(false);
    }
    function handleBlur() {
      setAltHeld(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, [active]);

  // §276.3 "Escape(또는 모드 OFF)로 드래그 중 취소" — 모드 토글과 Alt
  // 릴리즈는 서로 다른 이벤트지만 둘 다 areaCaptureActive를 false로
  // 만든다는 점은 같다. 그 전환 하나만 지켜보면 두 취소 경로를 각각 따로
  // 처리할 필요가 없다.
  useEffect(() => {
    if (!areaCaptureActive) cancelDragRef.current?.();
  }, [areaCaptureActive]);

  const onPageMouseDown = useCallback(
    (
      pageNumber: number,
      viewport: ViewportLike,
      pageOrigin: { left: number; top: number },
      clientX: number,
      clientY: number,
    ) => {
      const start = { x: clientX, y: clientY };
      setDragPreview({
        pageNumber,
        rect: localRectFromDragPoints(start, start, pageOrigin),
      });

      function handleMouseMove(ev: MouseEvent) {
        const current = { x: ev.clientX, y: ev.clientY };
        setDragPreview({
          pageNumber,
          rect: localRectFromDragPoints(start, current, pageOrigin),
        });
      }

      function cleanup() {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        cancelDragRef.current = null;
        setDragPreview(null);
      }

      function handleMouseUp(ev: MouseEvent) {
        const current = { x: ev.clientX, y: ev.clientY };
        const clientRect = rectFromDragPoints(start, current);
        cleanup();
        // §276.3 실수로 누른 클릭(움직임 없음/미미함) — 아무것도 만들지 않고
        // 조용히 취소한다.
        if (!isMeaningfulDrag(clientRect)) return;
        const pdfRect = clientRectToPdf(clientRect, pageOrigin, viewport);
        onAreaHighlightDrawn({
          anchor: {
            left: current.x - pageOrigin.left,
            top: current.y - pageOrigin.top + POPUP_ANCHOR_GAP,
          },
          pageNumber,
          rects: [pdfRect],
          text: t("pdfHighlight.areaNoteLabel", { page: String(pageNumber) }),
        });
      }

      cancelDragRef.current = cleanup;
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [onAreaHighlightDrawn, t],
  );

  return {
    areaCaptureActive,
    dragPreview,
    onPageMouseDown,
  };
}
