import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../services/task-capture", async (orig) => ({
  // `CaptureError`는 실물을 쓴다 — 훅이 `noTasksHome`을 그것으로 던지고, UI가
  // `instanceof`로 문구를 고른다.
  ...(await orig<typeof import("../../../services/task-capture")>()),
  captureTask: vi.fn(),
}));

import { CaptureError, captureTask } from "../../../services/task-capture";
import { useSettingsStore } from "../../../stores/settings/store";
import { captureErrorKey, useCaptureTaskMode } from "../use-capture-task-mode";

beforeEach(() => {
  vi.clearAllMocks();
  // §312.1 착지점은 태스크 홈이다 — 열린 vault가 아니다. `rootPath`를 여기서 세우지
  // 않는 것이 그 계약이고, 아래 "vault와 무관하다" 테스트가 그것을 고정한다.
  useSettingsStore.setState({
    tasksCaptureFile: "tasks/inbox.md",
    tasksEnabled: true,
    tasksHome: "/home",
    zettelkastenDirectory: "",
  });
});

describe("useCaptureTaskMode", () => {
  it("기본값은 꺼짐 — 기존 fleeting note 동작이 유지된다", () => {
    const { result } = renderHook(() => useCaptureTaskMode());
    expect(result.current.enabled).toBe(false);
  });

  it("토글된다", () => {
    const { result } = renderHook(() => useCaptureTaskMode());
    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(false);
  });

  it("reset은 켜진 모드를 끈다 — 다이얼로그가 열릴 때마다 새 결정이다", () => {
    const { result } = renderHook(() => useCaptureTaskMode());
    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(true);
    act(() => result.current.reset());
    expect(result.current.enabled).toBe(false);
  });

  it("설정된 수집함 파일과 오늘 날짜로 캡처한다", async () => {
    vi.mocked(captureTask).mockResolvedValue("- [ ] 우유 ➕2026-08-24");
    const { result } = renderHook(() => useCaptureTaskMode());
    await act(async () => {
      await result.current.save("우유", []);
    });
    expect(captureTask).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "우유",
        captureFile: "tasks/inbox.md",
        tasksHome: "/home",
      }),
    );
  });

  it("태그를 서비스로 넘긴다 — 여기서 버리면 #someday가 줄에 닿지 않는다", async () => {
    vi.mocked(captureTask).mockResolvedValue("x");
    const { result } = renderHook(() => useCaptureTaskMode());
    await act(async () => {
      await result.current.save("Rust 배우기", ["someday"]);
    });
    expect(captureTask).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ["someday"] }),
    );
  });

  it("태스크 홈이 비면 Zettel 디렉터리로 떨어진다 — 기본값이 그것이다", async () => {
    useSettingsStore.setState({
      tasksHome: "",
      zettelkastenDirectory: "/zettel",
    });
    vi.mocked(captureTask).mockResolvedValue("x");
    const { result } = renderHook(() => useCaptureTaskMode());
    await act(async () => {
      await result.current.save("우유", []);
    });
    expect(captureTask).toHaveBeenCalledWith(
      expect.objectContaining({ tasksHome: "/zettel" }),
    );
  });

  it("둘 다 없으면 캡처하지 않고 noTasksHome으로 던진다", async () => {
    // ‼️ 열린 vault로 폴백하지 않는다. 폴백을 두면 설정하지 않은 사용자에게는 §312.1이
    // 없애려던 "컨텍스트 따라 떠다니는 수집함"이 그대로 남는다.
    useSettingsStore.setState({ tasksHome: "", zettelkastenDirectory: "" });
    const { result } = renderHook(() => useCaptureTaskMode());
    await expect(result.current.save("우유", [])).rejects.toBeInstanceOf(
      CaptureError,
    );
    expect(captureTask).not.toHaveBeenCalled();
  });

  it("상대 경로 설정은 태스크 홈이 되지 못한다 — 절대 경로만 받는다", async () => {
    useSettingsStore.setState({
      tasksHome: "zettel",
      zettelkastenDirectory: "",
    });
    const { result } = renderHook(() => useCaptureTaskMode());
    await expect(result.current.save("우유", [])).rejects.toBeInstanceOf(
      CaptureError,
    );
    expect(captureTask).not.toHaveBeenCalled();
  });
});

