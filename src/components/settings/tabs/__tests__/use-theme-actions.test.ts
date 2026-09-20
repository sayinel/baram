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

// Bare `vi.fn()`: a typed `async () => undefined` implementation narrows the inferred
// signature to zero params, which the spread wrapper below (and `.mock.calls[0][0]` further
// down) then fails to typecheck against.
const showAlert = vi.fn();
vi.mock("../../../../utils/confirm-dialog", () => ({
  showAlert: (...a: unknown[]) => showAlert(...a),
}));

import type { RegistryEntry } from "../../../../plugins/types";
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
    expect(result.current.pendingConsent?.entry.id).toBe("first");

    // A second entry asks before the first was ever answered.
    act(() => {
      void result.current.handleInstall(
        entry({ id: "second" }),
        "https://reg.test",
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

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
