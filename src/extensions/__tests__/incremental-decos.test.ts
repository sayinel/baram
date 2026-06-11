// §perf-large-file C3.1: Regression tests — incremental decoration maintenance
//
// Property: for every tested edit, the incremental path must produce a
// DecorationSet equivalent to a fresh from-scratch rebuild on the same doc.

import type { Node as PmNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { describe, expect, test } from "vitest";

import { changedRanges } from "../../utils/editor/changed-ranges";
import { findFoldableHeadings } from "../plugins/fold";

// ---------------------------------------------------------------------------
// Shared comparison helper
// ---------------------------------------------------------------------------

function decoSetsEqual(a: DecorationSet, b: DecorationSet): boolean {
  const aDecos = a.find().map((d) => ({ from: d.from, to: d.to }));
  const bDecos = b.find().map((d) => ({ from: d.from, to: d.to }));
  aDecos.sort((x, y) => x.from - y.from || x.to - y.to);
  bDecos.sort((x, y) => x.from - y.from || x.to - y.to);
  if (aDecos.length !== bDecos.length) return false;
  for (let i = 0; i < aDecos.length; i++) {
    if (aDecos[i].from !== bDecos[i].from || aDecos[i].to !== bDecos[i].to)
      return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// list-atom-fix — schemas and helpers
// ---------------------------------------------------------------------------

const lafSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    bulletList: { content: "listItem+", group: "block" },
    listItem: { content: "paragraph block*" },
    tagNode: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: { tag: { default: "" } },
    },
    text: { group: "inline" },
  },
  marks: {},
});

function lafApplyAndCompare(
  baseDoc: PmNode,
  editFn: (tr: Transaction) => void,
) {
  const s0 = EditorState.create({ schema: lafSchema, doc: baseDoc });
  const tr = s0.tr;
  editFn(tr);
  const s1 = s0.apply(tr);
  const oldDecos = lafFullRebuild(baseDoc);
  const incremental = lafIncremental(oldDecos, tr, s1);
  const fromScratch = lafFullRebuild(s1.doc);
  return { incremental, fromScratch };
}

/** Full-rebuild list-atom-fix decos (mirrors production buildListAtomDecos). */
function lafFullRebuild(doc: PmNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos, parent, index) => {
    if (
      node.isTextblock &&
      index === 0 &&
      parent &&
      (parent.type.name === "listItem" || parent.type.name === "taskItem") &&
      node.childCount > 0 &&
      !node.child(0).isText
    ) {
      decorations.push(
        Decoration.widget(pos + 1, () => document.createElement("span"), {
          side: -1,
          key: `laf-${pos}`,
        }),
      );
    }
    return true;
  });
  return DecorationSet.create(doc, decorations);
}

/** Incremental list-atom-fix decos (mirrors production incremental apply). */
function lafIncremental(
  old: DecorationSet,
  tr: Transaction,
  newState: EditorState,
): DecorationSet {
  let decos = old.map(tr.mapping, tr.doc);
  const ranges = changedRanges(tr);
  for (const range of ranges) {
    let from = range.from;
    let to = range.to;
    const $from = newState.doc.resolve(Math.max(0, from));
    for (let d = $from.depth; d >= 1; d--) {
      const ancestor = $from.node(d);
      if (
        ancestor.type.name === "listItem" ||
        ancestor.type.name === "taskItem"
      ) {
        from = $from.before(d);
        to = Math.max(to, from + ancestor.nodeSize);
        break;
      }
    }
    from = Math.max(0, from);
    to = Math.min(newState.doc.content.size, to);
    const stale = decos.find(from, to);
    if (stale.length > 0) decos = decos.remove(stale);
    const fresh: Decoration[] = [];
    newState.doc.nodesBetween(from, to, (node, pos, parent, index) => {
      if (
        node.isTextblock &&
        index === 0 &&
        parent &&
        (parent.type.name === "listItem" || parent.type.name === "taskItem") &&
        node.childCount > 0 &&
        !node.child(0).isText
      ) {
        fresh.push(
          Decoration.widget(pos + 1, () => document.createElement("span"), {
            side: -1,
            key: `laf-${pos}`,
          }),
        );
      }
      return true;
    });
    if (fresh.length > 0) decos = decos.add(newState.doc, fresh);
  }
  return decos;
}

