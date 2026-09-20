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
import { clearThemeVars } from "../../utils/theme-vars";
import { useSettingsEffects } from "../use-settings-effects";

/** Valid per `verifyStoredThemeCss`'s four contracts — `@layer baram-theme`, no URL besides
 *  `data:` (none here), no `!important`, no `@import` — or `applyThemeCss` silently refuses
 *  to inject it and this file's own assertions would be testing the refusal path instead. */
const STORED_CSS =
  "@layer baram-theme {\n.theme-probe-marker { color: rgb(1, 2, 3); }\n}\n";

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
  useThemeCssCacheStore.setState({ entries: {} });
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
  window.matchMedia = originalMatchMedia;
  clearThemeVars(document.documentElement);
  document
    .querySelectorAll("style[data-baram-theme]")
    .forEach((el) => el.remove());
  useSettingsStore.setState({ activeThemeId: "system", installedThemes: {} });
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

  it("does nothing for a plain custom theme with no installed record (negative control)", async () => {
    useSettingsStore.setState({
      activeThemeId: "system",
      installedThemes: {},
    });
    render(<Host />);
    await waitFor(() => expect(readStoredThemeCss).not.toHaveBeenCalled());
    expect(themeStyleText()).toBeNull();
    expect(bgVar()).toBe("");
  });
});

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

  it("omits installedThemes when there are none, rather than always claiming a value", () => {
    useSettingsStore.setState({ installedThemes: {} });
    const options = useSettingsStore.persist.getOptions();
    const partialize = options.partialize as
      ((state: unknown) => { installedThemes?: unknown }) | undefined;
    const persisted = partialize?.(useSettingsStore.getState());
    expect(persisted?.installedThemes).toEqual({});
  });
});
