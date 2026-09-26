// Settings Registry — metadata for all searchable settings
// Phase 2: each entry carries SettingControlMeta for data-driven rendering
import type React from "react";

import type { DialId, DialValue, DialValues } from "../../appearance/dials";
import type { Locale } from "../../i18n";
import type { AIProvider } from "../../stores/ai/ai";
import type { JournalStartupBehavior } from "../../stores/settings/journal-settings";
import type { SettingsState } from "../../stores/settings/store";
import type { ZettelStartupBehavior } from "../../stores/settings/zettelkasten-settings";
import type { TaskScanScope } from "../../utils/tasks/task-scan-scope";

import { useShallow } from "zustand/shallow";

import { DIALS } from "../../appearance/dials";
import { resolveEditorTypography } from "../../appearance/editor-typography";
import { resolveDials } from "../../appearance/merge";
import { useThemeDials } from "../../hooks/use-theme-dials";
import { AVAILABLE_LOCALES, LOCALE_LABELS } from "../../i18n";
import {
  GHOST_TEXT_DEBOUNCE_RANGE,
  MAX_SUGGESTION_LENGTH_RANGE,
  useAIStore,
} from "../../stores/ai/ai";
import { AI_PROVIDER_IDS, AI_PROVIDERS } from "../../stores/ai/providers";
import {
  JOURNAL_FILENAME_FORMATS,
  JOURNAL_STARTUP_BEHAVIORS,
} from "../../stores/settings/journal-settings";
import { useSettingsStore } from "../../stores/settings/store";
import { ZETTEL_STARTUP_BEHAVIORS } from "../../stores/settings/zettelkasten-settings";
import { useUIStore } from "../../stores/ui/ui";
import { resolveCodeMetrics } from "../../utils/font/code-metrics";
import {
  fontSizeNumber,
  lineHeightNumber,
} from "../../utils/font/font-metric-text";
import { TASK_SCAN_SCOPES } from "../../utils/tasks/task-scan-scope";
import { dialOptionLabelKey } from "./dial-option-label";

export interface SearchableSetting {
  category: SettingsTab;
  control: SettingControlMeta;
  description: string;
  id: string;
  keywords?: string[];
  label: string;
  section: string;
}

export interface SettingControlMeta {
  controlType: "color" | "custom" | "input" | "select" | "slider" | "toggle";
  customRender?: (props: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onChange: (v: any) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: any;
  }) => React.ReactElement;
  options?: Array<{ label: string; value: string }>;
  range?: { max: number; min: number; step: number };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  storeSelector: () => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  storeSetter: (value: any) => void;
}

export type SettingsTab =
  | "activitybar"
  | "ai"
  | "appearance"
  | "editor"
  | "general"
  | "journal"
  | "keybindings"
  | "language"
  | "markdown"
  | "plugins"
  | "tasks"
  | "vault"
  | "zettelkasten";

// ‼️ 키 namespace 는 이력상 `settings.general.*` 이다 (§342 규칙 3). 탭은 옮겼지만
// 20개 넘는 i18n 키를 개명하면 정렬·parity·glossary 게이트를 전부 통과시켜야 하는데
// 사용자에게 보이지 않는 이름이라 얻는 것이 없다. `category` 가 탭을 정한다.

// Marker for settings that require navigation to their tab (no inline control)
export const NAVIGATE_CONTROL: SettingControlMeta = {
  controlType: "custom",
  storeSelector: () => null,
  storeSetter: () => undefined,
};

/** The settings fields the registry reads and writes — exactly the `settings.*` accesses
 *  below, selected with `useShallow` so a settings write the registry does not display
 *  (a keybinding override, an extension setting, a recent folder) does not rebuild it
 *  (issue 267). Add a field here when a new entry reads it. */
const selectRegistrySettings = (s: SettingsState) => ({
  appearanceOverrides: s.appearanceOverrides,
  autoCheckUpdates: s.autoCheckUpdates,
  autoLoadVideoEmbeds: s.autoLoadVideoEmbeds,
  autoPairBrackets: s.autoPairBrackets,
  autoSave: s.autoSave,
  autoSaveDelay: s.autoSaveDelay,
  autoUpdateLinks: s.autoUpdateLinks,
  codeFontSize: s.codeFontSize,
  codeLineHeight: s.codeLineHeight,
  highlight: s.highlight,
  inlineMath: s.inlineMath,
  journalEnabled: s.journalEnabled,
  journalFilenameFormat: s.journalFilenameFormat,
  journalStartupBehavior: s.journalStartupBehavior,
  lineNumbers: s.lineNumbers,
  linkFontMetrics: s.linkFontMetrics,
  locale: s.locale,
  onLaunch: s.onLaunch,
  setAutoCheckUpdates: s.setAutoCheckUpdates,
  setAutoLoadVideoEmbeds: s.setAutoLoadVideoEmbeds,
  setAutoPairBrackets: s.setAutoPairBrackets,
  setAutoSave: s.setAutoSave,
  setAutoSaveDelay: s.setAutoSaveDelay,
  setAutoUpdateLinks: s.setAutoUpdateLinks,
  setDial: s.setDial,
  setHighlight: s.setHighlight,
  setInlineMath: s.setInlineMath,
  setJournalEnabled: s.setJournalEnabled,
  setJournalFilenameFormat: s.setJournalFilenameFormat,
  setJournalStartupBehavior: s.setJournalStartupBehavior,
  setLineNumbers: s.setLineNumbers,
  setLinkFontMetrics: s.setLinkFontMetrics,
  setLocale: s.setLocale,
  setOnLaunch: s.setOnLaunch,
  setSmartPunctuation: s.setSmartPunctuation,
  setSnapshotInterval: s.setSnapshotInterval,
  setSnapshotMaxCount: s.setSnapshotMaxCount,
  setSpellCheck: s.setSpellCheck,
  setStrikethrough: s.setStrikethrough,
  setSymbolSuggest: s.setSymbolSuggest,
  setTabSize: s.setTabSize,
  setTasksEnabled: s.setTasksEnabled,
  setTasksRecordDoneDate: s.setTasksRecordDoneDate,
  setTasksScanScope: s.setTasksScanScope,
  setTasksStampCreatedDate: s.setTasksStampCreatedDate,
  setTasksTrackTime: s.setTasksTrackTime,
  setTasksWeekStart: s.setTasksWeekStart,
  setVimMode: s.setVimMode,
  setVirtualizeLargeDocs: s.setVirtualizeLargeDocs,
  setWikilinkFormat: s.setWikilinkFormat,
  setZettelkastenEnabled: s.setZettelkastenEnabled,
  setZettelkastenStartupBehavior: s.setZettelkastenStartupBehavior,
  smartPunctuation: s.smartPunctuation,
  snapshotInterval: s.snapshotInterval,
  snapshotMaxCount: s.snapshotMaxCount,
  spellCheck: s.spellCheck,
  strikethrough: s.strikethrough,
  symbolSuggest: s.symbolSuggest,
  tabSize: s.tabSize,
  tasksArchiveAfterDays: s.tasksArchiveAfterDays,
  tasksEnabled: s.tasksEnabled,
  tasksRecordDoneDate: s.tasksRecordDoneDate,
  tasksScanScope: s.tasksScanScope,
  tasksStampCreatedDate: s.tasksStampCreatedDate,
  tasksTrackTime: s.tasksTrackTime,
  tasksWeekStart: s.tasksWeekStart,
  vimMode: s.vimMode,
  virtualizeLargeDocs: s.virtualizeLargeDocs,
  wikilinkFormat: s.wikilinkFormat,
  zettelkastenEnabled: s.zettelkastenEnabled,
  zettelkastenStartupBehavior: s.zettelkastenStartupBehavior,
});

