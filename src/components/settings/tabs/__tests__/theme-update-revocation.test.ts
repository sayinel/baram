// §361 Task 6 — theme updates and withdrawals, at the action layer.
//
// Three things are pinned here that nothing else pins:
//   1. an update never re-stamps consent (the defect `consentedAt` was introduced for),
//   2. an update forgets the cached CSS (without which the new bytes are never read),
//   3. a withdrawn version is refused BEFORE the consent dialog, for any severity.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

/** The running app version, as `engines-app.ts` asks the backend for it. Mocked rather than
 *  stubbed at `@tauri-apps/api` so the floor arithmetic under test is the real one. */
const appVersion = vi.hoisted(() => vi.fn(() => Promise.resolve("0.7.3")));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: appVersion }));

import type { RevocationSeverity } from "../../../../plugins/revocation";
import type { RegistryEntry, RegistryIndex } from "../../../../plugins/types";
import type { InstalledTheme } from "../../../../themes/theme-install";

import { useSettingsStore } from "../../../../stores/settings/store";
import { usePluginStore } from "../../../../stores/system/plugin";
import { useThemeCssCacheStore } from "../../../../stores/system/theme-css-cache";
import { themeCssCacheKey } from "../../../../themes/installed-theme-defs";
import { useThemeActions } from "../use-theme-actions";

const REGISTRY = "https://reg.test/index.json";

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
    version: "2.0.0",
    ...over,
  };
}

function index(entries: RegistryEntry[]): RegistryIndex {
  return { plugins: entries, updatedAt: "2026-09-20" };
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
      modes: { light: { css: "light/theme.css" } },
      name: "Dracula",
      version: "1.0.0",
    },
    modes: { light: { css: true } },
    ...over,
  };
}

/** What `installTheme` hands back for a successful v2.0.0 install of the same id. Note the
 *  consent fields: `installTheme` always stamps "now", which is exactly what the store has
 *  to override on an update. */
function installedV2(): InstalledTheme {
  return installedTheme({
    consentedAt: "2026-09-20T00:00:00.000Z",
    consentedVersion: "2.0.0",
    installedAt: "2026-09-20T00:00:00.000Z",
    manifest: { ...installedTheme().manifest, version: "2.0.0" },
  });
}

function revoke(severity: RevocationSeverity) {
  usePluginStore.setState({
    revocations: {
      revoked: [
        { id: "dracula", reason: "compromised build", severity, versions: "*" },
      ],
      sequence: 1,
      version: 1,
    },
  });
}

beforeEach(() => {
  installTheme.mockReset();
  themeUninstall.mockReset();
  themeUninstall.mockResolvedValue(undefined);
  useSettingsStore.setState({
    activeThemeId: "system",
    customThemes: [],
    installedThemes: {},
  });
  usePluginStore.setState({ revocations: null });
  useThemeCssCacheStore.setState({ entries: {} });
  appVersion.mockResolvedValue("0.7.3");
});

