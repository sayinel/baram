// §56m The app's front-matter tag readers name the same tags as the backend's.
//
// Each row is front matter and the names the backend's front-matter tag reader
// (`extract_frontmatter_tags`, §56m) gives it; most rows are that reader's own test inputs.
// Every reader in the app that reads front-matter tags must name the same tags from the same
// front matter — the tag bar's pills, the journal tag index and the Zettel inbox
// (`extractTagsFromContent`, which lowercases as the backend's index does), and the journal
// search filter. A row changed here changes there too.
import { describe, expect, it } from "vitest";

import { parseFrontmatterTags } from "../../extensions/nodes/frontmatter-view";
import { extractFrontmatterFields } from "../journal/journal-search";
import { extractTagsFromContent } from "../journal/journal-tags";

const ROWS: [frontmatter: string, names: string[]][] = [
  [`tags: ["#solo"]`, ["solo"]],
  [`tags: ["#Solo"]`, ["Solo"]],
  [`tags: ['#sq']`, ["sq"]],
  [`tags:\n  - "#blockq"\n  - '#blockq2'`, ["blockq", "blockq2"]],
  [`tags: ["#a/b"]`, ["a/b"]],
  [`tags: ["##double"]`, ["double"]],
  [`tags: [solo, "plain"]`, ["solo", "plain"]],
  [`tags:\n  - solo\n  - 'plain'`, ["solo", "plain"]],
  // Not YAML (`#` cannot begin a plain scalar; in a block item it begins a comment), and
  // read as tags all the same: the app's own writers wrote them.
  [`tags: [#unq]`, ["unq"]],
  [`tags: [plain, #unq2]`, ["plain", "unq2"]],
  [`tags:\n  - #blockunq`, ["blockunq"]],
  // An entry of only `#`s, or of nothing, names no tag.
  [`tags: ["#", ##, '', , "#""", a]`, ["a"]],
  [`tags:\n  - "#"\n  - ##\n  - a`, ["a"]],
  // A block list need not be indented under its key; the key is read in any case.
  [`tags:\n- a\n- "#b"`, ["a", "b"]],
  [`Tags: [x]`, ["x"]],
  [`tags : [y]`, ["y"]],
];

describe("front-matter tag readers agree with the backend's (§56m)", () => {
  it.each(ROWS)("the tag bar reads %j", (frontmatter, names) => {
    expect(parseFrontmatterTags(frontmatter)).toEqual(names);
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
});
