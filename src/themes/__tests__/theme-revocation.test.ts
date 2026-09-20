// §361 / spec 0049 §9.4 — what a withdrawal entry means for an installed theme.
//
// ‼️ THIS FILE EXISTS FOR THE RESERVED-ID GUARD, which shipped unpinned (0090 re-review,
// R1): removing it left all 37 theme suites green, 356/356, because nothing anywhere called
// `themeRevocationFor` with a reserved id. The severity half is exercised through
// `use-settings-effects-theme-revoked.test.tsx` and the gallery's suite; the guard had no
// caller that could see it.
import type {
  RevocationList,
  RevocationSeverity,
} from "../../plugins/revocation";
import type { InstalledTheme } from "../theme-install";

import { describe, expect, it } from "vitest";

import { BUILT_IN_THEMES, RESERVED_THEME_IDS } from "../../types/theme";
import { themeBlocksApply, themeRevocationFor } from "../theme-revocation";

function installedTheme(id: string, version = "1.0.0"): InstalledTheme {
  return {
    checksum: "c".repeat(64),
    consentedAt: "2026-09-01T00:00:00.000Z",
    consentedVersion: version,
    id,
    installedAt: "2026-09-01T00:00:00.000Z",
    installPath: `/home/u/.baram/themes/${id}`,
    manifest: {
      author: "a",
      description: "d",
      engines: { baram: ">=0.7.0" },
      id,
      license: "MIT",
      modes: { light: { tokens: "t.json" } },
      name: id,
      version,
    },
    modes: { light: { css: false } },
  };
}

function withdrawal(
  id: string,
  severity: RevocationSeverity = "malicious",
): RevocationList {
  return {
    revoked: [{ id, reason: "compromised build", severity, versions: "*" }],
    sequence: 1,
    version: 1,
  };
}

describe("themeRevocationFor", () => {
  it("answers for an ordinary installed theme", () => {
    // The anchor. Every "returns null" below is only meaningful against a function that
    // does answer when it should.
    const found = themeRevocationFor(
      "dracula",
      { dracula: installedTheme("dracula") },
      withdrawal("dracula"),
    );
    expect(found?.severity).toBe("malicious");
  });

  it("returns null for a theme that is not installed", () => {
    expect(themeRevocationFor("dracula", {}, withdrawal("dracula"))).toBeNull();
  });

  it("returns null when the withdrawal names a version range this copy is outside", () => {
    const found = themeRevocationFor(
      "dracula",
      { dracula: installedTheme("dracula", "2.0.0") },
      {
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
    );
    expect(found).toBeNull();
  });
});

describe("a reserved id speaks for nobody (M2's third surface)", () => {
  // Every reserved id, not a sample: the set is derived from `BUILT_IN_THEMES`, so a ninth
  // shipped theme joins this loop by shipping rather than by someone remembering.
  const RESERVED = [...RESERVED_THEME_IDS];

  it("covers every id the set holds, and the set holds every built-in plus system", () => {
    // Non-vacuity for the loop below: if `RESERVED_THEME_IDS` were ever emptied, `it.each`
    // over it would silently run zero cases and this file would go green having tested
    // nothing.
    expect(RESERVED.length).toBe(BUILT_IN_THEMES.length + 1);
    expect(RESERVED).toContain("system");
    for (const theme of BUILT_IN_THEMES) expect(RESERVED).toContain(theme.id);
  });

  it.each(RESERVED)(
    "returns null for %s even with a record AND a matching withdrawal",
    (id) => {
      // ‼️ BOTH halves are present, which is what makes this the guard's test rather than a
      // restatement of "not installed": there IS an installed record under this id and the
      // withdrawal DOES name it. Without the guard this returns the entry, and
      // `use-settings-effects.ts` then force-deactivates the BUILT-IN theme of that id —
      // whose files are in the binary and which no registry entry describes.
      expect(
        themeRevocationFor(id, { [id]: installedTheme(id) }, withdrawal(id)),
      ).toBeNull();
    },
  );

  it("still answers for an id that merely resembles a reserved one", () => {
    // The membership is exact, not a prefix or a fuzzy match: `nord-extra` is an ordinary
    // community id and must keep its withdrawal.
    const found = themeRevocationFor(
      "nord-extra",
      { "nord-extra": installedTheme("nord-extra") },
      withdrawal("nord-extra"),
    );
    expect(found?.severity).toBe("malicious");
  });
});

describe("themeBlocksApply mirrors blocksLoad", () => {
  it.each([
    ["malicious", true],
    ["unlisted", false],
    ["vulnerable", false],
  ] as const)("%s → %s", (severity, blocks) => {
    // Spec §9.4 reads unqualified over "revoked"; the threshold is `blocksLoad`'s, so a
    // theme merely unlisted is not yanked out from under the user. Exercised here on the
    // function directly as well as through the effect, because this is the decision and
    // that is one of its consumers.
    const entry = themeRevocationFor(
      "dracula",
      { dracula: installedTheme("dracula") },
      withdrawal("dracula", severity),
    );
    expect(themeBlocksApply(entry)).toBe(blocks);
  });

  it("is false for no withdrawal at all", () => {
    expect(themeBlocksApply(null)).toBe(false);
  });
});
