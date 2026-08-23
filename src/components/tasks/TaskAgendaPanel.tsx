// §306 아젠다 패널 — vault 전역 태스크를 기한 버킷으로 모아 보고 그 자리에서 완료한다.
import { useCallback, useEffect, useMemo, useState } from "react";

import type { TaskEntry } from "../../ipc/types";
import type { TaskBucket } from "../../utils/tasks/task-buckets";

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
import { useZettelIndexStore } from "../../stores/zettelkasten/zettel-index";
import { logger } from "../../utils/logger";
import { openFileByPath } from "../../utils/open-file";
import { BUCKET_ORDER, groupIntoBuckets } from "../../utils/tasks/task-buckets";
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
  const [filter, setFilter] = useState("");

  // 버킷 경계가 렌더마다 흔들리지 않도록 마운트 시점의 시각을 고정한다.
  const now = useMemo(() => new Date(), []);

  useEffect(() => {
    if (!rootPath) return;
    void refreshAllTasks(rootPath, tasksExcludePaths);
  }, [rootPath, tasksExcludePaths]);

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
          todayIso(new Date()),
        );
        await refreshFileTasks(task.path);
      } catch (err) {
        // §305 stale — 토스트 없이 조용히 재인덱싱한다
        logger.warn("[tasks] write rejected, re-scanning:", err);
        await refreshFileTasks(task.path);
      }
    },
    [tasksRecordDoneDate],
  );

  const onJump = useCallback((task: TaskEntry) => {
    // pendingScrollLine은 1-based(`mdLineToPmBlockStart`가 line-1을 쓴다),
    // TaskEntry.line은 0-based다. GlobalSearch가 쓰는 것과 같은 경로.
    useLinkStore.getState().setPendingScrollLine(task.line + 1);
    void openFileByPath(task.path);
  }, []);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? tasks.filter((t) => t.text.toLowerCase().includes(q)) : tasks;
  }, [tasks, filter]);

  const groups = useMemo(
    () => groupIntoBuckets(visible, now, tasksWeekStart),
    [visible, now, tasksWeekStart],
  );

  return (
    <div className="task-panel">
      <div className="flex-header task-panel-header">
        <input
          aria-label="Filter tasks"
          className="task-panel-filter"
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter tasks…"
          type="search"
          value={filter}
        />
        <button
          className="icon-btn"
          disabled={!rootPath || loading}
          onClick={() =>
            rootPath && refreshAllTasks(rootPath, tasksExcludePaths)
          }
          title="Refresh"
          type="button"
        >
          ⟳
        </button>
      </div>

      <div className="task-panel-body">
        {BUCKET_ORDER.map((bucket) => (
          <TaskBucketList
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

function todayIso(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
