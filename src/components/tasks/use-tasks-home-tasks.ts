// §315 주간 리뷰가 배수구를 걸기 위해 읽는 목록 — **태스크 홈 한 루트**.
//
// 왜 스토어를 쓰지 않는가: 스토어에 든 것은 아젠다의 스캔 범위(§312.1)가 걷은 것이고,
// 사용자가 범위를 "현재 볼트"로 좁혀 두면 태스크 홈이 거기 없을 수 있다. 그러면 배수구
// 대상이 0으로 보이지만 파일에는 정리할 것이 쌓여 있다.
//
// §312.1은 그 대가를 알고 받아들이면서 갚을 자리를 정해 두었다 — "기본 범위에서 배수구가
// 보이지 않으므로 **주간 리뷰가 범위와 무관하게 그것을 제공한다**". 이 훅이 그 약속이다.
// 리뷰는 드물게 여는 화면이라 루트 하나를 더 걷는 비용(실측 파일당 25µs)은 값이 싸다.

import { useCallback, useEffect, useState } from "react";

import type { TaskEntry } from "../../ipc/types";

import { useShallow } from "zustand/shallow";

import { getVaultTasks } from "../../ipc/invoke";
import { useSettingsStore } from "../../stores/settings/store";
import { logger } from "../../utils/logger";
import { resolveTasksHome } from "../../utils/tasks/tasks-home";

export interface TasksHomeTasks {
  /** 해석된 태스크 홈. `null`이면 옮길 자리가 없다 */
  home: null | string;
  reload: () => void;
  tasks: TaskEntry[];
}

/**
 * `enabled`가 참인 동안 태스크 홈을 한 번 걷는다. 다시 걷는 것은 `reload()`로만 —
 * 배수구가 파일을 옮긴 **뒤**에 호출자가 부른다.
 */
export function useTasksHomeTasks(enabled: boolean): TasksHomeTasks {
  const { tasksExcludePaths, tasksHome, zettelkastenDirectory } =
    useSettingsStore(
      useShallow((s) => ({
        tasksExcludePaths: s.tasksExcludePaths,
        tasksHome: s.tasksHome,
        zettelkastenDirectory: s.zettelkastenDirectory,
      })),
    );
  const home = resolveTasksHome(tasksHome, zettelkastenDirectory);
  const [tasks, setTasks] = useState<TaskEntry[]>([]);
  const [seq, setSeq] = useState(0);

  const reload = useCallback(() => setSeq((n) => n + 1), []);

  useEffect(() => {
    if (!enabled || !home) {
      // 닫힐 때 비운다 — 다음에 열었을 때 지난 목록이 한 프레임 스쳐 보이면, 그 사이에
      // 누른 배수구가 **이미 옮긴 줄**을 대상으로 삼는다.
      setTasks([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const found = await getVaultTasks(home, tasksExcludePaths);
        if (!cancelled) setTasks(found);
      } catch (err) {
        // 리뷰의 나머지(훑기)는 이것 없이도 돈다 — 배수구만 0으로 보인다.
        logger.error("[tasks] review: could not scan the tasks home:", err);
        if (!cancelled) setTasks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, home, seq, tasksExcludePaths]);

  return { home, reload, tasks };
}
