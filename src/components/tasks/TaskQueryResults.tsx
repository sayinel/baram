// §310 쿼리 블록의 태스크 결과 — 문서 **안에서** 그리는 목록.
//
// `display: list`는 아젠다와 같은 `TaskRow`다. 설계 §18.13이 "체크 가능한 태스크
// 목록으로 렌더한다(문서 안에서 완료 처리 가능)"라고 못박은 자리이고, 그것이 MOC을
// 프로젝트 **보드**로 만드는 조건이다 — 읽기만 되는 목록은 링크 모음과 다르지 않다.
//
// `query-block-view.tsx`가 이미 559줄이라 여기로 나왔다.
import { useCallback } from "react";

import type { TaskEntry } from "../../ipc/types";
import type { QueryDisplay } from "../../utils/query-parser";

import { useShallow } from "zustand/shallow";

import { useEditorContext } from "../../contexts/editor-context";
import { useTranslation } from "../../i18n/useTranslation";
import { useSettingsStore } from "../../stores/settings/store";
import { useZettelIndexStore } from "../../stores/zettelkasten/zettel-index";
import { requestScroll } from "../../utils/editor/pending-scroll";
import { openFileByPath } from "../../utils/open-file";
import { priorityBadge } from "../../utils/tasks/task-filters";
import { displayText } from "../../utils/tasks/task-row-display";
import { TaskRowList } from "./TaskRowList";
import { useTaskTriage } from "./use-task-triage";

interface Props {
  display: QueryDisplay;
  /** 블록이 실행된 시각 — 버킷 경계가 아니라 ✅날짜의 기준이다. */
  now: Date;
  /**
   * ‼️ 이 목록의 한 줄에 대한 진실이 다시 맞춰졌다 — 블록이 질의를 **다시 돌려야** 한다.
   *
   * 이 표면은 스토어를 구독하지 않는다(결과는 블록이 한 번 걷어 온 로컬 state다).
   * 그래서 체크가 디스크에 착지해도 여기 `tasks`는 그대로이고, 제어 체크박스는 다음
   * 렌더에서 원래대로 돌아간다 — 사용자에게는 "체크가 안 먹었다"로 보이는데 파일은
   * 이미 바뀌어 있다. 아젠다·노트 섹션은 스토어를 읽으므로 이 문제가 없다.
   */
  onChanged: () => void;
  tasks: TaskEntry[];
}

export function TaskQueryResults({ display, now, onChanged, tasks }: Props) {
  const { t } = useTranslation();
  const { tasksExcludePaths, tasksRecordDoneDate } = useSettingsStore(
    useShallow((s) => ({
      tasksExcludePaths: s.tasksExcludePaths,
      tasksRecordDoneDate: s.tasksRecordDoneDate,
    })),
  );
  const byId = useZettelIndexStore((s) => s.byId);
  const editor = useEditorContext();

  const { onToggle, onTriage } = useTaskTriage({
    editor,
    exclude: tasksExcludePaths,
    now,
    onReconciled: onChanged,
    recordDoneDate: tasksRecordDoneDate,
  });

  const titleFor = useCallback(
    (target: string) => byId[target]?.title ?? target,
    [byId],
  );

  const onJump = useCallback((task: TaskEntry) => {
    requestScroll(task.path, { kind: "line", value: task.line + 1 });
    void openFileByPath(task.path);
  }, []);

  if (display === "table") {
    return (
      <table className="qb-table">
        <thead>
          <tr>
            <th>{t("tasks.query.col.state")}</th>
            <th>{t("tasks.query.col.text")}</th>
            <th>{t("tasks.query.col.due")}</th>
            <th>{t("tasks.query.col.priority")}</th>
            <th>{t("tasks.query.col.path")}</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={`${task.path}:${task.line}`}>
              <td>
                {t(
                  task.state === "done"
                    ? "tasks.panel.state.done"
                    : "tasks.panel.state.todo",
                )}
              </td>
              <td>{displayText(task.text, titleFor)}</td>
              <td>{task.due ?? ""}</td>
              <td>{priorityBadge(task.priority)?.label ?? ""}</td>
              <td className="qb-path">{task.path}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (display === "card") {
    return (
      <div className="qb-cards">
        {tasks.map((task) => (
          <div className="qb-card" key={`${task.path}:${task.line}`}>
            <div className="qb-card-name">
              {displayText(task.text, titleFor)}
            </div>
            <div className="qb-card-path">{task.path}</div>
            {task.tags.length > 0 && (
              <div className="qb-card-tags">
                {task.tags.slice(0, 5).map((tag) => (
                  <span className="qb-tag" key={tag}>
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="qb-task-list">
      <TaskRowList
        now={now}
        onJump={onJump}
        onToggle={onToggle}
        onTriage={onTriage}
        tasks={tasks}
        titleFor={titleFor}
      />
    </div>
  );
}