/**
 * Returns the full settings registry.
 * Must be called inside a React component (hooks are used internally).
 */
export function useSettingsRegistry(): SearchableSetting[] {
  const settings = useSettingsStore(useShallow(selectRegistrySettings));
  // §340 M-11 정정: bare `useAIStore()`는 ai 스토어의 **모든** write에 이 레지스트리
  // 전체를 재구성한다 — 스트리밍 토큰마다 바뀌는 `ghostText`·`isStreaming`도 포함해서.
  // 설정 모달이 열려 있는 동안만이지만, 이 브랜치가 `aiEnabled`를 여기서 읽게 만들며
  // 그 비용이 커졌다. 아래 필드만 이 파일이 실제로 읽고 쓴다.
  const ai = useAIStore(
    useShallow((s) => ({
      aiEnabled: s.aiEnabled,
      autoModelEnabled: s.autoModelEnabled,
      ghostTextDebounceMs: s.ghostTextDebounceMs,
      ghostTextEnabled: s.ghostTextEnabled,
      maxSuggestionLength: s.maxSuggestionLength,
      privacyMode: s.privacyMode,
      provider: s.provider,
      setAIEnabled: s.setAIEnabled,
      setAutoModelEnabled: s.setAutoModelEnabled,
      setGhostTextDebounceMs: s.setGhostTextDebounceMs,
      setGhostTextEnabled: s.setGhostTextEnabled,
      setMaxSuggestionLength: s.setMaxSuggestionLength,
      setPrivacyMode: s.setPrivacyMode,
      setProvider: s.setProvider,
    })),
  );
  // §366 — 검색 결과의 다이얼 컨트롤은 `AppearanceDialRow`와 **같은** 병합 결과를
  // 보여야 한다. 같은 설정이 두 표면에서 다른 값을 말하면 그중 하나는 거짓말이다.
  // 위 M-11 정정과 같은 규율로, 이 훅도 스토어를 좁게 읽는다(`activeThemeId` ·
  // `installedThemes` · 플러그인 스토어의 `revocations`).
  const themeDials = useThemeDials();
  const typography = resolveEditorTypography(
    themeDials,
    settings.appearanceOverrides,
  );
  // §370 — the chrome-visibility toggles only need these six fields. A bare
  // `useUIStore()` would rebuild this registry on every UI-store write, including
  // ones this settings modal itself causes (e.g. `settingsOpen` while it is open) —
  // the same M-11 shape the `ai` block above already guards against.
  const ui = useUIStore(
    useShallow((s) => ({
      activityBarVisible: s.activityBarVisible,
      statusBarVisible: s.statusBarVisible,
      tabBarVisible: s.tabBarVisible,
      toggleActivityBar: s.toggleActivityBar,
      toggleStatusBar: s.toggleStatusBar,
      toggleTabBar: s.toggleTabBar,
    })),
  );
  // §354 — 코드 크기·줄 높이 항목의 설명에 넣을 값. EditorTab 이 두 행에 보여 주는 값과
  // 같아야 하므로 같은 함수(code-metrics.ts)로 구한다 — 연동 중이면 본문에서 파생한 값이다.
  const codeMetrics = resolveCodeMetrics({
    codeFontSize: settings.codeFontSize,
    codeLineHeight: settings.codeLineHeight,
    fontSize: typography.fontSize,
    lineHeight: typography.lineHeight,
    linkFontMetrics: settings.linkFontMetrics,
  });

  return [
    // ── General ──────────────────────────────────────────────────────────────
    {
      id: "onLaunch",
      label: "settings.general.onLaunch",
      description: "settings.general.onLaunch.desc",
      category: "general",
      section: "settings.general.startup",
      control: makeSelectControl(
        () => settings.onLaunch,
        (v) =>
          settings.setOnLaunch(
            v as "newFile" | "restoreLastFile" | "restoreLastFolder",
          ),
        [
          {
            value: "restoreLastFolder",
            label: "settings.general.onLaunch.restoreLastFolder",
          },
          {
            value: "restoreLastFile",
            label: "settings.general.onLaunch.restoreLastFile",
          },
          { value: "newFile", label: "settings.general.onLaunch.newFile" },
        ],
      ),
    },
    {
      id: "autoSave",
      label: "settings.general.autoSave",
      description: "settings.general.autoSave.desc",
      category: "general",
      section: "settings.general.saving",
      control: makeToggleControl(() => settings.autoSave, settings.setAutoSave),
    },
    {
      id: "autoSaveDelay",
      label: "settings.general.saveDelay",
      description: "settings.general.saveDelay.desc",
      category: "general",
      section: "settings.general.saving",
      control: makeSliderControl(
        () => settings.autoSaveDelay,
        settings.setAutoSaveDelay,
        { min: 500, max: 10000, step: 500 },
      ),
    },
    {
      id: "spellCheck",
      label: "settings.general.spellCheck",
      description: "settings.general.spellCheck.desc",
      category: "general",
      section: "settings.general.system",
      control: makeToggleControl(
        () => settings.spellCheck,
        settings.setSpellCheck,
      ),
    },
    {
      id: "wikilinkFormat",
      label: "settings.general.linkFormat",
      description: "settings.general.linkFormat.desc",
      category: "general",
      section: "settings.general.links",
      keywords: ["wikilink", "markdown", "link"],
      control: makeSelectControl(
        () => settings.wikilinkFormat,
        (v) => settings.setWikilinkFormat(v as "markdown" | "wikilink"),
        [
          { value: "wikilink", label: "[[Wikilink]]" },
          { value: "markdown", label: "[Markdown](link)" },
        ],
      ),
    },
    {
      id: "autoUpdateLinks",
      label: "settings.general.autoUpdateLinks",
      description: "settings.general.autoUpdateLinks.desc",
      category: "general",
      section: "settings.general.links",
      control: makeToggleControl(
        () => settings.autoUpdateLinks,
        settings.setAutoUpdateLinks,
      ),
    },
    {
      id: "snapshotInterval",
      label: "settings.general.snapshotInterval",
      description: "settings.general.snapshotInterval.desc",
      category: "general",
      section: "settings.general.snapshots",
      keywords: ["version", "history", "backup"],
      control: makeSliderControl(
        () => settings.snapshotInterval,
        settings.setSnapshotInterval,
        { min: 0, max: 120, step: 5 },
      ),
    },
    {
      id: "snapshotMaxCount",
      label: "settings.general.snapshotMaxCount",
      description: "settings.general.snapshotMaxCount.desc",
      category: "general",
      section: "settings.general.snapshots",
      control: makeSliderControl(
        () => settings.snapshotMaxCount,
        settings.setSnapshotMaxCount,
        { min: 5, max: 200, step: 5 },
      ),
    },
    // 업데이트 섹션(UpdatesSection.tsx). 버전은 표시 전용이고 "지금 확인"은 동작이라
    // 둘 다 바꿀 값이 없다 — 검색에서 찾히게만 하고 탭으로 보낸다. 두 행 모두 설명
    // 문구가 없어서 description 은 비워 둔다(keybindings 항목과 같은 형태).
    {
      id: "appVersion",
      label: "settings.general.updates.version",
      description: "",
      category: "general",
      section: "settings.general.updates",
      keywords: ["version", "about"],
      control: NAVIGATE_CONTROL,
    },
    {
      id: "autoCheckUpdates",
      label: "settings.general.updates.autoCheck",
      description: "settings.general.updates.autoCheck.desc",
      category: "general",
      section: "settings.general.updates",
      keywords: ["update", "upgrade"],
      control: makeToggleControl(
        () => settings.autoCheckUpdates,
        settings.setAutoCheckUpdates,
      ),
    },
    {
      id: "checkForUpdates",
      label: "settings.general.updates.checkNow",
      description: "",
      category: "general",
      section: "settings.general.updates",
      keywords: ["update", "upgrade"],
      control: NAVIGATE_CONTROL,
    },
    {
      id: "journalEnabled",
      label: "settings.general.journalEnabled",
      description: "settings.general.journalEnabled.desc",
      category: "journal",
      section: "settings.general.journal",
      keywords: ["daily", "note", "diary"],
      control: makeToggleControl(
        () => settings.journalEnabled,
        settings.setJournalEnabled,
      ),
    },
    // 저널 탭의 나머지 행. 이 아래 NAVIGATE 항목 가운데 폴더·파일 행(journalDirectory·
    // journalTemplatePath·주간/월간/연간 템플릿)은 네이티브 대화상자를 여는 버튼이고 — 저널
    // 폴더는 승인 경계 `pickApprovedDir` 도 거친다 — journalCreateTemplateFiles 는 파일을
    // 만드는 동작 버튼이다. 모두 검색 결과의 단일 컨트롤로 옮길 수 없어서 탭으로 보낸다.
    {
      id: "journalDirectory",
      label: "settings.general.journalDirectory",
      description: "settings.general.journalDirectory.desc",
      category: "journal",
      section: "settings.general.journal",
      keywords: ["journal", "folder", "path"],
      control: NAVIGATE_CONTROL,
    },
    {
      id: "journalFilenameFormat",
      label: "settings.general.journalFilenameFormat",
      description: "settings.general.journalFilenameFormat.desc",
      category: "journal",
      section: "settings.general.journal",
      keywords: ["journal", "filename", "date"],
      control: makeSelectControl(
        () => settings.journalFilenameFormat,
        settings.setJournalFilenameFormat,
        JOURNAL_FILENAME_FORMATS.map((format) => ({
          value: format,
          label: format,
        })),
      ),
    },
    {
      id: "journalTemplatePath",
      label: "settings.general.journalTemplate",
      description: "settings.general.journalTemplate.desc",
      category: "journal",
      section: "settings.general.journal",
      keywords: ["journal", "template"],
      control: NAVIGATE_CONTROL,
    },
    {
      id: "journalStartupBehavior",
      label: "settings.general.journalStartup",
      description: "settings.general.journalStartup.desc",
      category: "journal",
      section: "settings.general.journal",
      keywords: ["journal", "startup", "launch"],
      control: makeSelectControl(
        () => settings.journalStartupBehavior,
        (v) => settings.setJournalStartupBehavior(v as JournalStartupBehavior),
        JOURNAL_STARTUP_BEHAVIORS.map((behavior) => ({
          value: behavior,
          label: `settings.general.journalStartup.${behavior}`,
        })),
      ),
    },
    // 인라인 스위치로 두지 않는다 — 탭에서는 저널 폴더가 정해져 있으면 이 스위치 바로
    // 아래에 기존 저널 파일을 옮기는 버튼 행이 있고, 스위치 값에 따라 그 행이 '폴더로
    // 마이그레이션'(journalMigrate) ↔ '루트로 평탄화'(journalFlatten)로 바뀐다. 검색 결과에서
    // 바로 바꾸면 그 버튼을 보지 못한 채 새 파일과 옛 파일의 배치가 갈린다. 그 버튼 행은
    // 라벨이 바뀌어 따로 등록하지 않으므로(settings-search-coverage.test.ts) 그 말로도
    // 여기가 찾히게 keywords 에 둔다.
    {
      id: "journalUseHierarchy",
      label: "settings.general.journalHierarchy",
      description: "settings.general.journalHierarchy.desc",
      category: "journal",
      section: "settings.general.journal",
      keywords: [
        "journal",
        "folder",
        "hierarchy",
        "daily",
        "migrate",
        "flatten",
        "마이그레이션",
        "평탄화",
      ],
      control: NAVIGATE_CONTROL,
    },
    {
      id: "journalWeeklyTemplate",
      label: "settings.general.weeklyTemplate",
      description: "settings.general.weeklyTemplate.desc",
      category: "journal",
      section: "settings.general.periodicTemplates",
      keywords: ["journal", "template", "weekly"],
      control: NAVIGATE_CONTROL,
    },
    {
      id: "journalMonthlyTemplate",
      label: "settings.general.monthlyTemplate",
      description: "settings.general.monthlyTemplate.desc",
      category: "journal",
      section: "settings.general.periodicTemplates",
      keywords: ["journal", "template", "monthly"],
      control: NAVIGATE_CONTROL,
    },
    {
      id: "journalYearlyTemplate",
      label: "settings.general.yearlyTemplate",
      description: "settings.general.yearlyTemplate.desc",
      category: "journal",
      section: "settings.general.periodicTemplates",
      keywords: ["journal", "template", "yearly"],
      control: NAVIGATE_CONTROL,
    },
    {
      id: "journalCreateTemplateFiles",
      label: "settings.general.createTemplateFiles",
      description: "settings.general.createTemplateFiles.desc",
      category: "journal",
      section: "settings.general.periodicTemplates",
      keywords: ["journal", "template"],
      control: NAVIGATE_CONTROL,
    },
    {
      id: "tasksEnabled",
      label: "settings.general.tasksEnabled",
      description: "settings.general.tasksEnabled.desc",
      category: "tasks",
      section: "settings.general.tasks",
      keywords: ["task", "todo", "checkbox", "agenda"],
      control: makeToggleControl(
        () => settings.tasksEnabled,
        settings.setTasksEnabled,
      ),
    },
    {
      id: "tasksRecordDoneDate",
      label: "settings.general.tasksRecordDoneDate",
      description: "settings.general.tasksRecordDoneDate.desc",
      category: "tasks",
      section: "settings.general.tasks",
      keywords: ["task", "done", "completion", "date"],
      control: makeToggleControl(
        () => settings.tasksRecordDoneDate,
        settings.setTasksRecordDoneDate,
      ),
    },
    {
      id: "tasksTrackTime",
      label: "settings.general.tasksTrackTime",
      description: "settings.general.tasksTrackTime.desc",
      category: "tasks",
      section: "settings.general.tasks",
      keywords: ["task", "time", "timer", "tracking", "duration"],
      control: makeToggleControl(
        () => settings.tasksTrackTime,
        settings.setTasksTrackTime,
      ),
    },
    {
      id: "tasksStampCreatedDate",
      label: "settings.general.tasksStampCreatedDate",
      description: "settings.general.tasksStampCreatedDate.desc",
      category: "tasks",
      section: "settings.general.tasks",
      keywords: ["task", "created", "date", "stamp"],
      control: makeToggleControl(
        () => settings.tasksStampCreatedDate,
        settings.setTasksStampCreatedDate,
      ),
    },
    {
      id: "tasksWeekStart",
      label: "settings.general.tasksWeekStart",
      description: "settings.general.tasksWeekStart.desc",
      category: "tasks",
      section: "settings.general.tasks",
      keywords: ["task", "week", "monday", "sunday"],
      control: makeSelectControl(
        () => settings.tasksWeekStart,
        (v) => settings.setTasksWeekStart(v as "monday" | "sunday"),
        [
          { value: "monday", label: "settings.general.tasksWeekStart.monday" },
          { value: "sunday", label: "settings.general.tasksWeekStart.sunday" },
        ],
      ),
    },
    {
      id: "tasksHome",
      label: "settings.general.tasksHome",
      description: "settings.general.tasksHome.desc",
      category: "tasks",
      section: "settings.general.tasks",
      keywords: ["task", "home", "inbox", "capture", "태스크 홈"],
      control: NAVIGATE_CONTROL,
    },
    {
      id: "tasksScanScope",
      label: "settings.general.tasksScanScope",
      description: "settings.general.tasksScanScope.desc",
      category: "tasks",
      section: "settings.general.tasks",
      keywords: ["task", "scope", "agenda", "vault", "범위"],
      control: makeSelectControl(
        () => settings.tasksScanScope,
        (v) => settings.setTasksScanScope(v as TaskScanScope),
        // 설정 탭의 <select>와 같은 목록을 본다 — 범위가 늘면 한쪽에만 나타나서
        // 검색으로는 고를 수 없는 값이 생기는 일이 없도록.
        TASK_SCAN_SCOPES.map((scope) => ({
          value: scope,
          label: `settings.general.tasksScanScope.${scope}`,
        })),
      ),
    },
    {
      id: "tasksCaptureFile",
      label: "settings.general.tasksCaptureFile",
      description: "settings.general.tasksCaptureFile.desc",
      category: "tasks",
      section: "settings.general.tasks",
      keywords: ["task", "capture", "inbox", "수집함"],
      control: NAVIGATE_CONTROL,
    },
    {
      id: "tasksGlobalCaptureShortcut",
      label: "settings.general.tasksGlobalCapture",
      description: "settings.general.tasksGlobalCapture.desc",
      category: "tasks",
      section: "settings.general.tasks",
      keywords: ["task", "capture", "shortcut", "global", "hotkey", "단축키"],
      // 검색 패널에서 직접 녹음시키지 않는다 — 키를 누르는 순간 그 키가 검색창의
      // 입력으로도 들어간다. 설정 탭으로 보낸다.
      control: NAVIGATE_CONTROL,
    },
    {
      id: "tasksArchiveAfterDays",
      label: "settings.general.tasksArchiveAfterDays",
      description: "settings.general.tasksArchiveAfterDays.desc",
      category: "tasks",
      section: "settings.general.tasks",
      keywords: ["task", "archive", "done", "cleanup", "정리", "아카이브"],
      // 설명에 `{value}` 가 있다 — NAVIGATE_CONTROL 이면 결과에 "null일" 이 찍혔다.
      control: navigateControlShowing(() =>
        String(settings.tasksArchiveAfterDays),
      ),
    },
    {
      id: "tasksExcludePaths",
      label: "settings.general.tasksExcludePaths",
      description: "settings.general.tasksExcludePaths.desc",
      category: "tasks",
      section: "settings.general.tasks",
      keywords: ["task", "exclude", "ignore", "folder"],
      control: NAVIGATE_CONTROL,
    },
    {
      id: "zettelkastenEnabled",
      label: "settings.general.zettelkastenEnabled",
      description: "settings.general.zettelkastenEnabled.desc",
      category: "zettelkasten",
      section: "settings.general.zettelkasten",
      keywords: ["zettel", "slipbox", "permanent", "note"],
      control: makeToggleControl(
        () => settings.zettelkastenEnabled,
        settings.setZettelkastenEnabled,
      ),
    },
    {
      id: "zettelkastenDirectory",
      label: "settings.general.zettelkastenDirectory",
      description: "settings.general.zettelkastenDirectory.desc",
      category: "zettelkasten",
      section: "settings.general.zettelkasten",
      keywords: ["zettel", "folder", "path"],
      control: NAVIGATE_CONTROL,
    },
    {
      id: "zettelkastenStartupBehavior",
      label: "settings.general.zettelkastenStartup",
      description: "settings.general.zettelkastenStartup.desc",
      category: "zettelkasten",
      section: "settings.general.zettelkasten",
      keywords: ["zettel", "startup", "launch", "home"],
      control: makeSelectControl(
        () => settings.zettelkastenStartupBehavior,
        (v) =>
          settings.setZettelkastenStartupBehavior(v as ZettelStartupBehavior),
        ZETTEL_STARTUP_BEHAVIORS.map((behavior) => ({
          value: behavior,
          label: `settings.general.zettelkastenStartup.${behavior}`,
        })),
      ),
    },
    {
      id: "zettelkastenHomeNote",
      label: "settings.general.zettelkastenHomeNote",
      description: "settings.general.zettelkastenHomeNote.desc",
      category: "zettelkasten",
      section: "settings.general.zettelkasten",
      keywords: ["zettel", "home", "index", "note"],
      control: NAVIGATE_CONTROL,
    },
    // ── Editor ───────────────────────────────────────────────────────────────
    {
      id: "fontFamily",
      label: "settings.editor.fontFamily",
      description: "settings.editor.fontFamily.desc",
      category: "editor",
      section: "settings.editor.font",
      keywords: ["typeface", "font"],
      control: NAVIGATE_CONTROL,
    },
    {
      id: "codeFontFamily",
      label: "settings.editor.codeFontFamily",
      description: "settings.editor.codeFontFamily.desc",
      category: "editor",
      section: "settings.editor.font",
      keywords: ["typeface", "font", "code", "monospace"],
      control: NAVIGATE_CONTROL,
    },
    ...dialSliderSetting(
      {
        id: "fontSize",
        label: "settings.editor.fontSize",
        description: "settings.editor.fontSize.desc",
        category: "editor",
        section: "settings.editor.font",
      },
      "editorFontSize",
      themeDials,
      settings.appearanceOverrides,
      settings.setDial,
    ),
    ...dialSliderSetting(
      {
        id: "lineHeight",
        label: "settings.editor.lineHeight",
        description: "settings.editor.lineHeight.desc",
        category: "editor",
        section: "settings.editor.font",
      },
      "editorLineHeight",
      themeDials,
      settings.appearanceOverrides,
      settings.setDial,
    ),
    // §354 연동 스위치는 인라인으로, 그 아래 코드 크기·줄 높이 두 항목은 탭으로 보내는
    // 버튼으로 둔다. 두 슬라이더의 값은 연동이 켜져 있는 동안 무시되는데, 이 레지스트리의
    // 슬라이더 컨트롤에는 끈 상태가 없다 — 검색 결과에 살아 있는 슬라이더로 나오면 움직여도
    // 아무 일이 일어나지 않는, 고장과 구별되지 않는 컨트롤이 된다. 탭은 그 상태를
    // `disabled` 로 그린다. 스위치 자체는 언제나 유효하다.
    {
      id: "linkFontMetrics",
      label: "settings.editor.linkFontMetrics",
      description: "settings.editor.linkFontMetrics.desc",
      category: "editor",
      section: "settings.editor.font",
      keywords: ["code", "size", "line height", "link"],
      control: makeToggleControl(
        () => settings.linkFontMetrics,
        (on) => settings.setLinkFontMetrics(on, typography),
      ),
    },
    {
      id: "codeFontSize",
      label: "settings.editor.codeFontSize",
      description: "settings.editor.codeFontSize.desc",
      category: "editor",
      section: "settings.editor.font",
      keywords: ["code", "font", "size"],
      control: navigateControlShowing(() =>
        fontSizeNumber(Math.round(codeMetrics.fontSize)),
      ),
    },
    {
      id: "codeLineHeight",
      label: "settings.editor.codeLineHeight",
      description: "settings.editor.codeLineHeight.desc",
      category: "editor",
      section: "settings.editor.font",
      keywords: ["code", "line height", "spacing"],
      control: navigateControlShowing(() =>
        lineHeightNumber(codeMetrics.lineHeight),
      ),
    },
    {
      id: "tabSize",
      label: "settings.editor.tabSize",
      description: "settings.editor.tabSize.desc",
      category: "editor",
      section: "settings.editor.behavior",
      keywords: ["indent", "space"],
      control: makeSelectControl(
        () => String(settings.tabSize),
        (v) => settings.setTabSize(Number(v)),
        [
          { value: "2", label: "settings.editor.tabSize.2spaces" },
          { value: "4", label: "settings.editor.tabSize.4spaces" },
        ],
      ),
    },
    {
      id: "autoPairBrackets",
      label: "settings.editor.autoPairBrackets",
      description: "settings.editor.autoPairBrackets.desc",
      category: "editor",
      section: "settings.editor.behavior",
      control: makeToggleControl(
        () => settings.autoPairBrackets,
        settings.setAutoPairBrackets,
      ),
    },
    {
      id: "vimMode",
      label: "settings.editor.vimMode",
      description: "settings.editor.vimMode.desc",
      category: "editor",
      section: "settings.editor.behavior",
      keywords: ["vim", "modal", "hjkl", "keybinding"],
      control: makeToggleControl(() => settings.vimMode, settings.setVimMode),
    },
    {
      id: "lineNumbers",
      label: "settings.editor.lineNumbers",
      description: "settings.editor.lineNumbers.desc",
      category: "editor",
      section: "settings.editor.display",
      control: makeToggleControl(
        () => settings.lineNumbers,
        settings.setLineNumbers,
      ),
    },
    // §368 — editorLineBreak도 editorMaxWidth와 같은 다이얼 기계를 쓰는
    // 외관 다이얼이다. 행(EditorTab.tsx)이 editorMaxWidth 바로 위에 있는
    // 이유와 같은 이유로 여기서도 그 앞에 둔다(§4.4: 검색 결과 라벨은 행과
    // 같은 순서·같은 키를 따른다).
    ...dialSelectSetting(
      {
        id: "editorLineBreak",
        label: "settings.editor.editorLineBreak",
        description: "settings.editor.editorLineBreak.desc",
        category: "editor",
        section: "settings.editor.display",
      },
      "editorLineBreak",
      themeDials,
      settings.appearanceOverrides,
      settings.setDial,
    ),
    // §368 — 자간·문단 간격도 editorMaxWidth와 같은 다이얼 기계를 쓰는 number
    // 다이얼이다. 행(EditorTab.tsx)이 editorLineBreak 바로 다음, editorMaxWidth
    // 바로 앞에 있는 것과 같은 순서로 여기도 둔다(§4.4).
    ...dialSliderSetting(
      {
        id: "editorLetterSpacing",
        label: "settings.editor.editorLetterSpacing",
        description: "settings.editor.editorLetterSpacing.desc",
        category: "editor",
        section: "settings.editor.display",
      },
      "editorLetterSpacing",
      themeDials,
      settings.appearanceOverrides,
      settings.setDial,
    ),
    ...dialSliderSetting(
      {
        id: "editorParagraphSpacing",
        label: "settings.editor.editorParagraphSpacing",
        description: "settings.editor.editorParagraphSpacing.desc",
        category: "editor",
        section: "settings.editor.display",
      },
      "editorParagraphSpacing",
      themeDials,
      settings.appearanceOverrides,
      settings.setDial,
    ),
    // §368.2 — 강조 렌더링도 editorLineBreak와 같은 다이얼 기계를 쓰는 enum
    // 다이얼이다. 조판 다이얼들(줄바꿈·자간·문단 간격) 끝에 둔다(§4.4).
    ...dialSelectSetting(
      {
        id: "editorEmphasisStyle",
        label: "settings.editor.editorEmphasisStyle",
        description: "settings.editor.editorEmphasisStyle.desc",
        category: "editor",
        section: "settings.editor.display",
      },
      "editorEmphasisStyle",
      themeDials,
      settings.appearanceOverrides,
      settings.setDial,
    ),
    // §366 되돌림 — editorMaxWidth는 잠시 외관 다이얼로 Appearance 탭에
    // 옮겨졌다가(Task 7) 돌아왔다. 다이얼 기계(병합·출처·되돌리기)는 그대로
    // AppearanceDialRow가 맡고, 여기서 바뀌는 것은 분류(category/section)뿐이다.
    ...dialSliderSetting(
      {
        id: "editorMaxWidth",
        label: "settings.editor.maxWidth",
        description: "settings.editor.maxWidth.desc",
        category: "editor",
        section: "settings.editor.display",
      },
      "editorMaxWidth",
      themeDials,
      settings.appearanceOverrides,
      settings.setDial,
    ),
    // §368 — 검색에서 이 설정을 찾을 방법이 없었다(행은 EditorTab.tsx에 이미
    // 있었지만 레지스트리에 항목이 없었다). §4.4: 검색 결과 라벨·설명은 행과
    // 같은 i18n 키를 그대로 재사용한다 — 키 이름 자체는 `settings.appearance.*`
    // 이력을 그대로 두고(이 태스크의 개명 대상이 아니다), category만 editor다.
    ...dialSliderSetting(
      {
        id: "editorPadding",
        label: "settings.appearance.editorPadding",
        description: "settings.appearance.editorPadding.desc",
        category: "editor",
        section: "settings.editor.display",
      },
      "editorPadding",
      themeDials,
      settings.appearanceOverrides,
      settings.setDial,
    ),
    // §369 — 리스트 들여쓰기 가이드의 농도. 색조는 여기 없다: 그쪽은 테마가
    // 고르는 `--color-editor-guide-tint` 이고 테마 편집기의 색 피커가 맡는다
    // (`THEME_COLOR_KEYS`). 두 축이 서로 다른 화면에 있는 것이 설계다.
    ...dialSliderSetting(
      {
        id: "editorListGuideStrength",
        label: "settings.editor.editorListGuideStrength",
        description: "settings.editor.editorListGuideStrength.desc",
        category: "editor",
        section: "settings.editor.display",
      },
      "editorListGuideStrength",
      themeDials,
      settings.appearanceOverrides,
      settings.setDial,
    ),
    // §5.1 — 순서 있는 마커의 정렬. editorEmphasisStyle 과 같은 enum 다이얼이고,
    // 행(EditorTab.tsx)이 가이드 농도 바로 다음에 있는 것과 같은 순서로 둔다.
    ...dialSelectSetting(
      {
        id: "editorOrderedMarkerAlign",
        label: "settings.editor.editorOrderedMarkerAlign",
        description: "settings.editor.editorOrderedMarkerAlign.desc",
        category: "editor",
        section: "settings.editor.display",
      },
      "editorOrderedMarkerAlign",
      themeDials,
      settings.appearanceOverrides,
      settings.setDial,
    ),
    {
      id: "virtualizeLargeDocs",
      label: "settings.editor.virtualizeLargeDocs",
      description: "settings.editor.virtualizeLargeDocs.desc",
      category: "editor",
      section: "settings.editor.display",
      control: makeToggleControl(
        () => settings.virtualizeLargeDocs,
        settings.setVirtualizeLargeDocs,
      ),
    },
    {
      id: "autoLoadVideoEmbeds",
      label: "settings.editor.autoLoadVideoEmbeds",
      description: "settings.editor.autoLoadVideoEmbeds.desc",
      category: "editor",
      section: "settings.editor.display",
      control: makeToggleControl(
        () => settings.autoLoadVideoEmbeds,
        settings.setAutoLoadVideoEmbeds,
      ),
    },
    // ── Appearance ───────────────────────────────────────────────────────────
    {
      id: "activeThemeId",
      label: "settings.appearance.theme",
      description: "settings.appearance.theme",
      category: "appearance",
      section: "settings.appearance.theme",
      keywords: ["dark", "light", "color", "theme"],
      control: NAVIGATE_CONTROL,
    },
    // 0049 §10.4 — the theme marketplace, findable from settings search (0090 final
    // review, L4). It lives two screens deep (Appearance → Browse Themes) and nothing
    // named it here, so searching "install theme" or "marketplace" found the plugin panel
    // and nothing else. `NAVIGATE_CONTROL` like its neighbour: search takes the user to
    // the Appearance tab, which is where the entry point is.
    {
      id: "browseThemes",
      label: "settings.appearance.browseThemes",
      description: "settings.appearance.themeBrowser.title",
      category: "appearance",
      section: "settings.appearance.theme",
      keywords: ["theme", "install", "marketplace", "browse", "download"],
      control: NAVIGATE_CONTROL,
    },
    // §367 — 강조색 다이얼 둘. 행은 AppearanceTab.tsx 에 있고, 여기 있는 것은
    // **검색**이다. 둘이 갈리면 검색해서 찾은 설정이 아무 데도 데려가지 않는
    // 구멍이 된다 — 0093 이 `editorPadding` 에서 정확히 그 구멍을 냈고 0094 가
    // 메웠다. label 은 행이 쓰는 키와 **같은 문자열**이어야 한다(§4.4).
    ...dialSliderSetting(
      {
        id: "accentHueShift",
        label: "settings.appearance.accentHueShift",
        description: "settings.appearance.accentHueShift.desc",
        category: "appearance",
        section: "settings.appearance.theme",
        keywords: ["accent", "colour", "color", "hue", "tint"],
      },
      "accentHueShift",
      themeDials,
      settings.appearanceOverrides,
      settings.setDial,
    ),
    ...dialSliderSetting(
      {
        id: "accentSaturationShift",
        label: "settings.appearance.accentSaturationShift",
        description: "settings.appearance.accentSaturationShift.desc",
        category: "appearance",
        section: "settings.appearance.theme",
        keywords: ["accent", "colour", "color", "saturation", "vivid"],
      },
      "accentSaturationShift",
      themeDials,
      settings.appearanceOverrides,
      settings.setDial,
    ),
    // §365 다이얼 2a·2b — 배경 대비(스펙 0059). 행은 AppearanceTab.tsx 의 테마 섹션,
    // 강조색 두 행 아래다. label 은 행이 쓰는 키와 같은 문자열이다(0055 §4.4).
    ...dialSelectSetting(
      {
        id: "backgroundContrastLight",
        label: "settings.appearance.backgroundContrastLight",
        description: "settings.appearance.backgroundContrastLight.desc",
        category: "appearance",
        section: "settings.appearance.theme",
        keywords: ["background", "contrast", "sidebar", "flat", "white"],
      },
      "backgroundContrastLight",
      themeDials,
      settings.appearanceOverrides,
      settings.setDial,
    ),
    ...dialSelectSetting(
      {
        id: "backgroundContrastDark",
        label: "settings.appearance.backgroundContrastDark",
        description: "settings.appearance.backgroundContrastDark.desc",
        category: "appearance",
        section: "settings.appearance.theme",
        keywords: [
          "background",
          "contrast",
          "sidebar",
          "flat",
          "black",
          "oled",
        ],
      },
      "backgroundContrastDark",
      themeDials,
      settings.appearanceOverrides,
      settings.setDial,
    ),
    // §365 다이얼 4·5 — 행은 AppearanceTab.tsx 의 "간격과 모서리" 섹션이다. label 은
    // 행이 쓰는 키와 같은 문자열이다(0055 §4.4).
    ...dialSelectSetting(
      {
        id: "density",
        label: "settings.appearance.density",
        description: "settings.appearance.density.desc",
        category: "appearance",
        section: "settings.appearance.spaceAndCorners",
        keywords: ["density", "compact", "spacious", "spacing", "padding"],
      },
      "density",
      themeDials,
      settings.appearanceOverrides,
      settings.setDial,
    ),
    ...dialSelectSetting(
      {
        id: "cornerRadius",
        label: "settings.appearance.cornerRadius",
        description: "settings.appearance.cornerRadius.desc",
        category: "appearance",
        section: "settings.appearance.spaceAndCorners",
        keywords: ["corner", "radius", "rounded", "sharp", "round"],
      },
      "cornerRadius",
      themeDials,
      settings.appearanceOverrides,
      settings.setDial,
    ),
    // ── Markdown ─────────────────────────────────────────────────────────────
    {
      id: "inlineMath",
      label: "settings.markdown.inlineMath",
      description: "settings.markdown.inlineMath.desc",
      category: "markdown",
      section: "settings.markdown.extendedSyntax",
      keywords: ["katex", "latex", "equation"],
      control: makeToggleControl(
        () => settings.inlineMath,
        settings.setInlineMath,
      ),
    },
    {
      id: "highlight",
      label: "settings.markdown.highlight",
      description: "settings.markdown.highlight.desc",
      category: "markdown",
      section: "settings.markdown.extendedSyntax",
      control: makeToggleControl(
        () => settings.highlight,
        settings.setHighlight,
      ),
    },
    {
      id: "strikethrough",
      label: "settings.markdown.strikethrough",
      description: "settings.markdown.strikethrough.desc",
      category: "markdown",
      section: "settings.markdown.extendedSyntax",
      control: makeToggleControl(
        () => settings.strikethrough,
        settings.setStrikethrough,
      ),
    },
    {
      id: "smartPunctuation",
      label: "settings.markdown.smartPunctuation",
      description: "settings.markdown.smartPunctuation.desc",
      category: "markdown",
      section: "settings.markdown.typography",
      control: makeToggleControl(
        () => settings.smartPunctuation,
        settings.setSmartPunctuation,
      ),
    },
    {
      id: "symbolSuggest",
      label: "settings.markdown.symbolSuggest",
      description: "settings.markdown.symbolSuggest.desc",
      category: "markdown",
      section: "settings.markdown.typography",
      control: makeToggleControl(
        () => settings.symbolSuggest,
        settings.setSymbolSuggest,
      ),
    },
    // ── AI ───────────────────────────────────────────────────────────────────
    {
      id: "aiEnabled",
      label: "settings.ai.aiEnabled",
      description: "settings.ai.aiEnabled.desc",
      category: "ai",
      section: "settings.ai.provider",
      keywords: ["ai", "assistant", "disable", "off"],
      control: makeToggleControl(() => ai.aiEnabled, ai.setAIEnabled),
    },
    {
      id: "provider",
      label: "settings.ai.aiProvider",
      description: "settings.ai.aiProvider.desc",
      category: "ai",
      section: "settings.ai.provider",
      // Both derived from the provider table: the settings search index and
      // this select used to list providers independently of the AI tab, so a
      // new provider could be selectable in one place and not the other.
      keywords: [...AI_PROVIDER_IDS],
      control: makeSelectControl(
        () => ai.provider,
        (v) => ai.setProvider(v as AIProvider),
        AI_PROVIDER_IDS.map((id) => ({
          value: id,
          label: AI_PROVIDERS[id].labelKey,
        })),
      ),
    },
    {
      id: "apiKey",
      label: "settings.ai.apiKey",
      description: "settings.ai.apiKey",
      category: "ai",
      section: "settings.ai.provider",
      control: NAVIGATE_CONTROL,
    },
    // 텍스트 입력이라 다른 입력 행(tasksCaptureFile 등)처럼 탭으로 보낸다. ‼️ 탭은 이 행을
    // 주 공급자가 Ollama 일 때만 그린다(AITab 의 `provider === "ollama"`). 그런데 자동 모델
    // 선택이 켜져 있으면 값은 작업별 공급자만 Ollama 여도 쓰인다(model-selection.ts 의
    // `baseUrl`) — 그 구성에서는 여기서 탭으로 가도 행이 없다. 좁은 쪽은 탭의 조건이고, 이
    // 항목이 고치는 문제가 아니다.
    {
      id: "ollamaUrl",
      label: "settings.ai.ollamaUrl",
      description: "settings.ai.ollamaUrl.desc",
      category: "ai",
      section: "settings.ai.provider",
      keywords: ["ollama", "url", "local", "server"],
      control: NAVIGATE_CONTROL,
    },
    {
      id: "model",
      label: "settings.ai.model",
      description: "settings.ai.model.desc",
      category: "ai",
      section: "settings.ai.provider",
      control: NAVIGATE_CONTROL,
    },
    {
      id: "autoModelEnabled",
      label: "settings.ai.autoModel",
      description: "settings.ai.autoModel.desc",
      category: "ai",
      section: "settings.ai.modelSelection",
      keywords: ["model", "task", "auto"],
      control: makeToggleControl(
        () => ai.autoModelEnabled,
        ai.setAutoModelEnabled,
      ),
    },
    // 작업별 모델 넷(`TaskModelSelector`)은 공급자·모델 두 select 를 묶은 행이고
    // 모델 목록을 공급자에게 비동기로 받아 온다 — 검색 결과의 단일 컨트롤로는
    // 옮길 수 없어서 `model` 항목처럼 탭으로 보낸다.
    {
      id: "ghostTextModel",
      label: "settings.ai.ghostTextModel",
      description: "settings.ai.ghostTextModel.desc",
      category: "ai",
      section: "settings.ai.modelSelection",
      keywords: ["model", "autocomplete"],
      control: NAVIGATE_CONTROL,
    },
    {
      id: "inlineEditModel",
      label: "settings.ai.inlineEditModel",
      description: "settings.ai.inlineEditModel.desc",
      category: "ai",
      section: "settings.ai.modelSelection",
      keywords: ["model", "edit"],
      control: NAVIGATE_CONTROL,
    },
    {
      id: "chatModel",
      label: "settings.ai.chatModel",
      description: "settings.ai.chatModel.desc",
      category: "ai",
      section: "settings.ai.modelSelection",
      keywords: ["model", "chat"],
      control: NAVIGATE_CONTROL,
    },
    {
      id: "agentModel",
      label: "settings.ai.agentModel",
      description: "settings.ai.agentModel.desc",
      category: "ai",
      section: "settings.ai.modelSelection",
      keywords: ["model", "agent"],
      control: NAVIGATE_CONTROL,
    },
    {
      id: "ghostTextEnabled",
      label: "settings.ai.ghostTextEnabled",
      description: "settings.ai.ghostTextEnabled.desc",
      category: "ai",
      section: "settings.ai.ghostText",
      keywords: ["autocomplete", "suggestion"],
      control: makeToggleControl(
        () => ai.ghostTextEnabled,
        ai.setGhostTextEnabled,
      ),
    },
    // 두 설명 문자열은 `{value}` 자리를 갖고 있다 — SettingsSearchResults 가 컨트롤의
    // 현재 값으로 채운다. 범위는 AITab 의 range 입력과 같은 상수(stores/ai/ai.ts)다.
    {
      id: "ghostTextDebounceMs",
      label: "settings.ai.debounce",
      description: "settings.ai.debounce.desc",
      category: "ai",
      section: "settings.ai.ghostText",
      keywords: ["delay", "autocomplete"],
      control: makeSliderControl(
        () => ai.ghostTextDebounceMs,
        ai.setGhostTextDebounceMs,
        GHOST_TEXT_DEBOUNCE_RANGE,
      ),
    },
    {
      id: "maxSuggestionLength",
      label: "settings.ai.maxLength",
      description: "settings.ai.maxLength.desc",
      category: "ai",
      section: "settings.ai.ghostText",
      keywords: ["length", "autocomplete"],
      control: makeSliderControl(
        () => ai.maxSuggestionLength,
        ai.setMaxSuggestionLength,
        MAX_SUGGESTION_LENGTH_RANGE,
      ),
    },
    {
      id: "privacyMode",
      label: "settings.ai.privacyMode",
      description: "settings.ai.privacyMode.desc",
      category: "ai",
      section: "settings.ai.privacy",
      control: makeToggleControl(() => ai.privacyMode, ai.setPrivacyMode),
    },
    // ── Activity Bar (화면 배치 축 — §365.4) ───────────────────────────────────
    {
      id: "activityBarVisible",
      label: "settings.activitybar.chromeVisibility.activityBar",
      description: "settings.activitybar.chromeVisibility.activityBar.desc",
      category: "activitybar",
      section: "settings.activitybar.chromeVisibility",
      keywords: ["chrome", "show", "hide", "toolbar"],
      // `toggleActivityBar` has no `(value)` form — it just flips. Every other
      // toggle entry's setter genuinely respects the boolean it's handed, so an
      // idempotency-respecting wrapper (no-op when already at `next`) keeps that
      // contract here too, in case a future caller ever sets an explicit value
      // instead of going through `ToggleSwitch`'s `onChange(!checked)`.
      control: makeToggleControl(
        () => ui.activityBarVisible,
        (next) => {
          if (next !== ui.activityBarVisible) ui.toggleActivityBar();
        },
      ),
    },
    {
      id: "statusBarVisible",
      label: "settings.activitybar.chromeVisibility.statusBar",
      description: "settings.activitybar.chromeVisibility.statusBar.desc",
      category: "activitybar",
      section: "settings.activitybar.chromeVisibility",
      keywords: ["chrome", "show", "hide", "bottom"],
      control: makeToggleControl(
        () => ui.statusBarVisible,
        (next) => {
          if (next !== ui.statusBarVisible) ui.toggleStatusBar();
        },
      ),
    },
    {
      id: "tabBarVisible",
      label: "settings.activitybar.chromeVisibility.tabBar",
      description: "settings.activitybar.chromeVisibility.tabBar.desc",
      category: "activitybar",
      section: "settings.activitybar.chromeVisibility",
      keywords: ["chrome", "show", "hide", "tabs"],
      control: makeToggleControl(
        () => ui.tabBarVisible,
        (next) => {
          if (next !== ui.tabBarVisible) ui.toggleTabBar();
        },
      ),
    },
    {
      id: "activityBarConfig",
      label: "settings.tab.activitybar",
      description: "settings.activitybar.desc",
      category: "activitybar",
      section: "settings.tab.activitybar",
      keywords: ["icon", "sidebar", "panel"],
      control: NAVIGATE_CONTROL,
    },
    // ── Language ─────────────────────────────────────────────────────────────
    {
      id: "locale",
      // 행(LanguageTab)이 쓰는 라벨 키와 같은 문자열이다(0055 §4.4).
      label: "settings.language.interface",
      description: "settings.language.interface.desc",
      category: "language",
      section: "settings.language.title",
      keywords: ["locale", "i18n", "korean", "english", "한국어"],
      control: makeSelectControl(
        () => settings.locale,
        (v) => settings.setLocale(v),
        AVAILABLE_LOCALES.map((loc: Locale) => ({
          value: loc,
          label: LOCALE_LABELS[loc],
        })),
      ),
    },
    // ── Keybindings ──────────────────────────────────────────────────────────
    {
      id: "keybindings",
      label: "settings.tab.keybindings",
      description: "",
      category: "keybindings",
      section: "settings.tab.keybindings",
      keywords: [
        "shortcut",
        "key",
        "binding",
        "hotkey",
        "keyboard",
        "remap",
        "단축키",
        "키보드",
        "바인딩",
      ],
      control: NAVIGATE_CONTROL,
    },
  ];
}