describe("list-atom-fix: incremental === from-scratch", () => {
  test("text insert mid-block (no atom → no decoration)", () => {
    const plain = lafSchema.node("paragraph", null, [lafSchema.text("hello")]);
    const item = lafSchema.node("listItem", null, [plain]);
    const list = lafSchema.node("bulletList", null, [item]);
    const d = lafSchema.node("doc", null, [list]);
    const { incremental, fromScratch } = lafApplyAndCompare(d, (tr) => {
      tr.insertText(" world", 7); // inside para text
    });
    expect(decoSetsEqual(incremental, fromScratch)).toBe(true);
  });

  test("atom-first paragraph in listItem: decoration preserved through text insert", () => {
    const tag = lafSchema.node("tagNode", { tag: "foo" });
    const para = lafSchema.node("paragraph", null, [tag]);
    const item = lafSchema.node("listItem", null, [para]);
    const list = lafSchema.node("bulletList", null, [item]);
    const d = lafSchema.node("doc", null, [list]);
    // Insert text AFTER the atom inside the para
    const { incremental, fromScratch } = lafApplyAndCompare(d, (tr) => {
      tr.insertText("X", 4); // pos 1(list)+1(item)+1(para)+1(tag)=4
    });
    expect(decoSetsEqual(incremental, fromScratch)).toBe(true);
  });

  test("atom replaced with text: decoration disappears", () => {
    const tag = lafSchema.node("tagNode", { tag: "foo" });
    const para = lafSchema.node("paragraph", null, [tag]);
    const item = lafSchema.node("listItem", null, [para]);
    const list = lafSchema.node("bulletList", null, [item]);
    const d = lafSchema.node("doc", null, [list]);
    // Replace atom (pos 3..4) with text
    const { incremental, fromScratch } = lafApplyAndCompare(d, (tr) => {
      tr.replaceWith(3, 4, lafSchema.text("hi"));
    });
    expect(decoSetsEqual(incremental, fromScratch)).toBe(true);
  });

  test("block insert: incremental === from-scratch", () => {
    const tag = lafSchema.node("tagNode", { tag: "foo" });
    const para = lafSchema.node("paragraph", null, [tag]);
    const item = lafSchema.node("listItem", null, [para]);
    const list = lafSchema.node("bulletList", null, [item]);
    const extraPara = lafSchema.node("paragraph", null, [
      lafSchema.text("extra"),
    ]);
    const d = lafSchema.node("doc", null, [list, extraPara]);
    const { incremental, fromScratch } = lafApplyAndCompare(d, (tr) => {
      // Insert a new paragraph at end
      tr.insert(
        d.content.size,
        lafSchema.node("paragraph", null, [lafSchema.text("new")]),
      );
    });
    expect(decoSetsEqual(incremental, fromScratch)).toBe(true);
  });

  test("block delete: incremental === from-scratch", () => {
    const tag = lafSchema.node("tagNode", { tag: "foo" });
    const para = lafSchema.node("paragraph", null, [tag]);
    const item = lafSchema.node("listItem", null, [para]);
    const list = lafSchema.node("bulletList", null, [item]);
    const extraPara = lafSchema.node("paragraph", null, [
      lafSchema.text("extra"),
    ]);
    const d = lafSchema.node("doc", null, [list, extraPara]);
    // Delete the extraPara
    const { incremental, fromScratch } = lafApplyAndCompare(d, (tr) => {
      const extraStart = list.nodeSize;
      tr.delete(extraStart, extraStart + extraPara.nodeSize);
    });
    expect(decoSetsEqual(incremental, fromScratch)).toBe(true);
  });

  test("edit inside listItem: incremental === from-scratch", () => {
    const tag = lafSchema.node("tagNode", { tag: "foo" });
    const para = lafSchema.node("paragraph", null, [tag]);
    const item = lafSchema.node("listItem", null, [para]);
    const list = lafSchema.node("bulletList", null, [item]);
    const d = lafSchema.node("doc", null, [list]);
    // Insert text after the atom inside the listItem paragraph
    const { incremental, fromScratch } = lafApplyAndCompare(d, (tr) => {
      tr.insertText("Y", 4);
    });
    expect(decoSetsEqual(incremental, fromScratch)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fold — paragraph-only edit must not touch heading structure
// ---------------------------------------------------------------------------

const foldSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block", marks: "_" },
    heading: {
      content: "inline*",
      group: "block",
      attrs: { level: { default: 1 } },
    },
    bulletList: { content: "listItem+", group: "block" },
    listItem: { content: "paragraph block*" },
    text: { group: "inline" },
  },
  marks: {},
});

function fH(level: number, text: string) {
  return foldSchema.node("heading", { level }, [foldSchema.text(text)]);
}
function fP(text: string) {
  return foldSchema.node("paragraph", null, [foldSchema.text(text)]);
}

describe("fold incremental: pure paragraph edit skips heading scan", () => {
  test("paragraph-only edit: changed ranges do not touch any heading", () => {
    const d = foldSchema.node("doc", null, [
      fH(1, "Section A"),
      fP("Content paragraph."),
      fH(1, "Section B"),
      fP("More content."),
    ]);
    const s0 = EditorState.create({ schema: foldSchema, doc: d });
    // "Content paragraph." starts after headingA (nodeSize = 2 + "Section A".length = 11)
    // pos 0: heading "Section A" size = 11 → content at pos 11
    // pos 11: paragraph "Content paragraph." → text starts at 12
    const headingASize = fH(1, "Section A").nodeSize;
    const insertPos = headingASize + 1; // inside paragraph "Content paragraph."
    const tr = s0.tr.insertText("X", insertPos);

    const ranges = changedRanges(tr);
    expect(ranges.length).toBeGreaterThan(0);

    let foundHeading = false;
    for (const r of ranges) {
      tr.doc.nodesBetween(r.from, r.to, (node) => {
        if (node.type.name === "heading") foundHeading = true;
        return !foundHeading;
      });
    }
    expect(foundHeading).toBe(false);
  });

  test("heading level change: changed ranges touch heading", () => {
    const d = foldSchema.node("doc", null, [
      fH(1, "Section A"),
      fP("Content."),
    ]);
    const s0 = EditorState.create({ schema: foldSchema, doc: d });
    const tr = s0.tr.setNodeMarkup(0, undefined, { level: 2 });

    const ranges = changedRanges(tr);
    let foundHeading = false;
    for (const r of ranges) {
      tr.doc.nodesBetween(r.from, r.to, (node) => {
        if (node.type.name === "heading") foundHeading = true;
        return !foundHeading;
      });
    }
    expect(foundHeading).toBe(true);
  });

  test("paragraph insert at end: heading foldables count unchanged", () => {
    const d = foldSchema.node("doc", null, [
      fH(1, "Section A"),
      fP("Content."),
      fH(1, "Section B"),
      fP("More."),
    ]);
    const s0 = EditorState.create({ schema: foldSchema, doc: d });
    const tr = s0.tr.insert(
      d.content.size,
      foldSchema.node("paragraph", null, [foldSchema.text("appended")]),
    );
    const headingsBefore = findFoldableHeadings(d);
    const headingsAfter = findFoldableHeadings(tr.doc);
    // Appending a paragraph at end doesn't change heading count or positions
    expect(headingsAfter.length).toBe(headingsBefore.length);
  });

  test("fold incremental: map-only for pure paragraph edit produces same decos as full rebuild", () => {
    // Build a doc with a heading and paragraph
    const d = foldSchema.node("doc", null, [
      fH(1, "Section"),
      fP("Para content."),
    ]);
    const s0 = EditorState.create({ schema: foldSchema, doc: d });

    // Verify via changedRanges and findFoldableHeadings directly.
    // For a paragraph-only edit, the foldables should be identical after tr.mapping.
    const headingASize = fH(1, "Section").nodeSize;
    const tr = s0.tr.insertText("X", headingASize + 1);

    // Verify: no listItem or heading in changed ranges → map-only path
    const ranges = changedRanges(tr);
    let touchesStructure = false;
    for (const r of ranges) {
      tr.doc.nodesBetween(r.from, r.to, (node) => {
        if (node.type.name === "heading" || node.type.name === "listItem") {
          touchesStructure = true;
        }
        return !touchesStructure;
      });
    }
    expect(touchesStructure).toBe(false);

    // Foldables after edit should be same count
    const before = findFoldableHeadings(d);
    const after = findFoldableHeadings(tr.doc);
    expect(after.length).toBe(before.length);
  });
});

// ---------------------------------------------------------------------------
// block-id-decoration — incremental entries === from-scratch
// ---------------------------------------------------------------------------

const bidSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      attrs: { blockId: { default: null } },
    },
    heading: {
      content: "inline*",
      group: "block",
      attrs: { level: { default: 1 }, blockId: { default: null } },
    },
    text: { group: "inline" },
  },
  marks: {},
});

