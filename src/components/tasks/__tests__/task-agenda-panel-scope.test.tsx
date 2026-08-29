// §312.1 스캔 범위 선택 — 패널이 무엇을 스캔하는가.
//
// 순수 판정은 `task-scan-scope.test.ts`가 고정한다. 여기서 보는 것은 **배선**뿐이다:
// 어떤 스토어가 그 판정의 입력이 되고, 범위를 바꾸면 실제로 다른 루트를 부르는가.
import type { ContextInfo } from "../../../ipc/types";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getVaultTasks = vi.fn().mockResolvedValue([]);

// listDir/readFile 스텁이 필요한 이유: TaskAgendaPanel → useZettelIndexStore →
// 같은 모듈에서 listDir/readFile을 import한다. appendTaskLine은 `task-capture`가
// 가져간다 — 이름이 하나라도 빠지면 import 자체가 실패한다.
vi.mock("../../../ipc/invoke", () => ({
  appendTaskLine: vi.fn(),
  archiveTaskLines: vi.fn(),
  getFileTasks: vi.fn().mockResolvedValue([]),
  getVaultTasks: (...a: unknown[]) => getVaultTasks(...a),
  listDir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(""),
}));

// 컨텍스트 스토어는 persist 미들웨어를 통해 Tauri 스토리지를 건드린다 — 여기서는
// `contexts` 배열만 필요하므로 `setState`로 직접 세운다.
import { useContextStore } from "../../../stores/context/context";
import { useFileStore } from "../../../stores/file/file";
import { useSettingsStore } from "../../../stores/settings/store";
import { useTaskStore } from "../../../stores/tasks/task-store";
import { TaskAgendaPanel } from "../TaskAgendaPanel";

/** 이번 렌더에서 스캔된 루트 — 호출 순서 그대로. */
function scannedRoots(): string[] {
  return getVaultTasks.mock.calls.map((c) => c[0] as string);
}

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

beforeEach(() => {
  vi.clearAllMocks();
  getVaultTasks.mockResolvedValue([]);
  useTaskStore.getState().clear();
  useFileStore.setState({ rootPath: "/vault" });
  useContextStore.setState({
    contexts: [vault("/vault"), vault("/other")],
  });
  useSettingsStore.setState({
    locale: "en",
    tasksExcludePaths: [],
    tasksHome: "/home",
    tasksScanScope: "allVaults",
    zettelkastenDirectory: "",
  });
});

describe("TaskAgendaPanel — 스캔 범위 (§312.1)", () => {
  it("기본은 전체 — 열린 vault 전부와 태스크 홈을 스캔한다", async () => {
    // 기본이 "전체"인 이유는 §312 상황 1이다: 문서 안에 그 자리에 친 `[ ] `는 정의상
    // 태스크 홈 **밖**에 남는데, 그것이 가장 흔한 캡처 경로다.
    render(<TaskAgendaPanel />);

    await waitFor(() => expect(getVaultTasks).toHaveBeenCalledTimes(3));
    expect(scannedRoots()).toEqual(["/vault", "/other", "/home"]);
  });

  it("겹치는 루트는 한 번만 스캔한다", async () => {
    // Zettel 디렉터리를 vault 안에 두는 흔한 배치. 두 번 걷으면 같은 태스크가 두 번
    // 뜨고, 체크하면 한 줄만 사라져 나머지가 유령이 된다.
    useSettingsStore.setState({ tasksHome: "/vault/zettel" });
    render(<TaskAgendaPanel />);

    await waitFor(() => expect(getVaultTasks).toHaveBeenCalled());
    expect(scannedRoots()).toEqual(["/vault", "/other"]);
  });

  it("폴더 컨텍스트는 스캔하지 않는다 — 상위 vault와 중복이다", async () => {
    useContextStore.setState({
      contexts: [
        vault("/vault"),
        { ...vault("/vault/sub"), contextType: "folder" },
      ],
    });
    render(<TaskAgendaPanel />);

    await waitFor(() => expect(getVaultTasks).toHaveBeenCalled());
    expect(scannedRoots()).toEqual(["/vault", "/home"]);
  });

  it("범위를 바꾸면 설정에 남고 그 즉시 다시 스캔한다", async () => {
    // "선택은 바꾸기 전까지 유지된다"가 §312.1의 요구사항이라 설정에 persist된다.
    render(<TaskAgendaPanel />);
    await waitFor(() => expect(getVaultTasks).toHaveBeenCalled());
    getVaultTasks.mockClear();

    await userEvent.selectOptions(
      screen.getByLabelText("Agenda scope"),
      "tasksHome",
    );

    expect(useSettingsStore.getState().tasksScanScope).toBe("tasksHome");
    await waitFor(() => expect(getVaultTasks).toHaveBeenCalledTimes(1));
    expect(scannedRoots()).toEqual(["/home"]);
  });

  it("현재 볼트 범위는 활성 컨텍스트 루트만 본다", async () => {
    useSettingsStore.setState({ tasksScanScope: "currentVault" });
    render(<TaskAgendaPanel />);

    await waitFor(() => expect(getVaultTasks).toHaveBeenCalledTimes(1));
    expect(scannedRoots()).toEqual(["/vault"]);
  });

  it("태스크 홈이 없으면 그 범위에서는 아무것도 스캔하지 않는다", async () => {
    useSettingsStore.setState({
      tasksHome: "",
      tasksScanScope: "tasksHome",
      zettelkastenDirectory: "",
    });
    render(<TaskAgendaPanel />);

    // 새로고침 버튼까지 함께 잠긴다 — 누를 수 있는데 아무 일도 안 하면 고장으로 보인다.
    expect(screen.getByTitle("Refresh")).toBeDisabled();
    expect(getVaultTasks).not.toHaveBeenCalled();
  });

  it("태스크 홈이 비면 Zettel 디렉터리를 스캔한다 — 그것이 기본값이다", async () => {
    useSettingsStore.setState({
      tasksHome: "",
      tasksScanScope: "tasksHome",
      zettelkastenDirectory: "/zettel",
    });
    render(<TaskAgendaPanel />);

    await waitFor(() => expect(getVaultTasks).toHaveBeenCalledTimes(1));
    expect(scannedRoots()).toEqual(["/zettel"]);
  });
});
