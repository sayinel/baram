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
