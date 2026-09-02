// §324-g Quick Capture 본문 편집기 리사이즈 — 드래그로 높이를 바꾸고 설정에 기억한다.
//
// 다이얼로그에서 떼어낸 이유는 use-capture-tags.ts / use-capture-task-mode.ts와
// 같다: 상태 세 개와 window 리스너 등록/해제가 저장 분기 옆에서 다이얼로그의
// 몸통을 부풀린다.

import { useEffect, useRef, useState } from "react";

import { useShallow } from "zustand/shallow";

import { useSettingsStore } from "../../stores/settings/store";

interface CaptureResize {
  /** 편집기 컨테이너의 인라인 height(px)로 그대로 쓴다. */
  height: number;
  /** 리사이즈 핸들의 mousedown에 그대로 붙인다. */
  onResizeMouseDown: (e: React.MouseEvent) => void;
}

export function useCaptureResize(): CaptureResize {
  const { captureDialogHeight, setCaptureDialogHeight } = useSettingsStore(
    useShallow((s) => ({
      captureDialogHeight: s.captureDialogHeight,
      setCaptureDialogHeight: s.setCaptureDialogHeight,
    })),
  );
  // liveHeight는 드래그 중 화면에 반영되는 값, liveHeightRef는 mouseup
  // 핸들러가 최신 값을 읽는 통로(핸들러는 등록 시점의 클로저에 갇히므로 state를
  // 직접 읽으면 낡은 값을 쓴다), dragFrom은 드래그 시작점이다.
  const [liveHeight, setLiveHeight] = useState(captureDialogHeight);
  const liveHeightRef = useRef(liveHeight);
  const [dragFrom, setDragFrom] = useState<null | {
    startH: number;
    startY: number;
  }>(null);

  // 저장된 높이가 바뀌면(다른 창에서 조정) 따라간다. 드래그 중에는 건드리지 않는다.
  useEffect(() => {
    if (!dragFrom) setLiveHeight(captureDialogHeight);
  }, [captureDialogHeight, dragFrom]);

  useEffect(() => {
    liveHeightRef.current = liveHeight;
  }, [liveHeight]);

  // 드래그 중에는 window에서 이벤트를 받는다. 드래그가 끝날 때만 설정에 쓴다 —
  // 이동마다 쓰면 persist가 매 프레임 직렬화한다.
  useEffect(() => {
    if (!dragFrom) return;
    const onMove = (e: MouseEvent) => {
      setLiveHeight(
        Math.max(120, dragFrom.startH + e.clientY - dragFrom.startY),
      );
    };
    const onUp = () => {
      setDragFrom(null);
      setCaptureDialogHeight(liveHeightRef.current);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragFrom, setCaptureDialogHeight]);

  return {
    height: liveHeight,
    onResizeMouseDown: (e) =>
      setDragFrom({ startH: liveHeight, startY: e.clientY }),
  };
}