describe("handleUpdate", () => {
  it("installs the registry's version and keeps the consent the first install recorded", async () => {
    useSettingsStore.setState({
      installedThemes: { dracula: installedTheme() },
    });
    installTheme.mockResolvedValue({ installed: installedV2(), ok: true });
    const { result } = renderHook(() => useThemeActions());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.handleUpdate(
        "dracula",
        index([entry()]),
        REGISTRY,
      );
    });

    expect(ok).toBe(true);
    const record = useSettingsStore.getState().installedThemes.dracula;
    // The version really moved — without this the consent assertions below would hold for
    // a store that simply ignored the update.
    expect(record.manifest.version).toBe("2.0.0");
    expect(record.installedAt).toBe("2026-09-20T00:00:00.000Z");
    // …and the consent did not.
    expect(record.consentedAt).toBe("2026-09-01T00:00:00.000Z");
    expect(record.consentedVersion).toBe("1.0.0");
  });

  it("asks for no consent — the dialog never opens", async () => {
    useSettingsStore.setState({
      installedThemes: { dracula: installedTheme() },
    });
    installTheme.mockResolvedValue({ installed: installedV2(), ok: true });
    const { result } = renderHook(() => useThemeActions());

    await act(async () => {
      await result.current.handleUpdate("dracula", index([entry()]), REGISTRY);
    });

    expect(result.current.pendingConsent).toBeNull();
    expect(installTheme).toHaveBeenCalledTimes(1);
  });

  it("forgets the cached CSS so the new bytes are read", async () => {
    useSettingsStore.setState({
      installedThemes: { dracula: installedTheme() },
    });
    useThemeCssCacheStore.setState({
      entries: {
        [themeCssCacheKey("dracula", "light")]: ".old{}",
        // A neighbouring theme whose id merely starts the same way. It must survive —
        // `clearTheme` compares against `${id}:` for exactly this.
        [themeCssCacheKey("dracula-pro", "light")]: ".other{}",
      },
    });
    installTheme.mockResolvedValue({ installed: installedV2(), ok: true });
    const { result } = renderHook(() => useThemeActions());

    await act(async () => {
      await result.current.handleUpdate("dracula", index([entry()]), REGISTRY);
    });

    const entries = useThemeCssCacheStore.getState().entries;
    expect(entries[themeCssCacheKey("dracula", "light")]).toBeUndefined();
    expect(entries[themeCssCacheKey("dracula-pro", "light")]).toBe(".other{}");
  });

  it("re-resolves the listing: an index with no theme entry for the id installs nothing", async () => {
    useSettingsStore.setState({
      installedThemes: { dracula: installedTheme() },
    });
    const { result } = renderHook(() => useThemeActions());

    let ok: boolean | undefined;
    await act(async () => {
      // Same id, same newer version — but published as a PLUGIN. Resolving by id alone
      // would download this archive over an installed theme.
      ok = await result.current.handleUpdate(
        "dracula",
        index([entry({ kind: "plugin" })]),
        REGISTRY,
      );
    });

    expect(ok).toBe(false);
    expect(installTheme).not.toHaveBeenCalled();
  });

  it("does nothing when the registry lists the version already installed", async () => {
    useSettingsStore.setState({
      installedThemes: { dracula: installedTheme() },
    });
    const { result } = renderHook(() => useThemeActions());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.handleUpdate(
        "dracula",
        index([entry({ version: "1.0.0" })]),
        REGISTRY,
      );
    });

    expect(ok).toBe(false);
    expect(installTheme).not.toHaveBeenCalled();
  });

  it.each(["malicious", "unlisted", "vulnerable"] as const)(
    "refuses a %s withdrawal of the target version",
    async (severity) => {
      useSettingsStore.setState({
        installedThemes: { dracula: installedTheme() },
      });
      revoke(severity);
      const { result } = renderHook(() => useThemeActions());

      let ok: boolean | undefined;
      await act(async () => {
        ok = await result.current.handleUpdate(
          "dracula",
          index([entry()]),
          REGISTRY,
        );
      });

      expect(ok).toBe(false);
      expect(installTheme).not.toHaveBeenCalled();
      expect(result.current.installErrors.dracula).toContain(
        "compromised build",
      );
      // The record is untouched — a refusal is not a removal.
      expect(
        useSettingsStore.getState().installedThemes.dracula.manifest.version,
      ).toBe("1.0.0");
    },
  );
});

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

describe("the engines.baram floor (M1)", () => {
  it("refuses an install whose entry states a floor this app is below, before the dialog", async () => {
    // Spec §9.1 lists the floor among what themes reuse from §69, and until the final fix
    // round nothing on the theme path called it — `validateThemeManifest` checks the field
    // is a non-empty string and stops. Refused BEFORE `askConsent` for the same reason a
    // withdrawal is: nobody should approve an install already decided against.
    const { result } = renderHook(() => useThemeActions());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.handleInstall(
        entry({ engines: { baram: ">=9.0.0" } }),
        REGISTRY,
      );
    });

    expect(ok).toBe(false);
    expect(result.current.pendingConsent).toBeNull();
    expect(installTheme).not.toHaveBeenCalled();
    expect(result.current.installErrors.dracula).toContain("9.0.0");
  });

  it("refuses an update to a target this app is below", async () => {
    useSettingsStore.setState({
      installedThemes: { dracula: installedTheme() },
    });
    const { result } = renderHook(() => useThemeActions());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.handleUpdate(
        "dracula",
        index([entry({ engines: { baram: ">=9.0.0" } })]),
        REGISTRY,
      );
    });

    expect(ok).toBe(false);
    expect(installTheme).not.toHaveBeenCalled();
  });

  it("lets a met floor through", async () => {
    // The positive half. Without it "refuse everything with an engines field" would pass
    // both cases above.
    const { result } = renderHook(() => useThemeActions());

    act(() => {
      void result.current.handleInstall(
        entry({ engines: { baram: ">=0.7.0" } }),
        REGISTRY,
      );
    });
    await reachConsent();

    expect(result.current.pendingConsent?.entry.id).toBe("dracula");
  });

  it("has no opinion when the app version cannot be read", async () => {
    // `engines.ts`'s direction of doubt: an unreadable version is not a refusal. Without
    // this the gate could be "refuse whenever a floor is stated", which would deny every
    // install the moment `getVersion` failed.
    appVersion.mockRejectedValue(new Error("no backend"));
    const { result } = renderHook(() => useThemeActions());

    act(() => {
      void result.current.handleInstall(
        entry({ engines: { baram: ">=9.0.0" } }),
        REGISTRY,
      );
    });
    await reachConsent();

    expect(result.current.pendingConsent?.entry.id).toBe("dracula");
  });
});

