// §306 아젠다 패널 — vault 전역 태스크를 기한 버킷으로 모아 보고 그 자리에서 완료한다.
import { useCallback, useEffect, useMemo, useState } from "react";

import type { TaskEntry } from "../../ipc/types";
import type { TaskBucket } from "../../utils/tasks/task-buckets";
import type { TaskFilters } from "../../utils/tasks/task-filters";

import { useShallow } from "zustand/shallow";

import { setTaskState } from "../../ipc/invoke";
import { useLinkStore } from "../../stores/editor/link";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import {
  refreshAllTasks,
  refreshFileTasks,
  useTaskStore,
} from "../../stores/tasks/task-store";
import { useUIStore } from "../../stores/ui/ui";
import { useZettelIndexStore } from "../../stores/zettelkasten/zettel-index";
import { logger } from "../../utils/logger";
import { openFileByPath } from "../../utils/open-file";
import { BUCKET_ORDER, groupIntoBuckets } from "../../utils/tasks/task-buckets";
import {
  applyTaskFilters,
  collectTags,
  EMPTY_FILTERS,
} from "../../utils/tasks/task-filters";
import { TaskBucketList } from "./TaskBucketList";

// 사이드바 패널의 사용자 노출 문자열은 영어가 이 코드베이스의 관례다
// ("Filter tags...", "File tree", "Label (optional)" 등). 코드 주석은 한국어 유지.
const BUCKET_LABEL: Record<TaskBucket, string> = {
  done: "Done",
  later: "Later",
  noDate: "No date",
  overdue: "Overdue",
  thisWeek: "This week",
  today: "Today",
};

