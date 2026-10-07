// §390 spec 0069 D2 · D5 — foldName folds as the backend's `fold_name` does.
// The expectations live in src-tauri/src/md/fixtures/name-fold.json, which the
// Rust test in `index::normalizer` reads too; neither implementation holds them.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { foldName } from "../name-fold";

interface FoldCase {
  checks: string[];
  folded: string;
  input: string;
  why: string;
}

const fixture = JSON.parse(
  readFileSync(
    join(process.cwd(), "src-tauri/src/md/fixtures/name-fold.json"),
    "utf8",
  ),
) as { cases: FoldCase[] };

describe("foldName and the fixture the backend reads", () => {
  // What fails this: lowercasing alone — the `input-not-nfc` cases keep their
  // decomposed letters; dropping the last NFC — the `final-nfc` cases stay
  // apart (`j` + caron is not U+01F0).
  it.each(fixture.cases)("$why", ({ checks, folded, input, why }) => {
    expect(foldName(input), why).toBe(folded);
    for (const check of checks) {
      if (check === "input-not-nfc") {
        expect(input.normalize("NFC"), why).not.toBe(input);
        expect(input.toLowerCase(), why).not.toBe(folded);
      } else if (check === "final-nfc") {
        expect(input.normalize("NFC").toLowerCase(), why).not.toBe(folded);
      } else {
        throw new Error(`unknown check ${check}: ${why}`);
      }
    }
  });

  it("still carries every kind of check", () => {
    // What fails this: a fixture edit that drops the last case of a kind —
    // the per-case checks above would then pass with nothing left to catch.
    expect([...new Set(fixture.cases.flatMap((c) => c.checks))].sort()).toEqual(
      ["final-nfc", "input-not-nfc"],
    );
  });
});
