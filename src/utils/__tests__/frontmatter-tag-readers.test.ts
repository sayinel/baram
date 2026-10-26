// §56m The app's front-matter tag readers name the same tags as the backend's.
//
// The cases live in `fixtures/frontmatter-tags.json` — front matter and the names the backend's
// front-matter tag reader (`extract_frontmatter_tags`) gives it. Every reader in the app that
// reads front-matter tags must name the same tags from the same front matter: the tag bar's
// pills, the journal search filter, and the journal tag index and the Zettel inbox
// (`extractTagsFromContent`, which lowercases as the backend's index does).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseFrontmatterTags } from "../../extensions/nodes/frontmatter-view";
import { extractFrontmatterFields } from "../journal/journal-search";
import { extractTagsFromContent } from "../journal/journal-tags";
import { frontmatterListItems } from "../markdown/frontmatter-list";
import { tagName } from "../tags/tag-name";

interface Case {
  frontmatter: string;
  names: string[];
  why: string;
}

const { cases } = JSON.parse(
  readFileSync(
    join(process.cwd(), "src/utils/__tests__/fixtures/frontmatter-tags.json"),
    "utf8",
  ),
) as { cases: Case[] };

const ROWS = cases.map((c) => [c.frontmatter, c.names] as const);

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

  // The one reading that differs on purpose: a comma inside a quoted inline item does not
  // split it here (the backend reads `a` and `b`), so a rewrite keeps the item whole.
  it("keeps a quoted inline item whole at its comma", () => {
    const names = (fm: string) =>
      frontmatterListItems(fm, "tags").map((i) => tagName(i.value));
    expect(names(`tags: ["a, b", c]`)).toEqual(["a, b", "c"]);
    expect(names(`tags: ['a, b']`)).toEqual(["a, b"]);
  });
});
