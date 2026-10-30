// §56m The app's front-matter tag readers name the same tags as the backend's.
//
// The cases live in `src-tauri/src/tag/fixtures/frontmatter-tags.json`, which the backend's
// reader test (`tag::frontmatter::tests::the_reader_agrees_with_the_shared_fixture`) reads
// too: front matter, and the names `extract_frontmatter_tags` gives it. Every reader in the app
// that reads front-matter tags must name the same tags from the same front matter — the tag
// bar's pills, the journal search filter, and the journal tag index and the Zettel inbox
// (`extractTagsFromContent`, which lowercases as the backend's index does). Where a case
// carries `frontendTags`, the app reads the text differently on purpose and that is its answer.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseFrontmatterTags } from "../../extensions/nodes/frontmatter-view";
import { extractFrontmatterFields } from "../journal/journal-search";
import { extractTagsFromContent } from "../journal/journal-tags";

interface Case {
  frontendTags?: string[];
  frontendWhy?: string;
  frontmatter: string;
  tags: string[];
  why: string;
}

const { cases } = JSON.parse(
  readFileSync(
    join(process.cwd(), "src-tauri/src/tag/fixtures/frontmatter-tags.json"),
    "utf8",
  ),
) as { cases: Case[] };

const ROWS = cases.map(
  (c) => [c.frontmatter, c.frontendTags ?? c.tags] as const,
);

describe("front-matter tag readers agree with the backend's (§56m)", () => {
  it("has cases to agree on", () => {
    expect(cases.length).toBeGreaterThan(30);
  });

  it.each(ROWS)("the tag bar reads %j", (frontmatter, names) => {
    expect(parseFrontmatterTags(frontmatter)).toEqual([...new Set(names)]);
  });

  it.each(ROWS)("the journal search reads %j", (frontmatter, names) => {
    const content = `---\n${frontmatter}\n---\nbody`;
    expect(extractFrontmatterFields(content).tags).toEqual(names);
  });

  it.each(ROWS)("the journal tag index reads %j", (frontmatter, names) => {
    const content = `---\n${frontmatter}\n---\nbody`;
    const lowered = [...new Set(names.map((n) => n.toLowerCase()))].sort();
    expect(extractTagsFromContent(content)).toEqual(lowered);
  });

  // The fixture holds the intended difference as rows of its own: the test must see them.
  it("reads the cases where the app reads the text differently on purpose", () => {
    expect(cases.some((c) => c.frontendTags && c.frontendWhy)).toBe(true);
  });
});
