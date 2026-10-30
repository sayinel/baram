import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { withFrontmatterYaml } from "../../../utils/markdown/frontmatter";
import {
  addYamlProperty,
  parseYamlProperties,
  type PropertyEntry,
  removeYamlProperty,
  setYamlPropertyItems,
  setYamlPropertyValue,
} from "../../../utils/markdown/yaml-properties";

describe("parseYamlProperties", () => {
  it("parses string fields", () => {
    const result = parseYamlProperties(
      "name: test-skill\ndescription: A skill",
    );
    expect(result).toContainEqual({
      key: "name",
      value: "test-skill",
      type: "string",
    });
    expect(result).toContainEqual({
      key: "description",
      value: "A skill",
      type: "string",
    });
  });

  it("parses array fields (bracket syntax)", () => {
    const result = parseYamlProperties("tags: [code-gen, tiptap]");
    expect(result).toContainEqual({
      key: "tags",
      value: ["code-gen", "tiptap"],
      type: "array",
    });
  });

  it("parses known array keys even without brackets", () => {
    const result = parseYamlProperties("tags: code-gen");
    // tags is a known array key, but single value without brackets → still treated as array
    expect(result.find((e) => e.key === "tags")?.type).toBe("array");
  });

  it("parses status as enum", () => {
    const result = parseYamlProperties("status: draft");
    expect(result).toContainEqual({
      key: "status",
      value: "draft",
      type: "enum",
    });
  });

  it("parses empty array", () => {
    const result = parseYamlProperties("tags: []");
    expect(result).toContainEqual({ key: "tags", value: [], type: "array" });
  });

  it("handles empty string", () => {
    expect(parseYamlProperties("")).toEqual([]);
    expect(parseYamlProperties("  ")).toEqual([]);
  });

  // §72 What turns these red: listing every `key: value` line — a nested map's `nested: 1`
  // showed as a property of its own, and editing the parent wrote over the lines under it.
  // §72 What turns this red: listing every `key: value` line — a nested map's `nested: 1`
  // showed as a property of its own and a block scalar as `|`, and any edit flattened the one
  // and emptied the other.
  it("leaves out a nested map and a block scalar, and shows a quoted value as its text", () => {
    const keys = parseYamlProperties(
      'title: "My: note"\nmeta:\n  nested: 1\ndesc: |\n  line\nnote: n',
    );
    expect(keys).toEqual([
      { key: "title", type: "string", value: "My: note" },
      { key: "note", type: "string", value: "n" },
    ]);
  });

  it("shows a tags list by tag name, read as the tag bar reads it", () => {
    expect(parseYamlProperties('tags:\n  - a # c\n  - "#b"\n- c')[0]).toEqual({
      key: "tags",
      type: "array",
      value: ["a # c", "b", "c"],
    });
  });
});

/**
 * Front matter in shapes the panel must not disturb: CRLF line breaks, a comment, a quoted
 * value with a comment, a block list, a nested map and a block scalar it cannot show.
 */
const SHAPES = [
  [
    'title: "My: note" # c',
    "status: draft",
    "tags:",
    "  - a",
    '  - "#b" # kept',
    "requires: [x.md]",
    "meta:",
    "  nested: 1",
    "  deep:",
    "    - y",
    "desc: |",
    "  line one",
    "# a comment",
    "aliases: [p, q]",
    "related:",
    "  - r",
    "base: &a x",
    "m: {a: 1}",
    "energy: 3",
  ].join("\r\n"),
  "date: 2026-03-01\ntags:\n- a\n- b\nnote: plain text\n",
];

const VALUES = [
  "plain",
  "My: note",
  "#x",
  "a #b",
  "- x",
  "[x",
  "'q",
  '"q',
  "3",
  "2026-03-01",
  "",
  "x y",
];

/** Every edit the panel can make on `yaml`, as [what, the key it edits, the result]. */
function edits(
  yaml: string,
  entries: PropertyEntry[],
): [string, string, string][] {
  const out: [string, string, string][] = [];
  for (const { key, type, value } of entries) {
    if (type === "array") {
      const items = value as string[];
      out.push([
        `add z to ${key}`,
        key,
        setYamlPropertyItems(yaml, key, [...items, "z"]),
      ]);
      out.push([
        `remove from ${key}`,
        key,
        setYamlPropertyItems(yaml, key, items.slice(1)),
      ]);
    } else if (type === "yaml") {
      out.push([
        `set ${key} as typed`,
        key,
        setYamlPropertyValue(yaml, key, value as string, true),
      ]);
    } else {
      for (const v of VALUES)
        out.push([
          `set ${key} to ${JSON.stringify(v)}`,
          key,
          setYamlPropertyValue(yaml, key, v),
        ]);
    }
    out.push([`delete ${key}`, key, removeYamlProperty(yaml, key)]);
  }
  out.push(["add newkey", "newkey", addYamlProperty(yaml, "newkey", "string")]);
  return out;
}

