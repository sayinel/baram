import { afterEach, describe, expect, it } from "vitest";

import { buildTurnIntoItems } from "../../utils/toolbar/block-turn-into";
import { makeTestEditor } from "../helpers/make-test-editor";

// Track every editor so afterEach can destroy it. An undestroyed editor keeps
// ProseMirror's DOMObserver flush timeout pending; when it fires after the
// jsdom env is torn down it throws "ReferenceError: document is not defined"
// (an unhandled error that fails the run even though all assertions passed).
const editors: ReturnType<typeof makeTestEditor>[] = [];
function makeEditor(html: string): ReturnType<typeof makeTestEditor> {
  const editor = makeTestEditor(html);
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("buildTurnIntoItems", () => {
  it("converts a paragraph to Heading 1", () => {
    const editor = makeEditor("<p>Hello</p>");
    const items = buildTurnIntoItems(editor, 0);
    const h1 = items.find((i) => i.label === "Heading 1")!;
    expect(h1).toBeTruthy();
    h1.run();
    expect(editor.state.doc.firstChild!.type.name).toBe("heading");
    expect(editor.state.doc.firstChild!.attrs.level).toBe(1);
  });

  it("marks the current type active", () => {
    const editor = makeEditor("<h2>Title</h2>");
    const items = buildTurnIntoItems(editor, 0);
    expect(items.find((i) => i.label === "Heading 2")!.isActive).toBe(true);
    expect(items.find((i) => i.label === "Text")!.isActive).toBe(false);
  });

  it("is a no-op when converting to the already-active type", () => {
    const editor = makeEditor("<h2>Title</h2>");
    const items = buildTurnIntoItems(editor, 0);
    items.find((i) => i.label === "Heading 2")!.run();
    expect(editor.state.doc.firstChild!.type.name).toBe("heading");
    expect(editor.state.doc.firstChild!.attrs.level).toBe(2);
  });

  it.each([4, 5, 6])("converts a paragraph to Heading %i", (level) => {
    const editor = makeEditor("<p>Hello</p>");
    const item = buildTurnIntoItems(editor, 0).find(
      (i) => i.label === `Heading ${level}`,
    )!;
    expect(item).toBeTruthy();
    item.run();
    expect(editor.state.doc.firstChild!.type.name).toBe("heading");
    expect(editor.state.doc.firstChild!.attrs.level).toBe(level);
  });

  it("converts a paragraph to a Toggle, keeping its text as the summary", () => {
    const editor = makeEditor("<p>Hello</p>");
    const toggle = buildTurnIntoItems(editor, 0).find(
      (i) => i.label === "Toggle",
    )!;
    expect(toggle).toBeTruthy();
    toggle.run();
    const first = editor.state.doc.firstChild!;
    expect(first.type.name).toBe("toggle");
    expect(first.firstChild!.type.name).toBe("paragraph"); // summary
    expect(first.textContent).toBe("Hello");
  });

  it("marks Toggle active when the block is already a toggle", () => {
    const editor = makeEditor("<p>Hello</p>");
    buildTurnIntoItems(editor, 0)
      .find((i) => i.label === "Toggle")!
      .run();
    // After wrapping, the top-level block at pos 0 is the toggle itself.
    const items = buildTurnIntoItems(editor, 0);
    expect(items.find((i) => i.label === "Toggle")!.isActive).toBe(true);
  });

  /** Wrap a paragraph into a toggle and return the editor (toggle at pos 0). */
  function makeToggleEditor() {
    const editor = makeEditor("<p>Hello</p>");
    buildTurnIntoItems(editor, 0)
      .find((i) => i.label === "Toggle")!
      .run();
    expect(editor.state.doc.firstChild!.type.name).toBe("toggle");
    return editor;
  }

  it("converts a Toggle to Text by unwrapping it", () => {
    const editor = makeToggleEditor();
    buildTurnIntoItems(editor, 0)
      .find((i) => i.label === "Text")!
      .run();
    // The toggle wrapper is gone; the summary becomes a top-level paragraph.
    expect(editor.state.doc.firstChild!.type.name).toBe("paragraph");
    expect(editor.state.doc.firstChild!.textContent).toBe("Hello");
  });

  it("converts a Toggle to Heading 1 using the summary text", () => {
    const editor = makeToggleEditor();
    buildTurnIntoItems(editor, 0)
      .find((i) => i.label === "Heading 1")!
      .run();
    expect(editor.state.doc.firstChild!.type.name).toBe("heading");
    expect(editor.state.doc.firstChild!.attrs.level).toBe(1);
    expect(editor.state.doc.firstChild!.textContent).toBe("Hello");
  });

  it("converts a paragraph to a Callout, keeping its text", () => {
    const editor = makeEditor("<p>Hello</p>");
    buildTurnIntoItems(editor, 0)
      .find((i) => i.label === "Callout")!
      .run();
    const first = editor.state.doc.firstChild!;
    expect(first.type.name).toBe("callout");
    expect(first.textContent).toBe("Hello");
  });

  it("converts a Callout to Text by unwrapping it", () => {
    const editor = makeEditor("<p>Hello</p>");
    buildTurnIntoItems(editor, 0)
      .find((i) => i.label === "Callout")!
      .run();
    expect(editor.state.doc.firstChild!.type.name).toBe("callout");
    buildTurnIntoItems(editor, 0)
      .find((i) => i.label === "Text")!
      .run();
    expect(editor.state.doc.firstChild!.type.name).toBe("paragraph");
    expect(editor.state.doc.firstChild!.textContent).toBe("Hello");
  });

  it("converts a paragraph to a Math block using its text as the formula", () => {
    const editor = makeEditor("<p>E=mc^2</p>");
    buildTurnIntoItems(editor, 0)
      .find((i) => i.label === "Math")!
      .run();
    const first = editor.state.doc.firstChild!;
    expect(first.type.name).toBe("mathBlock");
    expect(first.attrs.formula).toBe("E=mc^2");
  });
});
