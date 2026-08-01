// The comparison a revocation decision rests on (§69).
//
// This is hand-written rather than delegated to a library, so it is tested against the
// semver 2.0.0 spec's OWN ordering example rather than against cases chosen to suit the
// implementation. Every neighbouring pair in that chain exercises a different rule.
import { describe, expect, it } from "vitest";

import { compareVersions, matchesRange } from "../version-range";

/** The precedence chain published in the semver 2.0.0 spec, section 11. */
const SPEC_ORDER = [
  "1.0.0-alpha",
  "1.0.0-alpha.1",
  "1.0.0-alpha.beta",
  "1.0.0-beta",
  "1.0.0-beta.2",
  "1.0.0-beta.11",
  "1.0.0-rc.1",
  "1.0.0",
];

describe("compareVersions", () => {
  it("orders the spec's own example chain, pair by pair", () => {
    const misordered: string[] = [];
    for (let i = 0; i < SPEC_ORDER.length - 1; i++) {
      const [lower, higher] = [SPEC_ORDER[i], SPEC_ORDER[i + 1]];
      const cmp = compareVersions(lower, higher);
      if (cmp === null || cmp >= 0) misordered.push(`${lower} !< ${higher}`);
    }
    expect(misordered).toEqual([]);
  });

  it("orders the chain transitively, not just between neighbours", () => {
    // Neighbour-only checking passes for an implementation that is locally right and
    // globally inconsistent, which is exactly what a hand-rolled comparator risks.
    const wrong: string[] = [];
    for (let i = 0; i < SPEC_ORDER.length; i++) {
      for (let j = i + 1; j < SPEC_ORDER.length; j++) {
        const cmp = compareVersions(SPEC_ORDER[i], SPEC_ORDER[j]);
        if (cmp === null || cmp >= 0)
          wrong.push(`${SPEC_ORDER[i]} !< ${SPEC_ORDER[j]}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("compares numerically, not as strings", () => {
    // The single most likely bug, and string comparison gets it backwards.
    expect(compareVersions("2.0.10", "2.0.9")).toBeGreaterThan(0);
    expect(compareVersions("2.10.0", "2.9.0")).toBeGreaterThan(0);
    expect(compareVersions("10.0.0", "9.0.0")).toBeGreaterThan(0);
  });

  it("treats equal versions as equal, and is antisymmetric", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.3-beta.1", "1.2.3-beta.1")).toBe(0);
    for (const [a, b] of [
      ["1.2.3", "1.2.4"],
      ["1.0.0-alpha", "1.0.0"],
    ]) {
      const forward = compareVersions(a, b);
      const backward = compareVersions(b, a);
      expect(Math.sign(forward ?? 0)).toBe(-Math.sign(backward ?? 0));
    }
  });

  it("ignores build metadata, as the spec requires", () => {
    expect(compareVersions("1.2.3+build.1", "1.2.3+build.2")).toBe(0);
    expect(compareVersions("1.2.3+build", "1.2.3")).toBe(0);
  });

  it("returns null for anything it cannot compare", () => {
    for (const bad of ["", "1.2", "v1.2.3", "1.2.3.4", "latest", "1.x.0"]) {
      expect(compareVersions(bad, "1.2.3"), bad).toBeNull();
      expect(compareVersions("1.2.3", bad), bad).toBeNull();
    }
  });
});

describe("matchesRange", () => {
  it('matches every version for "*"', () => {
    for (const v of ["0.0.1", "1.2.3", "99.0.0-rc.1"]) {
      expect(matchesRange(v, "*"), v).toBe(true);
    }
  });

  it("ANDs the bounds it is given", () => {
    const range = { gte: "2.0.0", lt: "2.0.4" };
    expect(matchesRange("2.0.0", range)).toBe(true);
    expect(matchesRange("2.0.3", range)).toBe(true);
    expect(matchesRange("2.0.4", range)).toBe(false);
    expect(matchesRange("1.9.9", range)).toBe(false);
  });

  it("handles each bound on its own", () => {
    expect(matchesRange("1.2.3", { eq: "1.2.3" })).toBe(true);
    expect(matchesRange("1.2.4", { eq: "1.2.3" })).toBe(false);
    expect(matchesRange("1.2.4", { gt: "1.2.3" })).toBe(true);
    expect(matchesRange("1.2.3", { gt: "1.2.3" })).toBe(false);
    expect(matchesRange("1.2.3", { lte: "1.2.3" })).toBe(true);
    expect(matchesRange("1.2.4", { lte: "1.2.3" })).toBe(false);
  });

  it("does NOT treat a bound-less object as everything", () => {
    // The failure this prevents: one malformed entry in a hand-edited revocation file
    // blocking every installed plugin. `"*"` is how you say everything, explicitly.
    expect(matchesRange("1.2.3", {})).toBe(false);
  });

  it("matches nothing when the version or a bound is unparseable", () => {
    // Same direction, same reason: a bad entry is ignored rather than catching
    // everything. The registry CI is what stops a bad entry from shipping.
    expect(matchesRange("not-a-version", "*")).toBe(true); // "*" needs no parse
    expect(matchesRange("not-a-version", { gte: "1.0.0" })).toBe(false);
    expect(matchesRange("1.2.3", { gte: "garbage" })).toBe(false);
    expect(matchesRange("1.2.3", { gte: "1.0.0", lt: "garbage" })).toBe(false);
  });

  it("includes prereleases below the release when the range says so", () => {
    // A revoked 2.0.0 should also catch 2.0.0-rc.1, which is a DIFFERENT version and
    // ranks lower — so a `lt: "2.0.4"` window has to reach it.
    expect(matchesRange("2.0.0-rc.1", { gte: "2.0.0-rc.1", lt: "2.0.4" })).toBe(
      true,
    );
    expect(matchesRange("2.0.0-rc.1", { gte: "2.0.0", lt: "2.0.4" })).toBe(
      false,
    );
  });
});
