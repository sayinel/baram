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
