// §283 레일 폭 드래그 조절.
//
// ‼️ 폭이 **두 개**로 나오는 것이 이 훅의 요점이다 — §280이 배율에 대해 한 것과
// 같은 분리다:
//
//   • `width`     — 드래그 중 매 프레임 따라가는 라이브 값. 레이아웃(CSS 변수,
//                   썸네일 프레임 크기, 본문 fit-width)이 이것을 쓴다.
//   • `rasterWidth` — 드래그를 **놓았을 때만** 바뀌는 값. 캔버스를 그리는 쪽
//                   (썸네일 렌더 배율, 영역 크롭 레이아웃)이 이것을 쓴다.
//
// 왜 나눠야 하는가: PdfThumbnail의 렌더 effect deps에 `scale`(= width/naturalWidth)이
// 있고, 그 effect는 `canvas.width = ...` 대입으로 **캔버스를 지우고** 시작한다.
// 라이브 폭을 그대로 주면 드래그 픽셀마다 모든 썸네일이 지워졌다가 다시 그려지고,
// 다음 픽셀이 그것을 취소한다 — 드래그하는 내내 레일이 비어 보인다. §280이
// 핀치에서 측정한 것과 정확히 같은 증상이다.
//
// 그 사이에도 화면은 맞다: `.pdf-thumbnail-frame`의 width/height는 라이브 폭을
// 따르고 `.pdf-thumbnail-frame canvas { width:100%; height:100% }`가 마지막
// 래스터를 그 크기로 늘려 그린다(pdf-side-panel.css). 잠깐 덜 선명할 뿐이다.
//
// ‼️ 그리고 이 분리는 타이머가 아니다. §280은 제스처가 "멎었는지"를 추측해야 해서
// SETTLE_MS가 필요했지만, 드래그에는 **놓는 순간**이라는 정확한 경계가 있다.
// 추측할 것이 없으므로 지연도 없다.
import { useCallback, useRef, useState } from "react";

import { useSettingsStore } from "../../../stores/settings/store";
import { clampRailWidth } from "./pdf-side-panel-utils";

/** 방향키 한 번에 움직이는 폭(CSS px). Shift와 조합하면 아래 배수만큼. */
const KEY_STEP_PX = 8;
const KEY_STEP_COARSE_PX = 40;

export interface PdfRailResize {
  /** 드래그 중인가 — 커서/하이라이트 스타일과 텍스트 선택 억제에 쓴다. */
  isResizing: boolean;
  /** 핸들의 keydown — 방향키/Home/End로도 조절되게 한다. */
  onResizeKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
  /** 핸들의 pointerdown. */
  onResizeStart: (e: React.PointerEvent<HTMLElement>) => void;
  /** 캔버스를 그릴 때 쓸 폭 — 드래그를 놓았을 때만 바뀐다. */
  rasterWidth: number;
  /** 레이아웃에 쓸 폭 — 드래그 중 매 프레임 바뀐다. */
  width: number;
}

export function usePdfRailResize(): PdfRailResize {
  const committed = useSettingsStore((s) => s.pdfRailWidth);
  const setPdfRailWidth = useSettingsStore((s) => s.setPdfRailWidth);

  // null = 드래그 중이 아님. 드래그 중에만 라이브 값이 여기 있다.
  const [dragWidth, setDragWidth] = useState<null | number>(null);
  // 드래그 시작 시점의 기준점. ref인 이유는 포인터 이벤트 사이에서만 읽고
  // 렌더에는 영향이 없어서다.
  const originRef = useRef({ clientX: 0, width: 0 });

  const onResizeStart = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      // 주 버튼만. 오른쪽 클릭으로 드래그가 시작되면 컨텍스트 메뉴와 겹친다.
      if (e.button !== 0) return;
      e.preventDefault();
      originRef.current = { clientX: e.clientX, width: committed };
      setDragWidth(committed);

      // ‼️ 포인터 캡처를 쓴다 — document에 리스너를 달지 않는다. 커서가 레일
      // 밖으로(본문 위로, 심지어 창 밖으로) 나가도 이 엘리먼트가 계속 이벤트를
      // 받으므로, 빠르게 끌었을 때 드래그가 끊기지 않는다. 정리도 자동이다.
      const handle = e.currentTarget;
      handle.setPointerCapture(e.pointerId);

      const onMove = (ev: PointerEvent) => {
        const next =
          originRef.current.width + (ev.clientX - originRef.current.clientX);
        setDragWidth(clampRailWidth(next));
      };
      const onEnd = (ev: PointerEvent) => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onEnd);
        handle.removeEventListener("pointercancel", onEnd);
        if (handle.hasPointerCapture(ev.pointerId)) {
          handle.releasePointerCapture(ev.pointerId);
        }
        // ‼️ 커밋을 먼저, 그 다음에 드래그 상태를 지운다. 순서가 뒤집히면
        // dragWidth가 null인데 committed는 아직 옛값인 한 프레임이 생겨 레일이
        // 원래 폭으로 튀었다가 돌아온다.
        setPdfRailWidth(
          originRef.current.width + (ev.clientX - originRef.current.clientX),
        );
        setDragWidth(null);
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onEnd);
      handle.addEventListener("pointercancel", onEnd);
    },
    [committed, setPdfRailWidth],
  );

  // 드래그만 있으면 포인터 없이는 조절할 수 없다. separator 관례대로 방향키를
  // 받는다 — 키보드에는 "놓는 순간"이 따로 없으므로 곧바로 커밋한다(그래서
  // 래스터도 즉시 따라온다. 키 한 번의 변화량이 작아 문제가 되지 않는다).
  const onResizeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      const step = e.shiftKey ? KEY_STEP_COARSE_PX : KEY_STEP_PX;
      let next: number;
      if (e.key === "ArrowLeft") next = committed - step;
      else if (e.key === "ArrowRight") next = committed + step;
      else if (e.key === "Home")
        next = 0; // clampRailWidth가 하한으로 자른다
      else if (e.key === "End") next = Number.MAX_SAFE_INTEGER;
      else return;
      // 방향키를 그냥 두면 레일 본문이 함께 스크롤된다(§282.4의 같은 이유).
      e.preventDefault();
      setPdfRailWidth(next);
    },
    [committed, setPdfRailWidth],
  );

  return {
    isResizing: dragWidth !== null,
    onResizeKeyDown,
    onResizeStart,
    rasterWidth: committed,
    width: dragWidth ?? committed,
  };
}
