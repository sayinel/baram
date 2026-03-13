import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
// §5.6 Find/Replace — Plugin key, search matching, options, replace
import { describe, expect, test } from "vitest";

import {
  buildSearchRegex,
  findMatches,
  findReplacePluginKey,
} from "../plugins/find-replace";

// ── Minimal schema for unit tests ────────────────────────────────────

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      marks: "_",
    },
    heading: {
      content: "inline*",
      group: "block",
      attrs: { level: { default: 1 } },
    },
    text: { group: "inline" },
  },
  marks: {},
});

// Helper: build a doc with paragraphs
function makeDoc(...paragraphs: string[]) {
  const nodes = paragraphs.map((text) =>
    schema.node("paragraph", null, text ? [schema.text(text)] : []),
  );
  return schema.node("doc", null, nodes);
}

// ── Plugin Key ───────────────────────────────────────────────────────

describe("§5.6 Find/Replace — plugin key", () => {
  test("findReplacePluginKey is defined and named correctly", () => {
    expect(findReplacePluginKey).toBeDefined();
    expect((findReplacePluginKey as unknown as { key: string }).key).toContain(
      "findReplace",
    );
  });
});

// ── buildSearchRegex ─────────────────────────────────────────────────

describe("§5.6 Find/Replace — buildSearchRegex", () => {
  test("returns null for empty term", () => {
    expect(buildSearchRegex("", false, false, false)).toBeNull();
  });

  test("builds case-insensitive literal regex by default", () => {
    const regex = buildSearchRegex("hello", false, false, false);
    expect(regex).not.toBeNull();
    expect(regex!.flags).toContain("i");
    expect(regex!.flags).toContain("g");
    expect("Hello World".match(regex!)).toHaveLength(1);
  });

  test("builds case-sensitive regex when caseSensitive is true", () => {
    const regex = buildSearchRegex("hello", true, false, false);
    expect(regex).not.toBeNull();
    expect(regex!.flags).not.toContain("i");
    expect("Hello World".match(regex!)).toBeNull();
    expect("hello World".match(regex!)).toHaveLength(1);
  });

  test("supports regex mode", () => {
    const regex = buildSearchRegex("he.lo", false, true, false);
    expect(regex).not.toBeNull();
    expect("hello".match(regex!)).toHaveLength(1);
    expect("heylo".match(regex!)).toHaveLength(1);
  });

  test("returns null for invalid regex", () => {
    const regex = buildSearchRegex("[invalid", false, true, false);
    expect(regex).toBeNull();
  });

  test("supports whole word matching", () => {
    const regex = buildSearchRegex("the", false, false, true);
    expect(regex).not.toBeNull();
    expect("the quick fox".match(regex!)).toHaveLength(1);
    expect("there".match(regex!)).toBeNull();
  });

  test("escapes special characters in literal mode", () => {
    const regex = buildSearchRegex("a.b", false, false, false);
    expect(regex).not.toBeNull();
    expect("a.b".match(regex!)).toHaveLength(1);
    expect("axb".match(regex!)).toBeNull(); // dot is literal, not wildcard
  });
});

// ── findMatches ──────────────────────────────────────────────────────

