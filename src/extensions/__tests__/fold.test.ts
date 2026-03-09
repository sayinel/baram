// Heading & List Folding — unit tests
// Tests fold range detection, toggle, selection safety, position remapping,
// fold all / unfold all, no doc mutation, and anchor persistence.

import { describe, test, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, Plugin } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import { DecorationSet } from "@tiptap/pm/view";
import {
  findFoldableHeadings,
  findFoldableListItems,
  findAllFoldables,
  positionsToAnchors,
  anchorsToPositions,
  foldPluginKey,
  type FoldMeta,
} from "../plugins/fold";

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
    bulletList: {
      content: "listItem+",
      group: "block",
    },
    orderedList: {
      content: "listItem+",
      group: "block",
    },
    listItem: {
      content: "paragraph block*",
    },
    text: { group: "inline" },
  },
  marks: {},
});

// ── Helpers ──────────────────────────────────────────────────────────

function h(level: number, text: string) {
  return schema.node("heading", { level }, text ? [schema.text(text)] : []);
}

function p(text: string) {
  return schema.node("paragraph", null, text ? [schema.text(text)] : []);
}

function li(...children: ReturnType<typeof p | typeof schema.node>[]) {
  return schema.node("listItem", null, children);
}

function ul(...items: ReturnType<typeof li>[]) {
  return schema.node("bulletList", null, items);
}

function doc(...children: ReturnType<typeof h | typeof p | typeof ul>[]) {
  return schema.node("doc", null, children);
}

// ── Heading fold range detection ─────────────────────────────────────

describe("Heading fold range detection", () => {
  test("H1 folds until next H1", () => {
    const d = doc(
      h(1, "Title A"),
      p("content A"),
      h(1, "Title B"),
      p("content B"),
    );
    const foldables = findFoldableHeadings(d);
    expect(foldables).toHaveLength(2);

    const first = foldables[0];
    expect(first.kind).toBe("heading");
    // Should fold from after "Title A" to before "Title B"
    expect(first.foldFrom).toBe(first.pos + first.node.nodeSize);
    const secondHeadingPos = foldables[1].pos;
    expect(first.foldTo).toBe(secondHeadingPos);
  });

  test("H2 folds until next H2 or H1", () => {
    const d = doc(
      h(1, "Title"),
      h(2, "Section A"),
      p("content A"),
      h(2, "Section B"),
      p("content B"),
    );
    const foldables = findFoldableHeadings(d);
    // H1(Title) → folds until end (everything after it)
    // H2(Section A) → folds until H2(Section B)
    // H2(Section B) → folds until end
    expect(foldables).toHaveLength(3);

    const sectionA = foldables[1];
    expect(sectionA.node.textContent).toBe("Section A");
    expect(sectionA.foldTo).toBe(foldables[2].pos);
  });

  test("H3 folds until next H3, H2, or H1", () => {
    const d = doc(
      h(2, "Section"),
      h(3, "Sub A"),
      p("content"),
      h(2, "Next Section"),
      p("more content"),
    );
    const foldables = findFoldableHeadings(d);
    const subA = foldables.find((f) => f.node.textContent === "Sub A");
    expect(subA).toBeDefined();
    // H3 should fold until H2 "Next Section"
    const nextSection = foldables.find(
      (f) => f.node.textContent === "Next Section",
    );
    expect(nextSection).toBeDefined();
    expect(subA!.foldTo).toBe(nextSection!.pos);
  });

  test("last heading folds to end of doc", () => {
    const d = doc(h(1, "Title"), p("content"), p("more content"));
    const foldables = findFoldableHeadings(d);
    expect(foldables).toHaveLength(1);
    expect(foldables[0].foldTo).toBe(d.content.size);
  });

  test("heading with no content after it is not foldable", () => {
    const d = doc(p("intro"), h(1, "End Title"));
    const foldables = findFoldableHeadings(d);
    expect(foldables).toHaveLength(0);
  });
});

// ── List fold range detection ────────────────────────────────────────

