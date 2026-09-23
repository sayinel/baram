// Settings Registry — metadata for all searchable settings
// Phase 2: each entry carries SettingControlMeta for data-driven rendering
import type React from "react";

import type { DialId, DialValue, DialValues } from "../../appearance/dials";
import type { Locale } from "../../i18n";
import type { AIProvider } from "../../stores/ai/ai";
import type { SettingsState } from "../../stores/settings/store";
import type { TaskScanScope } from "../../utils/tasks/task-scan-scope";

import { useShallow } from "zustand/shallow";

import { DIALS } from "../../appearance/dials";
import { resolveDials } from "../../appearance/merge";
import { useThemeDials } from "../../hooks/use-theme-dials";
import { AVAILABLE_LOCALES, LOCALE_LABELS } from "../../i18n";
import { useAIStore } from "../../stores/ai/ai";
import { AI_PROVIDER_IDS, AI_PROVIDERS } from "../../stores/ai/providers";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { TASK_SCAN_SCOPES } from "../../utils/tasks/task-scan-scope";

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
  autoLoadVideoEmbeds: s.autoLoadVideoEmbeds,
  autoPairBrackets: s.autoPairBrackets,
  autoSave: s.autoSave,
  autoSaveDelay: s.autoSaveDelay,
  autoUpdateLinks: s.autoUpdateLinks,
  fontSize: s.fontSize,
  highlight: s.highlight,
  inlineMath: s.inlineMath,
  journalEnabled: s.journalEnabled,
  lineHeight: s.lineHeight,
  lineNumbers: s.lineNumbers,
  linkFontMetrics: s.linkFontMetrics,
  locale: s.locale,
  onLaunch: s.onLaunch,
  setAutoLoadVideoEmbeds: s.setAutoLoadVideoEmbeds,
  setAutoPairBrackets: s.setAutoPairBrackets,
  setAutoSave: s.setAutoSave,
  setAutoSaveDelay: s.setAutoSaveDelay,
  setAutoUpdateLinks: s.setAutoUpdateLinks,
  setDial: s.setDial,
  setFontSize: s.setFontSize,
  setHighlight: s.setHighlight,
  setInlineMath: s.setInlineMath,
  setJournalEnabled: s.setJournalEnabled,
  setLineHeight: s.setLineHeight,
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
  setVirtualizeLargeDocs: s.setVirtualizeLargeDocs,
  setWikilinkFormat: s.setWikilinkFormat,
  setZettelkastenEnabled: s.setZettelkastenEnabled,
  smartPunctuation: s.smartPunctuation,
  snapshotInterval: s.snapshotInterval,
  snapshotMaxCount: s.snapshotMaxCount,
  spellCheck: s.spellCheck,
  strikethrough: s.strikethrough,
  symbolSuggest: s.symbolSuggest,
  tabSize: s.tabSize,
  tasksEnabled: s.tasksEnabled,
  tasksRecordDoneDate: s.tasksRecordDoneDate,
  tasksScanScope: s.tasksScanScope,
  tasksStampCreatedDate: s.tasksStampCreatedDate,
  tasksTrackTime: s.tasksTrackTime,
  tasksWeekStart: s.tasksWeekStart,
  virtualizeLargeDocs: s.virtualizeLargeDocs,
  wikilinkFormat: s.wikilinkFormat,
  zettelkastenEnabled: s.zettelkastenEnabled,
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
  // 그 비용이 커졌다. 아래 여덟 필드만 이 파일이 실제로 읽고 쓴다.
  const ai = useAIStore(
    useShallow((s) => ({
      aiEnabled: s.aiEnabled,
      ghostTextEnabled: s.ghostTextEnabled,
      privacyMode: s.privacyMode,
      provider: s.provider,
      setAIEnabled: s.setAIEnabled,
      setGhostTextEnabled: s.setGhostTextEnabled,
      setPrivacyMode: s.setPrivacyMode,
      setProvider: s.setProvider,
    })),
  );
  // §366 — 검색 결과의 다이얼 컨트롤은 `AppearanceDialRow`와 **같은** 병합 결과를
  // 보여야 한다. 같은 설정이 두 표면에서 다른 값을 말하면 그중 하나는 거짓말이다.
  // 위 M-11 정정과 같은 규율로, 이 훅도 스토어를 좁게 읽는다(`activeThemeId` ·
  // `installedThemes` · 플러그인 스토어의 `revocations`).
  const themeDials = useThemeDials();
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
      control: NAVIGATE_CONTROL,
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
    {
      id: "fontSize",
      label: "settings.editor.fontSize",
      description: "settings.editor.fontSize.desc",
      category: "editor",
      section: "settings.editor.font",
      control: makeSliderControl(
        () => settings.fontSize,
        settings.setFontSize,
        { min: 8, max: 32, step: 1 },
      ),
    },
    {
      id: "lineHeight",
      label: "settings.editor.lineHeight",
      description: "settings.editor.lineHeight.desc",
      category: "editor",
      section: "settings.editor.font",
      control: makeSliderControl(
        () => settings.lineHeight,
        settings.setLineHeight,
        { min: 1.0, max: 3.0, step: 0.05 },
      ),
    },
    // §354 연동 스위치만 검색에 올린다. 코드 크기·줄 높이 슬라이더는 연동이
    // 켜져 있는 동안 값이 무시되는데, 이 레지스트리의 슬라이더 컨트롤에는 끈
    // 상태가 없다 — 검색 결과에 살아 있는 슬라이더로 나오면 움직여도 아무 일이
    // 일어나지 않는, 고장과 구별되지 않는 컨트롤이 된다. 스위치는 그 두 행으로
    // 가는 문이고, 그 자체로는 언제나 유효하다.
    {
      id: "linkFontMetrics",
      label: "settings.editor.linkFontMetrics",
      description: "settings.editor.linkFontMetrics.desc",
      category: "editor",
      section: "settings.editor.font",
      keywords: ["code", "size", "line height", "link"],
      control: makeToggleControl(
        () => settings.linkFontMetrics,
        settings.setLinkFontMetrics,
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
    {
      id: "editorLineBreak",
      label: "settings.editor.editorLineBreak",
      description: "settings.editor.editorLineBreak.desc",
      category: "editor",
      section: "settings.editor.display",
      control: makeSelectControl(
        // `makeSelectControl`의 selector는 `() => number | string`이라
        // `DialValue`가 그대로 맞는다 — String()으로 감싸지 않는다.
        () =>
          resolveDials(themeDials, settings.appearanceOverrides).editorLineBreak
            .value,
        (v) => settings.setDial("editorLineBreak", v),
        [
          {
            value: "normal",
            label: "settings.editor.editorLineBreak.normal",
          },
          {
            value: "keepAll",
            label: "settings.editor.editorLineBreak.keepAll",
          },
        ],
      ),
    },
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
    {
      id: "editorEmphasisStyle",
      label: "settings.editor.editorEmphasisStyle",
      description: "settings.editor.editorEmphasisStyle.desc",
      category: "editor",
      section: "settings.editor.display",
      control: makeSelectControl(
        () =>
          resolveDials(themeDials, settings.appearanceOverrides)
            .editorEmphasisStyle.value,
        (v) => settings.setDial("editorEmphasisStyle", v),
        [
          {
            value: "italic",
            label: "settings.editor.editorEmphasisStyle.italic",
          },
          {
            value: "color",
            label: "settings.editor.editorEmphasisStyle.color",
          },
          {
            value: "weight",
            label: "settings.editor.editorEmphasisStyle.weight",
          },
        ],
      ),
    },
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
    {
      id: "editorOrderedMarkerAlign",
      label: "settings.editor.editorOrderedMarkerAlign",
      description: "settings.editor.editorOrderedMarkerAlign.desc",
      category: "editor",
      section: "settings.editor.display",
      control: makeSelectControl(
        () =>
          resolveDials(themeDials, settings.appearanceOverrides)
            .editorOrderedMarkerAlign.value,
        (v) => settings.setDial("editorOrderedMarkerAlign", v),
        [
          {
            value: "number",
            label: "settings.editor.editorOrderedMarkerAlign.number",
          },
          {
            value: "period",
            label: "settings.editor.editorOrderedMarkerAlign.period",
          },
        ],
      ),
    },
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
    {
      id: "model",
      label: "settings.ai.model",
      description: "settings.ai.model.desc",
      category: "ai",
      section: "settings.ai.provider",
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
      label: "settings.language.title",
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
