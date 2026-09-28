// §361 Task 6 — which registry entry, if any, updates an installed theme.
//
// A pure function with no store behind it, so every case here is the rule itself rather
// than a rendering of it.
import type { RevocationEntry, RevocationList } from "../revocation";
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
    const updates = themeUpdatesFor(
      index(entry()),
      { dracula: at("1.0.0") },
      null,
    );
    expect(updates.dracula?.version).toBe("2.0.0");
  });

  it("offers nothing when the listed version is the installed one", () => {
    const updates = themeUpdatesFor(
      index(entry({ version: "1.0.0" })),
      { dracula: at("1.0.0") },
      null,
    );
    expect(updates).toEqual({});
  });

  it("offers a LOWER version, because a rollback is a real publish", () => {
    // Pins the `!==`. A `>` comparison would look more careful and would strand every user
    // on the exact version a registry is trying to withdraw by republishing under it.
    const updates = themeUpdatesFor(
      index(entry({ version: "0.9.0" })),
      { dracula: at("1.0.0") },
      null,
    );
    expect(updates.dracula?.version).toBe("0.9.0");
  });

  it("ignores an entry with the same id published as a plugin", () => {
    const updates = themeUpdatesFor(
      index(entry({ kind: "plugin" })),
      { dracula: at("1.0.0") },
      null,
    );
    expect(updates).toEqual({});
  });

  it("ignores an entry with no kind at all", () => {
    // The mirror of `checkForUpdates`'s rule: absence means "plugin", so a legacy entry is
    // never offered as a theme update however its id reads. Required rather than defaulted,
    // matching `searchThemeRegistry`.
    const noKind = entry();
    delete noKind.kind;
    expect(
      themeUpdatesFor(index(noKind), { dracula: at("1.0.0") }, null),
    ).toEqual({});
  });

  it("reports each installed theme independently", () => {
    const updates = themeUpdatesFor(
      index(entry(), entry({ id: "nord", name: "Nord", version: "3.1.0" })),
      { dracula: at("2.0.0"), nord: at("3.0.0") },
      null,
    );
    expect(Object.keys(updates)).toEqual(["nord"]);
  });

  it("offers nothing for a theme the registry no longer lists", () => {
    expect(themeUpdatesFor(index(), { dracula: at("1.0.0") }, null)).toEqual(
      {},
    );
  });

  // §371 6a — 파일에서 설치한 테마는 레지스트리의 같은 id 항목과 다른 패키지다. 그 항목을 "업데이트" 로
  // 보이면 누르는 순간 사용자가 고른 파일을 남의 패키지로 덮는다(스펙 0062 D9).
  it("파일에서 설치한 테마는 업데이트로 세지 않는다", () => {
    const updates = themeUpdatesFor(
      index(entry({ id: "my-look", version: "2.0.0" })),
      {
        "my-look": { manifest: { version: "1.0.0" }, origin: "file" },
      },
      null,
    );
    expect(updates).toEqual({});
  });
});

/** A revocation list naming each `(id, severity, versions)` — `reason` is never read here. */
function revoking(
  ...revoked: Pick<RevocationEntry, "id" | "severity" | "versions">[]
): RevocationList {
  return {
    revoked: revoked.map((r) => ({ ...r, reason: "r" })),
    sequence: 1,
    version: 1,
  };
}

// §69 — the theme install gate (`use-theme-actions.ts`'s `refuseIfRevoked`) refuses a revoked
// target of any severity, so an update to one is a badge whose button can only be refused.
describe("themeUpdatesFor and a revoked listed version (§69)", () => {
  it.each(["unlisted", "vulnerable", "malicious"] as const)(
    "does not offer a listed version revoked %s",
    (severity) => {
      const list = revoking({ id: "dracula", severity, versions: "*" });
      expect(
        themeUpdatesFor(index(entry()), { dracula: at("1.0.0") }, list),
      ).toEqual({});
    },
  );

  it("still offers a version the list does not name", () => {
    // Revoked: the version just BELOW the listed one. A rule that ignored the version and
    // skipped any revoked id would drop this update.
    const list = revoking({
      id: "dracula",
      severity: "malicious",
      versions: { lt: "2.0.0" },
    });
    const updates = themeUpdatesFor(
      index(entry()),
      { dracula: at("1.0.0") },
      list,
    );
    expect(updates.dracula?.version).toBe("2.0.0");
  });

  it("is not suppressed by a revocation of the INSTALLED version", () => {
    // The update is the way off a withdrawn copy. A rule keyed on the installed version would
    // hide exactly the update the withdrawal is asking the user to take.
    const list = revoking({
      id: "dracula",
      severity: "vulnerable",
      versions: { eq: "1.0.0" },
    });
    const updates = themeUpdatesFor(
      index(entry()),
      { dracula: at("1.0.0") },
      list,
    );
    expect(updates.dracula?.version).toBe("2.0.0");
  });
});