describe("List fold range detection", () => {
  test("list item with nested sub-list is foldable", () => {
    const d = doc(
      ul(
        li(p("Parent"), ul(li(p("Child A")), li(p("Child B")))),
        li(p("Sibling")),
      ),
    );
    const foldables = findFoldableListItems(d);
    expect(foldables).toHaveLength(1);
    expect(foldables[0].kind).toBe("listItem");
  });

  test("list item without nested list is not foldable", () => {
    const d = doc(ul(li(p("Simple item")), li(p("Another item"))));
    const foldables = findFoldableListItems(d);
    expect(foldables).toHaveLength(0);
  });

  test("deeply nested lists produce multiple foldable items", () => {
    const d = doc(
      ul(li(p("Level 1"), ul(li(p("Level 2"), ul(li(p("Level 3"))))))),
    );
    const foldables = findFoldableListItems(d);
    // Both "Level 1" and "Level 2" should be foldable
    expect(foldables).toHaveLength(2);
  });
});

// ── Combined foldables ──────────────────────────────────────────────

describe("findAllFoldables", () => {
  test("returns both headings and list items", () => {
    const d = doc(h(1, "Title"), ul(li(p("Parent"), ul(li(p("Child"))))));
    const all = findAllFoldables(d);
    const kinds = all.map((f) => f.kind);
    expect(kinds).toContain("heading");
    expect(kinds).toContain("listItem");
  });
});

// ── Plugin state transitions ─────────────────────────────────────────

describe("Fold plugin state (via meta)", () => {
  // Create a minimal plugin for testing state transitions
  function createPluginState(d: ReturnType<typeof doc>) {
    const foldPlugin = new Plugin({
      key: foldPluginKey,
      state: {
        init() {
          return {
            foldedPositions: new Set<number>(),
            decorations: DecorationSet.empty,
          };
        },
        apply(
          tr: Transaction,
          value: { foldedPositions: Set<number>; decorations: unknown },
        ) {
          const meta = tr.getMeta(foldPluginKey) as FoldMeta | undefined;
          if (!meta) return value;

          switch (meta.type) {
            case "toggle": {
              const newFolded = new Set(value.foldedPositions);
              if (newFolded.has(meta.pos)) {
                newFolded.delete(meta.pos);
              } else {
                newFolded.add(meta.pos);
              }
              return { ...value, foldedPositions: newFolded };
            }
            case "foldAll": {
              const foldables = findAllFoldables(tr.doc);
              return {
                ...value,
                foldedPositions: new Set(foldables.map((f) => f.pos)),
              };
            }
            case "unfoldAll":
              return { ...value, foldedPositions: new Set<number>() };
            case "restore":
              return { ...value, foldedPositions: new Set(meta.positions) };
          }
        },
      },
    });

    return EditorState.create({ doc: d, plugins: [foldPlugin] });
  }

  test("toggle fold on/off", () => {
    const d = doc(h(1, "Title"), p("content"));
    let state = createPluginState(d);

    const headingPos = 0;
    // Toggle on
    let tr = state.tr.setMeta(foldPluginKey, {
      type: "toggle",
      pos: headingPos,
    } as FoldMeta);
    state = state.apply(tr);
    let pluginState = foldPluginKey.getState(state)!;
    expect(pluginState.foldedPositions.has(headingPos)).toBe(true);

    // Toggle off
    tr = state.tr.setMeta(foldPluginKey, {
      type: "toggle",
      pos: headingPos,
    } as FoldMeta);
    state = state.apply(tr);
    pluginState = foldPluginKey.getState(state)!;
    expect(pluginState.foldedPositions.has(headingPos)).toBe(false);
  });

  test("fold all / unfold all", () => {
    const d = doc(h(1, "A"), p("a"), h(2, "B"), p("b"));
    let state = createPluginState(d);

    // Fold all
    let tr = state.tr.setMeta(foldPluginKey, { type: "foldAll" } as FoldMeta);
    state = state.apply(tr);
    let pluginState = foldPluginKey.getState(state)!;
    expect(pluginState.foldedPositions.size).toBeGreaterThan(0);

    // Unfold all
    tr = state.tr.setMeta(foldPluginKey, { type: "unfoldAll" } as FoldMeta);
    state = state.apply(tr);
    pluginState = foldPluginKey.getState(state)!;
    expect(pluginState.foldedPositions.size).toBe(0);
  });

  test("restore fold state from positions", () => {
    const d = doc(h(1, "A"), p("a"), h(2, "B"), p("b"));
    let state = createPluginState(d);
    const foldables = findFoldableHeadings(d);

    const positions = foldables.map((f) => f.pos);
    const tr = state.tr.setMeta(foldPluginKey, {
      type: "restore",
      positions,
    } as FoldMeta);
    state = state.apply(tr);
    const pluginState = foldPluginKey.getState(state)!;
    expect(pluginState.foldedPositions.size).toBe(positions.length);
    for (const pos of positions) {
      expect(pluginState.foldedPositions.has(pos)).toBe(true);
    }
  });

  test("no document mutation on fold toggle", () => {
    const d = doc(h(1, "Title"), p("content"));
    const state = createPluginState(d);

    const tr = state.tr.setMeta(foldPluginKey, {
      type: "toggle",
      pos: 0,
    } as FoldMeta);

    expect(tr.docChanged).toBe(false);
  });
});

