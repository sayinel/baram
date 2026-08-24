import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../../stores/settings/store";
import { useZoom } from "../use-zoom";

function fireCtrlWheel(deltaY: number): void {
  window.dispatchEvent(
    new WheelEvent("wheel", { cancelable: true, ctrlKey: true, deltaY }),
  );
}

// §281 WKWebView는 트랙패드 핀치를 Safari GestureEvent로 보낸다. jsdom에는
// GestureEvent 생성자가 없으므로 같은 모양의 이벤트를 만들어 보낸다 — 우리가
// 읽는 것은 `type`과 `scale`뿐이고, 이 테스트가 고정하려는 것은 그 계약이다.
function fireGesture(type: string, scale: number): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "scale", { configurable: true, value: scale });
  window.dispatchEvent(e);
  return e;
}

const zoom = () => useSettingsStore.getState().zoomLevel;

beforeEach(() => {
  useSettingsStore.getState().setZoomLevel(1);
  renderHook(() => useZoom(null));
});
afterEach(() => {
  useSettingsStore.getState().setZoomLevel(1);
});

describe("§281 WKWebView pinch (Safari GestureEvent)", () => {
  it("scale을 시작 시점 줌에 곱한다", () => {
    // scale은 제스처 시작 대비 누적값이다 — 델타가 아니다.
    fireGesture("gesturestart", 1);
    fireGesture("gesturechange", 1.5);
    expect(zoom()).toBeCloseTo(1.5, 4);

    // 같은 제스처 안에서 더 벌리면 여전히 **시작 시점** 기준으로 계산된다.
    fireGesture("gesturechange", 1.8);
    expect(zoom()).toBeCloseTo(1.8, 4);
  });

  it("다음 제스처는 끝난 자리에서 다시 시작한다", () => {
    fireGesture("gesturestart", 1);
    fireGesture("gesturechange", 1.5);
    fireGesture("gestureend", 1.5);

    fireGesture("gesturestart", 1);
    fireGesture("gesturechange", 1.2);
    // 1.5에서 시작해 1.2배 — 1.2가 아니라 1.8이어야 한다.
    expect(zoom()).toBeCloseTo(1.8, 4);
  });

  it("어느 배율에서든 같은 손동작이 같은 비율 변화를 낸다", () => {
    // 덧셈식 deltaY의 비대칭(줌 0.5에서와 2.0에서 4배 차이)이 사라졌는지.
    useSettingsStore.getState().setZoomLevel(0.6);
    fireGesture("gesturestart", 1);
    fireGesture("gesturechange", 1.5);
    const fromLow = zoom() / 0.6;
    fireGesture("gestureend", 1.5);

    useSettingsStore.getState().setZoomLevel(1.2);
    fireGesture("gesturestart", 1);
    fireGesture("gesturechange", 1.5);
    const fromHigh = zoom() / 1.2;
    fireGesture("gestureend", 1.5);

    expect(fromLow).toBeCloseTo(fromHigh, 3);
  });

  it("gesturestart의 기본 동작을 막는다", () => {
    // ‼️ 이걸 막지 않으면 WKWebView가 자기 페이지 줌을 하면서 제스처를 다시
    // 시작한다 — 진단에서 gesturestart가 반복되고 gestureend가 한 번뿐이었다.
    const e = fireGesture("gesturestart", 1);
    expect(e.defaultPrevented).toBe(true);
  });

  it("제스처 중에 도착한 ctrl+wheel은 무시한다", () => {
    // WKWebView는 같은 물리적 동작에 gesture와 ctrl+wheel을 둘 다 보낸다
    // (진단에서 같은 타임스탬프로 관측). 둘 다 적용하면 이중 반영된다.
    fireGesture("gesturestart", 1);
    fireGesture("gesturechange", 1.5);
    const afterGesture = zoom();

    fireCtrlWheel(-10);
    expect(zoom()).toBe(afterGesture);
  });

  it("제스처가 끝나면 ctrl+wheel이 다시 동작한다", () => {
    fireGesture("gesturestart", 1);
    fireGesture("gestureend", 1);
    const before = zoom();

    fireCtrlWheel(-10);
    expect(zoom()).toBeGreaterThan(before);
  });
});
