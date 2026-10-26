// §56m A front-matter list read item by item and rewritten so YAML still reads it.
import { describe, expect, it } from "vitest";
import { parse, parseDocument } from "yaml";

import { tagName } from "../../tags/tag-name";
import {
  appendFrontmatterLine,
  frontmatterListItems,
  listItemSpelling,
  readFrontmatterLists,
  writeFrontmatterList,
} from "../frontmatter-list";

function items(yaml: string) {
  return frontmatterListItems(yaml, "tags").map((i) => [i.raw, i.value]);
}

/** The tag names a front matter's lists hold — what the tag bar shows as pills. */
function names(yaml: string): string[] {
  return frontmatterListItems(yaml, "tags")
    .map((i) => tagName(i.value))
    .filter(Boolean);
}

/** Whether `yaml` parses, duplicate keys refused as YAML 1.2 refuses them. */
function parses(yaml: string): boolean {
  return parseDocument(yaml, { uniqueKeys: true }).errors.length === 0;
}

/** The tag bar's write: the names `yaml` holds, changed by `edit`. */
function write(yaml: string, edit: (names: string[]) => string[]): string {
  return writeFrontmatterList(yaml, "tags", edit(names(yaml)), tagName);
}

describe("readFrontmatterLists", () => {
  it("reads an inline list, unquoting each item", () => {
    expect(items(`tags: [plain, "#dq", '#sq', #unq]`)).toEqual([
      ["plain", "plain"],
      [`"#dq"`, "#dq"],
      [`'#sq'`, "#sq"],
      ["#unq", "#unq"],
    ]);
  });

  it("reads a block list, indented or not, keeping each line as written", () => {
    const [list] = readFrontmatterLists(
      `title: x\ntags:\n  - "#solo"\n- plain # c\ndate: y`,
      "tags",
    );
    expect(list.form).toBe("block");
    expect(list.items).toEqual([
      { lead: "  - ", raw: `"#solo"`, value: "#solo" },
      { lead: "- ", raw: "plain # c", value: "plain # c" },
    ]);
    expect(list.lines.map((l) => l.text)).toEqual([
      `  - "#solo"`,
      "- plain # c",
    ]);
  });

  it("reads every list of the field, in order, its key in any case", () => {
    const lists = readFrontmatterLists("tags: [a]\nTags :\n  - b", "tags");
    expect(lists.map((l) => [l.key, l.items.map((i) => i.value)])).toEqual([
      ["tags:", ["a"]],
      ["Tags :", ["b"]],
    ]);
  });

  it("reads no list from a field in another form", () => {
    for (const yaml of ["tags: solo", "tags: [a,\n  b]", "title: x"]) {
      expect(readFrontmatterLists(yaml, "tags")).toEqual([]);
    }
  });

  it("gives the range of the list and its line breaks", () => {
    const yaml = "a: 1\r\ntags:\r\n  - x\r\n  - y\r\nb: 2";
    const [list] = readFrontmatterLists(yaml, "tags");
    expect(yaml.slice(list.start, list.end)).toBe("tags:\r\n  - x\r\n  - y");
    expect(list.newline).toBe("\r\n");
    const inline = "a: 1\ntags: [x, y] # c\nb: 2";
    const [l2] = readFrontmatterLists(inline, "tags");
    expect(inline.slice(l2.start, l2.end)).toBe("tags: [x, y]");
    expect(inline.slice(l2.open, l2.end)).toBe("[x, y]");
  });

  // What turns these red: taking a list as read when it was not read to its end. A writer
  // then rewrites the part it read and strands the rest — `tags: []` above `  # c\n  - b`.
  it.each([
    ["a comment between items", "tags:\n  - a\n  # c\n  - b\nx: 1"],
    ["a blank line between items", "tags:\n  - a\n\n  - b\nx: 1"],
    ["a bare `-` between items", "tags:\n  - a\n  -\n  - b\nx: 1"],
    ["an item over two lines", "tags:\n  - a long\n    tag\nx: 1"],
    ["a mapping item", "tags:\n  - name: a\n    color: red\nx: 1"],
    ["a value under the key that is not an item", "tags:\n  a: b"],
    ["an unindented `-` that is not an item", "tags:\n- a\n-b"],
    ["a quote holding the `]`", `tags: ["a]b", c]`],
    ["a nested list", "tags: [[a], b]"],
    ["a nested map", "tags: [{a: 1}, b]"],
    ["text after `]`", "tags: [a, b]x"],
    ["a comment not set off by a space", "tags: [a]#c"],
  ])("is not complete with %s", (_why, yaml) => {
    const lists = readFrontmatterLists(yaml, "tags");
    expect(lists).toHaveLength(1);
    expect(lists[0].complete).toBe(false);
  });

  it.each([
    ["an inline list and a comment", "tags: [a, b] # c\nx: 1"],
    ["a block list, then comments and a key", "tags:\n  - a\n# c\n\nx: 1"],
    ["a block list at the end", "tags:\n  - a\n  - b"],
    ["a block list with item comments", "tags:\n  - a # c\n  - 'b' # d"],
    ["an empty block list", "tags:\nx: 1"],
  ])("is complete with %s", (_why, yaml) => {
    expect(readFrontmatterLists(yaml, "tags").map((l) => l.complete)).toEqual([
      true,
    ]);
  });
});