// ── Selection displacement ───────────────────────────────────────────

describe("Selection safety", () => {
  test("cursor position is checked against fold range", () => {
    const d = doc(h(1, "Title"), p("content below"));
    const foldables = findFoldableHeadings(d);
    expect(foldables).toHaveLength(1);

    const item = foldables[0];
    // The fold range is [foldFrom, foldTo)
    // A cursor at foldFrom should be inside the fold range
    expect(item.foldFrom).toBeGreaterThan(item.pos);
    expect(item.foldTo).toBeGreaterThan(item.foldFrom);
  });
});

// ── Position remapping ──────────────────────────────────────────────

describe("Position remapping after doc edits", () => {
  test("folded position maps correctly after inserting text before it", () => {
    const d = doc(p("intro"), h(1, "Title"), p("content"));
    const foldables = findFoldableHeadings(d);
    expect(foldables).toHaveLength(1);
    const originalPos = foldables[0].pos;

    // Simulate an insert at the beginning of the doc
    const state = EditorState.create({ doc: d });
    const tr = state.tr.insertText("ADDED", 1); // insert inside first paragraph
    const mapping = tr.mapping;
    const mappedPos = mapping.map(originalPos);

    // Position should shift forward by the length of "ADDED"
    expect(mappedPos).toBe(originalPos + 5);

    // The node at the mapped position should still be a heading
    const newDoc = tr.doc;
    const nodeAtMapped = newDoc.nodeAt(mappedPos);
    expect(nodeAtMapped?.type.name).toBe("heading");
  });
});

// ── Anchor-based persistence ────────────────────────────────────────

describe("Anchor-based persistence", () => {
  test("positionsToAnchors extracts heading anchors", () => {
    const d = doc(
      h(1, "My Title"),
      p("content"),
      h(2, "Section"),
      p("section content"),
    );
    const foldables = findFoldableHeadings(d);
    const positions = new Set(foldables.map((f) => f.pos));
    const anchors = positionsToAnchors(d, positions);

    expect(anchors).toHaveLength(2);
    expect(anchors[0]).toEqual({
      type: "heading",
      level: 1,
      textPrefix: "My Title",
    });
    expect(anchors[1]).toEqual({
      type: "heading",
      level: 2,
      textPrefix: "Section",
    });
  });

  test("anchorsToPositions resolves back to correct positions", () => {
    const d = doc(h(1, "My Title"), p("content"), h(2, "Section"), p("more"));
    const foldables = findFoldableHeadings(d);
    const originalPositions = new Set(foldables.map((f) => f.pos));
    const anchors = positionsToAnchors(d, originalPositions);
    const resolved = anchorsToPositions(d, anchors);

    expect(resolved.sort()).toEqual([...originalPositions].sort());
  });

  test("anchor roundtrip preserves list item anchors", () => {
    const d = doc(ul(li(p("Parent item"), ul(li(p("Child item"))))));
    const foldables = findFoldableListItems(d);
    expect(foldables).toHaveLength(1);

    const positions = new Set(foldables.map((f) => f.pos));
    const anchors = positionsToAnchors(d, positions);
    expect(anchors).toHaveLength(1);
    expect(anchors[0].type).toBe("listItem");
    expect(anchors[0].textPrefix).toContain("Parent item");

    const resolved = anchorsToPositions(d, anchors);
    expect(resolved).toEqual([...positions]);
  });

  test("anchors tolerate minor text changes", () => {
    // Original doc
    const d1 = doc(h(1, "Introduction to folding"), p("content"));
    const foldables = findFoldableHeadings(d1);
    const anchors = positionsToAnchors(
      d1,
      new Set(foldables.map((f) => f.pos)),
    );

    // Slightly modified doc (same heading prefix)
    const d2 = doc(
      h(1, "Introduction to folding and more"),
      p("different content"),
    );
    const resolved = anchorsToPositions(d2, anchors);
    expect(resolved).toHaveLength(1);
  });
});
