// §361 Task 6 — `addInstalledTheme` is the single writer of `installedThemes`, and it owns
// one rule that nothing above it may restate: an id that is already recorded keeps the
// consent stamp it was recorded with.
//
// The rule lives at the writer rather than at the update caller because it is the shape a
// third caller forgets. `installTheme` always stamps "now" and the version it just
// installed, which is right exactly once — at the first install — and wrong for every
// re-record after it. The visible consequence of getting it wrong is `showConsentHistory`
// asserting a consent moment that never happened, which is the defect `consentedAt` was
// introduced for (review round 1, F4).
import type { InstalledTheme } from "../../themes/theme-install";

import { beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../settings/store";

function installedTheme(over: Partial<InstalledTheme> = {}): InstalledTheme {
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
      modes: { light: { tokens: "light/tokens.json" } },
      name: "Dracula",
      version: "1.0.0",
    },
    modes: { light: { css: false } },
    ...over,
  };
}

/** What `installTheme` hands back for v2.0.0: every date and version is "now". */
function v2(): InstalledTheme {
  return installedTheme({
    checksum: "d".repeat(64),
    consentedAt: "2026-09-20T00:00:00.000Z",
    consentedVersion: "2.0.0",
    installedAt: "2026-09-20T00:00:00.000Z",
    manifest: { ...installedTheme().manifest, version: "2.0.0" },
  });
}

beforeEach(() => {
  useSettingsStore.setState({ activeThemeId: "system", installedThemes: {} });
});

describe("addInstalledTheme", () => {
  it("takes the record verbatim when the id is new", () => {
    useSettingsStore.getState().addInstalledTheme(installedTheme());
    expect(useSettingsStore.getState().installedThemes.dracula).toEqual(
      installedTheme(),
    );
  });

  it("carries consentedAt and consentedVersion forward over an existing record", () => {
    useSettingsStore.getState().addInstalledTheme(installedTheme());
    useSettingsStore.getState().addInstalledTheme(v2());

    const record = useSettingsStore.getState().installedThemes.dracula;
    expect(record.consentedAt).toBe("2026-09-01T00:00:00.000Z");
    expect(record.consentedVersion).toBe("1.0.0");
  });

  it("takes everything else from the new record", () => {
    // The other half, and the one that makes the assertions above mean something: a writer
    // that simply ignored a re-record would also keep the old consent, and would be wrong.
    useSettingsStore.getState().addInstalledTheme(installedTheme());
    useSettingsStore.getState().addInstalledTheme(v2());

    const record = useSettingsStore.getState().installedThemes.dracula;
    expect(record.manifest.version).toBe("2.0.0");
    expect(record.installedAt).toBe("2026-09-20T00:00:00.000Z");
    expect(record.checksum).toBe("d".repeat(64));
  });

  it("stamps fresh consent again after a removal, because that is a new install", () => {
    // Uninstall drops the record, so nothing is carried forward — the user really is
    // agreeing again. Without this case "carry forward" could be read as "never update
    // these fields", which would make a genuine reinstall claim a consent from a theme the
    // user had deliberately removed.
    useSettingsStore.getState().addInstalledTheme(installedTheme());
    useSettingsStore.getState().removeInstalledTheme("dracula");
    useSettingsStore.getState().addInstalledTheme(v2());

    const record = useSettingsStore.getState().installedThemes.dracula;
    expect(record.consentedAt).toBe("2026-09-20T00:00:00.000Z");
    expect(record.consentedVersion).toBe("2.0.0");
  });

  it("leaves other installed themes alone", () => {
    useSettingsStore.getState().addInstalledTheme(installedTheme());
    useSettingsStore
      .getState()
      .addInstalledTheme(installedTheme({ id: "nord" }));
    useSettingsStore.getState().addInstalledTheme(v2());

    expect(
      Object.keys(useSettingsStore.getState().installedThemes).sort(),
    ).toEqual(["dracula", "nord"]);
    expect(
      useSettingsStore.getState().installedThemes.nord.manifest.version,
    ).toBe("1.0.0");
  });
});