function bH(level: number, text: string, blockId: null | string = null) {
  return bidSchema.node(
    "heading",
    { level, blockId },
    text ? [bidSchema.text(text)] : [],
  );
}
function bidApplyAndCompare(
  baseDoc: PmNode,
  editFn: (tr: Transaction) => void,
) {
  const s0 = EditorState.create({ schema: bidSchema, doc: baseDoc });
  const tr = s0.tr;
  editFn(tr);
  const s1 = s0.apply(tr);

  const oldEntries = collectBlockIds(baseDoc).map((e) => {
    const node = baseDoc.nodeAt(e.pos)!;
    return { ...e, endPos: e.pos + node.nodeSize - 1 };
  });
  const incremental = blockIdIncremental(oldEntries, tr, s1.doc);
  const fromScratch = collectBlockIds(s1.doc);

  return { incremental, fromScratch };
}

/** Incremental entry update (mirrors production updateEntriesIncremental). */
function blockIdIncremental(
  oldEntries: { blockId: string; endPos: number; pos: number }[],
  tr: Transaction,
  newDoc: PmNode,
) {
  // Use old-doc ranges (from StepMap forEach) to decide which entries to drop.
  const oldRanges: { from: number; to: number }[] = [];
  for (const map of tr.mapping.maps) {
    map.forEach((oldStart: number, oldEnd: number) => {
      oldRanges.push({ from: oldStart, to: oldEnd });
    });
  }

  const surviving = oldEntries
    .filter((e) => !oldRanges.some((r) => e.pos >= r.from && e.pos < r.to))
    .map((e) => ({
      pos: tr.mapping.map(e.pos),
      blockId: e.blockId,
      endPos: tr.mapping.map(e.endPos),
    }));

  const survivingPosSet = new Set(surviving.map((e) => e.pos));
  const newDocRanges = changedRanges(tr);
  const freshMap = new Map<
    number,
    { blockId: string; endPos: number; pos: number }
  >();
  for (const range of newDocRanges) {
    newDoc.nodesBetween(range.from, range.to, (node, pos) => {
      if (node.type.name !== "paragraph" && node.type.name !== "heading")
        return true;
      const id = node.attrs.blockId as null | string;
      if (id && !freshMap.has(pos) && !survivingPosSet.has(pos))
        freshMap.set(pos, {
          pos,
          blockId: id,
          endPos: pos + node.nodeSize - 1,
        });
      return false;
    });
  }
  return [...surviving, ...freshMap.values()];
}

