// §3.5 사용자 설정 스토어
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  defaultColorsForBase,
  findThemeById,
  migrateThemeColors,
  THEME_COLOR_KEYS,
  THEME_COLOR_VALUE_RE,
} from "../../types/theme";
import { tauriStorage } from "../system/tauri-storage";
import {
  type ActivityBarItemConfig,
  DEFAULT_ACTIVITY_BAR_CONFIG,
} from "./activity-bar-config";
import {
  type AppearanceSettingsSlice,
  createAppearanceSettingsSlice,
} from "./appearance-settings";
import {
  createEditorSettingsSlice,
  type EditorSettingsSlice,
} from "./editor-settings";
import {
  createGeneralSettingsSlice,
  type GeneralSettingsSlice,
} from "./general-settings";
import {
  createJournalSettingsSlice,
  type JournalSettingsSlice,
} from "./journal-settings";
import {
  createTaskSettingsSlice,
  type TaskSettingsSlice,
} from "./task-settings";
import {
  createZettelkastenSettingsSlice,
  type ZettelkastenSettingsSlice,
} from "./zettelkasten-settings";
export type { ActivityBarItemConfig };
export { DEFAULT_ACTIVITY_BAR_CONFIG };

export type SettingsState = AppearanceSettingsSlice &
  EditorSettingsSlice &
  GeneralSettingsSlice &
  JournalSettingsSlice &
  TaskSettingsSlice &
  ZettelkastenSettingsSlice;

/**
 * Backfills any activity-bar id present in DEFAULT_ACTIVITY_BAR_CONFIG but
 * missing from a persisted config, in place. Originally the body of the v16
 * → v17 migration (see the comment there); extracted so a later version gate
 * (e.g. v17 → v18 below) can reuse it verbatim instead of duplicating ~25
 * lines. Idempotent — each id is only inserted once, so calling this more
 * than once against the same array (as happens when several version gates
 * fire in one `migrate()` call) is safe.
 */
