// §313 전역 캡처 단축키의 수명주기.
//
// 이 화면의 요구사항 중 **실패 표시가 필수**라는 것이 테스트하기 가장 어려운 부분이다.
// 등록 실패는 "다른 앱이 그 조합을 쥐고 있을 때"만 일어나므로 손으로 재현할 수 없다 —
// 여기서 플러그인을 세워 두고 거절시키는 이유다.
import { act } from "react";

import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingsStore } from "../../stores/settings/store";
import { useCaptureShortcutStatus } from "../../stores/tasks/capture-shortcut-status";
import { useUIStore } from "../../stores/ui/ui";
import { useGlobalCaptureShortcut } from "../use-global-capture-shortcut";

const register = vi.fn();
const unregister = vi.fn();

vi.mock("@tauri-apps/plugin-global-shortcut", () => ({
  register: (...args: unknown[]) => register(...args),
  unregister: (...args: unknown[]) => unregister(...args),
}));

const setFocus = vi.fn();
const show = vi.fn();
const unminimize = vi.fn();

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setFocus, show, unminimize }),
}));

function Harness() {
  useGlobalCaptureShortcut();
  return null;
}

/** 이펙트가 띄운 promise 체인이 끝날 때까지 흘려보낸다. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useGlobalCaptureShortcut", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    register.mockResolvedValue(undefined);
    unregister.mockResolvedValue(undefined);
    useSettingsStore.setState({ tasksGlobalCaptureShortcut: null });
    useCaptureShortcutStatus.setState({ status: { kind: "idle" } });
    useUIStore.setState({
      quickCaptureOpen: false,
      quickCaptureTaskIntent: false,
    });
  });

  it("설정이 비어 있으면 아무것도 등록하지 않는다", async () => {
    // §313의 기본값은 없음이다. 우리가 조합을 고르면 그것은 사용자가 다른 앱에서 쓰던
    // 키일 수 있고, 전역 단축키는 그 앱에서 키를 빼앗는다.
    render(<Harness />);
    await settle();
    expect(register).not.toHaveBeenCalled();
    expect(useCaptureShortcutStatus.getState().status.kind).toBe("idle");
  });

  it("설정된 조합을 액셀러레이터로 옮겨 등록한다", async () => {
    useSettingsStore.setState({ tasksGlobalCaptureShortcut: "Mod+Shift+N" });
    render(<Harness />);
    await settle();
    expect(register).toHaveBeenCalledWith(
      "CommandOrControl+Shift+N",
      expect.any(Function),
    );
    expect(useCaptureShortcutStatus.getState().status).toEqual({
      accelerator: "CommandOrControl+Shift+N",
      kind: "registered",
    });
  });

  it("OS가 거절하면 그 사실을 상태로 남긴다 — 조용히 지나가지 않는다", async () => {
    // ‼️ §313이 명시적으로 금지한 상태: 사용자는 설정에 조합을 적어 두고, 눌러도 아무
    // 일이 없는 이유를 알 수 없다.
    register.mockRejectedValue(new Error("HotKey already registered"));
    useSettingsStore.setState({ tasksGlobalCaptureShortcut: "Mod+Shift+N" });
    render(<Harness />);
    await settle();
    expect(useCaptureShortcutStatus.getState().status.kind).toBe("unavailable");
  });

  it("등록에 실패한 조합은 해제하지 않는다", async () => {
    // 그 조합을 실제로 쥐고 있는 것은 **다른 앱**이다. 해제를 보내면 우리 것이 아닌
    // 등록을 푸는 셈이 된다.
    register.mockRejectedValue(new Error("nope"));
    useSettingsStore.setState({ tasksGlobalCaptureShortcut: "Mod+Shift+N" });
    const view = render(<Harness />);
    await settle();
    view.unmount();
    await settle();
    expect(unregister).not.toHaveBeenCalled();
  });

  it("수식키 없는 조합은 OS에 물어보지 않고 거절한다", async () => {
    useSettingsStore.setState({ tasksGlobalCaptureShortcut: "N" });
    render(<Harness />);
    await settle();
    expect(register).not.toHaveBeenCalled();
    expect(useCaptureShortcutStatus.getState().status.kind).toBe("invalid");
  });

  it("값이 바뀌면 이전 등록을 해제한다", async () => {
    useSettingsStore.setState({ tasksGlobalCaptureShortcut: "Mod+Shift+N" });
    render(<Harness />);
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    await act(async () => {
      useSettingsStore.setState({ tasksGlobalCaptureShortcut: "Mod+Shift+K" });
      // 이펙트가 띄운 등록 promise가 끝나야 재등록까지 관찰된다.
      await Promise.resolve();
    });
    expect(register).toHaveBeenCalledTimes(2);
    // 해제하지 않으면 예전 조합이 계속 앱을 불러낸다 — 사용자는 바꿨다고 믿는데.
    expect(unregister).toHaveBeenCalledWith("CommandOrControl+Shift+N");
    expect(register.mock.calls[1][0]).toBe("CommandOrControl+Shift+K");
  });

  it("누를 때만 캡처창을 태스크 모드로 연다", async () => {
    useSettingsStore.setState({ tasksGlobalCaptureShortcut: "Mod+Shift+N" });
    render(<Harness />);
    await settle();
    const handler = register.mock.calls[0][1] as (e: { state: string }) => void;

    // 뗄 때도 이벤트가 온다. 무시하지 않으면 창이 열리자마자 다시 열려 본문이 지워진다.
    await act(async () => handler({ state: "Released" }));
    expect(useUIStore.getState().quickCaptureOpen).toBe(false);

    await act(async () => {
      handler({ state: "Pressed" });
      await Promise.resolve();
    });
    expect(useUIStore.getState().quickCaptureOpen).toBe(true);
    expect(useUIStore.getState().quickCaptureTaskIntent).toBe(true);
  });

  it("창을 앞으로 불러낸다 — 최소화·숨김 상태에서도", async () => {
    useSettingsStore.setState({ tasksGlobalCaptureShortcut: "Mod+Shift+N" });
    render(<Harness />);
    await settle();
    const handler = register.mock.calls[0][1] as (e: { state: string }) => void;
    await act(async () => {
      handler({ state: "Pressed" });
    });
    await settle();
    // 순서가 있다: 최소화된 창은 show()만으로 올라오지 않고, 보이지 않는 창은
    // setFocus()가 듣지 않는다.
    expect(unminimize).toHaveBeenCalled();
    expect(show).toHaveBeenCalled();
    expect(setFocus).toHaveBeenCalled();
  });
});