describe("§5.6 Find/Replace — findMatches", () => {
  test("finds basic text matches in a document", () => {
    const doc = makeDoc("hello world", "hello again");
    const matches = findMatches(doc, "hello", false, false, false);
    expect(matches).toHaveLength(2);
  });

  test("returns empty for no matches", () => {
    const doc = makeDoc("hello world");
    const matches = findMatches(doc, "xyz", false, false, false);
    expect(matches).toHaveLength(0);
  });

  test("case-sensitive search filters correctly", () => {
    const doc = makeDoc("Hello world", "hello again");
    const matchesInsensitive = findMatches(doc, "hello", false, false, false);
    expect(matchesInsensitive).toHaveLength(2);

    const matchesSensitive = findMatches(doc, "hello", true, false, false);
    expect(matchesSensitive).toHaveLength(1);
  });

  test("regex mode matches patterns", () => {
    const doc = makeDoc("foo123 bar456 baz");
    const matches = findMatches(doc, "\\d+", false, true, false);
    expect(matches).toHaveLength(2);
  });

  test("whole word mode matches only whole words", () => {
    const doc = makeDoc("the cat sat on the mat");
    const allMatches = findMatches(doc, "the", false, false, false);
    // "the" appears standalone and possibly in other words
    expect(allMatches.length).toBeGreaterThanOrEqual(2);

    const wholeMatches = findMatches(doc, "the", false, false, true);
    expect(wholeMatches).toHaveLength(2); // only "the" standalone
  });

  test("match positions are correct for single paragraph", () => {
    // ProseMirror doc: <doc><paragraph>"hello world"</paragraph></doc>
    // Position 0 = doc start, 1 = paragraph start, text starts at 1
    const doc = makeDoc("hello world");
    const matches = findMatches(doc, "world", false, false, false);
    expect(matches).toHaveLength(1);
    expect(matches[0].from).toBe(7); // 1 (para open) + 6 (offset of "world")
    expect(matches[0].to).toBe(12); // 7 + 5 ("world".length)
  });

  test("returns empty for empty search term", () => {
    const doc = makeDoc("hello");
    const matches = findMatches(doc, "", false, false, false);
    expect(matches).toHaveLength(0);
  });
});

// ── Plugin state via EditorState ─────────────────────────────────────

describe("§5.6 Find/Replace — plugin state integration", () => {
  test("replace single match correctly replaces text", () => {
    const doc = makeDoc("hello world");
    const state = EditorState.create({ doc, schema });

    // Find the match position
    const matches = findMatches(doc, "world", false, false, false);
    expect(matches).toHaveLength(1);

    // Apply replace
    const tr = state.tr.insertText("earth", matches[0].from, matches[0].to);
    const newDoc = tr.doc;

    // Verify replacement
    let text = "";
    newDoc.descendants((node) => {
      if (node.isText) text += node.text;
      return true;
    });
    expect(text).toBe("hello earth");
  });

  test("replace all matches correctly replaces all occurrences", () => {
    const doc = makeDoc("cat and cat", "the cat sat");
    const state = EditorState.create({ doc, schema });

    const matches = findMatches(doc, "cat", false, false, false);
    expect(matches).toHaveLength(3);

    // Replace from last to first
    const sorted = [...matches].sort((a, b) => b.from - a.from);
    let tr = state.tr;
    for (const match of sorted) {
      tr = tr.insertText("dog", match.from, match.to);
    }
    const newDoc = tr.doc;

    let text = "";
    newDoc.descendants((node) => {
      if (node.isText) text += node.text;
      return true;
    });
    expect(text).toBe("dog and dogthe dog sat");
  });
});

// ── Edge cases ───────────────────────────────────────────────────────

describe("§5.6 Find/Replace — edge cases", () => {
  test("handles multiple paragraphs with same text", () => {
    const doc = makeDoc("abc", "abc", "abc");
    const matches = findMatches(doc, "abc", false, false, false);
    expect(matches).toHaveLength(3);
  });

  test("regex with capture groups works", () => {
    const doc = makeDoc("foo bar baz");
    const matches = findMatches(doc, "(foo|baz)", false, true, false);
    expect(matches).toHaveLength(2);
  });

  test("empty paragraphs are skipped", () => {
    const doc = makeDoc("hello", "", "world");
    const matches = findMatches(doc, "hello", false, false, false);
    expect(matches).toHaveLength(1);
  });

  test("does not match across block boundaries", () => {
    const doc = makeDoc("hello", "world");
    // "helloworld" should NOT match since they are in different blocks
    const matches = findMatches(doc, "helloworld", false, false, false);
    expect(matches).toHaveLength(0);
  });
});
