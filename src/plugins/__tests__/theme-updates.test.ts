// §361 Task 6 — which registry entry, if any, updates an installed theme.
//
// A pure function with no store behind it, so every case here is the rule itself rather
// than a rendering of it.
import type { RegistryEntry, RegistryIndex } from "../types";

import { describe, expect, it } from "vitest";

import { themeUpdatesFor } from "../registry-client";

function entry(over: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    author: "a",
    capabilities: [],
    checksum: "c".repeat(64),
    description: "d",
    downloadUrl: "https://reg.test/t.zip",
    engines: { baram: ">=0.7.0" },
    id: "dracula",
    kind: "theme",
    license: "MIT",
    name: "Dracula",
    version: "2.0.0",
    ...over,
  };
}

function index(...entries: RegistryEntry[]): RegistryIndex {
  return { plugins: entries, updatedAt: "2026-09-20" };
}

/** Only the field `themeUpdatesFor` reads — the signature asks for exactly this much, so a
 *  test does not have to build a whole `InstalledTheme` to exercise it. */
const at = (version: string) => ({ manifest: { version } });

describe("themeUpdatesFor", () => {
  it("offers the entry when the registry lists a different version", () => {
    const updates = themeUpdatesFor(index(entry()), { dracula: at("1.0.0") });
    expect(updates.dracula?.version).toBe("2.0.0");
  });

  it("offers nothing when the listed version is the installed one", () => {
    const updates = themeUpdatesFor(index(entry({ version: "1.0.0" })), {
      dracula: at("1.0.0"),
    });
    expect(updates).toEqual({});
  });

  it("offers a LOWER version, because a rollback is a real publish", () => {
    // Pins the `!==`. A `>` comparison would look more careful and would strand every user
    // on the exact version a registry is trying to withdraw by republishing under it.
    const updates = themeUpdatesFor(index(entry({ version: "0.9.0" })), {
      dracula: at("1.0.0"),
    });
    expect(updates.dracula?.version).toBe("0.9.0");
  });

  it("ignores an entry with the same id published as a plugin", () => {
    const updates = themeUpdatesFor(index(entry({ kind: "plugin" })), {
      dracula: at("1.0.0"),
    });
    expect(updates).toEqual({});
  });

  it("ignores an entry with no kind at all", () => {
    // The mirror of `checkForUpdates`'s rule: absence means "plugin", so a legacy entry is
    // never offered as a theme update however its id reads. Required rather than defaulted,
    // matching `searchThemeRegistry`.
    const noKind = entry();
    delete noKind.kind;
    expect(themeUpdatesFor(index(noKind), { dracula: at("1.0.0") })).toEqual(
      {},
    );
  });

  it("reports each installed theme independently", () => {
    const updates = themeUpdatesFor(
      index(entry(), entry({ id: "nord", name: "Nord", version: "3.1.0" })),
      { dracula: at("2.0.0"), nord: at("3.0.0") },
    );
    expect(Object.keys(updates)).toEqual(["nord"]);
  });

  it("offers nothing for a theme the registry no longer lists", () => {
    expect(themeUpdatesFor(index(), { dracula: at("1.0.0") })).toEqual({});
  });
});
