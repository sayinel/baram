// §274 UX fix — 새 텍스트 선택을 감지해 팝업을 열지 판단하는 부분만 여기로
//뽑았다(use-pdf-highlights.ts가 500줄을 넘겨서다, 그 파일 헤더 comment의
// 책임 분리 원칙과 같은 이유). 상태(popup 자체)는 여전히 use-pdf-highlights.ts가
// 갖고, 이 훅은 "언제, 무엇을" 열지만 계산해 onSelect로 알린다.
import { useEffect } from "react";

import type { PdfRect } from "./pdf-highlight-geom";
import type { PDFPageProxy } from "pdfjs-dist";

import { clientRectToPdf, mergeRectsByLine } from "./pdf-highlight-geom";
import { findPageForNode } from "./pdf-highlight-hittest";

/** §274 UX fix (defect 1) — 선택 팝업을 선택 끝 지점에서 이만큼 아래로
 * 띄운다. 정확히 마우스를 뗀 자리에 딱 붙어 뜨지 않게 하는 최소한의 여백.
 * §276.3 export — 영역 하이라이트(use-pdf-area-highlight.ts)도 같은 팝업을
 * 같은 방식으로 앵커링하므로 여백 값을 따로 두지 않고 재사용한다. */
export const POPUP_ANCHOR_GAP = 6;

export interface NewSelectionPayload {
  anchor: { left: number; top: number };
  pageNumber: number;
  rects: PdfRect[];
  text: string;
}

/**
 * §274.1 새 텍스트 선택 감지 — document 전역 이벤트를 쓴다(개별 페이지가
 * 아니라): 드래그 도중 앵커가 어느 페이지에 속하는지 미리 알 수 없기
 * 때문이다. collapsed(단순 클릭으로 caret만 옮긴 경우)는 무시한다 — 그
 * 클릭은 이미 handlePageMouseDown이 처리했다(히트 또는 팝업 닫기, 호출부).
 *
 * §274 UX fix (defect 1) — selectionchange는 드래그 "도중" 계속 발생한다.
 * 예전에는 그때마다 팝업을 열었는데, 앵커가 선택 끝(우하단) 근처라 드래그가
 * 오른쪽/아래로 향할수록 커서가 막 뜬 팝업 위로 올라가 선택이 거기서
 * 끊겼다. isMouseDown ref로 "지금 마우스 버튼이 눌려 있는가"를 추적해,
 * 눌려 있는 동안은 selectionchange가 팝업을 열지 않게 막는다 — 실제로 여는
 * 것은 mouseup(제스처가 끝난 시점에 선택을 다시 읽는다)이다. 키보드만으로
 * 만든 선택(Shift+Arrow, Cmd+A 등)은 마우스 이벤트가 전혀 없어
 * isMouseDown이 계속 false이므로 selectionchange가 예전과 똑같이 즉시
 * 연다 — 회귀 없음.
 *
 * §276.3.1 텍스트 하이라이트 모드 게이팅 — 세 가지 상태 중 "모드 없음"에서는
 * 평범한 드래그 선택 + `Cmd+C`가 방해받지 않아야 한다는 사용자 판단으로,
 * 이 감지 자체를 textModeActive로 끈다. 이 effect의 나머지(구멍 병합,
 * mouseup 시점 재-읽기, 앵커 계산)는 세 번의 실사용 리포트로 다듬어진
 * 로직이라 손대지 않는다 — 게이트 한 줄만 추가한다.
 */
export function usePdfSelectionPopup({
  active,
  onSelect,
  pageElsRef,
  pagesByNumberRef,
  pdfRelPath,
  scale,
  textModeActive,
}: {
  /**
   * §288 규칙 1 — 이 PDF 표면이 지금 화면에 보이는가.
   *
   * 유지 집합(§286)은 PDF를 여러 개 마운트해 둔 채 하나만 보여준다. 숨은 표면이 document의
   * selectionchange를 계속 들으면, 사용자가 **다른 탭에서** 만든 선택에 반응해 자기 페이지
   * 좌표로 앵커를 계산하고 팝업을 띄운다.
   */
  active: boolean;
  onSelect: (payload: NewSelectionPayload) => void;
  pageElsRef: { current: Map<number, HTMLElement> };
  pagesByNumberRef: { current: Map<number, PDFPageProxy> };
  /** §274 M3 rootPath가 아니라 pdfRelPath로 게이팅한다 — 호출부(use-pdf-highlights.ts)의
   * 같은 이름 변수 doc comment 참조. */
  pdfRelPath: null | string;
  scale: number;
  /** §276.3.1 텍스트 하이라이트 모드가 꺼져 있으면(기본값) 이 감지 자체를
   * 걸지 않는다 — 평범한 텍스트 선택이 팝업 없이 그대로 동작해야 한다. */
  textModeActive: boolean;
}): void {
  useEffect(() => {
    if (!active || !pdfRelPath || !textModeActive) return;
    const isMouseDownRef = { current: false };

    function trySelectionPopup() {
      const sel = document.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const text = sel.toString();
      if (!text.trim()) return;

      const range = sel.getRangeAt(0);
      const found = findPageForNode(
        pageElsRef.current,
        range.commonAncestorContainer,
      );
      if (!found) return;
      const pageProxy = pagesByNumberRef.current.get(found.pageNumber);
      if (!pageProxy) return;

      const clientRects = Array.from(range.getClientRects());
      if (clientRects.length === 0) return;

      const viewport = pageProxy.getViewport({ scale });
      const origin = found.el.getBoundingClientRect();
      // §274 UX fix (defect 2) — 아이템 경계 사이의 구멍을 닫는다
      // (pdf-highlight-geom.ts의 doc comment 참조). 앵커는 원본
      // clientRects의 마지막 rect를 그대로 쓴다 — 실제 드래그가 끝난 지점을
      // 병합 후 재정렬된 줄이 아니라 정확히 반영해야 하므로.
      const rects = mergeRectsByLine(clientRects).map((r) =>
        clientRectToPdf(r, origin, viewport),
      );
      const last = clientRects[clientRects.length - 1];

      onSelect({
        anchor: {
          left: last.right - origin.left,
          // §274 UX fix (defect 1) — 팝업이 정확히 방금 마우스를 뗀 지점에
          // 딱 붙어 뜨지 않도록 작은 여백을 둔다.
          top: last.bottom - origin.top + POPUP_ANCHOR_GAP,
        },
        pageNumber: found.pageNumber,
        rects,
        text,
      });
    }

    function handleSelectionChange() {
      if (isMouseDownRef.current) return;
      trySelectionPopup();
    }

    function handleMouseDown() {
      isMouseDownRef.current = true;
    }

    function handleMouseUp() {
      isMouseDownRef.current = false;
      trySelectionPopup();
    }

    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    // onSelect는 매 렌더 새 클로저를 만들 수 있는 콜백이라 deps에서 뺀다 —
    // 호출부는 useCallback으로 안정된 참조를 넘긴다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, pdfRelPath, scale, textModeActive]);
}
