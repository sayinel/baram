// §307 C Zettel 허브의 태스크 섹션 — 지금 손대야 하는 것만 일곱 줄.
//
// 허브는 훑는 화면이지 처리하는 화면이 아니다. 그래서 아젠다 전체가 아니라 **밀린 것과
// 오늘**만 보이고, 더 있으면 아젠다로 넘긴다. 행 자체는 아젠다·노트 섹션과 같은
// `TaskRow`라 여기서도 그 자리에서 체크할 수 있다.
import { useCallback, useMemo, useState } from "react";

import type { TaskEntry } from "../../ipc/types";

import { ListChecks } from "lucide-react";
import { useShallow } from "zustand/shallow";

import { useEditorContext } from "../../contexts/editor-context";
import { useTranslation } from "../../i18n/useTranslation";
import { useSettingsStore } from "../../stores/settings/store";
import { useTaskStore } from "../../stores/tasks/task-store";
import { useUIStore } from "../../stores/ui/ui";
import { useZettelIndexStore } from "../../stores/zettelkasten/zettel-index";
import { requestScroll } from "../../utils/editor/pending-scroll";
import { openFileByPath } from "../../utils/open-file";
import { groupIntoBuckets } from "../../utils/tasks/task-buckets";
import { ZettelHubSectionHeader } from "../zettelkasten/ZettelSectionList";
import { TaskRowList } from "./TaskRowList";
import { useTaskScan } from "./use-task-scan";
import { useTaskTriage } from "./use-task-triage";

/** 허브가 보여 주는 최대 줄 수 — 넘으면 "전체 보기"가 아젠다로 넘긴다. */
const LIMIT = 7;

export function HubTasksSection() {
  const { t } = useTranslation();
  const { tasksEnabled, tasksRecordDoneDate, tasksTrackTime, tasksWeekStart } =
    useSettingsStore(
      useShallow((s) => ({
        tasksEnabled: s.tasksEnabled,
        tasksRecordDoneDate: s.tasksRecordDoneDate,
        tasksTrackTime: s.tasksTrackTime,
        tasksWeekStart: s.tasksWeekStart,
      })),
    );
  const tasks = useTaskStore((s) => s.tasks);
  const byId = useZettelIndexStore((s) => s.byId);
  const editor = useEditorContext();
  const { exclude, now } = useTaskScan(tasksEnabled);

  // 접힘은 로컬 state다. 설계 문서는 "UI 스토어에 persist"라고 적었지만 형제 섹션 넷이
  // 전부 `useState`이고(ZettelHubPanel), 이 하나만 재시작을 넘겨 살아남으면 같은 허브
  // 안에서 섹션마다 기억의 수명이 달라진다.
  const [collapsed, setCollapsed] = useState(false);

  const rows = useMemo(() => {
    const groups = groupIntoBuckets(tasks, now, tasksWeekStart);
    // ‼️ "예정 밀림"을 함께 넣는다. 설계 §18.6 C는 이 버킷이 생기기 전에 쓰였고, 빼면
    // 기한을 걸지 않고 `⏳`만 쓰는 사용자에게 이 섹션이 **영영 비어 있다** — 아젠다에는
    // 밀린 것이 쌓여 있는데 허브는 할 일이 없다고 말하는 상태다.
    return [...groups.overdue, ...groups.slipped, ...groups.today];
  }, [now, tasks, tasksWeekStart]);

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
    requestScroll(task.path, { kind: "line", value: task.line + 1 });
    void openFileByPath(task.path);
  }, []);

  if (!tasksEnabled) return null;

  const shown = rows.slice(0, LIMIT);

  return (
    <div className="zettel-hub-section">
      <ZettelHubSectionHeader
        collapsed={collapsed}
        icon={<ListChecks size={14} strokeWidth={1.5} />}
        label={t("tasks.hub.title", { count: String(rows.length) })}
        onToggle={() => setCollapsed((v) => !v)}
      />
      {!collapsed && (
        <div className="zettel-hub-section-body">
          {shown.length === 0 ? (
            <div className="zettel-hub-empty-hint">{t("tasks.hub.empty")}</div>
          ) : (
            <>
              <TaskRowList
                now={now}
                onJump={onJump}
                onToggle={onToggle}
                onTriage={onTriage}
                showLateDays
                tasks={shown}
                titleFor={titleFor}
              />
              {rows.length > LIMIT && (
                <button
                  className="btn-unstyled zettel-hub-more"
                  onClick={() => useUIStore.getState().setSidebarPanel("tasks")}
                  type="button"
                >
                  {t("tasks.hub.seeAll", {
                    count: String(rows.length - LIMIT),
                  })}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