describe("Properties panel edits (§72)", () => {
  // What turns this red: writing the front matter back from the panel's entries — a block
  // list's items, the nested map, the block scalar and the comments were all lost, and a typed
  // `#x` or `My: note` broke the YAML.
  it.each(SHAPES)(
    "edit one property and leave every other line as it was: %j",
    (yaml) => {
      const before = parse(yaml) as Record<string, unknown>;
      const entries = parseYamlProperties(yaml);
      for (const [what, key, out] of edits(yaml, entries)) {
        const after = parse(out) as Record<string, unknown>;
        for (const other of Object.keys(before)) {
          if (other !== key)
            expect(after[other], `${what}: ${other}`).toEqual(before[other]);
        }
        // Every byte outside the edited key's lines is as it was: without that key, the two are
        // the same text.
        expect(removeYamlProperty(out, key), what).toBe(
          removeYamlProperty(yaml, key),
        );
        if (yaml.includes("\r\n")) {
          expect(out.replace(/\r\n/g, ""), `${what}: a bare \\n`).not.toContain(
            "\n",
          );
        }
      }
    },
  );

  // What turns this red: writing the value as typed, or quoting a number or a date.
  it.each(VALUES)(
    "writes %j so YAML reads back the text the panel shows",
    (value) => {
      const out = setYamlPropertyValue("title: x\nenergy: 3", "title", value);
      expect(String(parse(out).title)).toBe(value);
      expect(parseYamlProperties(out)[0].value).toBe(value);
    },
  );

  it("writes a tags chip through the tag bar's list writer", () => {
    const out = setYamlPropertyItems('tags: ["#a"]', "tags", ["a", "b c"]);
    expect(out).toBe('tags: ["#a", b c]');
    expect(parse(out)).toEqual({ tags: ["#a", "b c"] });
  });

  it("adds a property at the end, once", () => {
    const yaml = "aliases:\n  - foo\ntitle: t";
    const out = addYamlProperty(yaml, "status", "enum");
    expect(out).toBe('aliases:\n  - foo\ntitle: t\nstatus: ""');
    expect(addYamlProperty(out, "status", "enum")).toBe(out);
  });

  it("removes a property with its lines and one line break", () => {
    expect(removeYamlProperty("a: 1\nb:\n  - x\nc: 3", "b")).toBe("a: 1\nc: 3");
    expect(removeYamlProperty("a: 1\r\nc: 3", "c")).toBe("a: 1");
  });
});

/**
 * What the panel did on main (7da451c2) with each shape, measured by running its parser and
 * serializer: [shape, what it showed, an edit of another key, an edit of this key].
 */
describe("Properties panel shapes it could and could not round-trip (§72)", () => {
  // Main showed `[p, q]` as text and wrote it back as typed, which YAML read as the list: it
  // stays visible, now as items through the list writer.
  it("a flow list under any key is items the list writer edits", () => {
    const yaml = "title: t\naliases: [p, q]";
    expect(parseYamlProperties(yaml)[1]).toEqual({
      key: "aliases",
      type: "array",
      value: ["p", "q"],
    });
    const out = setYamlPropertyItems(yaml, "aliases", ["p", "q", "r"]);
    expect(out).toBe("title: t\naliases: [p, q, r]");
  });

  // Main showed it as `""` and any edit dropped its `- p` lines: the list writer now edits it.
  it("a block list under any key is items the list writer edits", () => {
    const yaml = "title: t\naliases:\n  - p\n  - q\nnote: n";
    expect(parseYamlProperties(yaml)[1]).toEqual({
      key: "aliases",
      type: "array",
      value: ["p", "q"],
    });
    const out = setYamlPropertyItems(yaml, "aliases", ["q", "r"]);
    expect(out).toBe("title: t\naliases:\n  - q\n  - r\nnote: n");
    expect(parse(setYamlPropertyValue(yaml, "title", "t2"))).toEqual({
      aliases: ["p", "q"],
      note: "n",
      title: "t2",
    });
  });

  // Main showed these as their YAML text and wrote them back as typed — they round-tripped,
  // so they stay visible, as `yaml` text written as typed.
  it.each([
    [
      "an anchor",
      "base: &a x\nref: *a",
      "base",
      "&a y",
      { base: "y", ref: "y" },
    ],
    ["an alias", "base: &a x\nref: *a", "ref", "*a", { base: "x", ref: "x" }],
    ["a flow map", "m: {a: 1}", "m", "{a: 2}", { m: { a: 2 } }],
    ["a YAML tag", "n: !!str 5", "n", "!!str 6", { n: "6" }],
  ])("%s is YAML text written as typed", (_what, yaml, key, typed, after) => {
    const entry = parseYamlProperties(yaml).find((e) => e.key === key);
    expect(entry?.type).toBe("yaml");
    expect(parse(setYamlPropertyValue(yaml, key, typed, true))).toEqual(after);
  });

  // Main showed a nested map's inner keys as properties and a block scalar as `|`; editing
  // anything flattened the map and emptied the scalar. They stay out of the panel, and an
  // edit of another key leaves them as they were.
  it.each([
    ["a nested map", "meta:\n  nested: 1\n  deep: x"],
    ["a block scalar", "desc: |\n  line one\n  line two"],
    // No lines under the indicator: the value is an empty string, not the text `|`.
    ["an empty block scalar", "desc: |"],
  ])("%s is left out and untouched", (_what, shape) => {
    const yaml = `title: t\n${shape}\nnote: n`;
    expect(parseYamlProperties(yaml).map((e) => e.key)).toEqual([
      "title",
      "note",
    ]);
    const out = setYamlPropertyValue(yaml, "title", "t2");
    expect(out).toBe(yaml.replace("title: t", "title: t2"));
  });
});

describe("withFrontmatterYaml (§72)", () => {
  // What turns this red: rebuilding the file as `---\n${yaml}\n---${rest}` — the line break
  // after the closing fence was lost (`---body`), and CRLF fences became LF.
  it("replaces the front matter's YAML and keeps every other character", () => {
    expect(withFrontmatterYaml("---\na: 1\n---\nbody", "a: 2")).toBe(
      "---\na: 2\n---\nbody",
    );
    expect(withFrontmatterYaml("---\r\na: 1\r\n---\r\n\r\n# T", "a: 2")).toBe(
      "---\r\na: 2\r\n---\r\n\r\n# T",
    );
    expect(withFrontmatterYaml("no front matter", "a: 2")).toBe(
      "no front matter",
    );
  });
});
