// §361 fix round 1 (F1) — join the three new modules to the actual paint.
//
// `installed-theme-defs.test.ts`, `theme-css-cache.test.ts` and
// `use-theme-css-hydration.test.tsx` each test their own module correctly, but nothing
// joined them to `applyThemeVars`/`applyThemeCss` — review round 1 found two mutations that
// pass every existing test green:
//   M-J: `use-settings-effects.ts`'s apply effect reverts to `findThemeById(activeThemeId,
//        customThemes)` (the exact lookup this task replaced) — an installed theme silently
//        stops painting.
//   M-K: `installedThemes` is dropped from `store.ts`'s `partialize` — nothing survives a
//        restart, one of this plan's stated completion criteria.
// This file is the fix for both, and it is written so it goes RED under each.
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same three-module mock as use-settings-effects-theme-modes.test.tsx, for the same reason:
// this hook syncs native menus via lazy `import()`, and an unresolved one landing after
// vitest tears the environment down fails the whole run even though every test passed.
const menuIpc = vi.hoisted(() => ({
  syncMenuEnabled: vi.fn(() => Promise.resolve()),
  syncMenuLocale: vi.fn(() => Promise.resolve()),
  syncRecentMenu: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../ipc/menu-locale", () => ({
  syncMenuLocale: menuIpc.syncMenuLocale,
}));
vi.mock("../../ipc/recent-menu", () => ({
  syncRecentMenu: menuIpc.syncRecentMenu,
}));
vi.mock("../../ipc/menu-enabled", () => ({
  syncMenuEnabled: menuIpc.syncMenuEnabled,
}));

const readStoredThemeCss =
  vi.fn<(id: string, mode: "dark" | "light") => Promise<null | string>>();
vi.mock("../../themes/theme-store-fs", () => ({
  readStoredThemeCss: (id: string, mode: "dark" | "light") =>
    readStoredThemeCss(id, mode),
}));

import type { InstalledTheme } from "../../themes/theme-install";

import { useSettingsStore } from "../../stores/settings/store";
import { useThemeCssCacheStore } from "../../stores/system/theme-css-cache";
import { defaultColorsForBase } from "../../types/theme";
import { clearThemeVars, setThemePreviewOwner } from "../../utils/theme-vars";
import { useSettingsEffects } from "../use-settings-effects";

/** Valid per `verifyStoredThemeCss`'s four contracts — `@layer baram-theme`, no URL besides
 *  `data:` (none here), no `!important`, no `@import` — or `applyThemeCss` silently refuses
 *  to inject it and this file's own assertions would be testing the refusal path instead. */
const STORED_CSS =
  "@layer baram-theme {\n.theme-probe-marker { color: rgb(1, 2, 3); }\n}\n";

/** A colour no theme in this file carries, so finding it proves the preview survived. */
const PREVIEW_SENTINEL = "#abcdef";

function bgVar(): string {
  return document.documentElement.style.getPropertyValue("--color-bg-default");
}

function Host() {
  useSettingsEffects(null);
  return null;
}

function installedTheme(): InstalledTheme {
  return {
    checksum: "c".repeat(64),
    consentedAt: "2026-09-01T00:00:00.000Z",
    consentedVersion: "1.0.0",
    id: "dracula",
    installedAt: "2026-09-01T00:00:00.000Z",
    installPath: "/home/u/.baram/themes/dracula",
    manifest: {
      author: "a",
      description: "d",
      engines: { baram: ">=0.7.0" },
      id: "dracula",
      license: "MIT",
      modes: { light: { css: "light/theme.css", tokens: "light/tokens.json" } },
      name: "Dracula",
      version: "1.0.0",
    },
    modes: {
      light: { colors: defaultColorsForBase("light"), css: true },
    },
  };
}

