import type { TaskEntry } from "../../ipc/types";

// §304 태스크 캐시 — Rust는 상태를 갖지 않으므로 여기가 유일한 캐시다.
import { create } from "zustand";

import { getFileTasks, getVaultTasks } from "../../ipc/invoke";
import { logger } from "../../utils/logger";
import { isUnderRoot, toPosixPath } from "../../utils/path-utils";
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
  /**
   * §312.1 지금 로드된 태스크가 걷혀 온 루트 — 마지막 전체 스캔의 범위.
   *
   * 워처가 증분 갱신에서 이것을 읽는다. 설정·컨텍스트를 다시 조합하지 않고 **실제로 스캔한
   * 목록**을 쓰는 이유는, 두 벌이 갈리는 순간 워처가 목록에 없는 파일을 넣거나 있는 파일을
   * 빠뜨리기 때문이다 — 이 프로젝트가 반복해서 대가를 치른 종류의 어긋남이다.
   */
  roots: string[];
  setAll: (tasks: TaskEntry[]) => void;
  setError: (error: null | string) => void;
  setLoading: (loading: boolean) => void;
  setRoots: (roots: string[]) => void;
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
  roots: [],
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
  setRoots: (roots) => set({ roots }),
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
    set({
      bufferRelativePaths: [],
      error: null,
      loading: false,
      roots: [],
      tasks: [],
    }),
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
 * 스캔 범위 전체 재스캔. 패널 마운트·컨텍스트 변경·범위 변경·수동 새로고침에서 부른다.
 * `tasksEnabled`가 꺼져 있으면 아무것도 하지 않는다(I2) — 그러지 않으면
 * 패널이 언마운트돼 있어도 마운트 시점의 전체 스캔이 계속 돌아간다.
 *
 * ‼️ 루트를 **동시에** 부른다(§312.1). 실측에서 루트 3개 × 1만 파일이 순차 1.24초 /
 * 동시 0.74초였고, 그 1.68배는 3회 반복에서 일관됐다. `for await` 루프로 바꾸면 기본
 * 범위("전체")의 예산이 그대로 날아간다 — §18.7.1 "스캔 비용 실측".
 *
 * 루트 하나가 실패해도 나머지는 보여 준다(`allSettled`). 외장 디스크의 vault 하나가
 * 사라졌다고 아젠다 전체가 비면, 사용자는 자기 태스크가 없어진 것으로 읽는다. 전부
 * 실패한 경우에만 오류 상태로 간다.
 *
 * 겹치는 루트는 호출 전에 걸러져 있어야 한다(`dedupeScanRoots`). 여기서 다시 거르지
 * 않는 이유는 그 판정이 "무엇을 볼 것인가"에 속하고, 이 함수는 이미 정해진 목록을
 * 실행할 뿐이기 때문이다.
 */
export async function refreshAllTasks(
  roots: string[],
  exclude: string[],
): Promise<void> {
  if (!useSettingsStore.getState().tasksEnabled) return;
  const seq = ++requestSeq;
  const store = useTaskStore.getState();
  // 워처가 읽는 범위다 — 응답을 기다리지 않고 지금 세운다. 스캔이 도는 동안 도착하는
  // 파일 이벤트도 새 범위로 판정되어야 한다.
  store.setRoots(roots);
  store.setLoading(true);
  try {
    const results = await Promise.allSettled(
      roots.map((root) => getVaultTasks(root, exclude)),
    );
    if (seq !== requestSeq) return; // 이 응답이 도착하기 전에 더 최신 스캔이 시작됨

    const tasks: TaskEntry[] = [];
    let failure: null | string = null;
    for (const [i, result] of results.entries()) {
      if (result.status === "fulfilled") {
        tasks.push(...result.value);
      } else {
        logger.error("[tasks] scan failed for", roots[i], result.reason);
        failure ??= String(result.reason);
      }
    }

    if (failure !== null && tasks.length === 0 && roots.length > 0) {
      store.setError(failure);
      return;
    }
    store.setAll(tasks);
  } finally {
    if (seq === requestSeq) useTaskStore.getState().setLoading(false);
  }
}

/**
 * 지금 스캔 범위 안일 때만 그 파일을 다시 읽는다.
 *
 * 디스크가 바뀌었다는 사실을 들고 오는 두 곳이 쓴다 — 파일 워처와 캡처. 범위 밖 파일을
 * 넣으면 범위를 좁혀 둔 사용자에게 다른 vault의 태스크가 되살아나므로, "인덱싱할 것인가"를
 * 여기서 한 번만 판정한다.
 *
 * ‼️ **저장되지 않은 표면이 있는 파일에는 쓰면 안 된다.** 디스크를 다시 읽는 것은 그 파일의
 * `bufferRelativePaths` 표시를 푸는 일이라, 버퍼에만 있는 삭제가 있으면 줄 번호가 어긋난다.
 * 캡처가 이것을 부르는 곳이 디스크 갈래뿐인 이유다.
 */
export async function refreshFileTasksInScope(path: string): Promise<void> {
  if (!scanRootForPath(path)) return;
  await refreshFileTasks(path, useSettingsStore.getState().tasksExcludePaths);
}

/**
 * 이 파일을 덮는 스캔 루트. 지금 범위 밖이면 `null`.
 *
 * `get_file_tasks`의 `exclude`는 **루트 기준 상대 경로**로 판정된다. 종전에는 워처가 언제나
 * `useFileStore.rootPath`를 넘겼는데, §312.1로 범위가 여러 루트로 넓어지면 다른 vault의
 * 파일에 엉뚱한 루트를 대게 되어 제외 규칙이 그 파일에만 다르게 적용된다 — I1이 막으려던
 * 것과 같은 종류의 어긋남이 증분 경로에서만 되살아난다.
 *
 * 범위 밖 파일에 `null`을 주는 것도 의도다. 그 파일의 태스크는 지금 목록에 있으면 안 되므로
 * 호출자가 인덱싱을 건너뛴다.
 */
export function scanRootForPath(path: string): null | string {
  const p = toPosixPath(path);
  return (
    useTaskStore
      .getState()
      .roots.find((root) => isUnderRoot(p, toPosixPath(root))) ?? null
  );
}

/**
 * 파일 하나만 재스캔한다. 읽기에 실패하면 그 파일의 엔트리를 비운다.
 *
 * 루트는 **여기서 고른다**(`scanRootForPath`) — 호출자가 넘기지 않는다. `exclude`는 루트
 * 기준 상대 경로로 판정되므로 루트를 잘못 대면 그 설정이 이 파일에만 다르게 적용되고(I1),
 * 종전에는 네 호출자가 각자 `useFileStore.rootPath`를 넘기고 있었다. 범위가 여러 루트로
 * 넓어진 §312.1에서 그것은 전부 오답이다 — 규칙을 한 곳에 둔다.
 *
 * 덮는 루트가 없으면 `exclude` 없이 읽는다(종전과 같다). "그 파일을 아예 인덱싱할 것인가"는
 * 다른 질문이고, 범위 밖 경로가 실제로 도착하는 곳은 워처뿐이라 그 판정은 거기 있다.
 */
export async function refreshFileTasks(
  path: string,
  exclude: string[] = [],
): Promise<void> {
  const root = scanRootForPath(path);
  try {
    useTaskStore
      .getState()
      .replaceFile(path, await getFileTasks(path, root, exclude));
  } catch (err) {
    logger.warn("[tasks] file re-scan failed, clearing its entries:", err);
    useTaskStore.getState().replaceFile(path, []);
  }
}
