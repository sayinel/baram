// §361 — the browse screen renders WHATEVER THE REGISTRY GIVES IT. There is no theme
// published in the live registry today (the plan's own ledger records this), so this file
// is the evidence for "the code is correct," not "themes appear" — that claim waits on a
// publish this task cannot make.
import type { RegistryEntry, RegistryIndex } from "../../../../plugins/types";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Bare `vi.fn()` (no inline implementation) rather than `vi.fn(() => fetchResult)`: a typed
// implementation narrows the mock's inferred signature to zero params, and the mock factory
// below spreads an `unknown[]` into it — TS rejects that spread against anything but a rest
// parameter. `theme-install.test.ts` uses the same bare-`vi.fn()` shape for the same reason.
let fetchResult: Promise<RegistryIndex> = Promise.resolve({ plugins: [] });
const fetchRegistryIndex = vi.fn();
vi.mock("../../../../plugins/registry-client", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../plugins/registry-client")
  >()),
  fetchRegistryIndex: (...a: unknown[]) => fetchRegistryIndex(...a),
}));

const handleInstall = vi.fn();
const settleConsent = vi.fn();
let pendingConsent: null | { entry: RegistryEntry } = null;
// `importOriginal` + spread, not a bare literal: `ThemeConsentDialog.tsx` imports the real
// `themeConsentSentences` from this same module path, and a bare factory would leave it
// undefined — the exact trap `plugin-install-consent.test.tsx` names for the same reason
// (its mock of `plugin-loader.ts` needs `importOriginal` because sibling exports are used
// elsewhere in the same import graph).
/**
 * ‼️ THE WRAPPERS ARE HOISTED, so their identity is stable across calls.
 *
 * The real `settleConsent` is `useCallback(…, [])` and never changes, which is what makes
 * `ThemeBrowser`'s memoised dialog callbacks stable (external review #11). A mock that
 * returned a fresh arrow per render would model the opposite and make the attach-count test
 * below measure the fixture instead of the component — it did, on the first run: 6 attaches
 * where production has 1.
 */
const stableHandleInstall = (...a: unknown[]) => handleInstall(...a);
const stableSettleConsent = (...a: unknown[]) => settleConsent(...a);
const stableInstallErrors: Record<string, string> = {};
const stableInstalling: Record<string, boolean> = {};

vi.mock("../use-theme-actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../use-theme-actions")>()),
  useThemeActions: () => ({
    handleInstall: stableHandleInstall,
    installErrors: stableInstallErrors,
    installing: stableInstalling,
    pendingConsent,
    settleConsent: stableSettleConsent,
  }),
}));

import type { InstalledTheme } from "../../../../themes/theme-install";

import { findSurface } from "../../../../__tests__/helpers/security-surface";
import en from "../../../../i18n/en.json";
import { useSettingsStore } from "../../../../stores/settings/store";
import { usePluginStore } from "../../../../stores/system/plugin";
import { ThemeBrowser } from "../ThemeBrowser";

const EN = en as Record<string, string>;

function themeEntry(over: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    author: "Someone",
    capabilities: [],
    checksum: "c".repeat(64),
    description: "A dark theme",
    downloadUrl: "https://reg.test/themes/dracula.zip",
    engines: { baram: ">=0.7.0" },
    id: "dracula",
    kind: "theme",
    license: "MIT",
    name: "Dracula",
    version: "1.0.0",
    ...over,
  };
}

beforeEach(() => {
  fetchRegistryIndex.mockReset();
  fetchRegistryIndex.mockImplementation(() => fetchResult);
  handleInstall.mockClear();
  settleConsent.mockClear();
  pendingConsent = null;
  usePluginStore.setState({ registryUrl: "https://reg.test/index.json" });
  useSettingsStore.setState({ installedThemes: {} });
});

afterEach(() => {
  fetchResult = Promise.resolve({ plugins: [] });
  useSettingsStore.setState({ installedThemes: {} });
});

/** A record for the browse entry above, at whatever version the case needs. */
function installedAt(version: string): Record<string, InstalledTheme> {
  return {
    dracula: {
      checksum: "c".repeat(64),
      consentedAt: "2026-09-01T00:00:00.000Z",
      consentedVersion: version,
      id: "dracula",
      installedAt: "2026-09-01T00:00:00.000Z",
      installPath: "/home/u/.baram/themes/dracula",
      manifest: {
        author: "Someone",
        description: "A dark theme",
        engines: { baram: ">=0.7.0" },
        id: "dracula",
        license: "MIT",
        modes: { light: { tokens: "t.json" } },
        name: "Dracula",
        version,
      },
      modes: { light: { css: false } },
    },
  };
}

