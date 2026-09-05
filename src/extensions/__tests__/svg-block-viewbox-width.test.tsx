// issue 538 — an svg with only a viewBox renders at its aspect, not at height 0.
//
// `viewBox` fixes the coordinate system and aspect ratio but not the size on
// screen. An inline <svg> without width/height gets nothing from the block's
// CSS (`height: auto` needs a width to work from), and WebKit lays it out at
// 0 height — a blank block. Figma, Excalidraw and Inkscape export exactly this
// shape. The block's render pass now gives such a root the intrinsic size its
// viewBox describes (a percentage would collapse inside the shrink-to-fit
// resize frame, as the mermaid renderer found); the source attribute is
// untouched, so the file and the resize percentage are exactly what the user
// wrote. jsdom has no layout — what is pinned is the
// attribute the browser lays out from, on every render of the block.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
  invoke: vi.fn(async () => undefined),
}));

import { createBaramExtensions } from "../index";

const VIEWBOX_ONLY =
  '<svg viewBox="0 0 160 60" xmlns="http://www.w3.org/2000/svg"><rect width="160" height="60" rx="8" fill="#4a90d9"/></svg>';
const SIZED =
  '<svg width="320" height="120" viewBox="0 0 160 60" xmlns="http://www.w3.org/2000/svg"><rect width="160" height="60"/></svg>';

const editors: Editor[] = [];

afterEach(() => {
  cleanup();
  for (const e of editors.splice(0)) e.destroy();
});

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function mountSvg(code: string) {
  const editor = new Editor({ extensions: createBaramExtensions() });
  editors.push(editor);
  const view = render(<EditorContent editor={editor} />);
  act(() => {
    editor.commands.setContent({
      content: [{ attrs: { code }, type: "svgBlock" }, { type: "paragraph" }],
      type: "doc",
    });
  });
  await flush();
  return { editor, view };
}

function renderedRoot(scope: ParentNode): SVGSVGElement {
  const svg = scope.querySelector<SVGSVGElement>(".svg-block-render svg");
  if (!svg) throw new Error("svg did not render");
  return svg;
}

function svgCodeOf(editor: Editor): string {
  let code = "";
  editor.state.doc.descendants((node) => {
    if (node.type.name === "svgBlock") code = node.attrs.code as string;
    return node.type.name !== "svgBlock";
  });
  return code;
}

describe("a viewBox-only svg block", () => {
  it("renders its root at the viewBox size while the source keeps none", async () => {
    const { editor, view } = await mountSvg(VIEWBOX_ONLY);

    expect(renderedRoot(view.container).getAttribute("width")).toBe("160");
    expect(renderedRoot(view.container).getAttribute("height")).toBe("60");
    expect(renderedRoot(view.container).getAttribute("viewBox")).toBe(
      "0 0 160 60",
    );
    expect(svgCodeOf(editor)).toBe(VIEWBOX_ONLY);
  });

  it("keeps the same rendering in the editing-state preview and the fullscreen editor", async () => {
    const { editor, view } = await mountSvg(VIEWBOX_ONLY);
    act(() => {
      editor.commands.setNodeSelection(0);
    });
    await flush();
    expect(renderedRoot(view.container).getAttribute("width")).toBe("160");

    fireEvent.click(view.getByTitle("Edit full-screen"));
    await flush();
    const modal = document.body.querySelector(".svg-fullscreen-modal");
    if (!modal) throw new Error("fullscreen editor did not open");
    expect(renderedRoot(modal).getAttribute("width")).toBe("160");
  });
});

describe("an svg that sizes itself", () => {
  it("is left exactly as written", async () => {
    const { view } = await mountSvg(SIZED);

    expect(renderedRoot(view.container).getAttribute("width")).toBe("320");
    expect(renderedRoot(view.container).getAttribute("height")).toBe("120");
  });
});
