// §5 Tasks settings section, split out of GeneralTab.
import { useEffect, useRef, useState } from "react";

import { open } from "@tauri-apps/plugin-dialog";

import type { TaskScanScope } from "../../../../utils/tasks/task-scan-scope";

import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../../../i18n/useTranslation";
import { useSettingsStore } from "../../../../stores/settings/store";
import { TASK_SCAN_SCOPES } from "../../../../utils/tasks/task-scan-scope";
import {
  SettingsRow,
  SettingsSectionHeader,
  ToggleSwitch,
} from "../../settings-shared";
import { GlobalCaptureRow } from "./GlobalCaptureRow";

export function TasksSection() {
  const { t } = useTranslation();
  const {
    tasksEnabled,
    setTasksEnabled,
    tasksWeekStart,
    setTasksWeekStart,
    tasksRecordDoneDate,
    setTasksRecordDoneDate,
    tasksArchiveAfterDays,
    setTasksArchiveAfterDays,
    tasksHome,
    setTasksHome,
    tasksScanScope,
    setTasksScanScope,
    tasksCaptureFile,
    setTasksCaptureFile,
    tasksExcludePaths,
    setTasksExcludePaths,
  } = useSettingsStore(
    useShallow((s) => ({
      tasksEnabled: s.tasksEnabled,
      setTasksEnabled: s.setTasksEnabled,
      tasksWeekStart: s.tasksWeekStart,
      setTasksWeekStart: s.setTasksWeekStart,
      tasksRecordDoneDate: s.tasksRecordDoneDate,
      setTasksRecordDoneDate: s.setTasksRecordDoneDate,
      tasksArchiveAfterDays: s.tasksArchiveAfterDays,
      setTasksArchiveAfterDays: s.setTasksArchiveAfterDays,
      tasksHome: s.tasksHome,
      setTasksHome: s.setTasksHome,
      tasksScanScope: s.tasksScanScope,
      setTasksScanScope: s.setTasksScanScope,
      tasksCaptureFile: s.tasksCaptureFile,
      setTasksCaptureFile: s.setTasksCaptureFile,
      tasksExcludePaths: s.tasksExcludePaths,
      setTasksExcludePaths: s.setTasksExcludePaths,
    })),
  );

  // Buffered separately from the store: the store holds string[], but the
  // field edits a comma-separated string. Deriving `value` from
  // `tasksExcludePaths.join(", ")` on every keystroke would strip a
  // trailing ", " (or a lone trailing comma) as soon as it's typed, since
  // split+filter(Boolean) drops the empty segment it produces — making it
  // impossible to type a second folder. This buffer shows exactly what was
  // typed while still pushing the parsed array to the store on each change.
  // Seeded once at mount — assumes nothing else writes tasksExcludePaths
  // while this tab is mounted (true today: no reset-to-defaults touches it,
  // and it's a NAVIGATE_CONTROL in the search registry, so search never
  // edits it directly). Reusing this pattern for a field an external writer
  // *can* change underneath should resync the buffer from the store.
  const [tasksExcludePathsText, setTasksExcludePathsText] = useState(() =>
    tasksExcludePaths.join(", "),
  );
  // I3: tasksExcludePaths is a scan *input* (TaskAgendaPanel's refresh effect
  // keys on it), unlike this tab's other per-keystroke-write fields — writing
  // the parsed array on every keystroke fires a full vault scan per
  // keystroke, and a stale scan can even resolve after a newer one and
  // overwrite it (guarded separately in task-store.ts). Debounce the store
  // write; the text buffer above still updates immediately so typing stays
  // responsive.
  const excludePathsTimer = useRef<null | ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    return () => {
      if (excludePathsTimer.current) clearTimeout(excludePathsTimer.current);
    };
  }, []);

  return (
    <>
      <SettingsSectionHeader title={t("settings.general.tasks")} />

      <SettingsRow
        description={t("settings.general.tasksEnabled.desc")}
        label={t("settings.general.tasksEnabled")}
      >
        <ToggleSwitch checked={tasksEnabled} onChange={setTasksEnabled} />
      </SettingsRow>

      {tasksEnabled && (
        <>
          <SettingsRow
            description={t("settings.general.tasksWeekStart.desc")}
            label={t("settings.general.tasksWeekStart")}
          >
            <select
              className="settings-select"
              onChange={(e) =>
                setTasksWeekStart(e.target.value as "monday" | "sunday")
              }
              value={tasksWeekStart}
            >
              <option value="monday">
                {t("settings.general.tasksWeekStart.monday")}
              </option>
              <option value="sunday">
                {t("settings.general.tasksWeekStart.sunday")}
              </option>
            </select>
          </SettingsRow>

          <SettingsRow
            description={t("settings.general.tasksRecordDoneDate.desc")}
            label={t("settings.general.tasksRecordDoneDate")}
          >
            <ToggleSwitch
              checked={tasksRecordDoneDate}
              onChange={setTasksRecordDoneDate}
            />
          </SettingsRow>

          <SettingsRow
            description={t("settings.general.tasksHome.desc")}
            label={t("settings.general.tasksHome")}
          >
            {/* Zettel 디렉터리와 같은 폼이되 **읽기 전용이 아니다**: 여기서는 빈 값이
                뜻을 가진다(= Zettel 디렉터리를 쓴다). 저쪽처럼 readOnly로 두면 한 번
                고른 뒤에는 그 기본값으로 돌아갈 방법이 없어진다. */}
            <div className="settings-key-row">
              <input
                className="settings-input settings-input-key"
                onChange={(e) => setTasksHome(e.target.value)}
                placeholder={t("settings.general.tasksHome.placeholder")}
                type="text"
                value={tasksHome}
              />
              <button
                className="settings-key-toggle"
                onClick={async () => {
                  const selected = await open({ directory: true });
                  if (typeof selected === "string") setTasksHome(selected);
                }}
              >
                {t("common.browse")}
              </button>
            </div>
          </SettingsRow>

          <SettingsRow
            description={t("settings.general.tasksScanScope.desc")}
            label={t("settings.general.tasksScanScope")}
          >
            <select
              className="settings-select"
              onChange={(e) =>
                setTasksScanScope(e.target.value as TaskScanScope)
              }
              value={tasksScanScope}
            >
              {/* 목록을 여기 다시 적지 않는다 — 범위가 늘면 `TaskScanScope`에
                  더한 값이 설정 UI와 검색 패널 양쪽에 함께 나타나야 한다. */}
              {TASK_SCAN_SCOPES.map((scope) => (
                <option key={scope} value={scope}>
                  {t(`settings.general.tasksScanScope.${scope}`)}
                </option>
              ))}
            </select>
          </SettingsRow>

          <SettingsRow
            description={t("settings.general.tasksCaptureFile.desc")}
            label={t("settings.general.tasksCaptureFile")}
          >
            <input
              className="settings-input"
              onChange={(e) => setTasksCaptureFile(e.target.value)}
              placeholder={t("settings.general.tasksCaptureFile.placeholder")}
              value={tasksCaptureFile}
            />
          </SettingsRow>

          <GlobalCaptureRow />

          <SettingsRow
            description={t(
              "settings.general.tasksArchiveAfterDays.desc",
            ).replace("{value}", String(tasksArchiveAfterDays))}
            label={t("settings.general.tasksArchiveAfterDays")}
          >
            <input
              className="settings-range"
              max={365}
              min={1}
              onChange={(e) => setTasksArchiveAfterDays(Number(e.target.value))}
              step={1}
              type="range"
              value={tasksArchiveAfterDays}
            />
          </SettingsRow>

          <SettingsRow
            description={t("settings.general.tasksExcludePaths.desc")}
            label={t("settings.general.tasksExcludePaths")}
          >
            <input
              className="settings-input"
              onChange={(e) => {
                const value = e.target.value;
                setTasksExcludePathsText(value);
                if (excludePathsTimer.current) {
                  clearTimeout(excludePathsTimer.current);
                }
                excludePathsTimer.current = setTimeout(() => {
                  setTasksExcludePaths(
                    value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  );
                }, 400);
              }}
              placeholder={t("settings.general.tasksExcludePaths.placeholder")}
              value={tasksExcludePathsText}
            />
          </SettingsRow>
        </>
      )}
    </>
  );
}
