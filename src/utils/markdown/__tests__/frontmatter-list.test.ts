// §56m A front-matter list read item by item and written so YAML still reads it.
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  flowList,
  listItemSpelling,
  readFrontmatterList,
} from "../frontmatter-list";

function items(yaml: string) {
  return readFrontmatterList(yaml, "tags")?.items.map((i) => [i.raw, i.value]);
}

describe("readFrontmatterList", () => {
  it("reads an inline list, unquoting each item", () => {
    expect(items(`tags: [plain, "#dq", '#sq', #unq]`)).toEqual([
      ["plain", "plain"],
      [`"#dq"`, "#dq"],
      [`'#sq'`, "#sq"],
      ["#unq", "#unq"],
    ]);
  });

  // What turns this red: splitting at every comma — `"a, b"` became two items, `"a` and `b"`,
  // and writing them back kept neither quoted.
  it("does not split an inline item at a comma inside its quotes", () => {
    expect(items(`tags: ["a, b", c]`)).toEqual([
      [`"a, b"`, "a, b"],
      ["c", "c"],
    ]);
  });

  // What turns this red: the block readers kept the quotes — the tag bar showed `#"#solo"`.
  it("reads a block list, unquoting each item and keeping its lead", () => {
    const list = readFrontmatterList(
      `title: x\ntags:\n  - "#solo"\n    - plain\ndate: y`,
      "tags",
    );
    expect(list?.form).toBe("block");
    expect(list?.items).toEqual([
      { lead: "  - ", raw: `"#solo"`, value: "#solo" },
      { lead: "    - ", raw: "plain", value: "plain" },
    ]);
  });

  it("reads `tags:` with nothing under it as an empty block list", () => {
    const yaml = "title: x\ntags:\ndate: y";
    const list = readFrontmatterList(yaml, "tags");
    expect(list?.form).toBe("block");
    expect(list?.items).toEqual([]);
    expect(yaml.slice(list!.start, list!.end)).toBe("tags:");
  });

  // A field that is there but not a list this reader can rewrite: writing a list over its
  // first line would leave the rest dangling.
  it("refuses a field it cannot read as a list", () => {
    expect(readFrontmatterList("tags: solo", "tags")).toBeNull();
    expect(readFrontmatterList("tags:\n- a\n- b", "tags")).toBeNull();
    expect(readFrontmatterList("tags:\n  a: b", "tags")).toBeNull();
  });

  it("returns null when the field is absent", () => {
    expect(readFrontmatterList("title: x", "tags")).toBeNull();
  });

  it("gives the range of the whole field", () => {
    const yaml = "a: 1\ntags:\n  - x\n  - y\nb: 2";
    const list = readFrontmatterList(yaml, "tags")!;
    expect(yaml.slice(list.start, list.end)).toBe("tags:\n  - x\n  - y");
    const inline = "a: 1\ntags: [x, y]\nb: 2";
    const l2 = readFrontmatterList(inline, "tags")!;
    expect(inline.slice(l2.start, l2.end)).toBe("tags: [x, y]");
  });
});

describe("listItemSpelling", () => {
  // What turns this red: writing the value as it is — `#solo` opens a YAML comment.
  it("quotes a new value YAML would not read back as that text", () => {
    for (const value of [
      "#solo",
      "a, b",
      "key: value",
      "x #y",
      "[x",
      "true",
      "null",
      "2024",
      "2024-01-01",
      "",
    ]) {
      const written = `tags: ${flowList([value])}`;
      expect(parse(written)).toEqual({ tags: [value] });
      expect(listItemSpelling(value, true)).toBe(JSON.stringify(value));
    }
  });

  it("leaves a plain-safe new value unquoted", () => {
    for (const value of ["solo", "project/baram", "일기", "baram-dev", "1st"]) {
      expect(listItemSpelling(value, true)).toBe(value);
      expect(parse(`tags: ${flowList([value])}`)).toEqual({ tags: [value] });
    }
  });

  it("keeps an item's spelling when YAML reads it back as its value", () => {
    const list = readFrontmatterList(
      `tags: ["#dq", '#sq', plain, foo bar]`,
      "tags",
    )!;
    expect(list.items.map((i) => listItemSpelling(i, true))).toEqual([
      `"#dq"`,
      `'#sq'`,
      "plain",
      "foo bar",
    ]);
  });

  // What turns this red: keeping every item as written — `#unq` stays a comment, and the list
  // stays unreadable however the user edits it.
  it("quotes an item whose spelling YAML cannot read, keeping its #", () => {
    const list = readFrontmatterList("tags: [#unq, ok]", "tags")!;
    const written = `tags: ${flowList(list.items)}`;
    expect(written).toBe(`tags: ["#unq", ok]`);
    expect(parse(written)).toEqual({ tags: ["#unq", "ok"] });
  });

  it("quotes a block item that would break a flow list", () => {
    const list = readFrontmatterList("tags:\n  - a, b\n  - c", "tags")!;
    expect(list.items.map((i) => listItemSpelling(i, false))).toEqual([
      "a, b",
      "c",
    ]);
    expect(parse(`tags: ${flowList(list.items)}`)).toEqual({
      tags: ["a, b", "c"],
    });
  });
});
