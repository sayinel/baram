// §315 주간 리뷰 — 새 기능이 아니라 아젠다의 **프리셋 필터 + 전용 레이아웃**이다.
//
// 한 화면에 세 묶음을 세로로 놓고, §312의 네 조작을 키 한 번으로 훑는다. 조작하면 그
// 항목이 묶음에서 빠지고 포커스가 **그 자리에 새로 온 항목**으로 이어진다 — 훑는 속도가
// 이 화면의 전부다. 아젠다와 다른 점은 그 둘뿐이다: 한 흐름으로 이어지는 이동과 자동 전진.
//
// 리뷰 주기를 강제하거나 알림을 보내지 않는다(§18.10).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TaskEntry } from "../../ipc/types";
import type { ReviewGroup } from "../../utils/tasks/task-review";

import { Archive, X } from "lucide-react";
import { useShallow } from "zustand/shallow";

import { useEditorContext } from "../../contexts/editor-context";
import { useTranslation } from "../../i18n/useTranslation";
import { useSettingsStore } from "../../stores/settings/store";
import { currentScanRoots } from "../../stores/tasks/task-scan-roots";
import { refreshAllTasks, useTaskStore } from "../../stores/tasks/task-store";
import { useUIStore } from "../../stores/ui/ui";
import { useZettelIndexStore } from "../../stores/zettelkasten/zettel-index";
import { requestScroll } from "../../utils/editor/pending-scroll";
import { openFileByPath } from "../../utils/open-file";
import {
  applyTaskFilters,
  EMPTY_FILTERS,
} from "../../utils/tasks/task-filters";
import {
  groupForReview,
  REVIEW_GROUP_ORDER,
} from "../../utils/tasks/task-review";
import {
  focusRowAt,
  moveRowFocus,
  rowIndexOf,
} from "../../utils/tasks/task-row-focus";
import { resolveTaskRowKey } from "../../utils/tasks/task-row-keys";
import { buildTriageItems } from "../../utils/tasks/task-triage";
import { TaskRow } from "./TaskRow";
import { TaskRowMenu } from "./TaskRowMenu";
import { useArchiveDone } from "./use-archive-done";
import { useTaskRowMenu } from "./use-task-row-menu";
import { useTaskTriage } from "./use-task-triage";
import { useTasksHomeTasks } from "./use-tasks-home-tasks";

/** `j`/`k`가 도는 범위 — 세 묶음 전체다(아젠다는 버킷 안에서 멈춘다). */
const REVIEW_SCOPE = ".weekly-review-body";

interface SectionProps {
  group: ReviewGroup;
  menu: null | { task: TaskEntry };
  now: Date;
  onJump: (task: TaskEntry) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLLIElement>, task: TaskEntry) => void;
  onOpenMenu: (row: HTMLElement, task: TaskEntry) => void;
  onToggle: (task: TaskEntry) => void;
  tasks: TaskEntry[];
  titleFor: (target: string) => string;
}

export function WeeklyReviewDialog() {
  const open = useUIStore((s) => s.weeklyReviewOpen);
  const close = useUIStore((s) => s.closeWeeklyReview);
  // ‼️ 열릴 때마다 **새로 마운트**한다. 이 화면의 상태는 전부 "이번 리뷰"의 것이다 —
  // 기준일, 시작 시점의 처리 대상 수, 배수구가 읽은 목록. 컴포넌트를 살려 두고 effect로
  // 되돌리면 그중 하나는 반드시 빠진다(QuickCapture가 실제로 그랬다 — §307D 리뷰 Minor 6).
  if (!open) return null;
  return <WeeklyReview onClose={close} />;
}

function ReviewSection({
  group,
  menu,
  now,
  onJump,
  onKeyDown,
  onOpenMenu,
  onToggle,
  tasks,
  titleFor,
}: SectionProps) {
  const { t } = useTranslation();
  if (tasks.length === 0) return null;

  return (
    <section className="weekly-review-section" data-group={group}>
      <h4 className="weekly-review-section-title">
        {t(`tasks.review.group.${group}`)}{" "}
        <span className="task-bucket-count">({tasks.length})</span>
      </h4>
      <ul className="task-bucket-list">
        {tasks.map((task) => (
          <TaskRow
            key={`${task.path}:${task.line}`}
            menuOpen={
              menu?.task.path === task.path && menu.task.line === task.line
            }
            now={now}
            onJump={onJump}
            onKeyDown={onKeyDown}
            onOpenMenu={onOpenMenu}
            onToggle={onToggle}
            // 방치 배지는 "예정 없음"에서만 — 이 화면이 그 묶음을 위에 두는 이유가 그것이다.
            showAge={group === "noDate"}
            showOverdueAge={group === "overdue"}
            task={task}
            titleFor={titleFor}
          />
        ))}
      </ul>
    </section>
  );
}

