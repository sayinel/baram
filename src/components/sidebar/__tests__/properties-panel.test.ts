import { describe, expect, it } from "vitest";
import { parse, parseDocument } from "yaml";

import { withFrontmatterYaml } from "../../../utils/markdown/frontmatter";
import {
  addYamlProperty,
  isWritableYamlValue,
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
      raw: "test-skill",
      value: "test-skill",
      type: "string",
    });
    expect(result).toContainEqual({
      key: "description",
      raw: "A skill",
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
      raw: "draft",
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
      { key: "title", raw: '"My: note"', type: "string", value: "My: note" },
      { key: "note", raw: "n", type: "string", value: "n" },
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
        setYamlPropertyValue(yaml, key, value as string, { asYaml: true }),
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

  // A new property has no value yet (`key:`), so the first value typed takes its own type.
  it("adds a property at the end, once, with no value", () => {
    const yaml = "aliases:\n  - foo\ntitle: t";
    const out = addYamlProperty(yaml, "status", "enum");
    expect(out).toBe("aliases:\n  - foo\ntitle: t\nstatus:");
    expect(addYamlProperty(out, "status", "enum")).toBe(out);
    expect(setYamlPropertyValue(out, "status", "3")).toBe(
      "aliases:\n  - foo\ntitle: t\nstatus: 3",
    );
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
    expect(
      parse(setYamlPropertyValue(yaml, key, typed, { asYaml: true })),
    ).toEqual(after);
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

/** The kind YAML reads a value as. */
function kindOf(value: unknown): string {
  if (value === null) return "null";
  return typeof value === "boolean" ? "bool" : typeof value;
}

describe("an edited value keeps its type (§72)", () => {
  // What turns this red: writing every edit through `yamlPropertyValue` alone — `-1` became
  // `"-1"`, `True` became `"True"`, and merely touching the field changed its type.
  it.each([
    ["-1", "-12"],
    ["1.50", "1.25"],
    ["3", "3.5"],
    ["0x1F", "0x20"],
    ["1e3", "2e3"],
    ["True", "False"],
    ["~", "null"],
  ])("a plain %j edited to %j stays plain and of its kind", (raw, typed) => {
    const yaml = `v: ${raw}\nnote: n`;
    const out = setYamlPropertyValue(yaml, "v", typed);
    expect(out).toBe(`v: ${typed}\nnote: n`);
    expect(kindOf(parse(out).v)).toBe(kindOf(parse(yaml).v));
  });

  it("a value typed and then typed back writes back what was there", () => {
    for (const [raw, detour] of [
      ["1.50", "1.505"],
      ["True", "Tru"],
      ["-1", "-"],
      ['"a\\tb"', "a"],
      ["'it''s'", "it"],
    ]) {
      const yaml = `v: ${raw}\nnote: n`;
      const shown = parseYamlProperties(yaml)[0].value as string;
      const away = setYamlPropertyValue(yaml, "v", detour, { original: raw });
      expect(setYamlPropertyValue(away, "v", shown, { original: raw })).toBe(
        yaml,
      );
    }
  });

  // What turns this red: rewriting a value whose text did not change — `url: http://x` was
  // quoted, `a: x   ` lost its trailing spaces, `12:30` became `"12:30"`.
  it.each([
    "url: http://x.y/z",
    "time: 12:30",
    "v: x   ",
    "v: 'it''s'",
    'v: "a\\tb"',
    "v: 1.50",
    "v: ~",
  ])("writes nothing when %j is set to the value it shows", (yaml) => {
    const [entry] = parseYamlProperties(yaml);
    expect(setYamlPropertyValue(yaml, entry.key, entry.value as string)).toBe(
      yaml,
    );
  });

  it("a string stays a string when it is edited into something YAML would read as a number", () => {
    expect(setYamlPropertyValue("v: hello", "v", "3")).toBe('v: "3"');
    expect(setYamlPropertyValue('v: "5"', "v", "6")).toBe('v: "6"');
    expect(parse(setYamlPropertyValue("v: hello", "v", "true")).v).toBe("true");
  });
});

describe("values the panel shows as YAML text (§72)", () => {
  // What turns these red: showing them as strings — `a # c` was written back as the string
  // `"a # c"` (YAML had read `a`), and `"a\x41"` lost its escape.
  it.each([
    ["comment: a # c", "a # c"],
    ['fold: "a\\x41"', '"a\\x41"'],
    ['q: "a" # c', '"a" # c'],
    // m1: a comment with no value before it — YAML reads null, not the text `# note`.
    ["note: # note", "# note"],
  ])("%j is yaml text", (yaml, text) => {
    expect(parseYamlProperties(yaml)[0]).toMatchObject({
      type: "yaml",
      value: text,
    });
  });

  // What turns this red: reading `key:` with nothing after it as an empty list — emptying a
  // value turned the field into a chip list.
  it("a key with no value is an empty string, not a list", () => {
    expect(parseYamlProperties("aliases:\ntitle: t")[0]).toEqual({
      key: "aliases",
      raw: "",
      type: "string",
      value: "",
    });
  });

  it("a list shows each value once, and removing it removes every item holding it", () => {
    const yaml = "aliases: [p, p, q]";
    expect(parseYamlProperties(yaml)[0].value).toEqual(["p", "q"]);
    expect(setYamlPropertyItems(yaml, "aliases", ["q"])).toBe("aliases: [q]");
  });
});

describe("values that run on past their key's line (§72)", () => {
  // What turns this red: reading only the key's line — the panel showed the first line of a
  // value js-yaml reads over several lines and let an edit cut it, and `b: 2}` showed as a key
  // of its own. yaml 2.9.1 reports an error for each; js-yaml reads one value.
  it.each([
    'k: "a\nb"',
    "k: 'a\nb'",
    "k: [a,\nb]",
    "k: {a: 1,\nb: 2}",
    'k: "a # not a comment\nb: c"',
    "k: ['x,\ny']",
    "k: [a,\nb,\nc: d]",
  ])("hides %j and the lines it runs on to", (field) => {
    const keys = parseYamlProperties(`title: t\n${field}\nlast: z`).map(
      (e) => e.key,
    );
    expect(keys).toEqual(["title", "last"]);
  });

  // The sibling: values that close on their line are shown, comments and quotes inside
  // included.
  it.each([
    ['k: "a [b"', "string"],
    ["k: 'it''s {'", "string"],
    ["k: [a, '[', \"]\"] # ]", "yaml"],
    ["k: {a: [1, 2]} # {", "yaml"],
    ["k: it's [plain", "string"],
    ['k: "a\\"b"', "string"],
    ["k: [it's, b]", "array"],
    ['k: ["a\\"", b]', "array"],
    ['k: ["a\\" ,"]', "array"],
  ])("shows %j", (field, type) => {
    const keys = parseYamlProperties(`title: t\n${field}\nlast: z`).map(
      (e) => `${e.key}:${e.type}`,
    );
    expect(keys).toEqual(["title:string", `k:${type}`, "last:string"]);
  });
});

describe("isWritableYamlValue (§72)", () => {
  const DOC = [
    "title: t",
    "anchor: &a x",
    "ref: *a",
    "flow: {a: 1}",
    "typed: !!str 5",
    "comment: a # c",
  ].join("\n");
  const TEXTS = [
    "new",
    "a: b",
    "#x",
    "- y",
    "",
    "123",
    "-1",
    "true",
    "~",
    "it's",
    'say "hi"',
    "x #y",
    "[a",
    "{b",
    "@at",
    "`bt",
    "%p",
    "!t",
    "*a",
    "*b",
    "|",
    ">",
    "?",
    ":",
    "-",
    '"',
    "'",
    "''",
    "{a: 2}",
    "[1, 2]",
    "&a z",
    "&b z",
    "!!str 6",
    "{a: b: c}",
    "[a,",
    "{a: 1}}",
    "&a",
    "a # cd",
    '"q" # c',
    "&a b: c",
    "multi\nline",
  ];

  // What turns this red: writing `yaml` text as typed without checking it — `[a`, `a: b`, a
  // lone `"`, or an anchor typed away from the alias that needs it left YAML that does not
  // parse. Every text the check lets through must parse and resolve.
  it.each(["anchor", "ref", "flow", "typed", "comment"])(
    "lets through only texts that leave %s valid YAML",
    (key) => {
      for (const text of TEXTS) {
        if (!isWritableYamlValue(DOC, key, text)) continue;
        const out = setYamlPropertyValue(DOC, key, text, { asYaml: true });
        const doc = parseDocument(out, { uniqueKeys: true });
        expect(doc.errors, `${key}: ${JSON.stringify(text)}`).toEqual([]);
        expect(doc.warnings, `${key}: ${JSON.stringify(text)}`).toEqual([]);
        expect(
          () => doc.toJS(),
          `${key}: ${JSON.stringify(text)}`,
        ).not.toThrow();
      }
    },
  );

  it("lets through the edits a user means", () => {
    expect(isWritableYamlValue(DOC, "flow", "{a: 2}")).toBe(true);
    expect(isWritableYamlValue(DOC, "anchor", "&a y")).toBe(true);
    expect(isWritableYamlValue(DOC, "ref", "*a")).toBe(true);
    expect(isWritableYamlValue(DOC, "typed", "!!str 6")).toBe(true);
    expect(isWritableYamlValue(DOC, "comment", "a # cd")).toBe(true);
    expect(isWritableYamlValue(DOC, "flow", "")).toBe(true);
  });

  it.each(["a: b", "- y", "?", ":", "-", '"', "'"])("refuses %j", (text) => {
    expect(isWritableYamlValue(DOC, "flow", text)).toBe(false);
  });

  // What turns these red: judging the text by the editor's YAML grammar
  // (`@codemirror/lang-yaml`), which took all of them — an escape YAML does not have, an anchor
  // with no name, a tag `yaml` cannot resolve (a warning there, an error to js-yaml), and a
  // block scalar header, which reads the lines after it and takes the field out of the panel.
  it.each(["!!int x", "!x y", '"a\\q"', "&", "|", ">", "|-"])(
    "refuses %j under every key",
    (text) => {
      for (const key of ["anchor", "ref", "flow", "typed", "comment"]) {
        expect(isWritableYamlValue(DOC, key, text), key).toBe(false);
      }
    },
  );

  it.each(["|", ">", "|-", ">+", "|2", ">-1", "&b |", "!!str >"])(
    "refuses the block scalar header %j",
    (text) => {
      expect(isWritableYamlValue(DOC, "flow", text)).toBe(false);
    },
  );

  // Kinds the grammar let through, found by joining tokens three at a time.
  it.each([
    // a tag or an anchor with no space before what follows
    '!!int"x',
    "&b[]",
    "&b{}",
    // an anchor or an alias with no name
    "[&]",
    "{a: &}",
    "*",
    "[*]",
    // a comment with no space before it
    "[]#",
    "{}#",
    // an invalid escape inside a collection
    '{a: "\\q"}',
    '["\\q"]',
    // a tag yaml cannot resolve inside a collection
    "[!!int x]",
    "{a: !x y}",
  ])("refuses %j", (text) => {
    expect(isWritableYamlValue(DOC, "flow", text)).toBe(false);
  });

  // What turns this red: leaving a raw control character to the parser — `yaml` reads it with
  // no error or warning, though a YAML stream may hold only printable characters (§5.1) and
  // js-yaml rejects it.
  it.each(["x\u0007y", '"x\u0001"', "{a: x\u001b}", "x\u007fy", "x\u009fy"])(
    "refuses %j, which holds a character outside YAML's printable set",
    (text) => {
      expect(isWritableYamlValue(DOC, "flow", text)).toBe(false);
    },
  );

  it.each(["x\ty", "x\u0085y"])(
    "lets through %j, which YAML can hold",
    (text) => {
      expect(isWritableYamlValue(DOC, "flow", text)).toBe(true);
    },
  );

  // What turns this red: trusting `parseDocument` alone — 100 aliases to one anchor report no
  // error or warning, and `toJS` refuses them ("Excessive alias count").
  it("refuses a value that toJS cannot read though the parser reports nothing", () => {
    const aliases = (n: number) => `[${Array(n).fill("*a").join(", ")}]`;
    // `ref: *a` is one more: 100 in all, then 99.
    expect(isWritableYamlValue(DOC, "flow", aliases(99))).toBe(false);
    expect(isWritableYamlValue(DOC, "flow", aliases(98))).toBe(true);
  });

  // What turns this red: trusting `yaml` to close a quoted scalar — it takes `'''` for a whole
  // scalar and lets `"\\"` run on, so with the matching quote on the next key's line it read
  // that line as the next key and reported nothing, where YAML 1.2.2 leaves the scalar open
  // (js-yaml throws). An unclosed collection runs on too.
  it.each(["'''", '"\\"', "'a", '"a', "[a,", "{a: 1,", "[''']", '{a: "\\"}'])(
    "refuses %j whatever the next line holds",
    (text) => {
      for (const next of [
        "next: 'x'",
        'next: "x"',
        "next: ]",
        "next: }",
        "next: [b]",
      ]) {
        const yaml = `title: t\nflow: {a: 1}\n${next}\nlast: z`;
        expect(isWritableYamlValue(yaml, "flow", text), next).toBe(false);
      }
    },
  );

  // A behaviour pin, not a test of `quotesCloseWithin`: an open quote in a flow mapping key is
  // refused by the diagnostics, as yaml reports it there (`MISSING_CHAR`).
  it("refuses a flow mapping key quoted as YAML leaves open", () => {
    const yaml = "title: t\nflow: {a: 1}\nnext: 'x'\nlast: z";
    expect(isWritableYamlValue(yaml, "flow", "{''': 1}")).toBe(false);
    expect(isWritableYamlValue(yaml, "flow", "{'''': 1}")).toBe(true);
  });

  // What turns this red: judging every quoted scalar in the front matter — one on a line the
  // edit does not touch refused every edit.
  it("judges only the quoted scalars on the edited line", () => {
    const yaml = "other: '''\nnext: 'x'\nflow: {a: 1}";
    expect(isWritableYamlValue(yaml, "flow", "{a: 2}")).toBe(true);
  });

  // The sibling: a quoted scalar or a collection that closes on its line is still written,
  // whatever the next line holds.
  it.each([
    "''",
    "'it''s'",
    '""',
    '"a\\"b"',
    "'a' # c",
    '[a, "b"]',
    "{a: 'x'}",
    "x",
  ])("lets through %j whatever the next line holds", (text) => {
    for (const next of ["next: 'x'", 'next: "x"', "next: [b]"]) {
      const yaml = `title: t\nflow: {a: 1}\n${next}\nlast: z`;
      expect(isWritableYamlValue(yaml, "flow", text), next).toBe(true);
    }
  });

  // The sibling: valid YAML, if unusual, is still written.
  it.each([
    "!!int 0x1F",
    "!!float .inf",
    "!!null ~",
    "!!bool True",
    "!<tag:yaml.org,2002:str> x",
    '"\\u00e9\\x41\\t"',
    "'it''s'",
    '[1, "two", {c: d}, *a]',
    "&b [x, y]",
    "{a: [1, {b: 2}]} # c",
    "~",
    "''",
  ])("lets through %j", (text) => {
    expect(isWritableYamlValue(DOC, "flow", text)).toBe(true);
  });

  // What turns this red: judging the whole front matter — a line the edit does not touch that
  // YAML already could not read refused every edit.
  it("judges what the edit changes, not a line it leaves as it was", () => {
    const broken = `${DOC}\nbad: !!int x\nworse: "\\q"`;
    // Longer than `{a: 1}`: the lines after it move, and their diagnostics with them.
    expect(isWritableYamlValue(broken, "flow", "{a: 333}")).toBe(true);
    expect(isWritableYamlValue(broken, "flow", "[a")).toBe(false);
    expect(isWritableYamlValue(broken, "flow", "!!int y")).toBe(false);
    // With other diagnostics about, `toJS` is not asked; the alias is still checked.
    expect(isWritableYamlValue(broken, "flow", "*b")).toBe(false);
    // A key the front matter does not have is appended: its line is the edit.
    expect(isWritableYamlValue(broken, "added", "!!int y")).toBe(false);
    expect(isWritableYamlValue(broken, "added", "{a: 3}")).toBe(true);
  });

  it("refuses an edit to a line YAML already could not read that leaves it unreadable", () => {
    const yaml = "title: t\nflow: {a\nlast: z";
    expect(isWritableYamlValue(yaml, "flow", "{a: ")).toBe(false);
    expect(isWritableYamlValue(yaml, "flow", "{a: 1}")).toBe(true);
    // The same diagnostic at the same place as before: still the edited line's, so refused.
    const tagged = "title: t\nflow: !!int x\nlast: z";
    expect(isWritableYamlValue(tagged, "flow", "!!int y")).toBe(false);
    expect(isWritableYamlValue(tagged, "flow", "!!int 5")).toBe(true);
  });

  it("refuses an alias to an anchor the front matter does not set before it", () => {
    expect(isWritableYamlValue(DOC, "ref", "*b")).toBe(false);
    expect(isWritableYamlValue(DOC, "anchor", "new")).toBe(false);
  });
});
