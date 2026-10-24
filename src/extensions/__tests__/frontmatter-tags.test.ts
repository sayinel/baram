// §56m Frontmatter tag parsing tests
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  parseFrontmatterTags,
  updateFrontmatterTags,
} from "../nodes/frontmatter-view";

/** What the tag bar writes when it adds `tag` to the pills it shows for `yaml`. */
function addPill(yaml: string, tag: string): string {
  return updateFrontmatterTags(yaml, [...parseFrontmatterTags(yaml), tag]);
}

/** What the tag bar writes when it removes the pill `tag`. */
function removePill(yaml: string, tag: string): string {
  return updateFrontmatterTags(
    yaml,
    parseFrontmatterTags(yaml).filter((t) => t !== tag),
  );
}

describe("tag bar writes front matter YAML still reads (§56m)", () => {
  // What turns these red: joining the pill names with `, ` — `#solo` opens a YAML comment,
  // so the front matter stops parsing.
  it.each([
    [`tags: ["#solo"]`, ["#solo", "x"]],
    [`tags: ["a", "#solo"]`, ["a", "#solo", "x"]],
    [`tags: [y, "#solo"]`, ["y", "#solo", "x"]],
    [`tags: ['#solo']`, ["#solo", "x"]],
  ])("adding a pill to %s", (yaml, expected) => {
    expect(parse(addPill(yaml, "x"))).toEqual({ tags: expected });
  });

  it("removing a pill keeps the other items as they were written", () => {
    const yaml = `tags: ["#solo", 'sq', plain, x]`;
    expect(removePill(yaml, "x")).toBe(`tags: ["#solo", 'sq', plain]`);
  });

  it("a block list keeps its items, quotes and indentation", () => {
    const yaml = `title: t\ntags:\n    - "#solo"\n    - plain\ndate: d`;
    const out = addPill(yaml, "x");
    expect(out).toBe(
      `title: t\ntags:\n    - "#solo"\n    - plain\n    - x\ndate: d`,
    );
    expect(parse(out).tags).toEqual(["#solo", "plain", "x"]);
  });

  // An unquoted `#` item is already unreadable; the bar's next write quotes it rather than
  // carrying the broken spelling forward.
  it("an unindented block list stays unindented", () => {
    const out = addPill("title: t\ntags:\n- a\n- b\ndate: d", "x");
    expect(out).toBe("title: t\ntags:\n- a\n- b\n- x\ndate: d");
    expect(parse(out).tags).toEqual(["a", "b", "x"]);
  });

  it("keeps the key as it is spelled", () => {
    expect(addPill("Tags: [a]", "x")).toBe("Tags: [a, x]");
    expect(removePill("tags :\n  - a\n  - x", "x")).toBe("tags :\n  - a");
  });

  it("quotes an item whose spelling YAML cannot read", () => {
    const out = addPill("tags: [#unq]", "x");
    expect(out).toBe(`tags: ["#unq", x]`);
    expect(parse(out)).toEqual({ tags: ["#unq", "x"] });
  });

  it("quotes a typed value YAML would not read back as written", () => {
    const out = addPill("tags: [a]", "key: v");
    expect(parse(out)).toEqual({ tags: ["a", "key: v"] });
  });

  // What turns this red: an emptied block list written as a bare `tags:`, which the next add
  // did not recognise — it inserted a second `tags:` key, and YAML rejects duplicate keys.
  // What turns this red: writing the emptied block as a bare `tags:` — YAML reads that as
  // null, not as an empty list.
  it("an emptied block list is an empty list", () => {
    const out = removePill("title: t\ntags:\n  - a\ndate: d", "a");
    expect(out).toBe("title: t\ntags: []\ndate: d");
    expect(parse(out)).toEqual({ date: "d", tags: [], title: "t" });
  });

  it("emptying a block list and adding again keeps one tags key", () => {
    const emptied = removePill("title: t\ntags:\n  - a", "a");
    const out = addPill(emptied, "b");
    expect(parse(out)).toEqual({ tags: ["b"], title: "t" });
  });

  // A `tags:` the bar cannot read as a list is left alone: writing a list beside it would be
  // a duplicate key, and writing one over its first line would strand the rest.
  it.each([["tags: solo"], ["title: t\ntags: [a,\n  b]"]])(
    "does not write when tags is %j",
    (yaml) => {
      expect(addPill(yaml, "x")).toBe(yaml);
    },
  );
});

