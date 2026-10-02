import type { ColorModeSetting } from "../../appearance/color-mode";
import type { DialId, DialValue, DialValues } from "../../appearance/dials";
import type { InstalledTheme } from "../../themes/theme-install";
import type { ThemeDef } from "../../types/theme";
import type { ThemeInExport } from "../../utils/export/export";
import type { ChromeSurface } from "../ui/ui";
import type { ActivityBarItemConfig } from "./activity-bar-config";
import type { StateCreator } from "zustand";

import { DIALS } from "../../appearance/dials";
import { setConfig } from "../../ipc/config";
import { lookupThemes } from "../../themes/installed-theme-defs";
import { findThemeById, themeFieldFor } from "../../types/theme";
import { logger } from "../../utils/logger";

export interface AppearanceSettingsSlice {
  activeThemeId: string;
  activityBarConfig: ActivityBarItemConfig[];
  /**
   * §361 — record an installed community theme. The record IS the enumeration
   * (`theme-store-fs.ts`'s header explains why nothing re-reads the install tree).
   *
   * ‼️ An id already present is an UPDATE by default, and an update KEEPS the consent the
   * first install recorded. `freshConsent` is how the one caller that DID ask says so —
   * see the implementation for why the rule lives here and why the flag is a caller's
   * knowledge rather than something this store could infer.
   */
  addInstalledTheme: (
    theme: InstalledTheme,
    options?: { freshConsent?: boolean },
  ) => void;
  /**
   * §364 사용자 층. **희소하다** — 사용자가 명시적으로 바꾼 다이얼만 담는다.
   * 기본값을 전부 채워 넣으면 `system` 테마의 OS 추종이 죽는다(§364.2).
   */
  appearanceOverrides: DialValues;
  /** 스펙 0063 §3.4 — 사용자가 이 테마를 직접 골랐다: 그 테마의 거절 기록을 지운다. */
  clearChromeProposalDeclines: (themeId: string) => void;
  /**
   * §386 모드 설정(스펙 0064 D1) — 모드 설정을 따르는 테마(`followsColorModeSetting`)를 라이트와
   * 다크 중 무엇으로 그릴지. `"system"` 은 OS 를 따른다. 다이얼이 **아니다**: 3층 병합에 들지 않고,
   * 테마가 제안하지 못하고, 외관 내보내기에 실리지 않는다. 기본값 `"system"` 이 오늘 동작과 같아
   * `store.ts` 의 `version` 을 올리지 않는다.
   */
  colorModeSetting: ColorModeSetting;
  customThemes: ThemeDef[];
  /**
   * §370.3 · 스펙 0063 §3 — 사용자가 거절한 테마의 크롬 제안(테마 id → 표면).
   *
   * 라이브 가시성은 세션(`useUIStore`, 계획 0096 R-D)이고 이것만 저장된다. 기록은 제안을
   * 건너뛰게 할 뿐이라 표면을 숨길 수 없다(`chrome-proposal.ts` 의 `applyThemeChrome`).
   * 기본값 `{}` 가 오늘 동작과 같아 `store.ts` 의 `version` 을 올리지 않는다.
   */
  declinedChromeProposals: Readonly<Record<string, DeclinedChromeSurfaces>>;
  deleteCustomTheme: (id: string) => void;
  /** §361 — installed themes (either entrance, §371 — the registry or a package file),
   *  keyed by id. Persisted via `tauriStorage`, never `localStorage` (sandbox webviews
   *  share this origin). */
  installedThemes: Record<string, InstalledTheme>;
  locale: string;
  /** §361 — drop the record for an uninstalled community theme. Does not touch disk —
   *  callers uninstall first (`ipc/theme.ts`'s `themeUninstall`) and only remove the record
   *  once that succeeds, the same order `handleUninstall` uses for plugins. */
  removeInstalledTheme: (id: string) => void;
  removeTagColor: (tag: string) => void;
  resetActivityBarConfig: () => void;
  resetDial: (id: DialId) => void;
  saveCustomTheme: (theme: ThemeDef) => void;
  setActiveTheme: (id: string) => void;
  setActivityBarConfig: (config: ActivityBarItemConfig[]) => void;
  /** 스펙 0063 §3.3 — 한 (테마, 표면)의 거절을 기록하거나(`true`) 지운다(`false`). */
  setChromeProposalDeclined: (
    themeId: string,
    surface: ChromeSurface,
    declined: boolean,
  ) => void;
  /** §386 — 같은 값이면 상태를 바꾸지 않는다(CLAUDE.md 의 동등성 관문). */
  setColorModeSetting: (setting: ColorModeSetting) => void;
  setDial: (id: DialId, value: DialValue) => void;
  setLocale: (locale: string) => void;
  setTagColor: (tag: string, color: string) => void;
  setTheme: (theme: Theme) => void;
  /** §362 — set `themeInExport`. */
  setThemeInExport: (themeInExport: ThemeInExport) => void;
  tagColors: Record<string, string>;
  theme: Theme;
  /**
   * §362 — how much of the active theme an export carries: `"default"` (today's
   * output, unchanged), `"full"`, or `"tokens"`. Defaults to `"default"`, which
   * is byte-identical to pre-§362 output, so this key needs no `store.ts`
   * `version` bump — CLAUDE.md's migration rule only requires one when an
   * EXISTING user would see a different default than what they have today.
   */
  themeInExport: ThemeInExport;
}

