import type { RevocationEntry, RevocationList } from "../revocation";

// §69 revocation lookup — which entry governs, and what it is allowed to do.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  blocksLoad,
  EMPTY_REVOCATIONS,
  normalizeRevocationList,
  revocationFor,
} from "../revocation";

function entry(over: Partial<RevocationEntry> = {}): RevocationEntry {
  return {
    id: "some-plugin",
    reason: "because",
    severity: "malicious",
    versions: "*",
    ...over,
  };
}

function list(...revoked: RevocationEntry[]): RevocationList {
  return { revoked, version: 1 };
}

describe("revocationFor", () => {
  it("returns null when nothing is revoked", () => {
    expect(revocationFor("some-plugin", "1.0.0", EMPTY_REVOCATIONS)).toBeNull();
    expect(revocationFor("some-plugin", "1.0.0", null)).toBeNull();
  });

  it("matches on id and version together, not either alone", () => {
    const l = list(entry({ versions: { gte: "2.0.0", lt: "2.0.4" } }));
    expect(revocationFor("some-plugin", "2.0.1", l)).not.toBeNull();
    // right id, version outside the window
    expect(revocationFor("some-plugin", "2.0.4", l)).toBeNull();
    // right version, different plugin
    expect(revocationFor("other-plugin", "2.0.1", l)).toBeNull();
  });

  it("lets the most severe matching entry govern, whatever the order", () => {
    // The case this exists for: a plugin listed once for hygiene and again for a
    // dangerous version range. Taking the first match would let the bookkeeping entry
    // hide the malware, and the order in a hand-edited file is arbitrary.
    const hygiene = entry({
      severity: "unlisted",
      reason: "author went quiet",
    });
    const danger = entry({
      reason: "exfiltrates the vault",
      severity: "malicious",
    });
    expect(
      revocationFor("some-plugin", "1.0.0", list(hygiene, danger))?.severity,
    ).toBe("malicious");
    expect(
      revocationFor("some-plugin", "1.0.0", list(danger, hygiene))?.severity,
    ).toBe("malicious");
  });

  it("ranks vulnerable above unlisted and below malicious", () => {
    const unlisted = entry({ severity: "unlisted" });
    const vulnerable = entry({ severity: "vulnerable" });
    const malicious = entry({ severity: "malicious" });
    expect(
      revocationFor("some-plugin", "1.0.0", list(unlisted, vulnerable))
        ?.severity,
    ).toBe("vulnerable");
    expect(
      revocationFor("some-plugin", "1.0.0", list(vulnerable, malicious))
        ?.severity,
    ).toBe("malicious");
  });

  it("only lets a malicious entry stop a load", () => {
    // `unlisted` is most of a real removal list. Blocking on it would take a working
    // feature away from a user for a bookkeeping reason.
    expect(blocksLoad(entry({ severity: "malicious" }))).toBe(true);
    expect(blocksLoad(entry({ severity: "vulnerable" }))).toBe(false);
    expect(blocksLoad(entry({ severity: "unlisted" }))).toBe(false);
    expect(blocksLoad(null)).toBe(false);
  });
});