describe("tag bar pills show one # (§56m)", () => {
  // What turns this red: showing the value as written — `"#solo"` became the pill `##solo`,
  // and a block item kept its quotes, `#"#solo"`.
  it("a front-matter item spelled with # is the pill of its name", () => {
    expect(parseFrontmatterTags(`tags: ["#solo", "##deep"]`)).toEqual([
      "solo",
      "deep",
    ]);
    expect(parseFrontmatterTags(`tags:\n  - "#solo"\n  - 'b'`)).toEqual([
      "solo",
      "b",
    ]);
  });

  it("`solo` and `#solo` are one pill", () => {
    expect(parseFrontmatterTags(`tags: [solo, "#solo"]`)).toEqual(["solo"]);
  });

  it("removing that pill removes every item of the tag", () => {
    expect(parse(removePill(`tags: [solo, "#solo", b]`, "solo"))).toEqual({
      tags: ["b"],
    });
  });
});

describe("parseFrontmatterTags", () => {
  it("parses inline array format", () => {
    const yaml = "title: Test\ntags: [rust, react, coding]\ndate: 2026-03-01";
    expect(parseFrontmatterTags(yaml)).toEqual(["rust", "react", "coding"]);
  });

  it("parses inline array with quotes", () => {
    const yaml = "tags: [\"hello world\", 'coding', rust]";
    expect(parseFrontmatterTags(yaml)).toEqual([
      "hello world",
      "coding",
      "rust",
    ]);
  });

  it("parses block list format", () => {
    const yaml =
      "title: Test\ntags:\n  - kotlin\n  - rust\n  - typescript\ndate: 2026-03-01";
    expect(parseFrontmatterTags(yaml)).toEqual([
      "kotlin",
      "rust",
      "typescript",
    ]);
  });

  it("returns empty array when no tags field", () => {
    const yaml = "title: Test\ndate: 2026-03-01";
    expect(parseFrontmatterTags(yaml)).toEqual([]);
  });

  it("returns empty array for empty inline array", () => {
    const yaml = "tags: []";
    expect(parseFrontmatterTags(yaml)).toEqual([]);
  });

  it("handles Korean tags", () => {
    const yaml = "tags: [일기, 코딩, travel]";
    expect(parseFrontmatterTags(yaml)).toEqual(["일기", "코딩", "travel"]);
  });

  it("handles nested tags in inline array", () => {
    const yaml = "tags: [project/baram, status/done]";
    expect(parseFrontmatterTags(yaml)).toEqual([
      "project/baram",
      "status/done",
    ]);
  });

  it("handles nested tags in block list", () => {
    const yaml = "tags:\n  - project/baram\n  - status/done";
    expect(parseFrontmatterTags(yaml)).toEqual([
      "project/baram",
      "status/done",
    ]);
  });
});

describe("updateFrontmatterTags", () => {
  it("updates inline array format", () => {
    const yaml = "title: Test\ntags: [rust, react]\ndate: 2026-03-01";
    const result = updateFrontmatterTags(yaml, ["rust", "react", "go"]);
    expect(result).toBe(
      "title: Test\ntags: [rust, react, go]\ndate: 2026-03-01",
    );
  });

  it("updates block list format", () => {
    const yaml = "title: Test\ntags:\n  - rust\n  - react\ndate: 2026-03-01";
    const result = updateFrontmatterTags(yaml, ["rust", "react", "go"]);
    expect(result).toBe(
      "title: Test\ntags:\n  - rust\n  - react\n  - go\ndate: 2026-03-01",
    );
  });

  it("adds tags field when none exists", () => {
    const yaml = "title: Test\ndate: 2026-03-01";
    const result = updateFrontmatterTags(yaml, ["rust", "coding"]);
    expect(result).toBe("title: Test\ntags: [rust, coding]\ndate: 2026-03-01");
  });

  it("clears inline array to empty", () => {
    const yaml = "title: Test\ntags: [rust, react]\ndate: 2026-03-01";
    const result = updateFrontmatterTags(yaml, []);
    expect(result).toBe("title: Test\ntags: []\ndate: 2026-03-01");
  });

  it("preserves other YAML fields", () => {
    const yaml = "title: My Note\nauthor: John\ntags: [old]\ncategory: dev";
    const result = updateFrontmatterTags(yaml, ["new1", "new2"]);
    expect(result).toContain("title: My Note");
    expect(result).toContain("author: John");
    expect(result).toContain("category: dev");
    expect(result).toContain("tags: [new1, new2]");
  });
});
