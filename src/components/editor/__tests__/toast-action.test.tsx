// §324-a 토스트가 제안하는 단 하나의 행동 — "어디에 붙었는지 알리고 그리로 갈 수 있게
// 한다". 그리고 그 통로가 **앱 전용**이라는 것까지가 이 파일의 계약이다.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createUIRequestHandler } from "../../../plugins/sandbox/host-ui-bridge";
import { useUIStore } from "../../../stores/ui/ui";
import { ToastHost } from "../Toast";

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