export function TaskAgendaPanel() {
  const rootPath = useFileStore((s) => s.rootPath);
  const { tasks, loading } = useTaskStore(
    useShallow((s) => ({ tasks: s.tasks, loading: s.loading })),
  );
  const { tasksExcludePaths, tasksRecordDoneDate, tasksWeekStart } =
    useSettingsStore(
      useShallow((s) => ({
        tasksExcludePaths: s.tasksExcludePaths,
        tasksRecordDoneDate: s.tasksRecordDoneDate,
        tasksWeekStart: s.tasksWeekStart,
      })),
    );
  const byId = useZettelIndexStore((s) => s.byId);
  const [filters, setFilters] = useState<TaskFilters>(EMPTY_FILTERS);

  // I4: 밤새 패널을 열어 둬도 버킷 경계가 어제로 굳어버리지 않도록 state로
  // 관리한다 — 렌더마다 새로 만들면 버킷 경계가 흔들리므로 여전히 고정값이되,
  // 아래 자정 타이머와 refresh()가 그 고정값을 새로고침한다.
  const [now, setNow] = useState(() => new Date());

  // rootPath/exclude 변경(vault 전환) 시점과 수동 새로고침 버튼 양쪽에서 호출된다
  // — 두 경로 모두 "지금"을 다시 고정해야 밤새 열어 둔 패널이 자정을 넘겨도
  // 어제 기준으로 버킷을 나누지 않는다.
  const refresh = useCallback(() => {
    setNow(new Date());
    if (rootPath) void refreshAllTasks(rootPath, tasksExcludePaths);
  }, [rootPath, tasksExcludePaths]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 패널이 자정을 넘겨 열려 있어도 다음 로컬 자정에 자동으로 버킷 경계를 옮긴다.
  useEffect(() => {
    const msUntilMidnight = startOfNextDay(now).getTime() - now.getTime();
    const timer = window.setTimeout(() => setNow(new Date()), msUntilMidnight);
    return () => window.clearTimeout(timer);
  }, [now]);

  const titleFor = useCallback(
    (target: string) => byId[target]?.title ?? target,
    [byId],
  );

  const onToggle = useCallback(
    async (task: TaskEntry) => {
      const next = task.state === "done" ? "todo" : "done";
      try {
        await setTaskState(
          task.path,
          task.line,
          task.raw,
          next,
          tasksRecordDoneDate,
          // `now`로 통일 — 라이브 new Date()를 쓰면 자정을 넘긴 직후 디스크에
          // 적히는 ✅ 날짜가 사용자가 보고 있는 버킷 경계와 하루 어긋난다(I4).
          todayIso(now),
        );
      } catch (err) {
        if (err === "stale") {
          // §305 stale — 사이에 파일이 바뀐 정상적인 경합이다. 토스트 없이
          // 조용히 재인덱싱한다.
          logger.warn("[tasks] write rejected (stale), re-scanning:", err);
        } else {
          // I5: stale이 아닌 실패(권한 오류, 디스크 가득 참, 파일 삭제 등)를
          // 똑같이 조용히 되돌리면 사용자에게는 원인 모를 죽은 체크박스로만
          // 보인다 — 알려야 한다.
          logger.warn("[tasks] write failed, re-scanning:", err);
          useUIStore
            .getState()
            .showToast("Couldn't save the task change.", "error");
        }
      } finally {
        // 성공/실패 각 분기에 있던 동일한 호출을 하나로 모았다.
        await refreshFileTasks(task.path, rootPath, tasksExcludePaths);
      }
    },
    [tasksRecordDoneDate, rootPath, tasksExcludePaths, now],
  );

  const onJump = useCallback((task: TaskEntry) => {
    // pendingScrollLine은 1-based(`mdLineToPmBlockStart`가 line-1을 쓴다),
    // TaskEntry.line은 0-based다. GlobalSearch가 쓰는 것과 같은 경로.
    useLinkStore.getState().setPendingScrollLine(task.line + 1);
    void openFileByPath(task.path);
  }, []);

  // 태그 목록은 **필터 적용 전** 전체에서 뽑는다 — 태그로 거른 뒤 목록을 만들면
  // 방금 고른 태그 하나만 남아 다른 태그로 바꿀 수 없게 된다.
  const tagOptions = useMemo(() => collectTags(tasks), [tasks]);

  // I2: filters.tag는 자유 입력 state라 tagOptions와 저절로 맞물리지 않는다.
  // 선택했던 태그가 vault에서 사라지면(태스크가 지워졌거나 tasksExcludePaths로
  // 그 폴더가 막 제외됐거나) 필터는 여전히 그 값으로 걸려 있는데 <select>는
  // 옵션이 하나도 없어 사라지거나(마지막 태그였던 경우) "work" 같은 값을 든 채
  // 일치하는 <option>이 없어 빈 선택으로 보인다(다른 태그만 남은 경우). 매
  // 렌더에서 유효성을 다시 계산해 둘 다 "전체"로 되돌린다 — effect 없이 파생
  // 값 하나로 충분하다. state/priority는 닫힌 옵션 집합이라 같은 문제가 없다.
  const tag = tagOptions.includes(filters.tag) ? filters.tag : "";

  const visible = useMemo(
    () => applyTaskFilters(tasks, { ...filters, tag }),
    [tasks, filters, tag],
  );

  const groups = useMemo(
    () => groupIntoBuckets(visible, now, tasksWeekStart),
    [visible, now, tasksWeekStart],
  );

  return (
    <div className="task-panel">
      <div className="task-panel-header">
        <div className="flex-header task-panel-search">
          <input
            aria-label="Filter tasks"
            className="task-panel-filter"
            onChange={(e) =>
              setFilters((f) => ({ ...f, text: e.target.value }))
            }
            placeholder="Filter tasks…"
            type="search"
            value={filters.text}
          />
          <button
            className="icon-btn"
            disabled={!rootPath || loading}
            onClick={refresh}
            title="Refresh"
            type="button"
          >
            ⟳
          </button>
        </div>

        <div className="task-panel-selects">
          <select
            aria-label="Filter by state"
            className="task-panel-select"
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                state: e.target.value as TaskFilters["state"],
              }))
            }
            value={filters.state}
          >
            <option value="all">All</option>
            <option value="todo">To do</option>
            <option value="done">Done</option>
          </select>

          <select
            aria-label="Filter by priority"
            className="task-panel-select"
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                priority: e.target.value as TaskFilters["priority"],
              }))
            }
            value={filters.priority}
          >
            <option value="all">Any priority</option>
            <option value="high">⏫ High+</option>
            <option value="normal">Normal</option>
            <option value="low">🔽 Low−</option>
          </select>

          {tagOptions.length > 0 && (
            <select
              aria-label="Filter by tag"
              className="task-panel-select"
              onChange={(e) =>
                setFilters((f) => ({ ...f, tag: e.target.value }))
              }
              value={tag}
            >
              <option value="">Any tag</option>
              {tagOptions.map((opt) => (
                <option key={opt} value={opt}>
                  #{opt}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="task-panel-body">
        {BUCKET_ORDER.map((bucket) => (
          <TaskBucketList
            bucket={bucket}
            key={bucket}
            label={BUCKET_LABEL[bucket]}
            now={now}
            onJump={onJump}
            onToggle={onToggle}
            showOverdueAge={bucket === "overdue"}
            tasks={groups[bucket]}
            titleFor={titleFor}
          />
        ))}
      </div>
    </div>
  );
}

/** `d`가 속한 날의 다음 날 자정(로컬 시간) — 자정 롤오버 타이머의 목표 시각. */
function startOfNextDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
}

function todayIso(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
