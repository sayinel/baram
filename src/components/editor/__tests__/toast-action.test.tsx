// §324-a 토스트가 제안하는 단 하나의 행동 — "어디에 붙었는지 알리고 그리로 갈 수 있게
// 한다". 그리고 그 통로가 **앱 전용**이라는 것까지가 이 파일의 계약이다.
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createUIRequestHandler } from "../../../plugins/sandbox/host-ui-bridge";
import { useUIStore } from "../../../stores/ui/ui";
import {
  TOAST_ACTION_DURATION_MS,
  TOAST_DURATION_MS,
  ToastHost,
} from "../Toast";

describe("ToastHost — action button (§324-a)", () => {
  beforeEach(() => {
    useUIStore.setState({ toast: null });
  });

  it("renders the action button and calls its handler", async () => {
    const onClick = vi.fn();
    useUIStore.getState().showToast("Added to 영감노트", "info", undefined, {
      label: "Open",
      onClick,
    });
    render(<ToastHost />);

    await userEvent.click(screen.getByRole("button", { name: "Open" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  // 행동을 실행한 토스트가 남아 있으면 사용자는 그것을 "아직 안 눌렸다"로 읽고 한 번 더
  // 누른다 — 같은 노트가 탭에서 두 번 열리거나, 다음 토스트가 이 잔상 위에 겹친다.
  it("dismisses itself once the action has run", async () => {
    useUIStore.getState().showToast("Added to 영감노트", "info", undefined, {
      label: "Open",
      onClick: vi.fn(),
    });
    render(<ToastHost />);

    await userEvent.click(screen.getByRole("button", { name: "Open" }));

    expect(useUIStore.getState().toast).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  // §324-a 이 토스트는 대상 노트의 이름이 나타나는 **유일한** 자리이고 `[열기]`가 있는
  // 유일한 자리다. 3초는 이름을 읽고, 갈지 말지 정하고, 누르기에 부족하다 — 그러면
  // "어디에 갔는지 알고 그리로 갈 수 있다"는 것이 이름뿐인 기능이 된다.
  //
  // 아래 두 테스트는 짝이다. 두 번째가 없으면 첫 번째는 "타이머가 아예 안 돌았다"로도
  // 통과한다.
  it("keeps a toast that carries an action on screen past the base duration", () => {
    vi.useFakeTimers();
    try {
      useUIStore.getState().showToast("Added to 영감노트", "info", undefined, {
        label: "Open",
        onClick: vi.fn(),
      });
      render(<ToastHost />);

      act(() => vi.advanceTimersByTime(TOAST_DURATION_MS + 1));
      expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();

      act(() =>
        vi.advanceTimersByTime(TOAST_ACTION_DURATION_MS - TOAST_DURATION_MS),
      );
      expect(useUIStore.getState().toast).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("dismisses a plain toast on the base duration", () => {
    vi.useFakeTimers();
    try {
      useUIStore.getState().showToast("plain", "info");
      render(<ToastHost />);

      act(() => vi.advanceTimersByTime(TOAST_DURATION_MS + 1));
      expect(useUIStore.getState().toast).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // §324-a 이 토스트는 자기가 이름 붙인 노트로 가는 **유일한** 통로다. 그러면 자동
  // 소멸은 단순한 연출이 아니라 사용자 행동에 걸린 제한 시간이 된다(WCAG 2.2 SC 2.2.1).
  // 시간을 늘리는 것은 그 요구를 만족시키지 못한다 — **멈출 수 있어야** 한다.
  //
  // 화면 낭독기 사용자에게 특히 그렇다: `aria-live="polite"`라 메시지를 다 들은 **뒤에야**
  // 버튼을 찾기 시작한다.
  describe("the countdown is stoppable, not merely long", () => {
    const toastBox = () => document.querySelector(".toast")!;

    function showActionToast() {
      useUIStore.getState().showToast("Added to 영감노트", "info", undefined, {
        label: "Open",
        onClick: vi.fn(),
      });
    }

    it("pauses while the pointer is over the toast", () => {
      vi.useFakeTimers();
      try {
        showActionToast();
        render(<ToastHost />);

        fireEvent.mouseEnter(toastBox());
        act(() => vi.advanceTimersByTime(TOAST_ACTION_DURATION_MS * 3));
        expect(useUIStore.getState().toast).not.toBeNull();

        // 그리고 포인터가 떠나면 다시 흐른다 — 멈춤이지 영구 정지가 아니다.
        fireEvent.mouseLeave(toastBox());
        act(() => vi.advanceTimersByTime(TOAST_ACTION_DURATION_MS + 1));
        expect(useUIStore.getState().toast).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it("pauses while the action button holds keyboard focus", () => {
      vi.useFakeTimers();
      try {
        showActionToast();
        render(<ToastHost />);
        const button = screen.getByRole("button", { name: "Open" });

        fireEvent.focus(button);
        act(() => vi.advanceTimersByTime(TOAST_ACTION_DURATION_MS * 3));
        expect(useUIStore.getState().toast).not.toBeNull();

        fireEvent.blur(button);
        act(() => vi.advanceTimersByTime(TOAST_ACTION_DURATION_MS + 1));
        expect(useUIStore.getState().toast).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    // ‼️ 행동 버튼을 누르면 포인터가 토스트 위에 **있는 채로** 요소가 사라진다 —
    // `mouseleave`는 영영 오지 않는다. 일시정지 상태가 그대로 굳으면 그 뒤의 **모든**
    // 토스트가 자동으로 사라지지 않는다. 멈춤은 지금 떠 있는 토스트에만 매여야 한다.
    it("does not carry a pause over to the next toast", () => {
      vi.useFakeTimers();
      try {
        showActionToast();
        render(<ToastHost />);

        fireEvent.mouseEnter(toastBox());
        fireEvent.click(screen.getByRole("button", { name: "Open" }));
        expect(useUIStore.getState().toast).toBeNull();

        act(() => useUIStore.getState().showToast("plain", "info"));
        act(() => vi.advanceTimersByTime(TOAST_DURATION_MS + 1));
        expect(useUIStore.getState().toast).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ‼️ 셀렉터로 단정한다. 여기서 실제로 났던 결함은 클래스 문자열의 **공백 하나**가
  // 빠져 `"toast toast-infotoast-interactive"`가 나온 것이다 — 두 이름을 모두 담고 있으면서
  // 두 셀렉터 어디에도 걸리지 않는 문자열이다. 그래서 `className`에 대한 부분 문자열
  // 검사로는 잡히지 않고, `classList`/`querySelector`로만 잡힌다.
  //
  // 이 한 글자가 (a) 행동 토스트의 강조 테두리를 없애고 (b) `pointer-events: auto`를
  // 적용하지 못하게 해 토스트 **본문** 위 hover 일시정지를 죽였다. 아래 hover 테스트는
  // `.toast`에 직접 이벤트를 쏘므로 jsdom에서는 그대로 통과했다.
  it("marks an action toast interactive without swallowing its type class", () => {
    useUIStore.getState().showToast("Added to 영감노트", "info", undefined, {
      label: "Open",
      onClick: vi.fn(),
    });
    render(<ToastHost />);

    expect(
      document.querySelector(".toast.toast-info.toast-interactive"),
    ).not.toBeNull();
  });

  it("leaves a plain toast click-through and unstyled by the action modifier", () => {
    useUIStore.getState().showToast("plain", "info");
    render(<ToastHost />);

    expect(document.querySelector(".toast.toast-info")).not.toBeNull();
    expect(document.querySelector(".toast-interactive")).toBeNull();
  });

  it("renders no button when no action is given", () => {
    useUIStore.getState().showToast("plain", "info");
    render(<ToastHost />);

    expect(screen.getByText("plain")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  // ‼️ §260 Phase 4a와 같은 경계다. 샌드박스 플러그인은 `host-ui-bridge.ts`의 **3-인자**
  // `showToast`로만 닿으므로 콜백을 넘길 통로가 없다 — `source` 배지가 문자열이라 위조가
  // 가능했던 것과는 반대 상황이다. 아래 두 단정이 그 사실을 계약으로 못 박는다:
  // 브리지가 네 번째 인자를 넘기도록 넓어지면 둘 다 실패해야 한다.
  describe("the sandbox bridge has no way to supply an action", () => {
    it("leaves a plugin toast without an action, through the real store wiring", async () => {
      // `showToast`를 주입하지 **않는다** — 프로덕션 기본값(스토어로 직접 쓰는 것)이
      // 정확히 검증 대상이기 때문이다.
      const handler = createUIRequestHandler({
        capabilities: ["statusbar"],
        declaredStatusBarIds: [],
        pluginId: "acme.notes",
        pluginName: "Acme Notes",
      });

      await handler({
        kind: "ui_notify",
        message: "indexed 12 notes",
        type: "info",
      });

      const { toast } = useUIStore.getState();
      // 토스트가 실제로 떴다는 것부터 — 이게 없으면 아래 단정이 "아무 일도 없었다"로도
      // 통과한다.
      expect(toast?.message).toBe("indexed 12 notes");
      expect(toast?.source).toBe("Acme Notes");
      expect(toast?.action).toBeUndefined();
    });

    it("passes exactly three arguments to showToast", async () => {
      const showToast = vi.fn();
      const handler = createUIRequestHandler({
        capabilities: ["statusbar"],
        declaredStatusBarIds: [],
        pluginId: "acme.notes",
        showToast,
      });

      await handler({ kind: "ui_notify", message: "hi", type: "info" });

      // 인자 개수 그 자체가 단정이다 — 네 번째 자리가 생기는 순간 실패한다.
      expect(showToast.mock.calls[0]).toHaveLength(3);
    });
  });
});