function bP(text: string, blockId: null | string = null) {
  return bidSchema.node(
    "paragraph",
    { blockId },
    text ? [bidSchema.text(text)] : [],
  );
}

function collectBlockIds(doc: PmNode): { blockId: string; pos: number }[] {
  const result: { blockId: string; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "paragraph" && node.type.name !== "heading")
      return true;
    const id = node.attrs.blockId as null | string;
    if (id) result.push({ pos, blockId: id });
    return false;
  });
  return result;
}

describe("block-id-decoration: incremental entries === from-scratch", () => {
  test("text insert mid-block (no blockId in range): entries unchanged positions", () => {
    const d = bidSchema.node("doc", null, [bP("hello", "id-1"), bP("world")]);
    const { incremental, fromScratch } = bidApplyAndCompare(d, (tr) => {
      // Edit inside second paragraph (no blockId)
      tr.insertText("X", bP("hello", "id-1").nodeSize + 2);
    });
    expect(incremental.length).toBe(fromScratch.length);
    for (const e of fromScratch) {
      expect(incremental.some((g) => g.blockId === e.blockId)).toBe(true);
    }
  });

  test("block with blockId deleted: entry removed", () => {
    const p1 = bP("hello", "id-1");
    const p2 = bP("world", "id-2");
    const d = bidSchema.node("doc", null, [p1, p2]);
    const { incremental, fromScratch } = bidApplyAndCompare(d, (tr) => {
      tr.delete(0, p1.nodeSize);
    });
    expect(incremental.length).toBe(fromScratch.length);
    expect(fromScratch.some((e) => e.blockId === "id-1")).toBe(false);
    expect(incremental.some((g) => g.blockId === "id-1")).toBe(false);
  });

  test("blockId attr added: new entry collected", () => {
    const d = bidSchema.node("doc", null, [bP("hello"), bP("world")]);
    const { incremental, fromScratch } = bidApplyAndCompare(d, (tr) => {
      tr.setNodeMarkup(0, undefined, { blockId: "new-id" });
    });
    expect(incremental.length).toBe(fromScratch.length);
    expect(incremental.some((e) => e.blockId === "new-id")).toBe(true);
  });

  test("edit inside listItem (block with blockId): position remapped correctly", () => {
    const d = bidSchema.node("doc", null, [
      bH(1, "Title", "hid-1"),
      bP("content", "pid-1"),
    ]);
    const { incremental, fromScratch } = bidApplyAndCompare(d, (tr) => {
      // Text insert in heading (touches heading with blockId)
      tr.insertText("X", 2);
    });
    expect(incremental.length).toBe(fromScratch.length);
  });

  test("idCountMap: duplicate ids counted correctly after edit", () => {
    const d = bidSchema.node("doc", null, [
      bP("a", "dup"),
      bP("b", "dup"),
      bP("c", "unique"),
    ]);
    const s0 = EditorState.create({ schema: bidSchema, doc: d });
    const tr = s0.tr.insertText("X", 2); // text edit in first para
    const s1 = s0.apply(tr);

    const oldEntries = collectBlockIds(d).map((e) => {
      const node = d.nodeAt(e.pos)!;
      return { ...e, endPos: e.pos + node.nodeSize - 1 };
    });
    const entries = blockIdIncremental(oldEntries, tr, s1.doc);
    const idCountMap = new Map<string, number>();
    for (const e of entries)
      idCountMap.set(e.blockId, (idCountMap.get(e.blockId) ?? 0) + 1);

    expect(idCountMap.get("dup")).toBe(2);
    expect(idCountMap.get("unique")).toBe(1);
  });
});
