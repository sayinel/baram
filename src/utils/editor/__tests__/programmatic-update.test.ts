import { Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import {
  clearOriginalDoc,
  isTabLoading,
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
