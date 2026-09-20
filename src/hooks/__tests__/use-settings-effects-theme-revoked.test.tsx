// §361 Task 6 / spec 0049 §9.4 — a withdrawn theme stops being worn.
//
// The threshold is `blocksLoad`'s, so this file exercises all three severities rather than
// only the one that acts: the two that must NOT deactivate are what distinguishes the
// implemented rule from "any withdrawal yanks the theme", which is how §9.4's unqualified
// sentence reads at face value.
import { StrictMode } from "react";

import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same three-module mock as the sibling settings-effects suites, for the same reason: this
// hook syncs native menus via lazy `import()`, and one landing after vitest tears the
// environment down fails the whole run with every test passing.
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

// ‼️ A CALL RECORDER, NOT A STUB — it calls through, so every DOM assertion in this file
// still observes the real write. It exists because the DOM alone cannot answer the one
// question the derived-id design is about: whether the withdrawn theme was ever PAINTED.
// Measured (2026-09-20): an apply effect reading `activeThemeId` instead of the derived id
// paints the theme and then clears it when the store revert re-runs the effect, all inside
// one update — so `--color-bg-default` reads empty either way and the DOM cannot tell the
// two designs apart. The spy can.
const applyThemeVarsCalls = vi.fn();
vi.mock("../../utils/theme-vars", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../utils/theme-vars")>();
  return {
    ...actual,
    applyThemeVars: (
      ...args: Parameters<typeof actual.applyThemeVars>
    ): void => {
      applyThemeVarsCalls(...args);
      actual.applyThemeVars(...args);
    },
  };
});

import type { RevocationSeverity } from "../../plugins/revocation";
import type { InstalledTheme } from "../../themes/theme-install";

import { useSettingsStore } from "../../stores/settings/store";
import { usePluginStore } from "../../stores/system/plugin";
import { useThemeCssCacheStore } from "../../stores/system/theme-css-cache";
import { useUIStore } from "../../stores/ui/ui";
import { defaultColorsForBase } from "../../types/theme";
import { clearThemeVars } from "../../utils/theme-vars";
import { useSettingsEffects } from "../use-settings-effects";

/** Valid per `verifyStoredThemeCss`'s four contracts, or `applyThemeCss` refuses it and
 *  every "the theme is applied" assertion below would pass for the wrong reason. */
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
    modes: { light: { colors: defaultColorsForBase("light"), css: true } },
  };
}

function revoke(severity: RevocationSeverity, versions: unknown = "*") {
  usePluginStore.setState({
    revocations: {
      revoked: [
        {
          id: "dracula",
          reason: "compromised build",
          severity,
          versions: versions as never,
        },
      ],
      sequence: 1,
      version: 1,
    },
  });
}

function themeStyleText(): null | string {
  return document.querySelector("style[data-baram-theme]")?.textContent ?? null;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const originalMatchMedia = window.matchMedia;
/** Replaced by the dedupe case below, and put back after it — the store is module state
 *  shared with every other case in this file. */
const originalShowToast = useUIStore.getState().showToast;

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
  usePluginStore.setState({ revocations: null });
  useUIStore.getState().dismissToast();
  applyThemeVarsCalls.mockClear();
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  useUIStore.setState({ showToast: originalShowToast });
  clearThemeVars(document.documentElement);
  document
    .querySelectorAll("style[data-baram-theme]")
    .forEach((el) => el.remove());
  useSettingsStore.setState({ activeThemeId: "system", installedThemes: {} });
  usePluginStore.setState({ revocations: null });
});

