// issue 620 — the cross-language contract: the backend's link index and
// rewriter (src-tauri/src/index/extractor.rs) and this text path rename the
// same references of the same document. The expectations live in the JSON
// file, not in either implementation; the Rust test reads the same file.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { renameBlockIdInMarkdown } from "../block-id-rename-markdown";

interface Fixtures {
  cases: { expected: string; markdown: string; name: string }[];
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
  it.each(fixtures.cases)("$name", ({ expected, markdown }) => {
    expect(
      renameBlockIdInMarkdown(
        markdown,
        fixtures.target,
        fixtures.old,
        fixtures.new,
      ),
    ).toBe(expected);
  });
});
