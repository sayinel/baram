// §312.1 지금 설정·컨텍스트로 스캔할 루트 — 렌더 밖에서 부르는 곳을 위한 얇은 층.
//
// 패널은 리렌더가 필요하므로 훅으로 같은 값을 계산한다(`TaskAgendaPanel`). 규칙 자체는
// `task-scan-scope.ts` 한 곳에만 있고 여기는 스토어 세 개를 읽어 넘기기만 한다.
//
// ‼️ **마지막 스캔이 걷은 루트**(`useTaskStore.roots`)와 혼동하지 말 것. 그쪽은 "지금
// 목록에 든 것이 어디서 왔나"이고 이쪽은 "지금 걷는다면 어디를 걸을까"다. 워처처럼
// 이미 로드된 목록을 다루는 곳은 그쪽을, 새로 걷는 곳은 이쪽을 쓴다.

import { resolveScanRoots } from "../../utils/tasks/task-scan-scope";
import { resolveTasksHome } from "../../utils/tasks/tasks-home";
import { useContextStore } from "../context/context";
import { useFileStore } from "../file/file";
import { useSettingsStore } from "../settings/store";

export function currentScanRoots(): string[] {
  const { tasksHome, tasksScanScope, zettelkastenDirectory } =
    useSettingsStore.getState();
  return resolveScanRoots(tasksScanScope, {
    rootPath: useFileStore.getState().rootPath,
    tasksHome: resolveTasksHome(tasksHome, zettelkastenDirectory),
    vaultPaths: useContextStore
      .getState()
      .vaultContexts()
      .map((c) => c.path),
  });
}
