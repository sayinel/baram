// issue 669 — the other half of the parity corpus. The Rust link index
// (`src-tauri/src/md/literal/`) re-implements what THIS stack reads, measured
// rule by rule (issue 620). The Rust reader of this fixture asserts the
// emulation still matches what was measured; this one asserts that what was
// measured is still what the parser does.
//
// That is the drift detector the version sentinel cannot be. The sentinel
// (`literal-measured-stack.test.ts`) fires on any dependency movement,
// including the many that change no grammar; this fires only when a document
// in the corpus is read differently — and it names the document.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  LITERAL_TYPES,
  referenceIsEditable,
} from "../block-id-rename-markdown";

interface Fixture {
  cases: {
    bytes: number;
    editable: boolean[];
    markdown: string;
    ordinal: number;
    sha256: string;
    test: string;
    why: string[];
  }[];
  contract: string;
  literalNodeTypes: string[];
}

/** The marker and its grammar, as the contract states it: one line. */
const MARKER = /\(\(n#\^o(?:\|[^)\n\r]+)?\)\)/g;

const fixture = JSON.parse(
  readFileSync(
    join(process.cwd(), "src-tauri/src/md/fixtures/literal-parity.json"),
    "utf8",
  ),
) as Fixture;

describe("the literal parity corpus (issue 669)", () => {
  // A fixture that lost its cases would be a green run of zero assertions.
  it("holds the corpus it was generated from", () => {
    expect(fixture.cases.length).toBeGreaterThan(200);
    expect(
      fixture.cases.reduce((n, c) => n + c.editable.length, 0),
    ).toBeGreaterThan(400);
  });

  // The oracle classified by this set. If production's set moves, the numbers
  // in the fixture were measured under a policy that no longer applies, and
  // regenerating is the only honest answer.
  it("was generated under the literal node types production still uses", () => {
    expect(fixture.literalNodeTypes).toEqual([...LITERAL_TYPES].sort());
  });

  it.each(fixture.cases)("$test#$ordinal", ({ editable, markdown, why }) => {
    const occurrences = [...markdown.matchAll(MARKER)];
    expect(occurrences.length).toBe(editable.length);
    expect(
      occurrences.map((m) =>
        referenceIsEditable(markdown, m.index, m.index + m[0].length),
      ),
      `${JSON.stringify(markdown)}\n  measured as ${JSON.stringify(why)}`,
    ).toEqual(editable);
  });
});
