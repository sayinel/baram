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
import { clampRailWidth } from "../../../utils/pdf-rail-width";

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
  // ‼️ clamp를 거쳐 읽는다. setPdfRailWidth는 자르지만 persist의 기본 merge는
  // **setter를 통하지 않고** 저장값을 얕게 밀어 넣으므로, 손상된 설정 파일이나
  // 다음 릴리스에서 범위를 좁혔을 때의 옛 저장값이 그대로 흘러든다. 그러면
  // railContentWidth를 거치는 소비자(썸네일·크롭)와 그렇지 않은 소비자
  // (CSS 변수·fit-width)가 서로 다른 폭을 보게 된다.
  const committed = useSettingsStore((s) => clampRailWidth(s.pdfRailWidth));
  const setPdfRailWidth = useSettingsStore((s) => s.setPdfRailWidth);

  // null = 드래그 중이 아님. 드래그 중에만 라이브 값이 여기 있다.
  const [dragWidth, setDragWidth] = useState<null | number>(null);
  // 지금 드래그를 쥐고 있는 포인터. 재진입 판정에만 쓴다.
  const activePointerRef = useRef<null | number>(null);

  const onResizeStart = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      // 주 버튼만. 오른쪽 클릭으로 드래그가 시작되면 컨텍스트 메뉴와 겹친다.
      if (e.button !== 0) return;
      // ‼️ 두 번째 포인터는 무시한다. 멀티터치(터치 노트북)나 마우스+펜에서
      // 실제로 온다 — 리뷰가 실측했다: 두 번째 pointerdown이 기준점을 덮어써서
      // 진행 중이던 첫 드래그가 하한으로 130px 역방향 점프했다.
      if (activePointerRef.current !== null) return;
      e.preventDefault();
      activePointerRef.current = e.pointerId;

      // ‼️ 기준점은 이 드래그의 **지역 상수**다. ref에 두면 위 재진입 가드가
      // 뚫렸을 때 두 드래그가 같은 기준점을 공유한다 — 가드와 이 클로저는
      // 같은 결함을 두 겹으로 막는다.
      const origin = { clientX: e.clientX, width: committed };
      setDragWidth(committed);

      // ‼️ 포인터 캡처를 쓴다 — document에 리스너를 달지 않는다. 커서가 레일
      // 밖으로(본문 위로, 심지어 창 밖으로) 나가도 이 엘리먼트가 계속 이벤트를
      // 받으므로, 빠르게 끌었을 때 드래그가 끊기지 않는다. 정리도 자동이다.
      const handle = e.currentTarget;
      handle.setPointerCapture(e.pointerId);
      // pointerdown의 preventDefault가 호환 mousedown을 막고, 포커스는 그
      // mousedown의 기본 동작이다 — 명시적으로 주지 않으면 드래그 직후
      // 방향키로 미세 조정할 수 없다(손잡이에 포커스가 없으므로).
      handle.focus();

      const widthAt = (clientX: number) =>
        clampRailWidth(origin.width + (clientX - origin.clientX));

      const onMove = (ev: PointerEvent) => {
        setDragWidth(widthAt(ev.clientX));
      };
      const onEnd = (ev: PointerEvent) => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onEnd);
        handle.removeEventListener("pointercancel", onEnd);
        if (handle.hasPointerCapture(ev.pointerId)) {
          handle.releasePointerCapture(ev.pointerId);
        }
        activePointerRef.current = null;
        // 순서는 무관하다 — React가 두 갱신을 한 번의 렌더로 배치한다
        // (zustand의 set도 useSyncExternalStore를 거쳐 같은 flush에 들어간다).
        // 처음엔 "뒤집으면 옛 폭으로 한 프레임 튄다"고 적었는데 **거짓**이었다:
        // 리뷰가 두 순서를 실제로 돌려 pointerup 이후 렌더가 양쪽 다 1회,
        // 값도 최종값 하나뿐임을 보였다. 읽기 순서로만 커밋을 먼저 둔다.
        setPdfRailWidth(widthAt(ev.clientX));
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
