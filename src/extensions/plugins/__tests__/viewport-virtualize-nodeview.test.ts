import { Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { makeBlockNodeView } from "../viewport-virtualize";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "text*",
      group: "block",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    text: {},
  },
});

function noopController() {
  return { register() {}, unregister() {} } as never;
}

describe("makeBlockNodeView", () => {
  it("renders via the node's own toDOM (faithful passthrough)", () => {
    const node = schema.node("paragraph", null, [schema.text("hi")]);
    const nv = makeBlockNodeView(node, noopController());
    expect(nv.dom.tagName).toBe("P");
    expect(nv.contentDOM).toBe(nv.dom); // <p> is its own content hole
  });

  it("setHidden toggles display:none on the wrapper dom", () => {
    const node = schema.node("paragraph", null, [schema.text("hi")]);
    const nv = makeBlockNodeView(node, noopController());
    nv.setHidden(true);
    expect(nv.dom.style.display).toBe("none");
    nv.setHidden(false);
    expect(nv.dom.style.display).toBe("");
  });

  it("ignores attribute mutations on its own dom but not content edits", () => {
    const node = schema.node("paragraph", null, [schema.text("hi")]);
    const nv = makeBlockNodeView(node, noopController());
    expect(
      nv.ignoreMutation!({ target: nv.dom, type: "attributes" } as never),
    ).toBe(true);
    const child = nv.contentDOM!.firstChild as Node;
    expect(
      nv.ignoreMutation!({ target: child, type: "childList" } as never),
    ).toBe(false);
  });
});