function makeSelectControl(
  selector: () => number | string,
  setter: (v: string) => void,
  options: Array<{ label: string; value: string }>,
): SettingControlMeta {
  return {
    controlType: "select",
    storeSelector: selector,
    storeSetter: setter as (v: unknown) => void,
    options,
  };
}

function makeSliderControl(
  selector: () => number,
  setter: (v: number) => void,
  range: { max: number; min: number; step: number },
): SettingControlMeta {
  return {
    controlType: "slider",
    storeSelector: selector,
    storeSetter: setter as (v: unknown) => void,
    range,
  };
}

function makeToggleControl(
  selector: () => boolean,
  setter: (v: boolean) => void,
): SettingControlMeta {
  return {
    controlType: "toggle",
    storeSelector: selector,
    storeSetter: setter as (v: unknown) => void,
  };
}

/**
 * `NAVIGATE_CONTROL` 처럼 탭으로 보내는 버튼이지만, 설명 문자열의 `{value}` 에 넣을 값을
 * 돌려준다. `NAVIGATE_CONTROL` 의 selector 는 null 이라 그런 설명에 쓰면 "null" 이 찍힌다.
 * `SearchSettingControl` 은 `customRender` 없는 `custom` 을 이동 버튼으로 그린다.
 */
function navigateControlShowing(value: () => string): SettingControlMeta {
  return {
    controlType: "custom",
    storeSelector: value,
    storeSetter: () => undefined,
  };
}

