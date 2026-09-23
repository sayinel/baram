// §361 — install (consent → install → apply → undo toast), remove (routes by source
// without the CALLER ever comparing `theme.source`), and consent history.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const installTheme = vi.fn();
vi.mock("../../../../themes/theme-install", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../themes/theme-install")
  >()),
  installTheme: (...a: unknown[]) => installTheme(...a),
}));

const themeUninstall = vi.fn();
vi.mock("../../../../ipc/theme", () => ({
  themeUninstall: (...a: unknown[]) => themeUninstall(...a),
}));

/**
 * The running app version (0090 re-review, R4).
 *
 * ‼️ MOCKED SO THE FIXTURES BELOW EXERCISE THE PATH THEY LOOK LIKE THEY EXERCISE. Without
 * it, `engines-app.ts`'s `getVersion()` throws in jsdom, the M1 floor gate catches it, and
 * every `engines: { baram: ">=0.7.0" }` fixture in this file resolves as "no opinion" —
 * green, correct, and never once comparing a version. It also logged a warning per case.
 * The comparison itself is exercised on both sides in `theme-update-revocation.test.ts`;
 * this mock is what keeps THIS file's cases from passing through a branch nobody meant.
 */
const appVersion = vi.hoisted(() => vi.fn(() => Promise.resolve("0.7.3")));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: appVersion }));

// Bare `vi.fn()`: a typed `async () => undefined` implementation narrows the inferred
// signature to zero params, which the spread wrapper below (and `.mock.calls[0][0]` further
// down) then fails to typecheck against.
const showAlert = vi.fn();
vi.mock("../../../../utils/confirm-dialog", () => ({
  showAlert: (...a: unknown[]) => showAlert(...a),
}));

import type { RegistryEntry, RegistryIndex } from "../../../../plugins/types";
import type { InstalledTheme } from "../../../../themes/theme-install";
import type { ThemeDef } from "../../../../types/theme";

import en from "../../../../i18n/en.json";
import { useSettingsStore } from "../../../../stores/settings/store";
import { useUIStore } from "../../../../stores/ui/ui";
import { installFailureMessage, useThemeActions } from "../use-theme-actions";

const T = (key: string, params?: Record<string, string>): string => {
  let s = (en as Record<string, string>)[key] ?? key;
  for (const [k, v] of Object.entries(params ?? {})) {
    s = s.replaceAll(`{${k}}`, v);
  }
  return s;
};