function WeeklyReview({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const editor = useEditorContext();
  const tasks = useTaskStore((s) => s.tasks);
  const {
    tasksArchiveAfterDays,
    tasksExcludePaths,
    tasksRecordDoneDate,
    tasksWeekStart,
  } = useSettingsStore(
    useShallow((s) => ({
      tasksArchiveAfterDays: s.tasksArchiveAfterDays,
      tasksExcludePaths: s.tasksExcludePaths,
      tasksRecordDoneDate: s.tasksRecordDoneDate,
      tasksWeekStart: s.tasksWeekStart,
    })),
  );
  const byId = useZettelIndexStore((s) => s.byId);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // 기준일은 열 때 고정한다 — 아젠다와 같은 이유(I4). 자정을 넘겨도 묶음 경계가 흔들리지
  // 않아야 방금 처리한 항목이 다시 나타나지 않는다.
  const [now] = useState(() => new Date());

  // 커맨드 팔레트로 바로 열 수도 있다 — 그 경로에서는 아젠다가 한 번도 마운트되지 않아
  // 스토어가 비어 있을 수 있으므로, 열 때 지금 범위를 한 번 걷는다.
  useEffect(() => {
    const roots = currentScanRoots();
    if (roots.length > 0) void refreshAllTasks(roots, tasksExcludePaths);
  }, [tasksExcludePaths]);

  // `#someday`는 빼고 본다. 미룬 항목이 큐에 남아 있으면 `s`를 눌러도 화면이 그대로라,
  // 이 화면이 약속하는 "누르면 다음으로"가 그 항목에서만 깨진다.
  const visible = useMemo(
    () => applyTaskFilters(tasks, EMPTY_FILTERS),
    [tasks],
  );
  const groups = useMemo(
    () => groupForReview(visible, now, tasksWeekStart),
    [visible, now, tasksWeekStart],
  );

  // 훑어서 처리할 것 — 회고(이번 주 완료)는 세지 않는다.
  const remaining = groups.overdue.length + groups.noDate.length;
  const startedWith = useRef<null | number>(null);
  // 스캔이 끝나기 전에 0으로 굳으면 진행률이 영영 0이 된다 — 처음으로 대상이 보인 순간을
  // 시작점으로 삼는다.
  if (startedWith.current === null && remaining > 0)
    startedWith.current = remaining;
  const processed = Math.max(0, (startedWith.current ?? 0) - remaining);

  const { onToggle, onTriage } = useTaskTriage({
    editor,
    exclude: tasksExcludePaths,
    now,
    recordDoneDate: tasksRecordDoneDate,
  });

  const allRows = useMemo(
    () => [...groups.overdue, ...groups.noDate, ...groups.doneThisWeek],
    [groups],
  );
  const { closeMenu, dismissMenu, menu, openMenu } = useTaskRowMenu(allRows);

  // 열자마자 키를 받을 수 있어야 한다. 커맨드 팔레트로 열면 포커스가 이 화면 밖에 있어
  // `j`도 `x`도 Escape도 닿지 않는다 — 키보드로 훑는 화면에서 첫 조작이 마우스 클릭이면
  // 그 화면의 목적이 첫걸음부터 사라진다.
  //
  // 목록은 비동기로 온다(열 때 한 번 걷는다). 그래서 마운트가 아니라 **행이 처음 생긴
  // 순간**에 잡고, 한 번만 한다 — 그 뒤로는 사용자와 자동 전진의 몫이다.
  const didFocus = useRef(false);
  useEffect(() => {
    if (didFocus.current) return;
    // 처리할 것이 없는 리뷰도 Escape로 닫혀야 하므로, 행이 없으면 다이얼로그를 잡는다.
    const target = focusRowAt(bodyRef.current, 0) ?? dialogRef.current;
    if (!target) return;
    didFocus.current = true;
    if (target !== document.activeElement) target.focus();
  }, [allRows]);

  // 자동 전진: 조작 직전의 **행 위치**를 적어 두고, 목록이 갱신된 뒤 그 자리에 포커스를
  // 돌려준다. 처리한 항목이 빠지므로 같은 인덱스가 곧 다음 항목이다.
  const advanceTo = useRef<null | number>(null);
  useEffect(() => {
    if (advanceTo.current === null) return;
    // ‼️ "아직 이 화면 안에 있는가"만 보면 **언제나 실패한다.** 처리한 행이 언마운트되는
    // 순간 포커스는 `body`로 떨어지고, 이 effect는 그 뒤에 돈다 — 자동 전진이 필요한
    // 바로 그 경우가 가드에 걸린다.
    //
    // 그래서 가르는 것은 "포커스를 잃었는가"와 "사용자가 다른 곳으로 옮겼는가"다. 앞은
    // 우리가 방금 만든 상태이고, 뒤는 빼앗으면 안 되는 상태다. 워처가 목록을 갱신하는
    // 것만으로도 이 effect가 도므로 그 구분이 필요하다.
    const active = document.activeElement;
    const lost = active === null || active === document.body;
    if (!lost && !bodyRef.current?.contains(active)) {
      advanceTo.current = null;
      return;
    }
    const index = advanceTo.current;
    advanceTo.current = null;
    focusRowAt(bodyRef.current, index);
  }, [allRows]);

  const handleRowKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLLIElement>, task: TaskEntry) => {
      const action = resolveTaskRowKey({
        altKey: e.altKey,
        code: e.code,
        ctrlKey: e.ctrlKey,
        isComposing: e.nativeEvent.isComposing,
        key: e.key,
        keyCode: e.keyCode,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
      });
      if (!action) return;
      e.preventDefault();
      switch (action.kind) {
        case "focus":
          // 아젠다와 달리 묶음 경계에서 멈추지 않는다 — 세 묶음이 한 흐름이다.
          moveRowFocus(e.currentTarget, action.delta, REVIEW_SCOPE);
          break;
        case "menu":
          openMenu(e.currentTarget, task);
          break;
        case "triage":
          advanceTo.current = rowIndexOf(bodyRef.current, e.currentTarget);
          if (action.action === "check") onToggle(task);
          else onTriage(task, action.action);
          break;
      }
    },
    [onToggle, onTriage, openMenu],
  );

  const onJump = useCallback(
    (task: TaskEntry) => {
      // 파일로 뛰면 리뷰를 계속할 수 없다 — 화면을 닫고 그 줄로 보낸다.
      onClose();
      requestScroll(task.path, { kind: "line", value: task.line + 1 });
      void openFileByPath(task.path);
    },
    [onClose],
  );

  const titleFor = useCallback(
    (target: string) => byId[target]?.title ?? target,
    [byId],
  );

  const home = useTasksHomeTasks(true);
  const archive = useArchiveDone({
    afterDays: tasksArchiveAfterDays,
    editor,
    // ‼️ 여기서는 스캔 범위와 무관하게 켠다. 기본 범위("전체")에서 아젠다의 배수구가
    // 보이지 않는다는 §312.1의 대가를 갚는 자리가 이 화면이다.
    enabled: true,
    exclude: tasksExcludePaths,
    now,
    tasks: home.tasks,
    tasksHome: home.home,
  });

  return (
    <div className="weekly-review-overlay" onMouseDown={onClose}>
      <div
        aria-label={t("tasks.review.title")}
        className="weekly-review-dialog"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        // 행이 하나도 없을 때 포커스를 받을 자리 — 그래야 빈 리뷰도 Escape로 닫힌다.
        tabIndex={-1}
      >
        <header className="flex-header weekly-review-header">
          <h3>{t("tasks.review.title")}</h3>
          <span className="weekly-review-progress">
            {t("tasks.review.progress", {
              done: String(processed),
              left: String(remaining),
            })}
          </span>
          <button
            aria-label={t("common.close")}
            className="icon-btn"
            onClick={onClose}
            type="button"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </header>

        <div className="weekly-review-body" ref={bodyRef}>
          {REVIEW_GROUP_ORDER.map((group) => (
            <ReviewSection
              group={group}
              key={group}
              menu={menu}
              now={now}
              onJump={onJump}
              onKeyDown={handleRowKeyDown}
              onOpenMenu={openMenu}
              onToggle={onToggle}
              tasks={groups[group]}
              titleFor={titleFor}
            />
          ))}
          {remaining === 0 && (
            <p className="weekly-review-empty">
              {t("tasks.review.allClear", { count: String(processed) })}
            </p>
          )}
        </div>

        <footer className="weekly-review-footer">
          <button
            className="btn-unstyled weekly-review-archive"
            disabled={archive.busy || archive.count === 0}
            onClick={() => void archive.run().then(home.reload)}
            title={
              archive.count > 0
                ? t("tasks.archive.title", { count: String(archive.count) })
                : t("tasks.archive.none", {
                    days: String(tasksArchiveAfterDays),
                  })
            }
            type="button"
          >
            <Archive size={14} strokeWidth={1.5} />
            {/* 짧은 라벨만 버튼에 둔다 — 긴 사유는 `title`이 갖는다. 문장을 통째로
                버튼에 넣었더니 두 줄로 감기며 푸터가 무너졌다(사용자 보고). */}
            {archive.count > 0
              ? t("tasks.archive.title", { count: String(archive.count) })
              : t("tasks.archive.noneShort")}
          </button>
          <span className="weekly-review-hint">
            {t("tasks.review.keyHint")}
          </span>
        </footer>

        {menu && (
          <TaskRowMenu
            items={buildTriageItems(t, menu.task)}
            menu={menu}
            onAction={(action) => {
              closeMenu();
              onTriage(menu.task, action);
            }}
            onClose={closeMenu}
            onDismiss={dismissMenu}
          />
        )}
      </div>
    </div>
  );
}