describe("normalizeRevocationList", () => {
  it("keeps every well-formed shape the format allows", () => {
    // Deliberately covers all three severities and both range forms. The seed guard
    // below runs over the REAL file, which is empty and must stay empty — nothing is
    // revoked — so it can prove the document parses but not that entry validation
    // still works. This is where that is proven.
    const raw = {
      revoked: [
        { id: "a", reason: "r", severity: "malicious", versions: "*" },
        {
          id: "b",
          reason: "r",
          severity: "vulnerable",
          versions: { gte: "1.0.0" },
        },
        {
          id: "c",
          reason: "r",
          reasonKey: "plugin.revoked.reason",
          severity: "unlisted",
          since: "2026-08-01",
          versions: { eq: "1.2.3" },
        },
        {
          id: "d",
          reason: "r",
          severity: "malicious",
          versions: { gt: "1.0.0", lte: "2.0.0" },
        },
      ],
    };
    const kept = normalizeRevocationList(raw)?.revoked ?? [];
    expect(kept.map((e) => e.id)).toEqual(["a", "b", "c", "d"]);
    expect(kept.map((e) => e.severity).sort()).toEqual([
      "malicious",
      "malicious",
      "unlisted",
      "vulnerable",
    ]);
  });

  it("drops a malformed entry without taking the list down with it", () => {
    // Direction matters. A list that threw would break plugin loading outright; a list
    // that parsed to nothing would silently disable revocation. Neither is acceptable
    // for one bad line in a hand-edited file.
    const raw = {
      revoked: [
        { id: "good", reason: "r", severity: "malicious", versions: "*" },
        { id: "", reason: "r", severity: "malicious", versions: "*" }, // empty id
        { id: "no-severity", reason: "r", versions: "*" },
        { id: "bad-severity", reason: "r", severity: "spicy", versions: "*" },
        { id: "bad-range", reason: "r", severity: "malicious", versions: 42 },
        { id: "array-range", reason: "r", severity: "malicious", versions: [] },
        {
          id: "unknown-bound",
          reason: "r",
          severity: "malicious",
          versions: { approx: "1.0.0" },
        },
        { reason: "r", severity: "malicious", versions: "*" }, // no id
        "not-an-object",
        null,
      ],
    };
    const kept = normalizeRevocationList(raw)?.revoked ?? [];
    expect(kept.map((e) => e.id)).toEqual(["good"]);
  });

  it("returns null for a document it cannot read, so the caller keeps what it had", () => {
    // Distinct from an entry being dropped. An unreadable document — a botched deploy,
    // a host serving nonsense — must not replace real revocations with none.
    for (const raw of [
      null,
      undefined,
      42,
      "text",
      {},
      { revoked: "nope" },
      [],
    ]) {
      expect(normalizeRevocationList(raw), JSON.stringify(raw)).toBeNull();
    }
  });

  it("accepts a well-formed empty list, so a revocation can be withdrawn", () => {
    // The other side of the rule above: if empty were also null, a false positive
    // could never be undone on machines that already stored it.
    expect(normalizeRevocationList({ revoked: [] })).toEqual({
      revoked: [],
      version: 1,
    });
  });

  it("does not let a dropped entry become a match", () => {
    // The whole point of dropping: a bad entry must not revoke anything.
    const raw = {
      revoked: [{ id: "x", reason: "r", severity: "spicy", versions: "*" }],
    };
    expect(
      revocationFor("x", "1.0.0", normalizeRevocationList(raw)),
    ).toBeNull();
  });
});

describe("the committed revocation seed", () => {
  // The registry file is hand-edited while acting on a malware report — the worst
  // possible moment to discover a typo. This runs the SHIPPED validator over the
  // SHIPPED seed, so a document the app would refuse to read cannot be committed.
  const raw: unknown = JSON.parse(
    readFileSync(resolve(__dirname, "../../../registry/revoked.json"), "utf8"),
  );

  it("is a document the app can read", () => {
    // Null here means the app would keep its stored list and ignore this file
    // entirely — the failure mode that looks like nothing happening.
    expect(normalizeRevocationList(raw)).not.toBeNull();
  });

  it("loses no entry to the entry-level validator", () => {
    // The document parsing and every entry surviving are different claims. An entry
    // dropped for a bad `severity` or range would leave a plugin unrevoked while the
    // file on disk says otherwise, and nothing else would report it.
    //
    // ‼️ Vacuous while the seed is empty, which it should be — nothing is revoked. The
    // entry validator is exercised by "keeps every well-formed shape" above, and by
    // `scripts/validate-revocations.ts`, which the publish workflow runs and which
    // FAILS on a dropped entry rather than shrugging the way the app does.
    const declared = (raw as { revoked: unknown[] }).revoked.length;
    expect(normalizeRevocationList(raw)?.revoked).toHaveLength(declared);
  });
});
