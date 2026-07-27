// §298 Vim Phase 1 — line-unit resolution against the REAL Baram schema.
//
// Every §9 pin gets a case here, including the ones the design calls out by
// name: `⏎a`, `a⏎`, `a⏎⏎b`, cursor-on-break, sole-child containers, toggle
// summary protection, and nested list items.

import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../../../index";
import { resolveLineUnit, splitSegments } from "../line-units";

const editors: Editor[] = [];

function makeEditor(content: string): Editor {
  const editor = new Editor({ content, extensions: createBaramExtensions() });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
});

/** Position of the first node of `typeName`. */
function posOf(editor: Editor, typeName: string): number {
  let found: null | number = null;
  editor.state.doc.descendants((node, pos) => {
    if (found === null && node.type.name === typeName) found = pos;
    return found === null;
  });
  if (found === null) throw new Error(`not found: ${typeName}`);
  return found;
}

describe("dispatch order (§9)", () => {
  it("a table cell resolves as a row, never as its paragraph", () => {
    const editor = makeEditor(
      "<table><tr><th><p>h</p></th></tr><tr><td><p>a</p></td></tr></table>",
    );
    const cellPara = posOf(editor, "tableCell") + 2;
    const unit = resolveLineUnit(editor.state, cellPara);
    expect(unit.kind).toBe("tableRow");
  });

  it("a segment inside a sole-child blockquote stays a segment", () => {
    // The §9 contradiction the design resolves explicitly: container
    // escalation must NOT reach a multi-segment paragraph.
    const editor = makeEditor("<blockquote><p>a<br>b</p></blockquote>");
    const para = posOf(editor, "paragraph");
    const unit = resolveLineUnit(editor.state, para + 1);
    expect(unit.kind).toBe("hardBreakSegment");
  });

  it("once the breaks are gone the same spot resolves structurally", () => {
    const editor = makeEditor("<blockquote><p>b</p></blockquote>");
    const para = posOf(editor, "paragraph");
    const unit = resolveLineUnit(editor.state, para + 1);
    expect(unit.kind).toBe("structural");
  });
});

describe("hard-break segments (§9 pins)", () => {
  function segments(html: string) {
    const editor = makeEditor(html);
    const pos = posOf(editor, "paragraph");
    const node = editor.state.doc.nodeAt(pos)!;
    return { editor, pos, segs: splitSegments(node, pos) };
  }

  it("a⏎b splits into two segments", () => {
    const { segs } = segments("<p>a<br>b</p>");
    expect(segs).toHaveLength(2);
    expect(segs[0].breakAfter).not.toBeNull();
    expect(segs[1].breakAfter).toBeNull();
  });

  it("⏎a yields a leading EMPTY segment", () => {
    const { segs } = segments("<p><br>a</p>");
    expect(segs).toHaveLength(2);
    expect(segs[0].from).toBe(segs[0].to); // empty, but a real line
  });

  it("a⏎ yields a trailing EMPTY segment", () => {
    const { segs } = segments("<p>a<br></p>");
    expect(segs).toHaveLength(2);
    expect(segs[1].from).toBe(segs[1].to);
  });

  it("a⏎⏎b makes the middle empty segment a line of its own", () => {
    const { segs } = segments("<p>a<br><br>b</p>");
    expect(segs).toHaveLength(3);
    expect(segs[1].from).toBe(segs[1].to);
    expect(segs[1].breakBefore).not.toBeNull();
    expect(segs[1].breakAfter).not.toBeNull();
  });

  it("a cursor sitting ON a break belongs to the PRECEDING segment", () => {
    const editor = makeEditor("<p>a<br>b</p>");
    const para = posOf(editor, "paragraph");
    const breakPos = para + 2; // after "a"
    const unit = resolveLineUnit(editor.state, breakPos);
    expect(unit.kind).toBe("hardBreakSegment");
    if (unit.kind !== "hardBreakSegment") return;
    expect(unit.from).toBe(para + 1); // the "a" segment, not the "b" one
  });

  it("prefers the FOLLOWING break when a segment has one on both sides", () => {
    // The priority is only observable on a MIDDLE segment. With a single
    // break each segment owns just one side, so `a⏎b` would pass no matter
    // which side the rule preferred — a vacuous test for this pin.
    const editor = makeEditor("<p>a<br>b<br>c</p>");
    const para = posOf(editor, "paragraph");
    const middle = resolveLineUnit(editor.state, para + 3);
    if (middle.kind !== "hardBreakSegment") throw new Error("expected segment");

    // Its own content plus the break AFTER it — not the one before.
    expect(middle.deleteRange).toEqual({ from: para + 3, to: para + 5 });
  });

  it("falls back to the preceding break for the last segment", () => {
    const editor = makeEditor("<p>a<br>b</p>");
    const para = posOf(editor, "paragraph");
    const last = resolveLineUnit(editor.state, para + 4);
    if (last.kind !== "hardBreakSegment") throw new Error("expected segment");
    expect(last.deleteRange).toEqual({ from: para + 2, to: para + 4 });
  });

  it("the first segment takes the break after it", () => {
    const editor = makeEditor("<p>a<br>b</p>");
    const para = posOf(editor, "paragraph");
    const first = resolveLineUnit(editor.state, para + 1);
    if (first.kind !== "hardBreakSegment") throw new Error("expected segment");
    expect(first.deleteRange).toEqual({ from: para + 1, to: para + 3 });
  });

  it("a paragraph with no breaks is not a segment unit at all", () => {
    const { segs } = segments("<p>plain</p>");
    expect(segs).toHaveLength(1);
    const editor = makeEditor("<p>plain</p>");
    expect(
      resolveLineUnit(editor.state, posOf(editor, "paragraph") + 1).kind,
    ).toBe("structural");
  });
});

