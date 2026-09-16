// issue 669 — the Rust link index (`src-tauri/src/md/literal/`) does not
// implement a specification: it re-implements what THIS remark stack reads,
// measured case by case (decision record of issue 620). The measurement holds
// only for the versions it was taken against. Dependabot moves these packages
// on caret ranges, and nothing else would notice a grammar change: the shared
// fixtures (`literal-regions.json`) cover 33 shapes, the Rust unit tests pin
// values that are never re-derived. So this test turns red when the stack
// moves, and the ritual is: re-run the literal corpus against the new stack
// (the probe in the decision record), fix what diverged, then update the
// versions here. Dependabot groups these packages (`remark` in
// .github/dependabot.yml) so they arrive in one PR.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** The grammar the literal analysis was measured against: every installed
 *  remark, micromark, mdast-util and unified package, the transitive parts
 *  included — a whitespace or container rule lives in `micromark-factory-space`
 *  and `micromark-util-character`, not only in the wrappers. */
const MEASURED: Record<string, string> = {
  "mdast-util-find-and-replace": "3.0.2",
  "mdast-util-from-markdown": "2.0.3",
  "mdast-util-frontmatter": "2.0.1",
  "mdast-util-gfm": "3.1.0",
  "mdast-util-gfm-autolink-literal": "2.0.1",
  "mdast-util-gfm-footnote": "2.1.0",
  "mdast-util-gfm-strikethrough": "2.0.0",
  "mdast-util-gfm-table": "2.0.0",
  "mdast-util-gfm-task-list-item": "2.0.0",
  "mdast-util-math": "3.0.0",
  "mdast-util-phrasing": "4.1.0",
  "mdast-util-to-markdown": "2.1.2",
  "mdast-util-to-string": "4.0.0",
  micromark: "4.0.2",
  "micromark-core-commonmark": "2.0.3",
  "micromark-extension-frontmatter": "2.0.0",
  "micromark-extension-gfm": "3.0.0",
  "micromark-extension-gfm-autolink-literal": "2.1.0",
  "micromark-extension-gfm-footnote": "2.1.0",
  "micromark-extension-gfm-strikethrough": "2.1.0",
  "micromark-extension-gfm-table": "2.1.1",
  "micromark-extension-gfm-tagfilter": "2.0.0",
  "micromark-extension-gfm-task-list-item": "2.1.0",
  "micromark-extension-math": "3.1.0",
  "micromark-factory-destination": "2.0.1",
  "micromark-factory-label": "2.0.1",
  "micromark-factory-space": "2.0.1",
  "micromark-factory-title": "2.0.1",
  "micromark-factory-whitespace": "2.0.1",
  "micromark-util-character": "2.1.1",
  "micromark-util-chunked": "2.0.1",
  "micromark-util-classify-character": "2.0.1",
  "micromark-util-combine-extensions": "2.0.1",
  "micromark-util-decode-numeric-character-reference": "2.0.2",
  "micromark-util-decode-string": "2.0.1",
  "micromark-util-encode": "2.0.1",
  "micromark-util-html-tag-name": "2.0.1",
  "micromark-util-normalize-identifier": "2.0.1",
  "micromark-util-resolve-all": "2.0.1",
  "micromark-util-sanitize-uri": "2.0.1",
  "micromark-util-subtokenize": "2.1.0",
  "micromark-util-symbol": "2.0.1",
  "micromark-util-types": "2.0.2",
  "remark-frontmatter": "5.0.0",
  "remark-gfm": "4.0.1",
  "remark-math": "6.0.0",
  "remark-parse": "11.0.0",
  "remark-stringify": "11.0.0",
  unified: "11.0.5",
};

function installedVersion(name: string): string {
  // The packages restrict their `exports`, so `require("x/package.json")`
  // is refused; the file is read from where npm put it.
  const file = path.join(process.cwd(), "node_modules", name, "package.json");
  return (JSON.parse(readFileSync(file, "utf8")) as { version: string })
    .version;
}

describe("the remark stack the literal analysis was measured against (issue 669)", () => {
  it.each(Object.entries(MEASURED))("%s is still at %s", (name, measured) => {
    expect(
      installedVersion(name),
      `${name} moved from ${measured}: re-measure src-tauri/src/md/literal/ against the new stack (issue 669), then update MEASURED`,
    ).toBe(measured);
  });
});
