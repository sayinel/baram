import type { TaskEntry } from "../../ipc/types";

// §304 태스크 캐시 — Rust는 상태를 갖지 않으므로 여기가 유일한 캐시다.
import { create } from "zustand";

import { getFileTasks, getVaultTasks } from "../../ipc/invoke";
import { logger } from "../../utils/logger";
import { useSettingsStore } from "../settings/store";

interface TaskStoreState {
  clear: () => void;
  error: null | string;
  loading: boolean;
  patchTask: (path: string, line: number, patch: Partial<TaskEntry>) => void;
  removeFile: (path: string) => void;
  replaceFile: (path: string, entries: TaskEntry[]) => void;
  setAll: (tasks: TaskEntry[]) => void;
  setError: (error: null | string) => void;
  setLoading: (loading: boolean) => void;
  tasks: TaskEntry[];
}

export const useTaskStore = create<TaskStoreState>((set) => ({
  tasks: [],
  loading: false,
  error: null,
  setAll: (tasks) => set({ tasks, error: null }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  replaceFile: (path, entries) =>
    set((s) => ({
      tasks: [...s.tasks.filter((t) => t.path !== path), ...entries],
    })),
  // §305 열린 문서 경로 — 아직 저장되지 않았으므로 디스크를 다시 읽으면 방금
  // 만든 변경이 옛 내용으로 되돌아간다. 그 한 줄만 제자리에서 갱신한다.
  // 자동 저장이 켜져 있으면 저장 시 워처가 전체를 조정한다.
  patchTask: (path, line, patch) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.path === path && t.line === line ? { ...t, ...patch } : t,
      ),
    })),
  removeFile: (path) =>
    set((s) => ({ tasks: s.tasks.filter((t) => t.path !== path) })),
  clear: () => set({ tasks: [], loading: false, error: null }),
}));

// I3: 요청 순번. 두 스캔이 겹쳐 돌다가 exclude 리스트가 더 짧던(=옛) 요청이
// 나중에 응답하면, 그 결과로 최신 요청의 결과를 덮어써 방금 제외한 폴더의
// 태스크가 되살아나 보인다. 시작할 때 순번을 찍고 응답 시점에 아직 최신인지
// 확인해 낡은 응답은 버린다 — 수동 새로고침 버튼과 워처 경로도 함께 보호된다.
let requestSeq = 0;

/**
 * vault 전체 재스캔. 패널 마운트·컨텍스트 변경·수동 새로고침에서 부른다.
 * `tasksEnabled`가 꺼져 있으면 아무것도 하지 않는다(I2) — 그러지 않으면
 * 패널이 언마운트돼 있어도 마운트 시점의 전체 스캔이 계속 돌아간다.
 */
export async function refreshAllTasks(
  rootPath: string,
  exclude: string[],
): Promise<void> {
  if (!useSettingsStore.getState().tasksEnabled) return;
  const seq = ++requestSeq;
  const store = useTaskStore.getState();
  store.setLoading(true);
  try {
    const tasks = await getVaultTasks(rootPath, exclude);
    if (seq !== requestSeq) return; // 이 응답이 도착하기 전에 더 최신 스캔이 시작됨
    store.setAll(tasks);
  } catch (err) {
    if (seq !== requestSeq) return;
    logger.error("[tasks] vault scan failed:", err);
    store.setError(String(err));
  } finally {
    if (seq === requestSeq) useTaskStore.getState().setLoading(false);
  }
}

/**
 * 파일 하나만 재스캔한다. 읽기에 실패하면 그 파일의 엔트리를 비운다.
 * `rootPath`/`exclude`를 vault 전체 스캔과 함께 넘겨야 한다 — 그러지 않으면
 * exclude 설정이 이 증분 경로에서만 조용히 무시된다(I1).
 */
export async function refreshFileTasks(
  path: string,
  rootPath?: null | string,
  exclude: string[] = [],
): Promise<void> {
  try {
    useTaskStore
      .getState()
      .replaceFile(path, await getFileTasks(path, rootPath, exclude));
  } catch (err) {
    logger.warn("[tasks] file re-scan failed, clearing its entries:", err);
    useTaskStore.getState().replaceFile(path, []);
  }
}
