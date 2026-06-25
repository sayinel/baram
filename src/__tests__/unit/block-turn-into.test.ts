import { describe, expect, it } from "vitest";

import { buildTurnIntoItems } from "../../utils/toolbar/block-turn-into";
import { makeTestEditor } from "../helpers/make-test-editor";

describe("buildTurnIntoItems", () => {
  it("converts a paragraph to Heading 1", () => {
    const editor = makeTestEditor("<p>Hello</p>");
    const items = buildTurnIntoItems(editor, 0);
    const h1 = items.find((i) => i.label === "Heading 1")!;
    expect(h1).toBeTruthy();
    h1.run();
    expect(editor.state.doc.firstChild!.type.name).toBe("heading");
    expect(editor.state.doc.firstChild!.attrs.level).toBe(1);
  });

  it("marks the current type active", () => {
    const editor = makeTestEditor("<h2>Title</h2>");
    const items = buildTurnIntoItems(editor, 0);
    expect(items.find((i) => i.label === "Heading 2")!.isActive).toBe(true);
    expect(items.find((i) => i.label === "Text")!.isActive).toBe(false);
  });

  it("is a no-op when converting to the already-active type", () => {
    const editor = makeTestEditor("<h2>Title</h2>");
    const items = buildTurnIntoItems(editor, 0);
    items.find((i) => i.label === "Heading 2")!.run();
    expect(editor.state.doc.firstChild!.type.name).toBe("heading");
    expect(editor.state.doc.firstChild!.attrs.level).toBe(2);
  });

  it.each([4, 5, 6])("converts a paragraph to Heading %i", (level) => {
    const editor = makeTestEditor("<p>Hello</p>");
    const item = buildTurnIntoItems(editor, 0).find(
      (i) => i.label === `Heading ${level}`,
    )!;
    expect(item).toBeTruthy();
    item.run();
    expect(editor.state.doc.firstChild!.type.name).toBe("heading");
    expect(editor.state.doc.firstChild!.attrs.level).toBe(level);
  });

  it("converts a paragraph to a Toggle, keeping its text as the summary", () => {
    const editor = makeTestEditor("<p>Hello</p>");
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
    const editor = makeTestEditor("<p>Hello</p>");
    buildTurnIntoItems(editor, 0)
      .find((i) => i.label === "Toggle")!
      .run();
    // After wrapping, the top-level block at pos 0 is the toggle itself.
    const items = buildTurnIntoItems(editor, 0);
    expect(items.find((i) => i.label === "Toggle")!.isActive).toBe(true);
  });
});