describe("removeTheme when the directory is already gone (M3)", () => {
  it("drops the record, because Rust now reports that as success", async () => {
    // The dead end this closes: the frontend deletes the directory and only then drops the
    // record, so a crash between the two — or any external loss of the directory — left a
    // card whose Remove button could never work. `uninstall_in` returns Ok for an absent
    // directory now; the Rust side of that is pinned in `install.rs`'s own tests.
    useSettingsStore.setState({
      installedThemes: { dracula: installedTheme() },
    });
    const { result } = renderHook(() => useThemeActions());

    await act(async () => {
      await result.current.removeTheme({
        id: "dracula",
        modes: { light: {} },
        name: "Dracula",
        source: "community",
      });
    });

    expect(useSettingsStore.getState().installedThemes.dracula).toBeUndefined();
  });

  it("keeps the record AND says why when the uninstall really fails", async () => {
    useSettingsStore.setState({
      installedThemes: { dracula: installedTheme() },
    });
    themeUninstall.mockRejectedValue(new Error("EBUSY"));
    const { result } = renderHook(() => useThemeActions());

    await act(async () => {
      await result.current.removeTheme({
        id: "dracula",
        modes: { light: {} },
        name: "Dracula",
        source: "community",
      });
    });

    expect(useSettingsStore.getState().installedThemes.dracula).toBeDefined();
    // Until this round the failure was logged and nothing else: no error, no removal.
    expect(result.current.installErrors.dracula).toBeTruthy();
  });

  it("clears a stale error once a later remove succeeds", async () => {
    useSettingsStore.setState({
      installedThemes: { dracula: installedTheme() },
    });
    themeUninstall.mockRejectedValueOnce(new Error("EBUSY"));
    const { result } = renderHook(() => useThemeActions());
    const remove = () =>
      result.current.removeTheme({
        id: "dracula",
        modes: { light: {} },
        name: "Dracula",
        source: "community",
      });

    await act(async () => {
      await remove();
    });
    expect(result.current.installErrors.dracula).toBeTruthy();

    await act(async () => {
      await remove();
    });
    expect(result.current.installErrors.dracula).toBeUndefined();
  });
});

describe("handleInstall", () => {
  it("forgets any cached CSS for that id, the same as an update does", async () => {
    // Fix round 1 (F4). The clear lives in `stageAndRecord`, which BOTH callers reach, so
    // it is structurally shared — but only update and uninstall were pinned, and a clear
    // moved out of the shared helper into `handleUpdate` would have stayed green. The
    // reachable case: uninstall leaves the record gone, the user installs the same id
    // again in the same session, and the cache still holds the deleted copy's bytes.
    useThemeCssCacheStore.setState({
      entries: { [themeCssCacheKey("dracula", "light")]: ".deleted{}" },
    });
    installTheme.mockResolvedValue({ installed: installedV2(), ok: true });
    const { result } = renderHook(() => useThemeActions());

    act(() => {
      void result.current.handleInstall(entry(), REGISTRY);
    });
    await reachConsent();
    await act(async () => {
      result.current.settleConsent(true);
      await Promise.resolve();
    });

    expect(installTheme).toHaveBeenCalledTimes(1);
    expect(
      useThemeCssCacheStore.getState().entries[
        themeCssCacheKey("dracula", "light")
      ],
    ).toBeUndefined();
  });
});

