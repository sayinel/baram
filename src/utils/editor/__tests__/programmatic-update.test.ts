import { Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import {
  clearOriginalDoc,
  isTabLoading,
  markContentLoaded,
  setTabLoading,
  shouldSkipDirty,
} from "../programmatic-update";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: {},
  },
});
const doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create());

const docWith = (text: string) =>
  schema.nodes.doc.create(
    null,
    schema.nodes.paragraph.create(null, text ? schema.text(text) : null),
  );

describe("loading guard", () => {
  it("skips dirty while a tab is loading, regardless of baseline", () => {
    setTabLoading("tabX", true);
    expect(isTabLoading("tabX")).toBe(true);
    expect(shouldSkipDirty("tabX", doc)).toBe(true); // suppressed during load
    setTabLoading("tabX", false);
    expect(isTabLoading("tabX")).toBe(false);
  });

  it("clearOriginalDoc clears the loading flag (tab closed mid-load)", () => {
    setTabLoading("tabY", true);
    clearOriginalDoc("tabY");
    expect(isTabLoading("tabY")).toBe(false);
  });
});

// §perf-large-file C4: the baseline comparison is O(1)-guarded by content.size
// before the deep Node.eq() walk. These assert the guard stays behaviour-
// identical to a bare eq() in every case.
describe("baseline comparison (size-guarded)", () => {
  it("captures baseline on first update after load, then skips when unchanged", () => {
    clearOriginalDoc("tab-eq");
    markContentLoaded("tab-eq");
    const base = docWith("ab");
    // First update after load captures the baseline and skips dirty.
    expect(shouldSkipDirty("tab-eq", base)).toBe(true);
    // An equal-but-distinct doc instance: same size + structurally equal → skip.
    expect(shouldSkipDirty("tab-eq", docWith("ab"))).toBe(true);
  });

  it("marks dirty when the size changed (the common typing case)", () => {
    clearOriginalDoc("tab-size");
    markContentLoaded("tab-size");
    expect(shouldSkipDirty("tab-size", docWith("ab"))).toBe(true); // baseline "ab"
    // Typing a char changes content.size → not skipped (dirty) without a walk.
    expect(shouldSkipDirty("tab-size", docWith("abc"))).toBe(false);
  });

  it("marks dirty for a same-size but different doc (guard does not over-skip)", () => {
    clearOriginalDoc("tab-same");
    markContentLoaded("tab-same");
    expect(shouldSkipDirty("tab-same", docWith("ab"))).toBe(true); // baseline "ab"
    // Same content.size, different text → falls through to eq() → dirty.
    expect(shouldSkipDirty("tab-same", docWith("cd"))).toBe(false);
  });
});