// §368 — number 다이얼(editorMaxWidth·editorPadding·editorLetterSpacing·
// editorParagraphSpacing) 넷 다 슬라이더 컨트롤을 만드는 두 단정을 반복한다:
// `DIALS.find()`는 id-동등 predicate 로는 `DialDef`의 `kind` 판별 유니언을
// 좁혀 주지 않고, `resolveDials(...)[id].value`는 어떤 id 든 `DialValue`
// (number | string)라 슬라이더 셀렉터의 `() => number` 에 맞추려면 단정이
// 필요하다. `numberDialSliderControl`이 그 둘을 이 자리 하나로 모은다 — 단,
// 첫 번째는 단정이 아니라 `dial.kind === "number"` 런타임 판별로 좁혀서
// 캐스트 없이 `.range`에 접근한다(단정보다 이쪽이 실패를 삼키지 않는다).
//
// `id`가 number 다이얼로 풀리지 않으면(오타·다이얼 제거) `undefined`를
// 돌려줄 뿐, 던지지 않는다 — 이전에 있던 모듈 최상단 `throw`는 이 가정이
// 딱 한 번 깨졌을 때 레지스트리를 쓰는 모든 화면(설정 전체)의 모듈 로드를
// 막았다. `dialSliderSetting`이 `undefined`를 받으면 그 항목 하나만 검색
// 목록에서 빠진다 — 나머지 설정 검색은 계속 동작한다.
function numberDialSliderControl(
  id: DialId,
  themeDials: DialValues,
  userOverrides: DialValues,
  setDial: (dialId: DialId, value: DialValue) => void,
): SettingControlMeta | undefined {
  const dial = DIALS.find((d) => d.id === id);
  if (!dial || dial.kind !== "number") return undefined;
  return makeSliderControl(
    () => resolveDials(themeDials, userOverrides)[id].value as number,
    (v) => setDial(id, v),
    dial.range,
  );
}