/** §370.3 · 스펙 0063 §3 — 한 테마에서 사용자가 거절한 크롬 제안의 표면. */
export type DeclinedChromeSurfaces = Readonly<
  Partial<Record<ChromeSurface, true>>
>;

type Theme = "dark" | "light" | "system";

export const createAppearanceSettingsSlice: StateCreator<
  AppearanceSettingsSlice,
  [],
  [],
  AppearanceSettingsSlice
> = (set, get) => ({
  // Appearance
  theme: "system",
  activeThemeId: "system",
  customThemes: [],
  installedThemes: {},
  themeInExport: "default",
  appearanceOverrides: {},
  declinedChromeProposals: {},
  colorModeSetting: "system",

  // Activity Bar config
  activityBarConfig: [], // default set in main store via DEFAULT_ACTIVITY_BAR_CONFIG

  // i18n
  locale: "en",

  // Tag colors
  tagColors: {},

  // Appearance setters
  setTheme: (theme) => {
    const id =
      theme === "light"
        ? "default-light"
        : theme === "dark"
          ? "default-dark"
          : "system";
    get().setActiveTheme(id);
  },
  setActiveTheme: (id) =>
    set((state) => {
      if (id === "system") return { activeThemeId: id, theme: "system" };
      // §361 — installed themes need to be in this lookup too, or a paired community
      // theme's `theme` field would default to "system" (`themeFieldFor(undefined)`)
      // instead of following its actual mode count. CSS text is not needed here — only
      // which modes exist — so `lookupThemes` is called with no cache argument.
      const theme = findThemeById(
        id,
        lookupThemes(state.customThemes, state.installedThemes),
      );
      return { activeThemeId: id, theme: themeFieldFor(theme) };
    }),
  setThemeInExport: (themeInExport) => set({ themeInExport }),
  setColorModeSetting: (colorModeSetting) =>
    set((state) =>
      state.colorModeSetting === colorModeSetting
        ? state
        : { colorModeSetting },
    ),
  saveCustomTheme: (theme) =>
    set((state) => {
      const idx = state.customThemes.findIndex((t) => t.id === theme.id);
      const updated = [...state.customThemes];
      if (idx >= 0) updated[idx] = theme;
      else updated.push(theme);
      return { customThemes: updated };
    }),
  deleteCustomTheme: (id) =>
    set((state) => ({
      customThemes: state.customThemes.filter((t) => t.id !== id),
      activeThemeId:
        state.activeThemeId === id ? "system" : state.activeThemeId,
      theme: state.activeThemeId === id ? "system" : state.theme,
    })),
  addInstalledTheme: (theme, options) =>
    set((state) => {
      const prior = state.installedThemes[theme.id];
      // §361 Task 6 — the consent carry-forward, HERE rather than in the update caller.
      //
      // `installTheme` stamps `consentedAt`/`consentedVersion` with "now" and the version it
      // just installed, which is right for a first install and wrong for an update: nothing
      // was agreed to at that moment, and `showConsentHistory` would then tell the user they
      // approved v2.0 today when what they approved was v1.0 whenever they installed it.
      // `InstalledTheme.consentedAt`'s doc comment states that contract.
      //
      // Enforced at the single writer instead of at each call site so a future third caller
      // cannot reintroduce the defect by forgetting. A record that is ABSENT is a genuine
      // first install (uninstall removes it), so the stamp from `installTheme` stands.
      //
      // Themes never re-ask: there is no capability tuple to escalate (spec §9.3), so there
      // is no case where an update should produce a NEW consent moment. The three fixed
      // sentences hold for every version the hygiene pipeline will accept, which is what
      // makes carrying the old stamp forward true rather than merely convenient.
      //
      // ‼️ `freshConsent` IS THE CALLER'S KNOWLEDGE, NOT SOMETHING THIS STORE CAN DERIVE
      // (0090 final review, N2). Reinstalling a theme you already have goes through
      // `handleInstall`, which opens the consent dialog — and then this writer discarded
      // the stamp the user had just produced and kept an older one. Asking and discarding
      // is the worst of both: the dialog was not a formality, and the record then says the
      // agreement happened at a moment it did not. Nothing about the RECORD distinguishes
      // that from an update, because both are "an id that is already here"; only the code
      // path knows whether a human was asked. So it is a parameter, defaulting to the
      // update behaviour, which keeps every existing caller correct by omission.
      const merged: InstalledTheme =
        prior === undefined || options?.freshConsent === true
          ? theme
          : {
              ...theme,
              consentedAt: prior.consentedAt,
              consentedVersion: prior.consentedVersion,
            };
      // ‼️ THE `theme` FIELD IS NOT RE-DERIVED HERE, and that is safe only by contingency
      // (0090 final review, N4). An update can change a theme's MODE SET — a light-only
      // v1 becoming a light+dark v2 — which would move `themeFieldFor`'s answer for the
      // active theme. Nothing outside this store reads that field any more: 0088's M3 fix
      // moved the code block's highlighting onto the document's own light/dark answer, and
      // it was the last renderer that watched it. The launch-time rehydrate sync in
      // `store.ts` repairs the value on the next start.
      //
      // So a future reader of `theme` reintroduces the defect silently. If one appears,
      // this is where the re-derivation goes — `setActiveTheme` has the rule, and it takes
      // the same `lookupThemes` call.
      return {
        installedThemes: { ...state.installedThemes, [theme.id]: merged },
      };
    }),
  removeInstalledTheme: (id) =>
    set((state) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _removed, ...rest } = state.installedThemes;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _declines, ...keptDeclines } =
        state.declinedChromeProposals;
      return {
        // 계획 0111 P4 — 다시 설치한 테마는 처음부터 제안을 받는다.
        declinedChromeProposals: keptDeclines,
        installedThemes: rest,
        // Same rule as deleteCustomTheme: removing the ACTIVE theme falls back to system
        // rather than leaving activeThemeId pointing at a record that no longer exists.
        activeThemeId:
          state.activeThemeId === id ? "system" : state.activeThemeId,
        theme: state.activeThemeId === id ? "system" : state.theme,
      };
    }),

  // Activity Bar setters
  setActivityBarConfig: (activityBarConfig) => set({ activityBarConfig }),
  resetActivityBarConfig: () => set({}), // overridden in main store

  // 스펙 0063 §3 — 크롬 제안 거절 기록. 둘 다 바뀐 것이 없으면 `state` 를 그대로 돌려준다
  // (`{}` 는 새 root 가 되어 모든 리스너를 깨운다 — CLAUDE.md 의 동등성 관문).
  clearChromeProposalDeclines: (themeId) =>
    set((state) => {
      if (!(themeId in state.declinedChromeProposals)) return state;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [themeId]: _removed, ...rest } = state.declinedChromeProposals;
      return { declinedChromeProposals: rest };
    }),
  setChromeProposalDeclined: (themeId, surface, declined) =>
    set((state) => {
      const current = state.declinedChromeProposals[themeId] ?? {};
      if ((current[surface] === true) === declined) return state;
      const surfaces = Object.fromEntries(
        Object.entries(current).filter(([key]) => key !== surface),
      ) as Partial<Record<ChromeSurface, true>>;
      if (declined) surfaces[surface] = true;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [themeId]: _old, ...others } = state.declinedChromeProposals;
      return {
        declinedChromeProposals:
          Object.keys(surfaces).length === 0
            ? others
            : { ...others, [themeId]: surfaces },
      };
    }),

  // §364 사용자 층 다이얼 setter/reset
  resetDial: (id) =>
    set((state) => {
      if (!(id in state.appearanceOverrides)) return {};
      // 키를 지운다 — 기본값을 쓰면 사용자 층이 그 다이얼을 계속 소유한다.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _removed, ...rest } = state.appearanceOverrides;
      return { appearanceOverrides: rest };
    }),
  setDial: (id, value) =>
    set((state) => {
      const dial = DIALS.find((d) => d.id === id);
      // 검증은 다이얼이 소유한다. UI 가 범위를 두 번 적지 않게 하려는 것이고,
      // 매니페스트에서 오는 값과 같은 관문을 지나게 하려는 것이다.
      const parsed = dial?.parse(value);
      if (parsed === undefined) return {};
      if (state.appearanceOverrides[id] === parsed) return {};
      return {
        appearanceOverrides: { ...state.appearanceOverrides, [id]: parsed },
      };
    }),

  // i18n setter
  setLocale: (locale) => {
    set({ locale });
    import("../../ipc/menu-locale").then(({ syncMenuLocale }) => {
      syncMenuLocale(locale as "en" | "ko").catch((e) => logger.error(e));
    });
    // §333 The Rust-side approval dialog has its own phrase table (Rust has no
    // i18n) — mirror the locale to a flat config key so it can pick a language
    // from that table. The webview changing this value only ever **selects**
    // from the table; it cannot inject wording into the dialog.
    void setConfig("uiLocale", locale).catch((e) =>
      logger.warn("§333 setLocale: uiLocale mirror failed", e),
    );
  },

  // Tag setters
  setTagColor: (tag, color) =>
    set((state) => ({
      tagColors: { ...state.tagColors, [tag]: color },
    })),
  removeTagColor: (tag) =>
    set((state) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [tag]: _removed, ...rest } = state.tagColors;
      return { tagColors: rest };
    }),
});
