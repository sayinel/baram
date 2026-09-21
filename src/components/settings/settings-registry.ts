// Settings Registry — metadata for all searchable settings
// Phase 2: each entry carries SettingControlMeta for data-driven rendering
import type React from "react";

import type { NumberDialDef } from "../../appearance/dials";
import type { Locale } from "../../i18n";
import type { AIProvider } from "../../stores/ai/ai";
import type { SettingsState } from "../../stores/settings/store";
import type { TaskScanScope } from "../../utils/tasks/task-scan-scope";

import { useShallow } from "zustand/shallow";

import { DIALS } from "../../appearance/dials";
import { resolveDials } from "../../appearance/merge";
import { AVAILABLE_LOCALES, LOCALE_LABELS } from "../../i18n";
import { useAIStore } from "../../stores/ai/ai";
import { AI_PROVIDER_IDS, AI_PROVIDERS } from "../../stores/ai/providers";
import { useSettingsStore } from "../../stores/settings/store";
import { TASK_SCAN_SCOPES } from "../../utils/tasks/task-scan-scope";

// §366 — editorMaxWidth 항목의 슬라이더 범위는 다이얼의 `range`에서 가져온다
// (브리프 Step 5). 리터럴로 다시 적으면 슬라이더 끝에서 값이 parse에 걸려
// 조용히 버려지는 §364 dials.ts의 함정을 여기서도 반복하게 된다.
//
// non-null 단정은 타입이 이미 보장하는 것을 런타임에 다시 확인하지 않는다는
// 뜻이다 — `DIALS`는 `as const satisfies readonly DialDef[]`라 "editorMaxWidth"
// id 를 가진 항목이 배열 리터럴에 존재함을 컴파일 타임에 고정하고, `find`가
// 그 보장을 다시 좁혀 주지 못할 뿐이다. 모듈 최상단 `throw`였던 이전 형태는,
// 만에 하나 이 가정이 깨지면 레지스트리를 쓰는 모든 화면(설정 전체)의 모듈
// 로드를 막아 버렸다 — 깨져도 이 항목 하나만 무너지는 편이 낫다.
//
// §368 — `kind`가 갈리면서 `find`의 반환 타입은 `NumberDialDef | EnumDialDef`가
// 됐고, `.range`는 그중 `NumberDialDef`에만 있다. `as NumberDialDef`는 위
// non-null 단정과 같은 성격의 단정이다 — editorMaxWidth가 number 다이얼이라는
// 것도 리터럴에 고정돼 있고, TS가 `find`를 통해 그것까지 좁혀 주지 못할 뿐이다.
const editorMaxWidthRange = (
  DIALS.find((d) => d.id === "editorMaxWidth") as NumberDialDef
).range;

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
          resolveDials({}, settings.appearanceOverrides).editorLineBreak.value,
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
    // §366 되돌림 — editorMaxWidth는 잠시 외관 다이얼로 Appearance 탭에
    // 옮겨졌다가(Task 7) 돌아왔다. 다이얼 기계(병합·출처·되돌리기)는 그대로
    // AppearanceDialRow가 맡고, 여기서 바뀌는 것은 분류(category/section)뿐이다.
    {
      id: "editorMaxWidth",
      label: "settings.editor.maxWidth",
      description: "settings.editor.maxWidth.desc",
      category: "editor",
      section: "settings.editor.display",
      control: makeSliderControl(
        // §368: `.value`는 이제 `DialValue`(number | string)다. editorMaxWidth는
        // number 다이얼로 리터럴에 고정돼 있어(위 `editorMaxWidthRange`와 같은
        // 근거) `parse`를 통과한 값은 항상 number다 — makeSliderControl의
        // `() => number` 셀렉터에 맞추는 단정이다.
        () =>
          resolveDials({}, settings.appearanceOverrides).editorMaxWidth
            .value as number,
        (v) => settings.setDial("editorMaxWidth", v),
        editorMaxWidthRange,
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
    // ── Activity Bar ─────────────────────────────────────────────────────────
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
