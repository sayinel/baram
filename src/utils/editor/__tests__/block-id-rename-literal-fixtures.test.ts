// issue 620 — the cross-language contract: the backend's link index and
// rewriter (src-tauri/src/index/extractor.rs) and this text path rename the
// same references of the same document. The expectations live in the JSON
// file, not in either implementation; the Rust test reads the same file.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { renameBlockIdInMarkdown } from "../block-id-rename-markdown";

interface Fixtures {
  cases: {
    expected: string;
    markdown: string;
    name: string;
    /** spec 0069 D5 — a case may name its own target, read in place of the top-level one. */
    target?: string;
  }[];
  new: string;
  old: string;
  target: string;
}

const fixtures = JSON.parse(
  readFileSync(
    join(process.cwd(), "src-tauri/src/md/fixtures/literal-regions.json"),
    "utf8",
  ),
) as Fixtures;

describe("the rename fixtures shared with the backend", () => {
  it("names its own target only for a note stored decomposed (NFD)", () => {
    // spec 0069 §7: the input is not NFC. Declared before the cases, so it is
    // asserted first, before the cases that lean on it run.
    // What fails this: an own target written composed, as an editor or a copy
    // could leave it; a fixture with no own target at all, where the loop
    // below would assert nothing (`own.length > 0`).
    const own = fixtures.cases.flatMap((c) =>
      c.target === undefined ? [] : [c.target],
    );
    expect(own.length).toBeGreaterThan(0);
    for (const target of own) expect(target.normalize("NFC")).not.toBe(target);
  });

  it.each(fixtures.cases)("$name", ({ expected, markdown, target }) => {
    expect(
      renameBlockIdInMarkdown(
        markdown,
        target ?? fixtures.target,
        fixtures.old,
        fixtures.new,
      ),
    ).toBe(expected);
  });
});
