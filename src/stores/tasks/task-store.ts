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
  removeFile: (path) =>
    set((s) => ({ tasks: s.tasks.filter((t) => t.path !== path) })),
  clear: () => set({ tasks: [], loading: false, error: null }),
}));

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
  const store = useTaskStore.getState();
  store.setLoading(true);
  try {
    store.setAll(await getVaultTasks(rootPath, exclude));
  } catch (err) {
    logger.error("[tasks] vault scan failed:", err);
    store.setError(String(err));
  } finally {
    useTaskStore.getState().setLoading(false);
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
