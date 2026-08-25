import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../services/task-capture", () => ({ captureTask: vi.fn() }));

import { captureTask } from "../../../services/task-capture";
import { useFileStore } from "../../../stores/file/file";
import { useSettingsStore } from "../../../stores/settings/store";
import { useCaptureTaskMode } from "../use-capture-task-mode";

beforeEach(() => {
  vi.clearAllMocks();
  useFileStore.setState({ rootPath: "/v" });
  useSettingsStore.setState({ tasksCaptureFile: "Inbox.md" });
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

  it("설정된 수집함 파일과 오늘 날짜로 캡처한다", async () => {
    vi.mocked(captureTask).mockResolvedValue("- [ ] 우유 ➕2026-08-24");
    const { result } = renderHook(() => useCaptureTaskMode());
    await act(async () => {
      await result.current.save("우유");
    });
    expect(captureTask).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "우유",
        captureFile: "Inbox.md",
        rootPath: "/v",
      }),
    );
  });

  it("볼트가 없으면 캡처하지 않는다", async () => {
    useFileStore.setState({ rootPath: null });
    const { result } = renderHook(() => useCaptureTaskMode());
    await expect(result.current.save("우유")).rejects.toThrow();
    expect(captureTask).not.toHaveBeenCalled();
  });
});