describe("the consent dialog's Escape listener is attached once (external review #11)", () => {
  it("does not re-attach while the user types in the search box", async () => {
    // `ThemeConsentDialog`'s effect depends on `onCancel`; a fresh arrow at the call site
    // made it detach and re-attach a `window` listener on every render of this component,
    // and this component re-renders on every keystroke. It could not drop a key — React
    // flushes a commit's passive cleanups and setups in one synchronous job — so nothing
    // here asserts behaviour; it asserts the churn, which is the whole finding.
    const add = vi.spyOn(window, "addEventListener");
    pendingConsent = { entry: themeEntry() };
    fetchResult = Promise.resolve({ plugins: [themeEntry()] });
    try {
      render(<ThemeBrowser onBack={() => {}} />);
      await findSurface(".theme-consent");
      const keydownAttachesAfterMount = add.mock.calls.filter(
        ([type]) => type === "keydown",
      ).length;
      // The anchor: the dialog really did attach one, so "no more" below is about the
      // re-attach rather than about a listener that was never there.
      expect(keydownAttachesAfterMount).toBeGreaterThanOrEqual(1);

      const search = screen.getByPlaceholderText(
        EN["settings.appearance.themeBrowser.search"],
      );
      fireEvent.change(search, { target: { value: "d" } });
      fireEvent.change(search, { target: { value: "dr" } });
      fireEvent.change(search, { target: { value: "dra" } });
      await waitFor(() => expect(search).toHaveValue("dra"));

      expect(add.mock.calls.filter(([type]) => type === "keydown").length).toBe(
        keydownAttachesAfterMount,
      );
    } finally {
      add.mockRestore();
      pendingConsent = null;
    }
  });
});

describe("a browse card for something already installed (0090 final review, N5)", () => {
  it("says Install when nothing is installed", async () => {
    // The anchor. Without it every assertion below could hold for a screen that says
    // "Installed" unconditionally.
    fetchResult = Promise.resolve({ plugins: [themeEntry()] });
    render(<ThemeBrowser onBack={() => {}} />);

    expect(
      await screen.findByText(EN["settings.appearance.themeBrowser.install"]),
    ).toBeTruthy();
    expect(
      screen.queryByText(EN["settings.appearance.themeBrowser.installed"]),
    ).toBeNull();
  });

  it("says Installed, and offers Reinstall, at the same version", async () => {
    // With N2 the button re-asks consent and re-downloads, so the card has to say the
    // theme is already here before the click rather than after it.
    useSettingsStore.setState({ installedThemes: installedAt("1.0.0") });
    fetchResult = Promise.resolve({ plugins: [themeEntry()] });
    render(<ThemeBrowser onBack={() => {}} />);

    expect(
      await screen.findByText(EN["settings.appearance.themeBrowser.installed"]),
    ).toBeTruthy();
    expect(
      screen.getByText(EN["settings.appearance.themeBrowser.reinstall"]),
    ).toBeTruthy();
  });

  it("names the installed version when it differs from the listing", async () => {
    useSettingsStore.setState({ installedThemes: installedAt("0.9.0") });
    fetchResult = Promise.resolve({ plugins: [themeEntry()] });
    render(<ThemeBrowser onBack={() => {}} />);

    // The two states read differently on purpose: only this one is a version the user
    // might want to move off, and the gallery's own badge is where that action lives.
    expect(await screen.findByText("Installed: v0.9.0")).toBeTruthy();
    expect(
      screen.queryByText(EN["settings.appearance.themeBrowser.installed"]),
    ).toBeNull();
  });

  it("does not mark a card for a DIFFERENT theme as installed", async () => {
    useSettingsStore.setState({ installedThemes: installedAt("1.0.0") });
    fetchResult = Promise.resolve({
      plugins: [themeEntry({ id: "nord-ish", name: "Nordish" })],
    });
    render(<ThemeBrowser onBack={() => {}} />);

    expect(await screen.findByText("Nordish")).toBeTruthy();
    expect(
      screen.queryByText(EN["settings.appearance.themeBrowser.installed"]),
    ).toBeNull();
  });
});