function themeStyleText(): null | string {
  return document.querySelector("style[data-baram-theme]")?.textContent ?? null;
}

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  clearThemeVars(document.documentElement);
  document.documentElement.removeAttribute("data-theme");
  document
    .querySelectorAll("style[data-baram-theme]")
    .forEach((el) => el.remove());
  useThemeCssCacheStore.setState({ entries: {}, rejected: {} });
  readStoredThemeCss.mockReset();
  readStoredThemeCss.mockResolvedValue(STORED_CSS);
  window.matchMedia = ((query: string) => ({
    addEventListener: () => {},
    matches: false,
    media: query,
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  useSettingsStore.setState({
    activeThemeId: "dracula",
    customThemes: [],
    installedThemes: { dracula: installedTheme() },
    locale: "en",
  });
});

afterEach(() => {
  // Module state: a case that takes ownership and fails before releasing would make every
  // later case in this file skip its apply, which reads as an unrelated failure.
  setThemePreviewOwner(false);
  window.matchMedia = originalMatchMedia;
  clearThemeVars(document.documentElement);
  document
    .querySelectorAll("style[data-baram-theme]")
    .forEach((el) => el.remove());
  useSettingsStore.setState({ activeThemeId: "system", installedThemes: {} });
});

// ‼️ External review #1 — the preview guard was on ONE of the two doors.
//
// `themePreviewOwned()` wrapped only the `prefers-color-scheme` listener; the effect BODY
// applied unconditionally. That was equivalent while the only thing that re-ran the effect
// was a user action, and stopped being equivalent when §361 put `installedThemes` and
// `cssCacheEntries` in the deps: the hydration hook's own OS listener writes the cache, the
// effect re-runs, and `clearThemeVars` + the stored palette + `data-theme` land on top of a
// live preview. The gate was right; not every input reached it.
describe("a live theme-editor preview is not overwritten (external review #1)", () => {
  it("skips the apply while the preview owns the document", async () => {
    render(<Host />);
    await waitFor(() => expect(themeStyleText()).not.toBeNull());

    // The editor takes ownership and paints its own preview value.
    setThemePreviewOwner(true);
    document.documentElement.style.setProperty(
      "--color-bg-default",
      PREVIEW_SENTINEL,
    );

    // The async door: the hydration cache changes, which is a dep of the apply effect.
    act(() => {
      useThemeCssCacheStore.getState().setCss(
        "dracula:light",
        `${STORED_CSS}
/* second */
`,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    // The preview survives. Before this fix `clearThemeVars` ran and the stored palette
    // replaced the sentinel.
    expect(bgVar()).toBe(PREVIEW_SENTINEL);
    setThemePreviewOwner(false);
  });

  it("applies what it skipped once the preview is released", async () => {
    // ‼️ THE HALF THAT HAD NO RECOVERY PATH. The effect's own comment says a skipped
    // transition is not lost — `restorePreview()` on close, a re-run on save. Both are true
    // of an OS switch and neither covers this: `restorePreview` does not touch
    // `<style data-baram-theme>`, and closing without saving moves no dependency.
    render(<Host />);
    await waitFor(() => expect(themeStyleText()).not.toBeNull());

    setThemePreviewOwner(true);
    const arrived = `@layer baram-theme {\n.arrived-during-preview { color: rgb(4, 5, 6); }\n}\n`;
    act(() => {
      useThemeCssCacheStore.getState().setCss("dracula:light", arrived);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(themeStyleText()).not.toContain("arrived-during-preview");

    act(() => {
      setThemePreviewOwner(false);
    });
    await waitFor(() => {
      expect(themeStyleText()).toContain("arrived-during-preview");
    });
  });

  it("does not re-apply on release when nothing was skipped", async () => {
    // The negative control: a release must not become a second unconditional apply, or the
    // guard would just be a delay. Nothing was skipped here, so the `<style>` element that
    // is already in the document must be the same one afterwards.
    render(<Host />);
    await waitFor(() => expect(themeStyleText()).not.toBeNull());
    const before = document.querySelector("style[data-baram-theme]");

    act(() => {
      setThemePreviewOwner(true);
      setThemePreviewOwner(false);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(document.querySelector("style[data-baram-theme]")).toBe(before);
  });
});

describe("useSettingsEffects paints an installed (community) theme (F1)", () => {
  it("applies the theme's colours as inline vars — RED under M-J", async () => {
    render(<Host />);
    await waitFor(() => expect(bgVar()).not.toBe(""));
    expect(bgVar()).toBe(defaultColorsForBase("light")["--color-bg-default"]);
  });

  it("injects the theme's stored CSS once hydration warms the cache — RED under M-J", async () => {
    render(<Host />);
    await waitFor(() => {
      const text = themeStyleText();
      expect(text).not.toBeNull();
      expect(text).toContain(".theme-probe-marker");
    });
    expect(readStoredThemeCss).toHaveBeenCalledWith("dracula", "light");
  });

  it("clears both the vars and the <style> when the active theme reverts to system", async () => {
    render(<Host />);
    await waitFor(() => expect(themeStyleText()).not.toBeNull());

    act(() => {
      useSettingsStore.setState({ activeThemeId: "system" });
    });

    await waitFor(() => {
      expect(themeStyleText()).toBeNull();
      expect(bgVar()).toBe("");
    });
  });

  // §361 fix round 2 — re-review: the previous version of this control changed TWO inputs
  // at once (`activeThemeId: "system"` and `installedThemes: {}`), so it could not tell
  // apart "no theme is active" from "this theme id has no installed record". Varying only
  // `installedThemes` — `activeThemeId` stays "dracula", same as the positive tests above —
  // isolates the one thing this control claims to prove.
  it("does nothing when activeThemeId names no installed record (negative control)", async () => {
    useSettingsStore.setState({
      activeThemeId: "dracula",
      installedThemes: {},
    });
    render(<Host />);
    await waitFor(() => expect(readStoredThemeCss).not.toHaveBeenCalled());
    expect(themeStyleText()).toBeNull();
    expect(bgVar()).toBe("");
  });

  // §367 — 무엇이 이것을 실패시키는가: 파생을 `applyThemeVars` 에 배선하지 않으면
  // 설치 테마를 입어도 callout 색이 기본 팔레트에 남는다 — 이 계획이 고치려는
  // 결함 그 자체다.
  it("설치 테마를 입으면 파생 색이 인라인으로 실린다", async () => {
    render(<Host />);
    await waitFor(() => expect(bgVar()).not.toBe(""));
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--color-callout-info")).not.toBe("");
    expect(root.style.getPropertyValue("--color-git-added")).not.toBe("");
  });

  // 비공허성: 위 단언은 파생이 **무엇이든** 쓰기만 하면 통과한다.
  // 이것이 "테마의 강조색에서 나왔다" 를 요구한다.
  it("파생된 callout-info 는 그 테마의 강조색과 같은 색상이다", async () => {
    render(<Host />);
    await waitFor(() => expect(bgVar()).not.toBe(""));
    const root = document.documentElement;
    const accent = root.style.getPropertyValue("--color-accent-default");
    const info = root.style.getPropertyValue("--color-callout-info");
    expect(info).toBe(accent);
  });
});

// §361 fix round 2 — re-review named the narrowness of these two tests honestly, and
// accepted it as sufficient rather than requiring a full mock-tauriStorage round trip:
// `partialize` is the one task-specific link in "does this survive a restart" — there is
// no custom `merge` on this store, and `migrate` (`store.ts`) only mutates the persisted
// record under `version <` guards, so it strips nothing regardless of what `installedThemes`
// holds. What these two tests do NOT prove: that `tauriStorage` itself round-trips the
// value, or that a future `merge`/`migrate` addition would not drop it — that is shared
// persistence machinery with its own coverage, not this task's.
describe("installedThemes survives a restart (F1 — RED under M-K)", () => {
  it("is included in the persisted (partialize) shape", () => {
    const theme = installedTheme();
    useSettingsStore.setState({ installedThemes: { dracula: theme } });

    const options = useSettingsStore.persist.getOptions();
    const partialize = options.partialize as
      ((state: unknown) => { installedThemes?: unknown }) | undefined;
    expect(partialize).toBeDefined();
    const persisted = partialize?.(useSettingsStore.getState());

    expect(persisted).toBeDefined();
    expect(persisted?.installedThemes).toEqual({ dracula: theme });
  });

  // §361 fix round 2 — re-review: this title used to say "omits installedThemes when there
  // are none," but the assertion is `toEqual({})` — present AND empty, not absent. Fixed to
  // say what is actually checked: an empty record round-trips as `{}`, not as `undefined`
  // or a dropped key, which would also make `persisted?.installedThemes` fail differently.
  it("carries installedThemes through as {} when there are none, not as a dropped key", () => {
    useSettingsStore.setState({ installedThemes: {} });
    const options = useSettingsStore.persist.getOptions();
    const partialize = options.partialize as
      ((state: unknown) => { installedThemes?: unknown }) | undefined;
    const persisted = partialize?.(useSettingsStore.getState());
    expect(persisted?.installedThemes).toEqual({});
  });
});