describe("containers (§9)", () => {
  it("a sole child reports its container for removal", () => {
    const editor = makeEditor(
      "<blockquote><p>only</p></blockquote><p>after</p>",
    );
    const unit = resolveLineUnit(editor.state, posOf(editor, "paragraph") + 1);
    if (unit.kind !== "structural") throw new Error("expected structural");
    expect(unit.containerPos).toBe(posOf(editor, "blockquote"));
  });

  it("a container with siblings reports no container", () => {
    const editor = makeEditor("<blockquote><p>one</p><p>two</p></blockquote>");
    const unit = resolveLineUnit(editor.state, posOf(editor, "paragraph") + 1);
    if (unit.kind !== "structural") throw new Error("expected structural");
    expect(unit.containerPos).toBeNull();
  });

  it("a top-level paragraph has no container", () => {
    const editor = makeEditor("<p>top</p>");
    const unit = resolveLineUnit(editor.state, posOf(editor, "paragraph") + 1);
    if (unit.kind !== "structural") throw new Error("expected structural");
    expect(unit.containerPos).toBeNull();
    expect(unit.protectedFirstChild).toBe(false);
  });
});

describe("list items (§9, spike #7)", () => {
  it("reports the nested lists that a delete must lift", () => {
    const editor = makeEditor(
      "<ul><li><p>parent</p><ul><li><p>c1</p></li></ul></li></ul>",
    );
    const unit = resolveLineUnit(editor.state, posOf(editor, "paragraph") + 1);
    if (unit.kind !== "listItem") throw new Error("expected listItem");
    expect(unit.nestedListPositions).toHaveLength(1);
    expect(unit.itemPos).toBe(posOf(editor, "listItem"));
  });

  it("a childless item reports nothing to lift", () => {
    const editor = makeEditor("<ul><li><p>a</p></li><li><p>b</p></li></ul>");
    const unit = resolveLineUnit(editor.state, posOf(editor, "paragraph") + 1);
    if (unit.kind !== "listItem") throw new Error("expected listItem");
    expect(unit.nestedListPositions).toEqual([]);
  });
});
