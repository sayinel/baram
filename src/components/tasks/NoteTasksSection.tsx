// §307 A "이 노트의 태스크" — 백링크 패널 아래에 붙는다.
//
// 이 화면이 없는 동안 태스크는 Zettel 노트를 가리킬 수 있었지만 노트 쪽에서 자기에게
// 걸린 태스크를 볼 수 없었다 — `TaskEntry.links`를 읽는 프런트 코드가 한 줄도 없었다.
//
// 목록은 `useTaskStore`에서 온다. 왜 IPC가 아닌지는 `note-tasks.ts` 머리말 참조.
import { useCallback, useMemo } from "react";

import type { TaskEntry } from "../../ipc/types";

import { useShallow } from "zustand/shallow";

import { useEditorContext } from "../../contexts/editor-context";
import { useTranslation } from "../../i18n/useTranslation";
import { useEditorStore } from "../../stores/editor/editor";
import { useSettingsStore } from "../../stores/settings/store";
import { useTaskStore } from "../../stores/tasks/task-store";
import { useZettelIndexStore } from "../../stores/zettelkasten/zettel-index";
import { requestScroll } from "../../utils/editor/pending-scroll";
import { openFileByPath } from "../../utils/open-file";
import { noteIdentity, tasksForNote } from "../../utils/tasks/note-tasks";
import { TaskRowList } from "./TaskRowList";
import { useTaskScan } from "./use-task-scan";
import { useTaskTriage } from "./use-task-triage";

export function NoteTasksSection() {
  const { t } = useTranslation();
  const { tasksEnabled, tasksRecordDoneDate, tasksTrackTime } =
    useSettingsStore(
      useShallow((s) => ({
        tasksEnabled: s.tasksEnabled,
        tasksRecordDoneDate: s.tasksRecordDoneDate,
        tasksTrackTime: s.tasksTrackTime,
      })),
    );
  const { activeTabId, tabs } = useEditorStore(
    useShallow((s) => ({ activeTabId: s.activeTabId, tabs: s.tabs })),
  );
  const tasks = useTaskStore((s) => s.tasks);
  const byId = useZettelIndexStore((s) => s.byId);
  const editor = useEditorContext();

  // 이 패널이 열린 것만으로 스캔이 돈다 — 아젠다를 한 번도 열지 않은 사용자에게도
  // 목록이 있어야 하기 때문이다. 설정이 꺼져 있으면 걷지 않는다.
  const { exclude, now } = useTaskScan(tasksEnabled);

  const filePath = tabs.find((tab) => tab.id === activeTabId)?.filePath ?? null;

  const rows = useMemo(
    () => (filePath ? tasksForNote(tasks, noteIdentity(filePath)) : []),
    [filePath, tasks],
  );

  const { onToggle, onTriage } = useTaskTriage({
    editor,
    exclude,
    now,
    recordDoneDate: tasksRecordDoneDate,
    trackTime: tasksTrackTime,
  });

  const titleFor = useCallback(
    (target: string) => byId[target]?.title ?? target,
    [byId],
  );

  const onJump = useCallback((task: TaskEntry) => {
    // 줄 번호는 1-based(`mdLineToPmPos`가 line-1을 쓴다), `TaskEntry.line`은 0-based다.
    requestScroll(task.path, { kind: "line", value: task.line + 1 });
    void openFileByPath(task.path);
  }, []);

  if (!tasksEnabled || !filePath) return null;

  return (
    <div className="note-tasks">
      <div className="backlinks-header note-tasks-header">
        {t("tasks.note.title")} ({rows.length})
      </div>
      {rows.length === 0 ? (
        <div className="backlinks-empty-inline">{t("tasks.note.empty")}</div>
      ) : (
        <TaskRowList
          now={now}
          onJump={onJump}
          onToggle={onToggle}
          onTriage={onTriage}
          tasks={rows}
          titleFor={titleFor}
        />
      )}
    </div>
  );
}