function backfillMissingActivityBarItems(
  cfg: ActivityBarItemConfig[] | undefined,
): void {
  if (!Array.isArray(cfg)) return;
  DEFAULT_ACTIVITY_BAR_CONFIG.forEach((def, defIdx) => {
    if (cfg.some((c) => c.id === def.id)) return;

    // Insert right after the nearest preceding default id the user
    // already has, so a mid-list item lands mid-list rather than
    // at the end. Falls back to the front of its own section when
    // no such predecessor is present (e.g. it's the first default
    // item, or none of its predecessors survived).
    let insertAt = -1;
    for (let i = defIdx - 1; i >= 0; i--) {
      const idx = cfg.findIndex(
        (c) => c.id === DEFAULT_ACTIVITY_BAR_CONFIG[i].id,
      );
      if (idx >= 0) {
        insertAt = idx;
        break;
      }
    }

    if (insertAt >= 0) {
      cfg.splice(insertAt + 1, 0, { ...def });
    } else {
      const sectionIdx = cfg.findIndex((c) => c.section === def.section);
      if (sectionIdx >= 0) cfg.splice(sectionIdx, 0, { ...def });
      else cfg.push({ ...def });
    }
  });
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (...a) => ({
      ...createJournalSettingsSlice(...a),
      ...createTaskSettingsSlice(...a),
      ...createZettelkastenSettingsSlice(...a),
      ...createEditorSettingsSlice(...a),
      ...createAppearanceSettingsSlice(...a),
      ...createGeneralSettingsSlice(...a),
      // Override defaults that need the constant from this module
      activityBarConfig: DEFAULT_ACTIVITY_BAR_CONFIG,
      resetActivityBarConfig: () =>
        a[0]({ activityBarConfig: DEFAULT_ACTIVITY_BAR_CONFIG }),
    }),
    {
      name: "baram:settings",
      storage: createJSONStorage(() => tauriStorage),
      partialize: (state) => ({
        onLaunch: state.onLaunch,
        autoSave: state.autoSave,
        autoSaveDelay: state.autoSaveDelay,
        spellCheck: state.spellCheck,
        virtualizeLargeDocs: state.virtualizeLargeDocs,
        showWelcome: state.showWelcome,
        recentFolders: state.recentFolders,
        recentFiles: state.recentFiles,
        lastOpenedFolder: state.lastOpenedFolder,
        lastOpenedFile: state.lastOpenedFile,
        fontFamily: state.fontFamily,
        fontSize: state.fontSize,
        lineHeight: state.lineHeight,
        tabSize: state.tabSize,
        lineNumbers: state.lineNumbers,
        autoPairBrackets: state.autoPairBrackets,
        editorMaxWidth: state.editorMaxWidth,
        pdfRailWidth: state.pdfRailWidth,
        zoomLevel: state.zoomLevel,
        theme: state.theme,
        activeThemeId: state.activeThemeId,
        customThemes: state.customThemes,
        wikilinkFormat: state.wikilinkFormat,
        autoUpdateLinks: state.autoUpdateLinks,
        inlineMath: state.inlineMath,
        highlight: state.highlight,
        strikethrough: state.strikethrough,
        diagrams: state.diagrams,
        codeBlockLineNumbers: state.codeBlockLineNumbers,
        codeBlockStyle: state.codeBlockStyle,
        smartPunctuation: state.smartPunctuation,
        extensionSettings: state.extensionSettings,
        journalEnabled: state.journalEnabled,
        journalDirectory: state.journalDirectory,
        journalFilenameFormat: state.journalFilenameFormat,
        journalTemplatePath: state.journalTemplatePath,
        journalStartupBehavior: state.journalStartupBehavior,
        journalUseHierarchy: state.journalUseHierarchy,
        journalWeeklyEnabled: state.journalWeeklyEnabled,
        journalMonthlyEnabled: state.journalMonthlyEnabled,
        journalYearlyEnabled: state.journalYearlyEnabled,
        journalWeekStartDay: state.journalWeekStartDay,
        journalWeeklyTemplate: state.journalWeeklyTemplate,
        journalMonthlyTemplate: state.journalMonthlyTemplate,
        journalYearlyTemplate: state.journalYearlyTemplate,
        journalShowStreak: state.journalShowStreak,
        journalThemeId: state.journalThemeId,
        journalCustomThemes: state.journalCustomThemes,
        memoriesMode: state.memoriesMode,
        zettelkastenEnabled: state.zettelkastenEnabled,
        zettelkastenDirectory: state.zettelkastenDirectory,
        zettelkastenStartupBehavior: state.zettelkastenStartupBehavior,
        zettelkastenHomeNote: state.zettelkastenHomeNote,
        pandocPath: state.pandocPath,
        wordTemplatePath: state.wordTemplatePath,
        customExports: state.customExports,
        tagColors: state.tagColors,
        tasksEnabled: state.tasksEnabled,
        tasksExcludePaths: state.tasksExcludePaths,
        tasksRecordDoneDate: state.tasksRecordDoneDate,
        tasksTrackTime: state.tasksTrackTime,
        tasksWeekStart: state.tasksWeekStart,
        tasksArchiveAfterDays: state.tasksArchiveAfterDays,
        // §312.1 태스크 홈과 스캔 범위 — 둘 다 persist다. 범위는 "바꾸기 전까지
        // 유지된다"가 요구사항이고, 홈은 캡처 착지점이라 세션마다 흔들리면 안 된다.
        tasksHome: state.tasksHome,
        tasksScanScope: state.tasksScanScope,
        tasksCaptureFile: state.tasksCaptureFile,
        // §313 partialize는 whitelist다 — 빠뜨리면 재시작마다 단축키가 사라지고,
        // 사용자는 "가끔 안 먹는다"로 겪는다.
        tasksGlobalCaptureShortcut: state.tasksGlobalCaptureShortcut,
        snapshotInterval: state.snapshotInterval,
        snapshotMaxCount: state.snapshotMaxCount,
        activityBarConfig: state.activityBarConfig,
        locale: state.locale,
        keybindingOverrides: state.keybindingOverrides,
        autoCheckUpdates: state.autoCheckUpdates,
        // §298 vim keybindings — partialize is a whitelist; omitting this
        // would silently drop the setting on every restart.
        vimMode: state.vimMode,
      }),
      version: 22,
      migrate: (persisted: unknown, version: number) => {
        const state = persisted as Record<string, unknown>;

        // v0/v1 → v2: extensionSettings migration (from v1)
        if (version < 1) {
          const ext = (state.extensionSettings ?? {}) as Record<
            string,
            unknown
          >;
          for (const key of [
            "codeBlockLineNumbers",
            "codeBlockStyle",
            "diagrams",
          ]) {
            if (key in state && !(key in ext)) {
              ext[key] = state[key];
            }
          }
          state.extensionSettings = ext;
        }

        // v0/v1 → v2: theme migration
        if (version < 2) {
          const oldTheme = state.theme as string | undefined;
          if (!state.activeThemeId) {
            if (oldTheme === "light") state.activeThemeId = "default-light";
            else if (oldTheme === "dark") state.activeThemeId = "default-dark";
            else state.activeThemeId = "system";
          }
          if (!state.customThemes) state.customThemes = [];
        }

        // v0/v1/v2 → v3: §55 Pandoc export settings
        if (version < 3) {
          if (!state.pandocPath) state.pandocPath = "pandoc";
          if (!state.wordTemplatePath) state.wordTemplatePath = "";
          if (!state.customExports) state.customExports = [];
        }

        // v3 → v4: §56 Journal settings
        if (version < 4) {
          if (state.journalEnabled === undefined) state.journalEnabled = false;
          // Clear old relative paths — only absolute paths are valid now
          const jd = state.journalDirectory as string | undefined;
          if (jd && !jd.startsWith("/") && !/^[A-Z]:\\/.test(jd)) {
            state.journalDirectory = "";
          }
          if (!state.journalFilenameFormat)
            state.journalFilenameFormat = "YYYY-MM-DD.md";
          if (state.journalTemplatePath === undefined)
            state.journalTemplatePath = "";
          if (!state.journalStartupBehavior)
            state.journalStartupBehavior = "openJournal";
        }

        // v4 → v5: §56a Journal hierarchical folder structure
        if (version < 5) {
          if (state.journalUseHierarchy === undefined)
            state.journalUseHierarchy = true;
        }

        // v5 → v6: §56f Periodic notes settings
        if (version < 6) {
          if (state.journalWeeklyEnabled === undefined)
            state.journalWeeklyEnabled = false;
          if (state.journalMonthlyEnabled === undefined)
            state.journalMonthlyEnabled = false;
          if (state.journalYearlyEnabled === undefined)
            state.journalYearlyEnabled = false;
          if (state.journalWeekStartDay === undefined)
            state.journalWeekStartDay = "monday";
        }

        // v6 → v7: §14.3 optional journal settings + §56h theme ID migration
        if (version < 7) {
          if (state.journalMoodEnabled === undefined)
            state.journalMoodEnabled = true;
          if (state.journalShowStreak === undefined)
            state.journalShowStreak = true;
          if (state.journalCustomThemes === undefined)
            state.journalCustomThemes = [];
          if (state.journalPromptEnabled === undefined)
            state.journalPromptEnabled = true;
          if (state.journalPromptCategory === undefined)
            state.journalPromptCategory = "";
          if (state.journalPromptMode === undefined)
            state.journalPromptMode = "random";
          if (state.journalAIReflectionEnabled === undefined)
            state.journalAIReflectionEnabled = true;
          // Migrate old theme IDs to spec names
          const themeMap: Record<string, string> = {
            default: "classic-diary",
            nature: "moleskine",
            ocean: "muji",
            sunset: "night-owl",
            minimal: "vintage",
          };
          const oldId = state.journalThemeId as string | undefined;
          if (oldId && themeMap[oldId]) state.journalThemeId = themeMap[oldId];
        }

        // v7 → v8: Keybinding overrides
        if (version < 8) {
          if (!state.keybindingOverrides) state.keybindingOverrides = {};
        }

        // v8 → v9: Home screen recent lists + last-opened paths
        if (version < 9) {
          if (!state.recentFolders) state.recentFolders = [];
          if (!state.recentFiles) state.recentFiles = [];
          if (state.lastOpenedFolder === undefined)
            state.lastOpenedFolder = null;
          if (state.lastOpenedFile === undefined) state.lastOpenedFile = null;
        }

        // v9 → v10: Design token CSS variable rename — migrate custom theme color keys
        if (version < 10) {
          const themes = state.customThemes as Array<{
            [k: string]: unknown;
            colors: Record<string, string>;
          }>;
          if (Array.isArray(themes)) {
            state.customThemes = themes.map((theme) => ({
              ...theme,
              // base에 맞는 기본 팔레트로 채운다 — 생략하면 키가 모자란 다크
              // 테마가 Default Light 값과 섞인다 (적대 리뷰).
              colors: migrateThemeColors(
                theme.colors,
                defaultColorsForBase(theme.base === "dark" ? "dark" : "light"),
              ),
            }));
          }
        }

        // v10 → v11: ThemeColors contract expansion (16 → 25 keys)
        if (version < 11) {
          const themes = state.customThemes as Array<{
            [k: string]: unknown;
            colors: Record<string, string>;
          }>;
          if (Array.isArray(themes)) {
            state.customThemes = themes.map((theme) => ({
              ...theme,
              // base에 맞는 기본 팔레트로 채운다 — 생략하면 키가 모자란 다크
              // 테마가 Default Light 값과 섞인다 (적대 리뷰).
              colors: migrateThemeColors(
                theme.colors,
                defaultColorsForBase(theme.base === "dark" ? "dark" : "light"),
              ),
            }));
          }
        }

        // v11 → v12: §perf-large-file C4 windowing kill-switch (default on)
        if (version < 12) {
          if (state.virtualizeLargeDocs === undefined)
            state.virtualizeLargeDocs = true;
        }

        // v12 → v13: §P1 journal slim-down — drop removed setting keys
        // (Mood tracking, AI reflection cluster, daily-prompt, and the
        // Memories panel Journal/Notes tab now that Notes moves to a
        // separate Zettelkasten space).
        // Data-preserving: only clears stale settings; journal files untouched.
        if (version < 13) {
          delete state.journalMoodEnabled;
          delete state.journalAIReflectionEnabled;
          delete state.journalPromptEnabled;
          delete state.journalPromptCategory;
          delete state.journalPromptMode;
          delete state.memoriesTab;
        }

        // v13 → v14: Zettelkasten space settings (§92). Additive; disabled by default.
        if (version < 14) {
          if (state.zettelkastenEnabled === undefined)
            state.zettelkastenEnabled = false;
          if (state.zettelkastenDirectory === undefined)
            state.zettelkastenDirectory = "";
          if (state.zettelkastenStartupBehavior === undefined)
            state.zettelkastenStartupBehavior = "openInbox";
          if (state.zettelkastenHomeNote === undefined)
            state.zettelkastenHomeNote = "";
        }

        // v14 → v15: §100 add the Zettel hub activity-bar item
        // (append-if-missing, preserving user customizations/order)
        if (version < 15) {
          const cfg = state.activityBarConfig as
            undefined | { id: string; section: string; visible: boolean }[];
          if (Array.isArray(cfg) && !cfg.some((c) => c.id === "zettel")) {
            const item = { id: "zettel", visible: true, section: "top" };
            const idx = cfg.findIndex((c) => c.id === "tags");
            if (idx >= 0) cfg.splice(idx + 1, 0, item);
            else cfg.push(item);
          }
        }

        // v15 → v16: §206 App auto-update — periodic check toggle (default on)
        if (version < 16) {
          if (state.autoCheckUpdates === undefined) {
            state.autoCheckUpdates = true;
          }
        }

        // v16 → v17: backfill ANY activity-bar id present in
        // DEFAULT_ACTIVITY_BAR_CONFIG but missing from a persisted config.
        // Generalizes the v15 zettel-only backfill above — until now, a newly
        // added item (e.g. "plugins") was invisible AND un-turn-on-able for
        // anyone who persisted their config before it existed, because
        // ActivityBar/ActivityBarTab both filter this array instead of
        // falling back to defaults.
        if (version < 17) {
          backfillMissingActivityBarItems(
            state.activityBarConfig as ActivityBarItemConfig[] | undefined,
          );
        }

        // v17 → v18: §298 Vim keybindings (default off). Was v17 on the
        // feature branch; renumbered because main's v17 (the activity-bar
        // backfill above) shipped first.
        if (version < 18) {
          if (state.vimMode === undefined) {
            state.vimMode = false;
          }
        }

        // v18 → v19: §306 add the Tasks agenda activity-bar item. Reuses the
        // very same backfill as v16 → v17 above (see
        // `backfillMissingActivityBarItems`) — generalizing the *logic* in
        // v17 didn't generalize the *trigger*: that gate is pinned to
        // `version < 17`, so it does nothing for anyone already persisted at
        // v17 or later. Every future activity-bar addition needs its own
        // `version < N` gate calling this same helper; this is the second one.
        //
        // **This was v18 on the feature branch and was renumbered to v19 when
        // main was merged in.** main shipped its own v18 (the Vim default
        // above) first, so anyone running a main build is already persisted at
        // v18 — keeping this at `version < 18` would skip them entirely and
        // leave the Tasks activity-bar button permanently invisible, which is
        // the exact defect this backfill exists to prevent.
        if (version < 19) {
          backfillMissingActivityBarItems(
            state.activityBarConfig as ActivityBarItemConfig[] | undefined,
          );
        }

        // v19 → v20: §312.1 `tasksCaptureFile` is now relative to the **tasks
        // home**, and its default moved into the `tasks/` subtree so that
        // §312's inviolable-rule whitelist is one line ("everything under
        // `tasks/`") instead of two.
        //
        // ‼️ Without this the new default never reaches anyone who has already
        // run the app: persist restores the stored `"Inbox.md"`, capture keeps
        // landing at the tasks-home root, and the subtree this slice exists to
        // create stays empty forever. §312.1 recorded "no existing users, no
        // backfill needed" — the developer's own install disproved that within
        // a day, which is the usual fate of that claim.
        //
        // The setting is now a **name inside** `{tasksHome}/tasks/`, not a path
        // relative to the home — repeating the folder in a setting is what let a
        // value point outside the subtree, and that possibility is the only
        // reason the whitelist ever needed a second clause.
        //
        // Both prior defaults are rewritten: `"Inbox.md"` (pre-§312.1) and
        // `"tasks/inbox.md"` (§312.1's first shape, which shipped for a day).
        // A value the user actually typed is left alone.
        if (
          version < 20 &&
          (state.tasksCaptureFile === "Inbox.md" ||
            state.tasksCaptureFile === "tasks/inbox.md")
        ) {
          state.tasksCaptureFile = "inbox.md";
        }

        // v20 → v21: M2-b4 — `journal.captureTaskMode`가 `tasks.taskInput`이 됐다.
        // 캡처창의 토글과 에디터의 편집 모달은 "지금 입력하는 것을 태스크로 다룬다"는
        // **한 개념**이라 명령도 하나여야 하고, 둘로 두면 같은 `Mod+Alt+T`를 두 항목이
        // 노려 충돌 검사에 걸린다.
        //
        // ‼️ `keybindingOverrides`는 **명령 id로 키잉된다.** 이 줄이 없으면 그 키를
        // 이미 바꿔 둔 사용자의 조합이 조용히 사라지고 기본값으로 돌아간다 — 사용자는
        // 자기가 고른 키가 어느 날 안 먹는 것으로 겪는다. (§312.1에서 "기존 사용자
        // 없음"으로 넘겼다가 개발자 본인 설치에서 걸린 적이 있다.)
        if (version < 21) {
          const overrides = state.keybindingOverrides as
            Record<string, string> | undefined;
          const old = overrides?.["journal.captureTaskMode"];
          if (overrides && old !== undefined) {
            // 새 id에 이미 값이 있으면 그쪽을 이긴 것으로 둔다 — 사용자가 새 이름으로
            // 직접 고른 값이므로 옛 이름이 덮어써서는 안 된다.
            overrides["tasks.taskInput"] ??= old;
            delete overrides["journal.captureTaskMode"];
          }
        }

        // v21 → v22: 감사 BLOCKER — 저장된 custom theme의 colors를 whitelist
        // **키·값 모두**로 재구성한다. v22 이전의 테마 import는 무검증이었으므로
        // 여분 키(임의 CSS 속성명)뿐 아니라 임의 **값**(숫자, alpha hex, 빈
        // 문자열)도 저장돼 있을 수 있다. "잘못된 색은 화면에서 무해하게
        // 무시된다"던 최초 판단은 틀렸다(적대 리뷰 실증): 파생 색 계산이
        // 문자열이 아닌 값에서 `color.trim is not a function`으로 던져 앱이
        // 시작하다 죽고, alpha hex는 대비 파생을 1:1로 무너뜨린다. 계약
        // (THEME_COLOR_VALUE_RE)에 안 맞는 값과 누락 키는 그 테마 base의
        // 기본 팔레트 값으로 되돌린다.
        if (version < 22) {
          const themes = state.customThemes as Array<{
            [k: string]: unknown;
            base?: unknown;
            colors?: Record<string, unknown>;
          }>;
          if (Array.isArray(themes)) {
            state.customThemes = themes.map((theme) => {
              const defaults = defaultColorsForBase(
                theme.base === "dark" ? "dark" : "light",
              );
              const colors: Record<string, string> = {};
              for (const { key } of THEME_COLOR_KEYS) {
                const value = theme.colors?.[key];
                colors[key] =
                  typeof value === "string" && THEME_COLOR_VALUE_RE.test(value)
                    ? value
                    : defaults[key];
              }
              return { ...theme, colors };
            });
          }
        }

        return state;
      },
      // Fallback for unversioned → v1 upgrade (Zustand skips migrate when stored version is undefined)
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // extensionSettings sync (existing)
        const ext = { ...state.extensionSettings };
        let dirty = false;
        for (const key of [
          "codeBlockLineNumbers",
          "codeBlockStyle",
          "diagrams",
        ] as const) {
          if (key in state && !(key in ext)) {
            ext[key] = state[key];
            dirty = true;
          }
        }
        if (dirty) {
          useSettingsStore.setState({ extensionSettings: ext });
        }
        // Theme sync: ensure theme field matches activeThemeId
        if (state.activeThemeId && state.activeThemeId !== "system") {
          const t = findThemeById(state.activeThemeId, state.customThemes);
          if (t && state.theme !== t.base) {
            useSettingsStore.setState({ theme: t.base });
          }
        }
      },
    },
  ),
);
