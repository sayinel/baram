import { Editor } from "@tiptap/core";
// Regression: clicking a list item's fold arrow must actually fold it.
// Previously the mousedown handler resolved the clicked widget to depth-1
// (`before(1)`), which yields the parent LIST's position rather than the
// listItem's — so the toggle dispatch was a silent no-op for every list item.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../index";
import { foldPluginKey } from "../fold";

describe("Fold: list item fold arrow click", () => {
  let editor: Editor;
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: createBaramExtensions(),
      content: `
        <ul>
          <li><p>Top item with children</p>
            <ul><li><p>child a</p></li><li><p>child b</p></li></ul>
          </li>
          <li><p>Plain item</p></li>
        </ul>
      `,
    });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it("a top-level list item with a sub-list renders a fold arrow", () => {
    const arrow = editor.view.dom.querySelector(".fold-arrow");
    expect(arrow).not.toBeNull();
  });

  it("clicking the fold arrow folds the owning list item (not a no-op)", () => {
    const arrow = editor.view.dom.querySelector(".fold-arrow") as HTMLElement;
    expect(arrow).not.toBeNull();

    const before = foldPluginKey.getState(editor.state)!.foldedPositions.size;
    expect(before).toBe(0);

    // Simulate the real click path through the plugin's handleDOMEvents.
    arrow.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );

    const after = foldPluginKey.getState(editor.state)!.foldedPositions;
    expect(after.size).toBe(1);

    // The folded position must resolve to a listItem (the owning item), not the
    // wrapping list — that was the depth bug.
    const foldedPos = [...after][0];
    const node = editor.state.doc.nodeAt(foldedPos);
    expect(node?.type.name).toBe("listItem");

    // And the sub-list content is hidden (fold-hidden decoration applied).
    expect(editor.view.dom.querySelector(".fold-hidden")).not.toBeNull();
  });

  it("clicking again unfolds it", () => {
    const arrow = editor.view.dom.querySelector(".fold-arrow") as HTMLElement;
    arrow.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(foldPluginKey.getState(editor.state)!.foldedPositions.size).toBe(1);

    const arrow2 = editor.view.dom.querySelector(".fold-arrow") as HTMLElement;
    arrow2.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(foldPluginKey.getState(editor.state)!.foldedPositions.size).toBe(0);
  });
});
