import type { TaskEntry } from "../../ipc/types";

// §304 태스크 캐시 — Rust는 상태를 갖지 않으므로 여기가 유일한 캐시다.
import { create } from "zustand";

import { getFileTasks, getVaultTasks } from "../../ipc/invoke";
import { logger } from "../../utils/logger";
import { useSettingsStore } from "../settings/store";

interface TaskStoreState {
  /**
   * §312 이 파일들의 `line`은 **저장되지 않은 표면**을 가리킨다 — 디스크가 아니라.
   *
   * 편집 조작은 `line`을 바꾸지 않지만 저장 전 삭제는 바꾼다(`dropLineFromBuffer`).
   * 그 계산은 그 표면(라이브 문서 또는 소스 버퍼)에 대해서만 맞다. 라우터는 조작마다
   * 다시 판정하므로 표면이 사라지는 순간 — 탭을 닫거나, 문서 경로에서 지운 뒤 다른
   * 탭으로 넘어가면 — 다음 조작이 그 번호를 들고 디스크로 간다. 낙관적 잠금은
   * `(줄 번호, 원문)`만 보므로 바이트가 같은 이웃 줄이 있으면 그 잠금을 **통과해**
   * 엉뚱한 줄을 고친다.
   */
  bufferRelativePaths: string[];
  clear: () => void;
  /**
   * 저장 전 표면(라이브 문서·소스 버퍼)에서 지운 줄의 회계 — 그 항목을 빼고 **아래 줄
   * 번호를 하나씩 올린 뒤**, 이 파일의 번호가 이제 그 표면을 가리킨다고 표시한다.
   *
   * ‼️ 둘은 한 조다. 번호를 옮기면서 표시하지 않으면 그 번호가 디스크로 새어 나가고,
   * 표시만 하고 옮기지 않으면 그 다음 조작이 그 표면에서 한 줄 아래에 쓴다.
   */
  dropLineFromBuffer: (path: string, line: number) => void;
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

/** 표시를 지운 결과 — 없던 것을 지우면 **같은 배열**을 돌려준다(동등성 관문). */
function withoutPath(paths: string[], path: string): string[] {
  return paths.includes(path) ? paths.filter((p) => p !== path) : paths;
}

export const useTaskStore = create<TaskStoreState>((set) => ({
  tasks: [],
  loading: false,
  error: null,
  bufferRelativePaths: [],
  // 전체 스캔은 파서가 센 번호를 그대로 받는다 — 그 순간 모든 파일이 다시 디스크 기준이다.
  setAll: (tasks) =>
    set((s) => ({
      bufferRelativePaths: s.bufferRelativePaths.length
        ? []
        : s.bufferRelativePaths,
      error: null,
      tasks,
    })),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  // 이 파일을 디스크에서 다시 읽어 온 결과로 갈아끼운다 — 그러므로 표시도 함께 풀린다.
  // (저장 → 워처 `file:changed` → `refreshFileTasks`가 실제로 도는 경로다.)
  replaceFile: (path, entries) =>
    set((s) => ({
      bufferRelativePaths: withoutPath(s.bufferRelativePaths, path),
      tasks: [...s.tasks.filter((t) => t.path !== path), ...entries],
    })),
  dropLineFromBuffer: (path, line) =>
    set((s) => ({
      bufferRelativePaths: s.bufferRelativePaths.includes(path)
        ? s.bufferRelativePaths
        : [...s.bufferRelativePaths, path],
      tasks: s.tasks
        .filter((t) => !(t.path === path && t.line === line))
        .map((t) =>
          t.path === path && t.line > line ? { ...t, line: t.line - 1 } : t,
        ),
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
    set((s) => ({
      bufferRelativePaths: withoutPath(s.bufferRelativePaths, path),
      tasks: s.tasks.filter((t) => t.path !== path),
    })),
  clear: () =>
    set({ bufferRelativePaths: [], tasks: [], loading: false, error: null }),
}));

/**
 * 이 파일의 스토어 줄 번호가 **저장되지 않은 표면**을 가리키는가.
 *
 * 참이면 디스크 쓰기는 거절해야 한다 — 번호가 그 파일의 디스크 내용과 어긋나 있고,
 * 낙관적 잠금은 바이트가 같은 이웃 줄을 걸러 내지 못한다. 저장하면 워처가 그 파일만
 * 다시 스캔하고(`refreshFileTasks` → `replaceFile`) 표시는 거기서 풀린다.
 */
export function linesDescribeUnsavedBuffer(path: string): boolean {
  return useTaskStore.getState().bufferRelativePaths.includes(path);
}

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