function entry(over: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    author: "a",
    capabilities: [],
    checksum: "c".repeat(64),
    description: "d",
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

function installedTheme(over: Partial<InstalledTheme> = {}): InstalledTheme {
  return {
    checksum: "c".repeat(64),
    consentedAt: "2026-09-01T00:00:00.000Z",
    consentedVersion: "1.0.0",
    id: "dracula",
    installedAt: "2026-09-01T00:00:00.000Z",
    installPath: "/home/.baram/themes/dracula",
    manifest: {
      author: "a",
      description: "d",
      engines: { baram: ">=0.7.0" },
      id: "dracula",
      license: "MIT",
      modes: { light: { tokens: "light/tokens.json" } },
      name: "Dracula",
      version: "1.0.0",
    },
    modes: { light: { css: false } },
    ...over,
  };
}

beforeEach(() => {
  installTheme.mockReset();
  themeUninstall.mockReset();
  themeUninstall.mockResolvedValue(undefined);
  showAlert.mockClear();
  appVersion.mockResolvedValue("0.7.3");
  useSettingsStore.setState({
    activeThemeId: "system",
    customThemes: [],
    installedThemes: {},
  });
  useUIStore.getState().dismissToast();
});

afterEach(() => {
  useSettingsStore.setState({ customThemes: [], installedThemes: {} });
});

// §361 fix round 1 (F8/M-F) — the unmount guard is attributed in its own comment to a
// reported defect in usePluginActions (a dialog that disappears with the component must
// resolve as a REFUSAL, or the awaiting caller hangs forever) but had no test of its own;
// review round 1's M-F (deleting the guard) passed the whole suite green.
/**
 * Let `handleInstall` reach its consent dialog.
 *
 * ‼️ WHAT DOES THE WORK IS THE `act` BOUNDARY, NOT THE TURN COUNT (0090 re-review, R2). An
 * earlier comment here said three `Promise.resolve()` turns were needed because M1 put an
 * `await` in front of `askConsent`, and that "too few turns fails loudly". Measured: three
 * turns green, one turn green, and **zero** turns — a bare `await act(async () => {})` —
 * green too. Deleting the calls entirely fails 10 cases. So the flush is load-bearing and
 * the turns are decorative: exiting an async `act` scope drains the pending microtask work
 * and flushes the re-render that follows, which is the whole requirement.
 *
 * What keeps this from being a vacuous wait is the caller, not this function: every case
 * that uses it asserts the dialog IS open, or settles it and asserts what followed.
 */
async function reachConsent(): Promise<void> {
  await act(async () => {});
}

describe("the pending consent promise settles even if nothing else does", () => {
  it("unmounting while a consent is pending resolves handleInstall's promise as false — RED under M-F", async () => {
    const { result, unmount } = renderHook(() => useThemeActions());
    let installed: boolean | undefined;
    let settled = false;
    act(() => {
      void result.current
        .handleInstall(entry(), "https://reg.test")
        .then((v) => {
          installed = v;
          settled = true;
        });
    });
    await reachConsent();
    expect(result.current.pendingConsent).not.toBeNull();

    unmount();
    await act(async () => {
      await Promise.resolve();
    });

    expect(settled).toBe(true);
    expect(installed).toBe(false);
    expect(installTheme).not.toHaveBeenCalled();
  });

  it("a second consent request resolves the first one as false, not leaking it forever", async () => {
    const { result } = renderHook(() => useThemeActions());
    let firstResolved: boolean | undefined;
    act(() => {
      void result.current
        .handleInstall(entry({ id: "first" }), "https://reg.test")
        .then((v) => {
          firstResolved = v;
        });
    });
    await reachConsent();
    expect(result.current.pendingConsent?.entry.id).toBe("first");

    // A second entry asks before the first was ever answered.
    act(() => {
      void result.current.handleInstall(
        entry({ id: "second" }),
        "https://reg.test",
      );
    });
    await reachConsent();

    expect(firstResolved).toBe(false);
    expect(result.current.pendingConsent?.entry.id).toBe("second");
  });
});

describe("handleInstall", () => {
  it("does nothing until consent is confirmed", async () => {
    const { result } = renderHook(() => useThemeActions());
    let installed: boolean | undefined;
    act(() => {
      void result.current
        .handleInstall(entry(), "https://reg.test")
        .then((v) => {
          installed = v;
        });
    });
    await reachConsent();
    expect(result.current.pendingConsent?.entry.id).toBe("dracula");
    expect(installTheme).not.toHaveBeenCalled();

    await act(async () => {
      result.current.settleConsent(false);
      await Promise.resolve();
    });
    expect(installed).toBe(false);
    expect(installTheme).not.toHaveBeenCalled();
  });

  it("installs, applies immediately, and offers an undo toast on consent", async () => {
    useSettingsStore.setState({ activeThemeId: "default-light" });
    installTheme.mockResolvedValue({
      installed: installedTheme(),
      ok: true,
    });
    const { result } = renderHook(() => useThemeActions());

    let installed: boolean | undefined;
    act(() => {
      void result.current
        .handleInstall(entry(), "https://reg.test")
        .then((v) => {
          installed = v;
        });
    });
    await reachConsent();
    await act(async () => {
      result.current.settleConsent(true);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(installed).toBe(true);
    expect(installTheme).toHaveBeenCalledWith(
      expect.objectContaining({ id: "dracula" }),
      "https://reg.test",
    );
    // Applied immediately (§10.3).
    expect(useSettingsStore.getState().activeThemeId).toBe("dracula");
    expect(useSettingsStore.getState().installedThemes.dracula?.id).toBe(
      "dracula",
    );
    // Undo toast targets what was active BEFORE this install.
    const toast = useUIStore.getState().toast;
    expect(toast?.action).toBeDefined();
    toast?.action?.onClick();
    expect(useSettingsStore.getState().activeThemeId).toBe("default-light");
    // §361 fix round 1 (F8) — §10.3 says undo reverses only the APPLY: the directory and the
    // record both stay. Only `activeThemeId` moves; `installedThemes` is untouched.
    expect(useSettingsStore.getState().installedThemes.dracula?.id).toBe(
      "dracula",
    );
  });

  // §367.3 fix round 1 — `useUIStore`'s `showToast` has a single slot: a toast shown inside
  // `stageAndRecord` and a second one shown synchronously after by the caller left only the
  // second on screen, so the first (the contrast warning) was set and immediately discarded
  // with nothing ever rendering it. Pinning the CALL COUNT, not just the final toast's
  // contents, is what catches a regression here — asserting only the last toast would pass
  // the broken two-call version too, since the success toast is what survives.
  it("shows exactly one toast on a clean install with no contrast warnings", async () => {
    installTheme.mockResolvedValue({
      installed: installedTheme(),
      ok: true,
    });
    const showToastSpy = vi.spyOn(useUIStore.getState(), "showToast");
    const { result } = renderHook(() => useThemeActions());

    act(() => {
      void result.current.handleInstall(entry(), "https://reg.test");
    });
    await reachConsent();
    await act(async () => {
      result.current.settleConsent(true);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(showToastSpy).toHaveBeenCalledTimes(1);
    expect(showToastSpy.mock.calls[0]?.[1]).toBe("info");
    showToastSpy.mockRestore();
  });

  it("shows exactly one toast, folding the contrast warning into it, when installTheme reports warnings", async () => {
    installTheme.mockResolvedValue({
      installed: installedTheme(),
      ok: true,
      warnings: [
        {
          background: "--color-bg-panel",
          foreground: "--color-text-secondary",
          mode: "light",
          ratio: 4.35,
        },
      ],
    });
    const showToastSpy = vi.spyOn(useUIStore.getState(), "showToast");
    const { result } = renderHook(() => useThemeActions());

    act(() => {
      void result.current.handleInstall(entry(), "https://reg.test");
    });
    await reachConsent();
    await act(async () => {
      result.current.settleConsent(true);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(showToastSpy).toHaveBeenCalledTimes(1);
    const [message, type] = showToastSpy.mock.calls[0]!;
    expect(type).toBe("warning");
    expect(message).toBe(
      T("settings.appearance.installedToastWithWarning", {
        count: "1",
        name: "Dracula",
      }),
    );
    showToastSpy.mockRestore();
  });

  it("records an error and does not apply anything on a failed install", async () => {
    installTheme.mockResolvedValue({
      ok: false,
      reason: "downloadFailed",
    });
    const { result } = renderHook(() => useThemeActions());

    let installed: boolean | undefined;
    act(() => {
      void result.current
        .handleInstall(entry(), "https://reg.test")
        .then((v) => {
          installed = v;
        });
    });
    await reachConsent();
    await act(async () => {
      result.current.settleConsent(true);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(installed).toBe(false);
    expect(result.current.installErrors.dracula).toBeTruthy();
    expect(useSettingsStore.getState().activeThemeId).toBe("system");
    expect(useSettingsStore.getState().installedThemes).toEqual({});
  });

  it("refuses a second install of the same entry while one is already in flight", async () => {
    let resolveFirst!: (v: unknown) => void;
    installTheme.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );
    const { result } = renderHook(() => useThemeActions());

    act(() => {
      void result.current.handleInstall(entry(), "https://reg.test");
    });
    act(() => {
      result.current.settleConsent(true);
    });
    // The first call is now past consent and awaiting installTheme. A second call for the
    // SAME entry must be refused before it can open a second consent dialog.
    let second: boolean | undefined;
    await act(async () => {
      second = await result.current.handleInstall(entry(), "https://reg.test");
    });
    expect(second).toBe(false);

    await act(async () => {
      resolveFirst({ installed: installedTheme(), ok: true });
      await Promise.resolve();
      await Promise.resolve();
    });
  });
});

describe("handleUpdate", () => {
  // §367.3 fix round 1 — same single-slot toast fix as `handleInstall` above, and the same
  // reason for pinning the call count: `handleUpdate` composes its own toast now instead of
  // `stageAndRecord` showing one that the update toast right after it would have clobbered.
  it("shows exactly one toast, folding the contrast warning into it, when installTheme reports warnings", async () => {
    useSettingsStore.setState({
      installedThemes: { dracula: installedTheme() },
    });
    installTheme.mockResolvedValue({
      installed: installedTheme({
        manifest: { ...installedTheme().manifest, version: "2.0.0" },
      }),
      ok: true,
      warnings: [
        {
          background: "--color-bg-panel",
          foreground: "--color-text-secondary",
          mode: "light",
          ratio: 4.35,
        },
      ],
    });
    const index: RegistryIndex = { plugins: [entry({ version: "2.0.0" })] };
    const showToastSpy = vi.spyOn(useUIStore.getState(), "showToast");
    const { result } = renderHook(() => useThemeActions());

    let updated: boolean | undefined;
    await act(async () => {
      updated = await result.current.handleUpdate(
        "dracula",
        index,
        "https://reg.test",
      );
    });

    expect(updated).toBe(true);
    expect(showToastSpy).toHaveBeenCalledTimes(1);
    const [message, type] = showToastSpy.mock.calls[0]!;
    expect(type).toBe("warning");
    expect(message).toBe(
      T("settings.appearance.updatedToastWithWarning", {
        count: "1",
        name: "Dracula",
        version: "2.0.0",
      }),
    );
    showToastSpy.mockRestore();
  });
});

describe("removeTheme", () => {
  const CUSTOM: ThemeDef = {
    id: "mine",
    modes: { light: { colors: undefined } },
    name: "Mine",
    source: "custom",
  };

  it("deletes a custom theme from the store, without touching the network", async () => {
    useSettingsStore.setState({ customThemes: [CUSTOM] });
    const { result } = renderHook(() => useThemeActions());

    await act(async () => result.current.removeTheme(CUSTOM));

    expect(useSettingsStore.getState().customThemes).toEqual([]);
    expect(themeUninstall).not.toHaveBeenCalled();
  });

  it("uninstalls a community theme, then drops its record", async () => {
    useSettingsStore.setState({
      installedThemes: { dracula: installedTheme() },
    });
    const community: ThemeDef = {
      id: "dracula",
      modes: { light: {} },
      name: "Dracula",
      source: "community",
    };
    const { result } = renderHook(() => useThemeActions());

    await act(async () => result.current.removeTheme(community));

    expect(themeUninstall).toHaveBeenCalledWith("dracula");
    expect(useSettingsStore.getState().installedThemes).toEqual({});
  });

  it("keeps the record when the uninstall call fails", async () => {
    themeUninstall.mockRejectedValue(new Error("disk error"));
    const installedRecord = installedTheme();
    useSettingsStore.setState({
      installedThemes: { dracula: installedRecord },
    });
    const community: ThemeDef = {
      id: "dracula",
      modes: { light: {} },
      name: "Dracula",
      source: "community",
    };
    const { result } = renderHook(() => useThemeActions());

    await act(async () => result.current.removeTheme(community));

    expect(useSettingsStore.getState().installedThemes.dracula).toBe(
      installedRecord,
    );
  });

  it("does nothing for a builtin theme (no remove action for that source)", async () => {
    const builtin: ThemeDef = {
      id: "default-light",
      modes: { light: {} },
      name: "Default Light",
      source: "builtin",
    };
    const { result } = renderHook(() => useThemeActions());
    await act(async () => result.current.removeTheme(builtin));
    expect(themeUninstall).not.toHaveBeenCalled();
  });
});

describe("installFailureMessage", () => {
  it("uses the generic reason sentence for a non-CSS failure", () => {
    expect(
      installFailureMessage({ ok: false, reason: "downloadFailed" }, T),
    ).toBe(T("settings.appearance.installError.downloadFailed"));
  });

  it("prefers the specific CSS rejection sentence when detail is a known code", () => {
    expect(
      installFailureMessage(
        { detail: "importNotAllowed", ok: false, reason: "cssRejected" },
        T,
      ),
    ).toBe(T("settings.appearance.themeCssError.importNotAllowed"));
  });

  it("falls back to the generic cssRejected sentence when detail is not a known code", () => {
    expect(
      installFailureMessage(
        {
          detail: "some raw file-not-found error",
          ok: false,
          reason: "cssRejected",
        },
        T,
      ),
    ).toBe(T("settings.appearance.installError.cssRejected"));
  });

  it("falls back to the generic cssRejected sentence when detail is absent", () => {
    expect(installFailureMessage({ ok: false, reason: "cssRejected" }, T)).toBe(
      T("settings.appearance.installError.cssRejected"),
    );
  });
});

describe("showConsentHistory", () => {
  it("shows an alert naming the consented version and date", () => {
    const { result } = renderHook(() => useThemeActions());
    act(() => result.current.showConsentHistory(installedTheme()));

    expect(showAlert).toHaveBeenCalledTimes(1);
    const message = showAlert.mock.calls[0][0] as string;
    expect(message).toContain("1.0.0");
  });

  // §361 fix round 1 (F2/M-D) — review round 1 deleted the three sentences from this alert
  // and every test still passed; strengthened to assert each one by its actual locale text.
  it("includes the three fixed consent sentences — RED under M-D", () => {
    const { result } = renderHook(() => useThemeActions());
    act(() => result.current.showConsentHistory(installedTheme()));

    const message = showAlert.mock.calls[0][0] as string;
    expect(message).toContain(
      T("settings.appearance.installConsent.appearance"),
    );
    expect(message).toContain(T("settings.appearance.installConsent.noCode"));
    expect(message).toContain(
      T("settings.appearance.installConsent.noNetwork"),
    );
  });

  // §361 fix round 1 (F4) — reads consentedAt/consentedVersion, not installedAt/
  // manifest.version, so an update (Task 6) that legitimately moves the latter two does not
  // make this screen assert a consent that never happened.
  it("reads consentedAt/consentedVersion, not installedAt/manifest.version", () => {
    const { result } = renderHook(() => useThemeActions());
    act(() =>
      result.current.showConsentHistory(
        installedTheme({
          consentedAt: "2020-01-01T00:00:00.000Z",
          consentedVersion: "1.0.0",
          installedAt: "2099-12-31T00:00:00.000Z",
          manifest: { ...installedTheme().manifest, version: "9.9.9" },
        }),
      ),
    );

    const message = showAlert.mock.calls[0][0] as string;
    expect(message).toContain("1.0.0");
    expect(message).not.toContain("9.9.9");
    expect(message).not.toContain("2099");
  });
});