/**
 * A searchable-settings entry for a number dial — an array of 0 or 1 elements
 * so a call site can splice it into the registry list with `...` instead of
 * a ternary. Empty when `dialId` does not resolve to a number dial; see
 * {@link numberDialSliderControl} for why that is a silent skip, not a throw.
 */
function dialSliderSetting(
  entry: Omit<SearchableSetting, "control">,
  dialId: DialId,
  themeDials: DialValues,
  userOverrides: DialValues,
  setDial: (id: DialId, value: DialValue) => void,
): SearchableSetting[] {
  const control = numberDialSliderControl(
    dialId,
    themeDials,
    userOverrides,
    setDial,
  );
  return control ? [{ ...entry, control }] : [];
}

// §365 — enum 다이얼의 검색 항목. 옵션과 라벨을 `DIALS` 와 `dialOptionLabelKey` 에서
// 파생한다: 손으로 나열하면 행이 보이는 옵션과 검색이 보이는 옵션이 갈리는 날이
// 온다(스펙 0057 §6). `numberDialSliderControl` 과 같은 이유로, id 가 enum 다이얼로
// 풀리지 않으면 던지지 않고 그 항목 하나만 뺀다.
function enumDialSelectControl(
  id: DialId,
  themeDials: DialValues,
  userOverrides: DialValues,
  setDial: (dialId: DialId, value: DialValue) => void,
): SettingControlMeta | undefined {
  const dial = DIALS.find((d) => d.id === id);
  if (!dial || dial.kind !== "enum") return undefined;
  return makeSelectControl(
    () => resolveDials(themeDials, userOverrides)[id].value,
    (v) => setDial(id, v),
    dial.options.map((option) => ({
      label: dialOptionLabelKey(id, option),
      value: option,
    })),
  );
}

/** {@link dialSliderSetting} 의 enum 짝 — 0 또는 1 원소 배열. */
function dialSelectSetting(
  entry: Omit<SearchableSetting, "control">,
  dialId: DialId,
  themeDials: DialValues,
  userOverrides: DialValues,
  setDial: (id: DialId, value: DialValue) => void,
): SearchableSetting[] {
  const control = enumDialSelectControl(
    dialId,
    themeDials,
    userOverrides,
    setDial,
  );
  return control ? [{ ...entry, control }] : [];
}
