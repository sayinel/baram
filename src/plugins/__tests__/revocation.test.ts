import type { RevocationEntry, RevocationList } from "../revocation";

// §69 revocation lookup — which entry governs, and what it is allowed to do.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  blocksLoad,
  EMPTY_REVOCATIONS,
  meetsRevocationFloor,
  MINIMUM_REVOCATION_SEQUENCE,
  normalizeRevocationList,
  revocationFloorFor,
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
  return { revoked, sequence: 1, version: 1 };
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

describe("meetsRevocationFloor", () => {
  const at = (sequence: number): RevocationList => ({
    revoked: [],
    sequence,
    version: 1,
  });

  it("accepts a newer publish and refuses an older one", () => {
    expect(meetsRevocationFloor(at(2), 1)).toBe(true);
    expect(meetsRevocationFloor(at(1), 2)).toBe(false);
  });

  it("accepts an EQUAL counter, because that is every ordinary refresh", () => {
    // ‼️ Refusing equal would break the common case — the list usually has not changed
    // between refreshes — and it buys nothing: with a signature in force the same counter
    // cannot carry different content.
    expect(meetsRevocationFloor(at(3), 3)).toBe(true);
  });

  it("REFUSES a counter-less list now that the floor is armed", () => {
    // ‼️ THE BEHAVIOUR CHANGE ARMING BUYS, and this assertion was the opposite until the floor
    // was raised: with `MINIMUM_REVOCATION_SEQUENCE` at 0, a list reading as sequence 0 was
    // accepted on a fresh install. 0 is what every PRE-SIGNATURE list reads as (they have no
    // `sequence` field at all), so accepting it meant a replay of the unsigned era landed on
    // exactly the client with no other protection. At 1 — the counter actually live — it cannot.
    expect(meetsRevocationFloor(at(0))).toBe(false);
    expect(meetsRevocationFloor(at(MINIMUM_REVOCATION_SEQUENCE))).toBe(true);
    expect(meetsRevocationFloor(at(5))).toBe(true);
  });

  it("refuses a list below the compiled floor even with nothing stored", () => {
    // ‼️ THE FRESH-INSTALL HOLE. Monotonicity needs something to compare against, and a
    // first run has nothing — which is exactly when the user has no other protection. The
    // floor is that starting point. Still passed explicitly here, so this stays a test of the
    // comparison itself and does not move when the shipped constant is next raised.
    expect(meetsRevocationFloor(at(4), 5)).toBe(false);
    expect(meetsRevocationFloor(at(5), 5)).toBe(true);
    // ‼️ A third assertion used to sit here, identical to the first, with a comment claiming it
    // tested something else ("the floor outranks a stored list too") — code review LOW-4. That
    // claim is about `revocationFloorFor`, which now has its own tests; a duplicate here read
    // as coverage that did not exist.
  });
});

