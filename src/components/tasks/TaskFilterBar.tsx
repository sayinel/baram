// §306/§312.1 아젠다의 필터 줄 — 범위 하나와 필터 다섯.
//
// 패널에서 떼어낸 이유는 길이만이 아니다. 이 줄에는 규칙이 하나 산다 — **옵션이 있는
// 필터는 옵션이 있을 때만 나타난다**(태그·링크). 그 규칙이 패널 본문에 섞여 있으면
// 여섯째 필터를 더하는 사람이 그것을 못 보고 언제나 보이는 빈 <select>를 하나 더 만든다.
import type { TaskFilters } from "../../utils/tasks/task-filters";
import type { TaskScanScope } from "../../utils/tasks/task-scan-scope";

import { useTranslation } from "../../i18n/useTranslation";
import { TASK_STATES } from "../../utils/tasks/task-state";

interface Props {
  filters: TaskFilters;
  /** 이 태스크 집합에 실제로 등장하는 링크 대상. 비어 있으면 링크 필터가 없다. */
  linkOptions: string[];
  onChange: (patch: Partial<TaskFilters>) => void;
  onScopeChange: (scope: TaskScanScope) => void;
  scope: TaskScanScope;
  /** 이 태스크 집합에 실제로 등장하는 태그. 비어 있으면 태그 필터가 없다. */
  tagOptions: string[];
  /** 링크 대상 → 노트 제목. 없으면 대상을 그대로 보인다. */
  titleFor: (target: string) => string;
}

export function TaskFilterBar({
  filters,
  linkOptions,
  onChange,
  onScopeChange,
  scope,
  tagOptions,
  titleFor,
}: Props) {
  const { t } = useTranslation();

  return (
    <div className="task-panel-selects">
      <select
        aria-label={t("tasks.scope.label")}
        className="task-panel-select"
        onChange={(e) => onScopeChange(e.target.value as TaskScanScope)}
        title={t("tasks.scope.label")}
        value={scope}
      >
        <option value="allVaults">{t("tasks.scope.allVaults")}</option>
        <option value="currentVault">{t("tasks.scope.currentVault")}</option>
        <option value="tasksHome">{t("tasks.scope.tasksHome")}</option>
      </select>

      <select
        aria-label={t("tasks.panel.state")}
        className="task-panel-select"
        onChange={(e) =>
          onChange({ state: e.target.value as TaskFilters["state"] })
        }
        value={filters.state}
      >
        <option value="all">{t("tasks.panel.state.all")}</option>
        {/* §18.18 M4 — 상태가 넷이므로 고를 것도 넷이다. 셋을 두 개로 남겨 두면
            "할 일"을 골랐을 때 진행 중인 것이 조용히 사라진다. `TASK_STATES`가
            순서의 유일한 출처라 다섯 번째가 생겨도 여기는 저절로 따라온다. */}
        {TASK_STATES.map((state) => (
          <option key={state} value={state}>
            {t(`tasks.state.${state}`)}
          </option>
        ))}
      </select>

      <select
        aria-label={t("tasks.panel.priority")}
        className="task-panel-select"
        onChange={(e) =>
          onChange({ priority: e.target.value as TaskFilters["priority"] })
        }
        value={filters.priority}
      >
        <option value="all">{t("tasks.panel.priority.all")}</option>
        <option value="high">{t("tasks.panel.priority.high")}</option>
        <option value="normal">{t("tasks.panel.priority.normal")}</option>
        <option value="low">{t("tasks.panel.priority.low")}</option>
      </select>

      {tagOptions.length > 0 && (
        <select
          aria-label={t("tasks.panel.tag")}
          className="task-panel-select"
          onChange={(e) => onChange({ tag: e.target.value })}
          value={filters.tag}
        >
          <option value="">{t("tasks.panel.tag.all")}</option>
          {tagOptions.map((opt) => (
            <option key={opt} value={opt}>
              #{opt}
            </option>
          ))}
        </select>
      )}

      {/* §306 링크 대상. 라벨은 노트 **제목**이다 — 저장된 값은 ID라 목록이
          `202607051530`으로만 채워지면 고를 수가 없다. */}
      {linkOptions.length > 0 && (
        <select
          aria-label={t("tasks.panel.link")}
          className="task-panel-select"
          onChange={(e) => onChange({ link: e.target.value })}
          value={filters.link}
        >
          <option value="">{t("tasks.panel.link.all")}</option>
          {linkOptions.map((opt) => (
            <option key={opt} value={opt}>
              {titleFor(opt)}
            </option>
          ))}
        </select>
      )}

      <label className="task-panel-someday">
        <input
          checked={filters.showSomeday}
          onChange={(e) => onChange({ showSomeday: e.target.checked })}
          type="checkbox"
        />
        {t("tasks.panel.someday")}
      </label>
    </div>
  );
}
