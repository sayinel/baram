// §306 아젠다 패널 — vault 전역 태스크를 기한 버킷으로 모아 보고 그 자리에서 완료한다.
import { useCallback, useMemo, useState } from "react";

import type { Translate } from "../../i18n/useTranslation";
import type { TaskEntry } from "../../ipc/types";
import type { TaskFilters } from "../../utils/tasks/task-filters";

import { Archive, CalendarArrowUp, ListChecks, RefreshCw } from "lucide-react";
import { useShallow } from "zustand/shallow";

import { useEditorContext } from "../../contexts/editor-context";
import { useTranslation } from "../../i18n/useTranslation";
import { useSettingsStore } from "../../stores/settings/store";
import { useTaskStore } from "../../stores/tasks/task-store";
import { useUIStore } from "../../stores/ui/ui";
import { useZettelIndexStore } from "../../stores/zettelkasten/zettel-index";
import { requestScroll } from "../../utils/editor/pending-scroll";
import { openFileByPath } from "../../utils/open-file";
import { BUCKET_ORDER, groupIntoBuckets } from "../../utils/tasks/task-buckets";
import {
  applyTaskFilters,
  collectLinks,
  collectTags,
  EMPTY_FILTERS,
} from "../../utils/tasks/task-filters";
import { TaskBucketList } from "./TaskBucketList";
import { TaskFilterBar } from "./TaskFilterBar";
import { useArchiveDone } from "./use-archive-done";
import { useRescheduleOverdue } from "./use-reschedule-overdue";
import { useTaskScan } from "./use-task-scan";
import { useTaskTriage } from "./use-task-triage";

