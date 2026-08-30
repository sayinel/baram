// §312.1 태스크 스캔 — 어느 표면이 열려 있든 **같은 범위**를 걷는다.
//
// 종전에는 이 기계 전부가 `TaskAgendaPanel` 안에 있었고, 그래서 `refreshAllTasks`의
// 프로덕션 호출자가 그 패널 하나뿐이었다. 태스크 패널을 한 번도 열지 않은 사용자에게는
// 스토어가 영영 비어 있으므로, 스토어를 읽는 다른 표면(§307 A 노트별 섹션 · §307 C 허브
// 섹션)은 "태스크가 없다"를 정직하게 말할 방법이 없다 — 걷지 않은 것과 없는 것이
// 화면에서 같아진다.
//
// 사이드바는 한 번에 패널 하나만 마운트하므로 이 훅이 여러 곳에서 불려도 동시 스캔은
// 생기지 않는다.
import { useCallback, useEffect, useMemo, useState } from "react";

import { useShallow } from "zustand/shallow";

import { useContextStore } from "../../stores/context/context";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { refreshAllTasks } from "../../stores/tasks/task-store";
import { resolveScanRoots } from "../../utils/tasks/task-scan-scope";
import { resolveTasksHome } from "../../utils/tasks/tasks-home";

export interface TaskScan {
  /** `tasksExcludePaths` — 스캔과 **같은 값**을 쓰는 쓰기 경로들이 그대로 받아 간다. */
  exclude: string[];
  /**
   * 버킷 경계를 정하는 "지금". 렌더마다 새로 만들지 않는다 — 그러면 경계가 흔들린다.
   * 자정 타이머와 `refresh()`만 이것을 옮긴다(I4).
   */
  now: Date;
  refresh: () => void;
  roots: string[];
  tasksHome: null | string;
}

/**
 * `enabled`가 거짓이면 걷지 않는다. 세 표면 모두 `tasksEnabled`를 넘긴다 — 설정을 끈
 * 사용자의 디스크를 태스크 기능이 조용히 훑는 일이 없어야 한다.
 */
export function useTaskScan(enabled: boolean): TaskScan {
  const rootPath = useFileStore((s) => s.rootPath);
  const { tasksExcludePaths, tasksHomeSetting, tasksScanScope, zettelDir } =
    useSettingsStore(
      useShallow((s) => ({
        tasksExcludePaths: s.tasksExcludePaths,
        tasksHomeSetting: s.tasksHome,
        tasksScanScope: s.tasksScanScope,
        zettelDir: s.zettelkastenDirectory,
      })),
    );
  // §312.1 "전체" 범위는 볼트탭에 열려 있는 vault를 본다. `folder` 컨텍스트는 상위
  // vault와 중복 스캔이 되므로 제외한다(같은 태스크가 두 번 뜬다).
  const contexts = useContextStore((s) => s.contexts);

  const tasksHome = useMemo(
    () => resolveTasksHome(tasksHomeSetting, zettelDir),
    [tasksHomeSetting, zettelDir],
  );

  // 겹치는 루트는 여기서 걸린다 — Zettel 디렉터리를 vault 안에 두는 흔한 배치에서
  // 그대로 두면 같은 태스크가 두 번 뜨고, 체크하면 한 줄만 사라져 나머지가 유령이 된다.
  const roots = useMemo(
    () =>
      resolveScanRoots(tasksScanScope, {
        rootPath,
        tasksHome,
        vaultPaths: contexts
          .filter((c) => c.contextType === "vault")
          .map((c) => c.path),
      }),
    [contexts, rootPath, tasksHome, tasksScanScope],
  );
  // 배열 자체는 매 렌더 새 객체이므로 effect의 의존성으로는 내용을 쓴다 — 그러지 않으면
  // 컨텍스트 스토어가 무엇을 갱신하든 전체 스캔이 다시 돈다.
  const rootsKey = roots.join("\u0000");

  // I4: 밤새 패널을 열어 둬도 버킷 경계가 어제로 굳어버리지 않도록 state로 관리한다.
  const [now, setNow] = useState(() => new Date());

  // 스캔 루트/exclude 변경(vault 전환·범위 변경) 시점과 수동 새로고침 버튼 양쪽에서
  // 호출된다 — 두 경로 모두 "지금"을 다시 고정해야 밤새 열어 둔 패널이 자정을 넘겨도
  // 어제 기준으로 버킷을 나누지 않는다.
  const refresh = useCallback(() => {
    setNow(new Date());
    if (enabled && roots.length > 0) {
      void refreshAllTasks(roots, tasksExcludePaths);
    }
    // `roots`는 `rootsKey`로 고정된다 — 배열 참조를 의존성에 넣으면 매 렌더 재스캔이다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, rootsKey, tasksExcludePaths]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 패널이 자정을 넘겨 열려 있어도 다음 로컬 자정에 자동으로 버킷 경계를 옮긴다.
  useEffect(() => {
    const msUntilMidnight = startOfNextDay(now).getTime() - now.getTime();
    const timer = window.setTimeout(() => setNow(new Date()), msUntilMidnight);
    return () => window.clearTimeout(timer);
  }, [now]);

  return { exclude: tasksExcludePaths, now, refresh, roots, tasksHome };
}

/** `d`가 속한 날의 다음 날 자정(로컬 시간) — 자정 롤오버 타이머의 목표 시각. */
function startOfNextDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
}
