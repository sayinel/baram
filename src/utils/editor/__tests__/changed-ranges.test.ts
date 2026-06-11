import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";

import { changedRanges } from "../changed-ranges";

// Minimal schema matching the pattern from programmatic-update.test.ts
const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: {},
  },
});

function makeState(text: string): EditorState {
  const para = schema.nodes.paragraph.create(
    null,
    text ? [schema.text(text)] : [],
  );
  const doc = schema.nodes.doc.create(null, [para]);
  return EditorState.create({ schema, doc });
}

describe("changedRanges", () => {
  it("returns [] when tr.docChanged is false", () => {
    const state = makeState("hello");
    const tr = state.tr; // no doc change, only e.g. selection
    expect(tr.docChanged).toBe(false);
    expect(changedRanges(tr)).toEqual([]);
  });

  it("single text insert → one small range", () => {
    const state = makeState("hello");
    // Insert " world" after position 6 (inside paragraph)
    const tr = state.tr.insertText(" world", 6);
    expect(tr.docChanged).toBe(true);
    const ranges = changedRanges(tr);
    expect(ranges).toHaveLength(1);
    // The changed range should be narrow — inside the paragraph
    expect(ranges[0].from).toBeGreaterThanOrEqual(0);
    expect(ranges[0].to).toBeLessThanOrEqual(tr.doc.content.size);
    expect(ranges[0].to - ranges[0].from).toBeLessThanOrEqual(
      " world".length + 2,
    );
  });

  it("text delete → range with from <= to", () => {
    const state = makeState("hello world");
    // Delete chars 2..5 ("llo") inside paragraph: doc positions 2..5
    const tr = state.tr.delete(2, 5);
    expect(tr.docChanged).toBe(true);
    const ranges = changedRanges(tr);
    expect(ranges.length).toBeGreaterThanOrEqual(1);
    for (const r of ranges) {
      expect(r.from).toBeLessThanOrEqual(r.to);
    }
  });

  it("two separate steps in one tr → merged or two distinct ranges", () => {
    // Build a two-paragraph doc
    const para1 = schema.nodes.paragraph.create(null, [schema.text("AAA")]);
    const para2 = schema.nodes.paragraph.create(null, [schema.text("ZZZ")]);
    const doc = schema.nodes.doc.create(null, [para1, para2]);
    const state = EditorState.create({ schema, doc });

    // Step 1: insert at position 2 (inside para1)
    // Step 2: insert at position near end of para2
    const tr = state.tr
      .insertText("X", 2) // touches para1 region
      .insertText("Y", state.doc.content.size - 1); // touches para2 region

    expect(tr.docChanged).toBe(true);
    const ranges = changedRanges(tr);
    expect(ranges.length).toBeGreaterThanOrEqual(1);
    // All ranges must be within doc bounds
    for (const r of ranges) {
      expect(r.from).toBeGreaterThanOrEqual(0);
      expect(r.to).toBeLessThanOrEqual(tr.doc.content.size);
      expect(r.from).toBeLessThanOrEqual(r.to);
    }
  });

  it("ranges are sorted and non-overlapping after merge", () => {
    const para1 = schema.nodes.paragraph.create(null, [schema.text("AAAA")]);
    const para2 = schema.nodes.paragraph.create(null, [schema.text("BBBB")]);
    const doc = schema.nodes.doc.create(null, [para1, para2]);
    const state = EditorState.create({ schema, doc });

    const tr = state.tr
      .insertText("X", 2)
      .insertText("Y", 3)
      .insertText("Z", state.doc.content.size - 1);

    const ranges = changedRanges(tr);
    for (let i = 1; i < ranges.length; i++) {
      // sorted
      expect(ranges[i].from).toBeGreaterThan(ranges[i - 1].from);
      // non-overlapping (merged)
      expect(ranges[i].from).toBeGreaterThan(ranges[i - 1].to);
    }
  });
});