describe("revocationFloorFor", () => {
  const URL = "https://sayinel.github.io/baram-plugins/index.json";

  it("applies the build's floor when this registry has no mark yet", () => {
    // ‼️ Exercised at a floor of 5, not the shipped 0 (code review HIGH-1). Deleting
    // `MINIMUM_REVOCATION_SEQUENCE` from this expression left 54/54 green, because every
    // existing test either passed the floor explicitly or ran at 0, where "uses the constant"
    // and "uses nothing" are the same number. A fresh install is exactly the client with no
    // mark and no other protection.
    expect(revocationFloorFor({}, URL, 5)).toBe(5);
  });

  it("keeps the build's floor when the mark is BELOW it", () => {
    // The direction that loses protection: a client that somehow saw an older counter than its
    // own build knows about must not be pulled back down to it.
    expect(revocationFloorFor({ [URL]: 3 }, URL, 5)).toBe(5);
  });

  it("lets the mark win when it is above the floor", () => {
    expect(revocationFloorFor({ [URL]: 7 }, URL, 5)).toBe(7);
  });

  it("is per registry, so another registry's mark does not apply", () => {
    expect(
      revocationFloorFor({ "https://other.test/index.json": 9 }, URL, 5),
    ).toBe(5);
  });

  it("defaults to the floor this build compiled in", () => {
    // ‼️ VACUOUS TODAY and kept deliberately: `MINIMUM_REVOCATION_SEQUENCE` is 0, so this
    // cannot tell the default apart from a hardcoded 0. It becomes a real assertion in the
    // commit that raises the constant — which is the same commit that arms verification, and
    // the one with the most reason to believe the floor is applied.
    expect(revocationFloorFor({}, URL)).toBe(MINIMUM_REVOCATION_SEQUENCE);
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
      sequence: 0,
      version: 1,
    });
  });

  it("reads an absent or malformed sequence as 0, the weakest value there is", () => {
    // ‼️ Absent must stay READABLE, because the list live right now has no `sequence`:
    // rejecting it would make every client keep its stored copy and give a fresh install
    // nothing at all. And malformed must land on 0 rather than being coerced — `Number("999")`
    // would hand an attacker the highest counter they can type, when what they should get is
    // the one value that can never win a comparison.
    // ‼️ 1e7 and MAX_SAFE_INTEGER are the UPPER bound (code review CRITICAL-1 / MEDIUM-2).
    // The original loop had no unsafe integer in it, so `isSafeInteger` was unpinned — and
    // `Number.isInteger(1e308)` is true, which is exactly the half that bounds the poison.
    for (const bad of [
      "999",
      -1,
      1.5,
      Number.NaN,
      Infinity,
      null,
      {},
      true,
      1e7,
      1e21,
      Number.MAX_SAFE_INTEGER,
      Number.MAX_VALUE,
    ]) {
      expect(
        normalizeRevocationList({ revoked: [], sequence: bad })?.sequence,
        `sequence: ${JSON.stringify(bad)}`,
      ).toBe(0);
    }
    expect(
      normalizeRevocationList({ revoked: [], sequence: 7 })?.sequence,
    ).toBe(7);
  });

  it("does not let a dropped entry become a match — sequence edition", () => {
    // A dropped ENTRY must not take the counter with it: the rest of the list still stands,
    // so it still has to be able to supersede.
    const raw = {
      revoked: [{ id: "x", reason: "r", severity: "spicy", versions: "*" }],
      sequence: 9,
    };
    expect(normalizeRevocationList(raw)?.sequence).toBe(9);
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
    const declared = (raw as { revoked: unknown[] }).revoked.length;
    expect(declared).toBeGreaterThan(0);
    expect(normalizeRevocationList(raw)?.revoked).toHaveLength(declared);
  });

  it("covers the baram-ai-summary version that was actually published", () => {
    // A range matching nothing is how a revocation deploys cleanly and covers no one.
    // `scripts/validate-revocations.ts` only WARNS about that, so the seed's own bounds
    // are pinned here. 1.0.0 is the only version that ever reached the registry.
    expect(
      revocationFor("baram-ai-summary", "1.0.0", normalizeRevocationList(raw))
        ?.severity,
    ).toBe("unlisted");
  });

  it("covers a republished 1.x of baram-ai-summary, not just the exact version", () => {
    // ‼️ The reason the bound is `lt: 2.0.0` rather than `lte: 1.0.0`, which was the
    // first version of this entry. The withdrawal is a decision about the TRUSTED tier,
    // and the cheapest way to undo it by accident is a 1.0.1 that adds the `trust` field
    // the published manifest lacks — a version-level bound at 1.0.0 waves that straight
    // through, which is the opposite of what the entry says it means.
    expect(
      revocationFor("baram-ai-summary", "1.0.1", normalizeRevocationList(raw))
        ?.severity,
    ).toBe("unlisted");
  });

  it("carries a counter the app can actually read", () => {
    // ‼️ Asserted against the RAW value, because a parsed-to-parsed comparison can never
    // fail: `readSequence` turns anything malformed into 0, so a `"1"` written here would be
    // indistinguishable from no counter at all — in the app, and in the publish gate that
    // now reads the file through the same reader. The seed's counter is the single number
    // this list's rollback defence rests on.
    const rawSequence = (raw as { sequence?: unknown }).sequence;
    expect(rawSequence).toBe(normalizeRevocationList(raw)?.sequence);
    expect(rawSequence).toBeGreaterThan(0);
  });

  it("is at or above the floor this build refuses to go below", () => {
    // ‼️ Raising MINIMUM_REVOCATION_SEQUENCE above the counter that is actually live makes
    // every client refuse the REAL list — the arming step's one irreversible mistake, and it
    // presents as the feature working. The seed is what goes live, so the constant and this
    // file have to move together, and this is what says so.
    expect(normalizeRevocationList(raw)?.sequence).toBeGreaterThanOrEqual(
      MINIMUM_REVOCATION_SEQUENCE,
    );
  });

  it("leaves a future sandboxed port of baram-ai-summary unrevoked", () => {
    // The other half: porting to the sandboxed tier is the intended way out, and the
    // port is a major bump because the tier changed (the same rule baram-word-count
    // 2.0.0 followed). A `"*"` here would mean the port is born revoked — `unlisted`
    // blocks INSTALL for any severity, so it would reach the index and then refuse to
    // install, citing a withdrawal that no longer applies.
    expect(
      revocationFor("baram-ai-summary", "2.0.0", normalizeRevocationList(raw)),
    ).toBeNull();
  });
});