export function TaskAgendaPanel() {
  const { t } = useTranslation();
  const { tasks, loading } = useTaskStore(
    useShallow((s) => ({ tasks: s.tasks, loading: s.loading })),
  );
  const {
    setTasksScanScope,
    tasksArchiveAfterDays,
    tasksRecordDoneDate,
    tasksTrackTime,
    tasksScanScope,
    tasksWeekStart,
  } = useSettingsStore(
    useShallow((s) => ({
      setTasksScanScope: s.setTasksScanScope,
      tasksArchiveAfterDays: s.tasksArchiveAfterDays,
      tasksRecordDoneDate: s.tasksRecordDoneDate,
      tasksTrackTime: s.tasksTrackTime,
      tasksScanScope: s.tasksScanScope,
      tasksWeekStart: s.tasksWeekStart,
    })),
  );
  // §312.1 루트 해석·스캔·자정 롤오버는 이 패널의 것이 아니다 — 스토어를 읽는 다른
  // 표면들(§307 A·C)이 같은 훅을 쓴다. 이 패널은 `tasksEnabled`가 켜져 있을 때만
  // 마운트되므로(Sidebar) 여기서는 언제나 켠다.
  const {
    exclude: tasksExcludePaths,
    now,
    refresh,
    roots,
    tasksHome,
  } = useTaskScan(true);

  const byId = useZettelIndexStore((s) => s.byId);
  // §305 문서 경로 판정에 필요한 라이브 Editor — 활성 탭이 없으면 null이고,
  // 라우터는 그 경우 디스크로 폴백한다.
  const editor = useEditorContext();
  const [filters, setFilters] = useState<TaskFilters>(EMPTY_FILTERS);

  const titleFor = useCallback(
    (target: string) => byId[target]?.title ?? target,
    [byId],
  );

  // §312 네 판정 전부가 여기서 배선된다 — 체크 판정도 나머지 셋과 **같은 회계**를 탄다
  // (`writeAndReconcile`). 예전에는 이 패널이 그 회계를 손으로 한 벌 더 갖고 있었고, 그
  // 사본의 실패 문구만 하드코딩된 영어여서 같은 실패에 메뉴와 체크박스가 다른 언어로
  // 답했다(MODERATE-3).
  const { onToggle, onTriage } = useTaskTriage({
    editor,
    exclude: tasksExcludePaths,
    now,
    recordDoneDate: tasksRecordDoneDate,
    trackTime: tasksTrackTime,
  });

  const onJump = useCallback((task: TaskEntry) => {
    // §313 요청에 파일 주소를 붙여 건다 — 그 파일이 **이미 활성 탭**이어도 배달되고
    // (누른 태스크의 대부분이 그 경우다), 배달되지 못하면 남지 않고 버려진다.
    // 줄 번호는 1-based(`mdLineToPmPos`가 line-1을 쓴다), `TaskEntry.line`은
    // 0-based다.
    requestScroll(task.path, { kind: "line", value: task.line + 1 });
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

  // §306 링크 대상도 태그와 같다 — 목록은 **필터 적용 전** 전체에서 뽑고, 고른 대상이
  // 사라지면(그 태스크가 지워졌거나 범위가 좁아졌거나) "전체"로 되돌린다. 되돌리지
  // 않으면 <select>는 빈 선택으로 보이는데 목록은 계속 걸러진 채로 남는다.
  const linkOptions = useMemo(() => collectLinks(tasks), [tasks]);
  const link = linkOptions.includes(filters.link) ? filters.link : "";

  const visible = useMemo(
    () => applyTaskFilters(tasks, { ...filters, link, tag }),
    [tasks, filters, link, tag],
  );

  const groups = useMemo(
    () => groupIntoBuckets(visible, now, tasksWeekStart),
    [visible, now, tasksWeekStart],
  );

  // ‼️ "예정 밀림"은 여기 넣지 않는다. 이 버튼이 하는 일은 **기한(📅)을 오늘로 미는**
  // 것이라(`rescheduleOverdueToToday`), 기한이 없던 태스크에는 없던 마감을 만들고
  // 기한이 아직 남은 태스크에는 사용자가 정한 마감을 앞당긴다. 둘 다 이 버튼이 약속한
  // 일이 아니다 — 그 항목들은 행 단위 정리(`t`)로 옮긴다.
  const reschedule = useRescheduleOverdue({
    editor,
    exclude: tasksExcludePaths,
    tasks: groups.overdue,
    today: todayIso(now),
  });

  // §312 배수구. 후보는 **필터 적용 전** 전체에서 고른다 — 화면에 무엇을 걸어 두었든
  // 정리 대상은 같아야 한다. 필터로 좁힌 목록에서 고르면 "완료" 버킷을 접어 둔 사용자와
  // 펼쳐 둔 사용자가 같은 버튼에서 다른 개수를 본다.
  const archive = useArchiveDone({
    afterDays: tasksArchiveAfterDays,
    editor,
    // §312.1 배수구는 단일 루트 조작이라 범위가 "태스크 홈"일 때만 켠다 — 화면에 세
    // vault가 보이는데 버튼이 그중 하나만 건드리면 숨은 규칙이 된다.
    enabled: tasksScanScope === "tasksHome",
    exclude: tasksExcludePaths,
    now,
    tasks,
    tasksHome,
  });

  return (
    <div className="task-panel">
      <div className="task-panel-header">
        <div className="flex-header task-panel-search">
          <input
            aria-label={t("tasks.panel.filter")}
            className="task-panel-filter"
            onChange={(e) =>
              setFilters((f) => ({ ...f, text: e.target.value }))
            }
            placeholder={t("tasks.panel.filterPlaceholder")}
            type="search"
            value={filters.text}
          />
          {groups.overdue.length > 0 && (
            <button
              className="icon-btn task-panel-overdue-action"
              disabled={loading || reschedule.busy}
              onClick={() => void reschedule.run()}
              title={t("tasks.reschedule.action", {
                count: String(groups.overdue.length),
              })}
              type="button"
            >
              <CalendarArrowUp size={14} strokeWidth={1.5} />
            </button>
          )}
          {/* §312.1 배수구는 범위가 "태스크 홈"일 때만 나타난다 — 그 규칙을 UI에
              드러내는 것이 그 결정의 절반이다.
              ‼️ 대상이 0이어도 **감추지 않고 흐리게 둔다.** 감추면 "대상이 없다"와
              "기능이 고장났다"가 화면에서 구별되지 않는다 — M2-b3 수동 테스트에서
              세 라운드를 먹은 실패가 정확히 그 모양이었고, 범위 게이트가 생기면서
              버튼이 사라질 이유가 하나 더 늘었다. 이유는 title이 말한다. */}
          {tasksScanScope === "tasksHome" && (
            <button
              aria-label={t("tasks.archive.action")}
              className="icon-btn"
              disabled={loading || archive.busy || archive.count === 0}
              onClick={() => void archive.run()}
              title={archiveHint(
                t,
                tasksHome,
                archive.count,
                tasksArchiveAfterDays,
              )}
              type="button"
            >
              <Archive size={14} strokeWidth={1.5} />
            </button>
          )}
          {/* §315 주간 리뷰의 두 진입점 중 하나(다른 하나는 커맨드 팔레트). 범위·대상과
              무관하게 언제나 열 수 있다 — 리뷰는 목록을 처리하는 화면이지 목록이 있을 때만
              쓰는 화면이 아니고, 비어 있다는 사실 자체가 리뷰의 결과다. */}
          <button
            aria-label={t("tasks.review.action")}
            className="icon-btn"
            onClick={() => useUIStore.getState().toggleWeeklyReview()}
            title={t("tasks.review.action")}
            type="button"
          >
            <ListChecks size={14} strokeWidth={1.5} />
          </button>
          <button
            className="icon-btn"
            disabled={roots.length === 0 || loading}
            onClick={refresh}
            title={t("tasks.panel.refresh")}
            type="button"
          >
            <RefreshCw size={14} strokeWidth={1.5} />
          </button>
        </div>

        <TaskFilterBar
          filters={{ ...filters, link, tag }}
          linkOptions={linkOptions}
          onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
          onScopeChange={setTasksScanScope}
          scope={tasksScanScope}
          tagOptions={tagOptions}
          titleFor={titleFor}
        />
      </div>

      <div className="task-panel-body">
        {BUCKET_ORDER.map((bucket) => (
          <TaskBucketList
            bucket={bucket}
            key={bucket}
            // ‼️ 주간 리뷰와 **같은 키**를 쓴다. 두 화면이 같은 버킷을 그리므로 이름이
            // 갈리면 사용자는 그것을 서로 다른 두 묶음으로 읽는다.
            label={t(`tasks.bucket.${bucket}`)}
            now={now}
            onJump={onJump}
            onToggle={onToggle}
            onTriage={onTriage}
            showAge={bucket === "noDate"}
            // 지남 일수는 "밀린 것" 둘 다에서 뜻이 있다 — 앞은 기한을, 뒤는 예정일을
            // 넘긴 일수다. 색은 다르다(tasks.css): 빨강은 기한 초과만 갖는다.
            showLateDays={bucket === "overdue" || bucket === "slipped"}
            tasks={groups[bucket]}
            titleFor={titleFor}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * 배수구 버튼이 스스로를 설명하는 한 문장.
 *
 * 셋을 가른다: 홈이 없어 옮길 자리를 모른다 / 자리는 아는데 문턱을 넘긴 항목이 없다 /
 * N개가 기다린다. 하나로 뭉뚱그리면 흐린 버튼 앞에서 사용자가 할 수 있는 일이 없다.
 */
function archiveHint(
  t: Translate,
  tasksHome: null | string,
  count: number,
  afterDays: number,
): string {
  if (!tasksHome) return t("tasks.archive.noHome");
  if (count === 0) return t("tasks.archive.none", { days: String(afterDays) });
  return t("tasks.archive.title", { count: String(count) });
}

function todayIso(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
