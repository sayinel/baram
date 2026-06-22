// §perf-large-file C4: controller lifecycle integration test.
//
// jsdom has no real layout, so we STUB element heights + the scroll container's
// clientHeight and drive the controller directly. This can't measure real
// dispatch latency (that needs a browser), but it DOES exercise the exact
// lifecycle bugs the GUI sessions surfaced:
//   1. reconcile() hides off-screen blocks (display:none) and keeps the band.
//   2. the controller REVIVES after ProseMirror destroys+recreates plugin views
//      on a reconfigure (registerPlugin — what @tiptap/react menus do). Before
//      the fix the controller stayed permanently `destroyed` → windowing died.
//   3. reconcile re-windows when the block count grows (progressive load).
import { Editor } from "@tiptap/core";
import { Node } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { Plugin } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import { Paragraph } from "../../nodes/paragraph";
import {
  _activeControllerForTest,
  ViewportVirtualize,
} from "../viewport-virtualize";

const BLOCK_H = 30;
const CLIENT_H = 200;
const editors: Editor[] = [];

// A node named like a HEAVY type → ViewportVirtualize does NOT wrap it in a
// generic NodeView, so the controller treats it as non-windowable (never hides
// it — it owns its own lazy-mount). Mirrors codeBlock/math/mermaid/table.
const HeavyBlock = Node.create({
  content: "text*",
  group: "block",
  name: "codeBlock",
  parseHTML: () => [{ tag: "pre" }],
  renderHTML: () => ["pre", 0],
});

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
  document.body.innerHTML = "";
});

function hiddenCount(editor: Editor): number {
  return (Array.from(editor.view.dom.children) as HTMLElement[]).filter(
    (el) => el.style.display === "none",
  ).length;
}

function makeEditor(paragraphCount: number): Editor {
  const scroller = document.createElement("div");
  scroller.className = "editor-area-scroll";
  document.body.appendChild(scroller);
  Object.defineProperty(scroller, "clientHeight", {
    configurable: true,
    get: () => CLIENT_H,
  });
  const editor = new Editor({
    content: {
      content: Array.from({ length: paragraphCount }, (_, i) => ({
        content: [{ text: `p${i}`, type: "text" }],
        type: "paragraph",
      })),
      type: "doc",
    },
    element: scroller,
    extensions: [
      Document,
      Paragraph,
      Text,
      HeavyBlock,
      ViewportVirtualize.configure({ isEnabled: () => true }),
    ],
  });
  editors.push(editor);
  return editor;
}

/** Stub offsetHeight on every current top-level block (jsdom returns 0). */
function stubHeights(editor: Editor): void {
  for (const el of Array.from(editor.view.dom.children) as HTMLElement[]) {
    Object.defineProperty(el, "offsetHeight", {
      configurable: true,
      get: () => BLOCK_H,
    });
  }
}

describe("VirtualizeController lifecycle", () => {
  it("hides off-screen blocks on reconcile and keeps the top of the band visible", () => {
    const editor = makeEditor(200);
    stubHeights(editor);
    const c = _activeControllerForTest();
    expect(c).not.toBeNull();
    c!.reconcile();

    // band ≈ (clientHeight + idle buffer) / blockH = (200 + 600) / 30 ≈ 27 visible.
    const hidden = hiddenCount(editor);
    expect(hidden).toBeGreaterThan(100); // most of the 200 hidden
    expect(hidden).toBeLessThan(200); // not everything
    // first block (top of viewport) stays visible
    expect((editor.view.dom.children[0] as HTMLElement).style.display).toBe("");
    // a far off-screen block is hidden
    expect((editor.view.dom.children[199] as HTMLElement).style.display).toBe(
      "none",
    );
  });

  it("revives after a reconfigure (registerPlugin) destroys + recreates plugin views", () => {
    const editor = makeEditor(200);
    stubHeights(editor);
    _activeControllerForTest()!.reconcile();
    expect(hiddenCount(editor)).toBeGreaterThan(100);

    // Simulate @tiptap/react menus: registerPlugin reconfigures the plugin set,
    // so PM destroys+recreates ALL plugin views (including ours).
    editor.registerPlugin(new Plugin({}));
    stubHeights(editor); // re-stub in case NodeView doms were recreated

    const revived = _activeControllerForTest();
    expect(revived).not.toBeNull();
    revived!.reconcile();
    // Before the revive fix this was 0 (controller stayed `destroyed`).
    expect(hiddenCount(editor)).toBeGreaterThan(100);
  });

  it("re-windows when the document grows (progressive load)", () => {
    const editor = makeEditor(100);
    stubHeights(editor);
    const c = _activeControllerForTest()!;
    c.reconcile();
    const before = hiddenCount(editor);
    expect(before).toBeGreaterThan(0);

    // Grow the doc to mimic the progressive appender adding chunks.
    editor.commands.insertContentAt(
      editor.state.doc.content.size,
      "<p>x</p>".repeat(100),
    );
    stubHeights(editor);
    c.reconcile();

    expect(editor.view.dom.children.length).toBe(200);
    expect(hiddenCount(editor)).toBeGreaterThan(before); // more hidden now
  });

  it("never hides a non-windowable heavy block, even off-screen", () => {
    const editor = makeEditor(150);
    // Insert a heavy (codeBlock) block far down (index ~80, well off-screen).
    editor.commands.insertContentAt(posBeforeBlock(editor, 80), {
      content: [{ text: "code", type: "text" }],
      type: "codeBlock",
    });
    stubHeights(editor);
    _activeControllerForTest()!.reconcile();

    const heavy = (Array.from(editor.view.dom.children) as HTMLElement[]).find(
      (el) => el.tagName === "PRE",
    );
    expect(heavy).toBeDefined();
    // Off-screen, but must NOT be display:none — display:none removes the box a
    // lazy-visible observer needs, breaking content mount + edit-entry.
    expect(heavy!.style.display).not.toBe("none");
    // Meanwhile the windowable paragraphs around it ARE hidden.
    expect(hiddenCount(editor)).toBeGreaterThan(100);
  });
});

/** Doc position just before the Nth top-level block. */
function posBeforeBlock(editor: Editor, n: number): number {
  let pos = 0;
  editor.state.doc.forEach((node, offset, index) => {
    if (index === n) pos = offset;
  });
  return pos;
}