describe("ThemeBrowser", () => {
  it("shows only kind: theme entries, never a plugin row", async () => {
    fetchResult = Promise.resolve({
      plugins: [
        themeEntry(),
        {
          ...themeEntry({ id: "not-a-theme", name: "Some Plugin" }),
          kind: "plugin",
        },
      ],
    });
    render(<ThemeBrowser onBack={() => {}} />);

    await waitFor(() =>
      expect(screen.getByText("Dracula")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Some Plugin")).toBeNull();
  });

  it("filters by the search box (name, description, author)", async () => {
    fetchResult = Promise.resolve({
      plugins: [
        themeEntry(),
        themeEntry({ id: "solarized", name: "Solarized" }),
      ],
    });
    render(<ThemeBrowser onBack={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText("Dracula")).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "solar" },
    });
    expect(screen.queryByText("Dracula")).toBeNull();
    expect(screen.getByText("Solarized")).toBeInTheDocument();
  });

  it("shows an empty state when the registry has no themes", async () => {
    fetchResult = Promise.resolve({ plugins: [] });
    render(<ThemeBrowser onBack={() => {}} />);
    await waitFor(() => expect(fetchRegistryIndex).toHaveBeenCalled());
    expect(
      await screen.findByText(/no themes are available yet/i),
    ).toBeInTheDocument();
  });

  it("shows an error state with a retry that re-fetches", async () => {
    fetchResult = Promise.reject(new Error("network down"));
    render(<ThemeBrowser onBack={() => {}} />);

    await waitFor(() =>
      expect(
        screen.getByText(/could not load the theme registry/i),
      ).toBeInTheDocument(),
    );
    expect(fetchRegistryIndex).toHaveBeenCalledTimes(1);

    fetchResult = Promise.resolve({ plugins: [themeEntry()] });
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() =>
      expect(screen.getByText("Dracula")).toBeInTheDocument(),
    );
    expect(fetchRegistryIndex).toHaveBeenCalledTimes(2);
    // The retry forces a fresh fetch rather than serving the 24h cache.
    expect(fetchRegistryIndex).toHaveBeenLastCalledWith(true);
  });

  it("calls handleInstall with the entry and the shared registry URL", async () => {
    fetchResult = Promise.resolve({ plugins: [themeEntry()] });
    render(<ThemeBrowser onBack={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText("Dracula")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /^install$/i }));
    expect(handleInstall).toHaveBeenCalledWith(
      expect.objectContaining({ id: "dracula" }),
      "https://reg.test/index.json",
    );
  });

  // §361 fix round 1 (F2) — review round 1 found the consent surface asserted nowhere: three
  // mutations that each delete or hide the §9.3 disclosure (the sentences, and the ⓘ
  // affordance elsewhere) all passed the suite green. Every test below is written to fail
  // if what it names is missing from the screen, not merely to prove a dialog exists.
  //
  // §361 fix round 2 — the dialog is now shadow-isolated (`ThemeConsentDialog.tsx`, F3), so
  // `screen`/`within` cannot see inside it: `querySelectorAll` does not pierce a shadow
  // root, in jsdom or in a real browser. `findSurface` (the same helper
  // `plugin-install-consent.test.tsx` uses for `PluginConsentDialog`) waits for the shadow
  // host to appear and returns queries bound inside its content.
  describe("consent dialog (§9.3)", () => {
    beforeEach(() => {
      fetchResult = Promise.resolve({ plugins: [themeEntry()] });
      pendingConsent = { entry: themeEntry() };
    });

    it("shows the three fixed sentences — RED under M-A (sentences deleted)", async () => {
      render(<ThemeBrowser onBack={() => {}} />);
      const dialog = await findSurface(".theme-consent");

      expect(
        dialog.getByText(EN["settings.appearance.installConsent.appearance"]),
      ).toBeInTheDocument();
      expect(
        dialog.getByText(EN["settings.appearance.installConsent.noCode"]),
      ).toBeInTheDocument();
      expect(
        dialog.getByText(EN["settings.appearance.installConsent.noNetwork"]),
      ).toBeInTheDocument();
    });

    it("names the theme in the title", async () => {
      render(<ThemeBrowser onBack={() => {}} />);
      const dialog = await findSurface(".theme-consent");
      expect(dialog.getByText(/dracula/i)).toBeInTheDocument();
    });

    it("Install calls settleConsent(true)", async () => {
      render(<ThemeBrowser onBack={() => {}} />);
      const dialog = await findSurface(".theme-consent");
      // The card's own Install button is ALSO on screen (light DOM) and says "Install" —
      // querying inside the shadow surface can't accidentally click that one instead.
      fireEvent.click(dialog.getByRole("button", { name: /install/i }));
      expect(settleConsent).toHaveBeenCalledWith(true);
    });

    it("Cancel calls settleConsent(false)", async () => {
      render(<ThemeBrowser onBack={() => {}} />);
      const dialog = await findSurface(".theme-consent");
      fireEvent.click(dialog.getByRole("button", { name: /cancel/i }));
      expect(settleConsent).toHaveBeenCalledWith(false);
    });

    it("Escape calls settleConsent(false)", async () => {
      render(<ThemeBrowser onBack={() => {}} />);
      await findSurface(".theme-consent");
      fireEvent.keyDown(window, { key: "Escape" });
      expect(settleConsent).toHaveBeenCalledWith(false);
    });

    it("a key other than Escape does nothing", async () => {
      render(<ThemeBrowser onBack={() => {}} />);
      await findSurface(".theme-consent");
      fireEvent.keyDown(window, { key: "Enter" });
      expect(settleConsent).not.toHaveBeenCalled();
    });
  });

  it("calls onBack when the back control is used", async () => {
    fetchResult = Promise.resolve({ plugins: [] });
    const onBack = vi.fn();
    render(<ThemeBrowser onBack={onBack} />);
    await waitFor(() => expect(fetchRegistryIndex).toHaveBeenCalled());

    fireEvent.click(screen.getByText(/back/i));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