describe("reinstalling something already installed (N2)", () => {
  it("records the consent the user just gave, not the old one", async () => {
    // The pairing that makes this reachable: `handleInstall` is what the browse screen
    // calls for EVERY card, installed or not, so a reinstall really does open the dialog.
    useSettingsStore.setState({
      installedThemes: { dracula: installedTheme() },
    });
    installTheme.mockResolvedValue({ installed: installedV2(), ok: true });
    const { result } = renderHook(() => useThemeActions());

    act(() => {
      void result.current.handleInstall(entry(), REGISTRY);
    });
    await reachConsent();
    await act(async () => {
      result.current.settleConsent(true);
      await Promise.resolve();
      await Promise.resolve();
    });

    const record = useSettingsStore.getState().installedThemes.dracula;
    expect(record.consentedAt).toBe("2026-09-20T00:00:00.000Z");
    expect(record.consentedVersion).toBe("2.0.0");
  });

  it("but an update still carries the old stamp forward", async () => {
    // The sibling. Without it the N2 fix reads as "always take the new stamp", which is the
    // defect `consentedAt` was introduced for.
    useSettingsStore.setState({
      installedThemes: { dracula: installedTheme() },
    });
    installTheme.mockResolvedValue({ installed: installedV2(), ok: true });
    const { result } = renderHook(() => useThemeActions());

    await act(async () => {
      await result.current.handleUpdate("dracula", index([entry()]), REGISTRY);
    });

    const record = useSettingsStore.getState().installedThemes.dracula;
    expect(record.consentedAt).toBe("2026-09-01T00:00:00.000Z");
    expect(record.consentedVersion).toBe("1.0.0");
  });
});

describe("handleInstall and a withdrawn version", () => {
  it.each(["malicious", "unlisted", "vulnerable"] as const)(
    "refuses a %s withdrawal before the consent dialog opens",
    async (severity) => {
      revoke(severity);
      const { result } = renderHook(() => useThemeActions());

      let ok: boolean | undefined;
      await act(async () => {
        ok = await result.current.handleInstall(entry(), REGISTRY);
      });

      expect(ok).toBe(false);
      // ‼️ The point of the ordering: the user is never asked to approve something already
      // decided against. A refusal placed after `askConsent` would leave this non-null.
      expect(result.current.pendingConsent).toBeNull();
      expect(installTheme).not.toHaveBeenCalled();
      expect(result.current.installErrors.dracula).toContain(
        "compromised build",
      );
    },
  );

  it("still installs when the withdrawal names a different version range", async () => {
    usePluginStore.setState({
      revocations: {
        revoked: [
          {
            id: "dracula",
            reason: "old bad build",
            severity: "malicious",
            versions: { lt: "2.0.0" },
          },
        ],
        sequence: 1,
        version: 1,
      },
    });
    installTheme.mockResolvedValue({ installed: installedV2(), ok: true });
    const { result } = renderHook(() => useThemeActions());

    act(() => {
      void result.current.handleInstall(entry(), REGISTRY);
    });
    await reachConsent();
    // Reaching the dialog at all is the assertion: the range check is real rather than
    // "any entry with this id refuses everything".
    expect(result.current.pendingConsent?.entry.id).toBe("dracula");
    await act(async () => {
      result.current.settleConsent(true);
      await Promise.resolve();
    });
    expect(installTheme).toHaveBeenCalledTimes(1);
  });
});

describe("removeTheme", () => {
  it("forgets the cached CSS, so reinstalling the same id does not re-apply deleted bytes", async () => {
    useSettingsStore.setState({
      installedThemes: { dracula: installedTheme() },
    });
    useThemeCssCacheStore.setState({
      entries: { [themeCssCacheKey("dracula", "light")]: ".old{}" },
    });
    const { result } = renderHook(() => useThemeActions());

    await act(async () => {
      await result.current.removeTheme({
        id: "dracula",
        modes: { light: {} },
        name: "Dracula",
        source: "community",
      });
    });

    expect(themeUninstall).toHaveBeenCalledWith("dracula");
    expect(
      useThemeCssCacheStore.getState().entries[
        themeCssCacheKey("dracula", "light")
      ],
    ).toBeUndefined();
  });

  it("keeps the cached CSS when the uninstall fails — the files are still there", async () => {
    useSettingsStore.setState({
      installedThemes: { dracula: installedTheme() },
    });
    useThemeCssCacheStore.setState({
      entries: { [themeCssCacheKey("dracula", "light")]: ".old{}" },
    });
    themeUninstall.mockRejectedValue(new Error("EBUSY"));
    const { result } = renderHook(() => useThemeActions());

    await act(async () => {
      await result.current.removeTheme({
        id: "dracula",
        modes: { light: {} },
        name: "Dracula",
        source: "community",
      });
    });

    expect(useSettingsStore.getState().installedThemes.dracula).toBeDefined();
    expect(
      useThemeCssCacheStore.getState().entries[
        themeCssCacheKey("dracula", "light")
      ],
    ).toBe(".old{}");
  });
});