describe("a MALICIOUS withdrawal takes the theme off", () => {
  it("never injects the theme's CSS and never even reads it off disk", async () => {
    revoke("malicious");
    render(<Host />);

    await waitFor(() => {
      expect(useSettingsStore.getState().activeThemeId).toBe("system");
    });
    // Not "cleaned up afterwards" — never applied. The apply effect reads the DERIVED id,
    // so there is no commit in which the withdrawn theme's `<style>` was on the page.
    expect(themeStyleText()).toBeNull();
    expect(bgVar()).toBe("");
    expect(readStoredThemeCss).not.toHaveBeenCalled();
    // The withdrawn theme's colours were never written to `<html>` at all — not written
    // and then cleared. This is the assertion the DOM cannot make (see the recorder's
    // comment at the top of this file).
    expect(applyThemeVarsCalls).not.toHaveBeenCalled();
  });

  it("says so, naming the theme", async () => {
    revoke("malicious");
    render(<Host />);

    await waitFor(() => {
      expect(useUIStore.getState().toast?.message).toContain("Dracula");
    });
    expect(useUIStore.getState().toast?.type).toBe("warning");
  });

  it("announces a SECOND attempt too, rather than reverting in silence", async () => {
    // Fix round 1 (F2). The gallery leaves the withdrawn card selectable — it is a theme
    // the user owns and may want to open in order to remove — so choosing it again is an
    // ordinary action. With a dedupe that only ever grew, the second choice reverted with
    // no toast at all and read as a card that simply does nothing.
    revoke("malicious");
    render(<Host />);
    await waitFor(() => {
      expect(useUIStore.getState().toast?.message).toContain("Dracula");
    });

    useUIStore.getState().dismissToast();
    act(() => {
      useSettingsStore.getState().setActiveTheme("dracula");
    });

    await waitFor(() => {
      expect(useUIStore.getState().toast?.message).toContain("Dracula");
    });
    expect(useSettingsStore.getState().activeThemeId).toBe("system");
  });

  it("does not announce twice for one refusal", async () => {
    // The half the reset must not break: within a single force-deactivation the effect
    // runs twice (React's development double-invoke, which `StrictMode` turns on here),
    // and only one toast belongs to one refusal.
    //
    // ‼️ THE COUNT IS TAKEN FROM A SPY, NOT FROM THE STORE. The first version of this case
    // re-rendered with a fresh `installedThemes` identity and asserted `toast === null` —
    // vacuous twice over: by then `activeThemeId` is already `"system"` so the effect
    // early-returns whatever the dedupe does, and `showToast` replaces rather than
    // stacks, so two calls leave one toast either way. Deleting the dedupe outright left
    // that version green (measured, fix round 1).
    const showToast = vi.fn();
    useUIStore.setState({ showToast });
    revoke("malicious");

    render(
      <StrictMode>
        <Host />
      </StrictMode>,
    );
    await waitFor(() => {
      expect(useSettingsStore.getState().activeThemeId).toBe("system");
    });
    await settle();

    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it("takes it off when the withdrawal lands while the theme is already applied", async () => {
    // The live path: the theme is worn, then a background revocation refresh stores a list
    // naming it. The mount-time case above cannot tell whether the enforcement is reactive.
    render(<Host />);
    await waitFor(() => expect(themeStyleText()).not.toBeNull());

    revoke("malicious");

    await waitFor(() => {
      expect(useSettingsStore.getState().activeThemeId).toBe("system");
      expect(themeStyleText()).toBeNull();
    });
  });

  it("leaves a withdrawal for a different version range alone", async () => {
    // Installed is 1.0.0; the withdrawal covers < 1.0.0 only. Without this the suite could
    // not distinguish "matches this id" from "matches this id at this version".
    revoke("malicious", { lt: "1.0.0" });
    render(<Host />);

    await waitFor(() => expect(themeStyleText()).not.toBeNull());
    expect(useSettingsStore.getState().activeThemeId).toBe("dracula");
  });
});

describe("the two severities that do NOT take the theme off", () => {
  it.each(["unlisted", "vulnerable"] as const)(
    "keeps applying under a %s withdrawal",
    async (severity) => {
      revoke(severity);
      render(<Host />);

      await waitFor(() => {
        const text = themeStyleText();
        expect(text).not.toBeNull();
        expect(text).toContain(".theme-probe-marker");
      });
      expect(useSettingsStore.getState().activeThemeId).toBe("dracula");
      expect(useUIStore.getState().toast).toBeNull();
      // The recorder's positive half: it fires for a theme that IS worn, so
      // "not.toHaveBeenCalled()" above is an observation rather than a spy that never
      // works.
      expect(applyThemeVarsCalls).toHaveBeenCalled();
    },
  );
});

describe("a withdrawal that is not about the active theme", () => {
  it("leaves an unrelated active theme applied", async () => {
    usePluginStore.setState({
      revocations: {
        revoked: [
          {
            id: "some-other-theme",
            reason: "compromised build",
            severity: "malicious",
            versions: "*",
          },
        ],
        sequence: 1,
        version: 1,
      },
    });
    render(<Host />);

    await waitFor(() => expect(themeStyleText()).not.toBeNull());
    expect(useSettingsStore.getState().activeThemeId).toBe("dracula");
  });
});