// §338/Fix H — task mode is pinned false while Tasks is off, at the ONE
// chokepoint (this hook) rather than in each of its 3 call sites (the
// checkbox, the in-dialog chord, and the global-capture shortcut's "open
// already in task mode" path — see QuickCaptureDialog.test.tsx for those).
describe("useCaptureTaskMode — gated on tasksEnabled (§338/Fix H)", () => {
  it("toggle() does nothing while tasks is disabled", () => {
    useSettingsStore.setState({ tasksEnabled: false });
    const { result } = renderHook(() => useCaptureTaskMode());
    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(false);
  });

  it("toggle() still works when tasks is enabled — positive control", () => {
    useSettingsStore.setState({ tasksEnabled: true });
    const { result } = renderHook(() => useCaptureTaskMode());
    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(true);
  });

  it("reset(true) does not turn task mode on while tasks is disabled", () => {
    // This is the global-capture shortcut's exact call shape
    // (use-global-capture-shortcut.ts -> openQuickCaptureForTask() ->
    // quickCaptureTaskIntent: true -> QuickCaptureDialog's
    // resetTaskMode(quickCaptureTaskIntent)).
    useSettingsStore.setState({ tasksEnabled: false });
    const { result } = renderHook(() => useCaptureTaskMode());
    act(() => result.current.reset(true));
    expect(result.current.enabled).toBe(false);
  });

  it("reset(true) still turns task mode on when tasks is enabled — positive control", () => {
    useSettingsStore.setState({ tasksEnabled: true });
    const { result } = renderHook(() => useCaptureTaskMode());
    act(() => result.current.reset(true));
    expect(result.current.enabled).toBe(true);
  });

  it("a toggle queued while tasks is off does not resurface once tasks is re-enabled", () => {
    // Guards the "gate the setter, not just the read" design: if only the
    // returned `enabled` were ANDed with tasksEnabled, a toggle() while
    // disabled could still flip the internal state, and re-enabling tasks
    // would silently reveal a mode nobody explicitly turned on this session.
    useSettingsStore.setState({ tasksEnabled: false });
    const { result, rerender } = renderHook(() => useCaptureTaskMode());
    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(false);

    useSettingsStore.setState({ tasksEnabled: true });
    rerender();
    expect(result.current.enabled).toBe(false);
  });

  it("turning tasks off while the mode is already on reports it off", () => {
    // ‼️ 위 테스트의 **반대 방향**이다(재리뷰 I-C, 이 브랜치 다섯 번째 흡수 사례).
    // 위 것은 "세터를 막아야 한다"를 지키고, 이건 "읽기도 막아야 한다"를 지킨다.
    // 실측: `const enabled = tasksEnabled && enabledState;` 를 `= enabledState;` 로
    // 바꿔도(세터 게이트 둘은 그대로) 93건이 전부 초록이었다 — 세터 게이트가 읽기
    // 게이트의 뮤테이션을 흡수한다.
    //
    // 이 상태는 실제로 도달한다: 태스크 모드를 켠 채 캡처창을 열어 두고 설정에서
    // Tasks 를 끄면, 읽기 게이트가 없으면 체크박스는 컴포넌트 게이트로 **사라지는데**
    // 모드는 **켜진 채**이고 저장은 태스크 수집함으로 간다 — 꺼진 기능이 보이지 않게
    // 계속 동작한다.
    useSettingsStore.setState({ tasksEnabled: true });
    const { result, rerender } = renderHook(() => useCaptureTaskMode());
    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(true); // 양성 대조군

    useSettingsStore.setState({ tasksEnabled: false });
    rerender();
    expect(result.current.enabled).toBe(false);
  });
});

describe("captureErrorKey", () => {
  it("원인별로 다른 키를 준다 — 홈이 없는데 수집함 얘기를 하지 않는다", () => {
    expect(captureErrorKey(new CaptureError("noTasksHome", "x"))).toBe(
      "journal.capture.error.taskNoHome",
    );
    expect(captureErrorKey(new CaptureError("dirtyTab", "x"))).toBe(
      "journal.capture.error.taskDirtyTab",
    );
    expect(captureErrorKey(new CaptureError("notMarkdown", "x"))).toBe(
      "journal.capture.error.taskNotMarkdown",
    );
    expect(captureErrorKey(new CaptureError("outsideHome", "x"))).toBe(
      "journal.capture.error.taskOutsideHome",
    );
  });

  it("코드가 없는 예외(권한·디스크)만 일반 문구로 떨어진다", () => {
    expect(captureErrorKey(new Error("EACCES"))).toBe(
      "journal.capture.error.taskSave",
    );
  });
});
