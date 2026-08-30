// §312.1 스캔은 아젠다 패널의 것이 아니다 — 스토어를 읽는 모든 표면이 이 훅을 쓴다.
//
// 순수 판정(`resolveScanRoots`)은 `task-scan-scope.test.ts`가, 배선의 나머지는
// `task-agenda-panel-scope.test.tsx`가 고정한다. 여기서 보는 것은 훅으로 떼어내면서
// **새로 생긴 계약** 둘뿐이다: `enabled` 관문, 그리고 언제 다시 걷는가.
import type { ContextInfo } from "../../../ipc/types";

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getVaultTasks = vi.fn().mockResolvedValue([]);

vi.mock("../../../ipc/invoke", () => ({
  getFileTasks: vi.fn().mockResolvedValue([]),
  getVaultTasks: (...a: unknown[]) => getVaultTasks(...a),
}));

import { useContextStore } from "../../../stores/context/context";
import { useFileStore } from "../../../stores/file/file";
import { useSettingsStore } from "../../../stores/settings/store";
import { useTaskStore } from "../../../stores/tasks/task-store";
import { useTaskScan } from "../use-task-scan";

function vault(path: string): ContextInfo {
  return {
    addedAt: 0,
    color: "#000",
    contextType: "vault",
    id: path,
    label: path,
    path,
  };
}

/** 이번 렌더까지 스캔된 루트 — 호출 순서 그대로. */
function scannedRoots(): string[] {
  return getVaultTasks.mock.calls.map((c) => c[0] as string);
}

beforeEach(() => {
  vi.clearAllMocks();
  getVaultTasks.mockResolvedValue([]);
  useTaskStore.getState().clear();
  useFileStore.setState({ rootPath: "/vault" });
  useContextStore.setState({ contexts: [vault("/vault")] });
  useSettingsStore.setState({
    tasksExcludePaths: [],
    tasksHome: "/vault",
    tasksScanScope: "currentVault",
  });
});

describe("useTaskScan", () => {
  it("걷는다 — 해석된 루트를 그대로", async () => {
    renderHook(() => useTaskScan(true));
    await waitFor(() => expect(scannedRoots()).toEqual(["/vault"]));
  });

  it("‼️ enabled가 거짓이면 디스크를 건드리지 않는다", async () => {
    // 태스크 기능을 끈 사용자의 vault를, 그 사실을 모르는 새 표면(§307 A·C)이 조용히
    // 훑는 일이 없어야 한다. 이 훅이 세 표면의 유일한 스캔 진입점이므로 관문도 하나다.
    renderHook(() => useTaskScan(false));
    await act(async () => {
      await Promise.resolve();
    });
    expect(getVaultTasks).not.toHaveBeenCalled();
  });

  it("‼️ 내용이 같은 새 배열이 스토어에서 와도 다시 걷지 않는다", async () => {
    const { rerender } = renderHook(() => useTaskScan(true));
    await waitFor(() => expect(scannedRoots()).toEqual(["/vault"]));

    // 컨텍스트 스토어는 무엇이 바뀌든 **새 배열**을 낸다. 루트 배열을 그대로 effect
    // 의존성에 넣으면 그때마다 vault 전체를 다시 걷는다 — 이 훅의 유일한 방어가
    // `rootsKey`(내용 기반 키)이므로 그 방어가 사라지는 것을 여기서 잡는다.
    act(() => {
      useContextStore.setState({ contexts: [vault("/vault")] });
    });
    rerender();
    await act(async () => {
      await Promise.resolve();
    });
    expect(scannedRoots()).toEqual(["/vault"]);
  });

  it("자정을 넘기면 '지금'이 다음 날로 옮겨간다", async () => {
    // I4: 밤새 열어 둔 화면이 어제 기준으로 버킷을 나누면 "오늘"이 비고 "기한 초과"가
    // 하루 늦게 자란다. 타이머가 없으면 그 화면은 다시 열 때까지 어제에 머문다.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 30, 23, 30));
    try {
      const { result } = renderHook(() => useTaskScan(true));
      const before = result.current.now;
      expect(before.getDate()).toBe(30);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
      });

      expect(result.current.now.getDate()).toBe(31);
    } finally {
      vi.useRealTimers();
    }
  });

  it("루트가 바뀌면 다시 걷는다", async () => {
    const { rerender } = renderHook(() => useTaskScan(true));
    await waitFor(() => expect(scannedRoots()).toEqual(["/vault"]));

    act(() => {
      useFileStore.setState({ rootPath: "/other" });
    });
    rerender();
    await waitFor(() => expect(scannedRoots()).toEqual(["/vault", "/other"]));
  });

  it("refresh()는 지금을 다시 고정하고 한 번 더 걷는다", async () => {
    const { result } = renderHook(() => useTaskScan(true));
    await waitFor(() => expect(scannedRoots()).toEqual(["/vault"]));
    const before = result.current.now;

    await act(async () => {
      result.current.refresh();
    });

    // 자정을 넘겨 열어 둔 화면이 어제 기준으로 버킷을 나누지 않게 하는 것이 이 재고정의
    // 목적이다 — 걷기만 하고 `now`를 그대로 두면 새로고침이 절반만 듣는다.
    expect(result.current.now).not.toBe(before);
    expect(scannedRoots()).toEqual(["/vault", "/vault"]);
  });
});