describe("writeFrontmatterList", () => {
  // What turns this red: a writer that rewrites a list it did not read to its end — every row
  // here became YAML that does not parse, or split one item into two.
  it.each([
    "title: t\ntags:\n  - a\n  # c\n  - b\ndate: d",
    "title: t\ntags:\n  - a\n\n  - b\ndate: d",
    "title: t\ntags:\n  - a\n  -\n  - b\ndate: d",
    "title: t\ntags:\n  - a long\n    tag\ndate: d",
    'title: t\ntags: ["a]b", c]\ndate: d',
    "title: t\ntags: [[a], b]\ndate: d",
  ])("leaves a list it did not read to its end alone: %j", (yaml) => {
    expect(write(yaml, (n) => [...n, "x"])).toBe(yaml);
    expect(write(yaml, (n) => [...n, "yes"])).toBe(yaml);
    expect(write(yaml, (n) => n.slice(1))).toBe(yaml);
  });

  // A name the writer quoted around a `]` is read back only up to that `]`: the next write
  // must leave the list rather than cut the item.
  it("leaves a list alone once an item holds a `]`", () => {
    const once = writeFrontmatterList(
      "tags: [a, b]",
      "tags",
      ["a", "b", "[a]"],
      tagName,
    );
    expect(parse(once)).toEqual({ tags: ["a", "b", "[a]"] });
    expect(write(once, (n) => n.filter((t) => t !== "a"))).toBe(once);
  });

  // What turns this red: respelling a kept block item from its value — the comment moved into
  // the value (`- "a # c"`), and YAML read `a # c` where it had read `a`.
  it("keeps a kept block item's line as written, comment and quotes included", () => {
    const yaml = "tags:\n  - a # c\n  - 'b' # d\n  - - n\n  - x";
    const out = write(yaml, (n) => n.filter((t) => t !== "x"));
    expect(out).toBe("tags:\n  - a # c\n  - 'b' # d\n  - - n");
    expect(parse(out)).toEqual({ tags: ["a", "b", ["n"]] });
  });

  // The other half: an item YAML cannot read as written is respelled, keeping its lead.
  it.each([
    ["- #solo", `- "#solo"`],
    ['- "a', "- a"],
    ["- @x", `- "@x"`],
    ["- %x", `- "%x"`],
  ])("respells an unreadable block item %j", (item, respelled) => {
    const out = write(`tags:\n  ${item}`, (n) => [...n, "z"]);
    expect(out).toBe(`tags:\n  ${respelled}\n  - z`);
    expect(parses(out)).toBe(true);
  });

  // What turns this red: anything but the touched lines changing — a CRLF list rejoined with
  // `\n`, a comment absorbed, an empty `tags:` written `tags: []`, an item respelled.
  it.each([
    "title: t\ntags:\n  - a\n  - 'b' # c\ndate: d\n",
    "title: t\r\ntags:\r\n  - a\r\n  - b\r\ndate: d",
    "tags:\n- a\n- b\n# trailing\n",
    `tags: [a, "#b", 'c']`,
    "tags:\nx: 1",
    "tags: []",
  ])("writing back the names a list has changes nothing: %j", (yaml) => {
    expect(write(yaml, (n) => n)).toBe(yaml);
  });

  // What turns this red: joining the added line with `\n` in a CRLF front matter.
  it("adds a line with the list's own line break", () => {
    const out = write("tags:\r\n  - a\r\nx: 1", (n) => [...n, "b"]);
    expect(out).toBe("tags:\r\n  - a\r\n  - b\r\nx: 1");
  });

  // An item that names no tag is not the tag bar's to remove: it survives an edit.
  it("keeps items that name no tag", () => {
    expect(write(`tags: ["#", a, '']`, (n) => [...n, "x"])).toBe(
      `tags: ["#", a, '', x]`,
    );
    expect(write(`tags:\n  - "#"\n  - a`, () => [])).toBe(`tags:\n  - "#"`);
  });

  it("writes an emptied list as an empty flow list", () => {
    expect(write("t: 1\ntags:\n  - a\nd: 2", () => [])).toBe(
      "t: 1\ntags: []\nd: 2",
    );
  });

  // A kept flow item holding ` #` reads, in YAML, as a comment that runs past the `]`.
  it("respells a kept flow item YAML reads as a comment", () => {
    const out = write("tags: [a #c]", (n) => [...n, "x"]);
    expect(out).toBe(`tags: ["a #c", x]`);
    expect(parse(out)).toEqual({ tags: ["a #c", "x"] });
  });

  // What turns these red: writing a list when the front matter has more than one key that
  // reads as `tags`, or a quoted one — the result repeats the key, or edits the one YAML drops.
  it.each([
    "tags: [a]\ntags: [b]",
    "tags:\n  - a\nTags: [b]",
    `"tags": [a]\ntitle: t`,
    "'tags':\n  - a",
    "tags: a",
    // One readable list beside a second key that reads as `tags`.
    "tags: [a]\ntags: x",
    `tags:\n  - a\n"tags": [b]`,
  ])("leaves an ambiguous or unreadable tags key alone: %j", (yaml) => {
    expect(write(yaml, (n) => [...n, "x"])).toBe(yaml);
  });

  // What turns these red: putting the new key after the first line — inside that line's value
  // when it is a block list or a `|` scalar.
  it.each([
    ["a block list first", "aliases:\n  - foo\ntitle: t"],
    ["a literal scalar first", "desc: |\n  line\ntitle: t"],
    ["a literal scalar last", "title: t\ndesc: |\n  line"],
    ["a trailing line break", "title: t\n"],
  ])("appends a missing tags key at the end, after %s", (_why, yaml) => {
    const out = writeFrontmatterList(yaml, "tags", ["x"], tagName);
    expect(out.startsWith(yaml)).toBe(true);
    const before = parse(yaml) as Record<string, unknown>;
    expect(parse(out)).toEqual({ ...before, tags: ["x"] });
  });

  it("appends with the front matter's own line break", () => {
    expect(appendFrontmatterLine("a: 1\r\nb: 2", "tags: [x]")).toBe(
      "a: 1\r\nb: 2\r\ntags: [x]",
    );
    expect(appendFrontmatterLine("a: 1\n", "tags: [x]")).toBe(
      "a: 1\ntags: [x]\n",
    );
    expect(appendFrontmatterLine("", "tags: [x]")).toBe("tags: [x]");
  });
});

describe("listItemSpelling", () => {
  it("keeps an inline item's spelling when YAML reads it as one scalar", () => {
    const [list] = readFrontmatterLists(
      `tags: ["#dq", '#sq', plain, foo bar, 123, null]`,
      "tags",
    );
    expect(list.items.map((i) => listItemSpelling(i, true))).toEqual([
      `"#dq"`,
      `'#sq'`,
      "plain",
      "foo bar",
      "123",
      "null",
    ]);
  });

  it("quotes an inline item whose spelling YAML cannot read, keeping its #", () => {
    const [list] = readFrontmatterLists("tags: [#unq, ok]", "tags");
    expect(list.items.map((i) => listItemSpelling(i, true))).toEqual([
      `"#unq"`,
      "ok",
    ]);
  });

  it("keeps a block item as written, and respells it for a flow list when needed", () => {
    const [list] = readFrontmatterLists("tags:\n  - a, b\n  - c", "tags");
    expect(list.items.map((i) => listItemSpelling(i, false))).toEqual([
      "a, b",
      "c",
    ]);
    expect(list.items.map((i) => listItemSpelling(i, true))).toEqual([
      `"a, b"`,
      "c",
    ]);
  });
});
