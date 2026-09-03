// issue 521 (final review) — one context menu at a time, across blocks and
// the document-level menu.
//
// Every menu dismisses itself on document mousedown. But a diagram block in
// preview state stops the right-button mousedown at its wrapper (so
// ProseMirror will not select it and flip it into editing), and that same
// stop hides the mousedown from every OTHER menu's dismiss listener. Open a
// menu on block A, right-click block B: A's menu used to stay open next to
// B's, Delete and all, each bound to a different block. The fix is a
// document-level "close all" signal sent right before any menu opens or
// yields to the browser; these tests drive the full mousedown + contextmenu
// sequence across two blocks.
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
  invoke: vi.fn(async () => undefined),
}));
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (id: string) => ({
      svg: `<svg id="${id}" viewBox="0 0 200 100" width="200" height="100"><g><text>Start</text></g></svg>`,
    })),
  },
}));

import { createBaramExtensions } from "../../../extensions";
import { ContextMenu } from "../ContextMenu";

declare const MockIntersectionObserver: {
  instances: { triggerIntersect: (v?: boolean) => void }[];
};

const MERMAID = "flowchart LR\n  A --> B";
const SVG = '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';

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

/** Mount a doc of [blockA, paragraph, blockB, paragraph] with the real
 *  <ContextMenu>, render every mermaid block, and return the two wrappers. */
async function mountPair(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
) {
  const editor = new Editor({ extensions: createBaramExtensions() });
  editors.push(editor);
  const view = render(
    <>
      <EditorContent editor={editor} />
      <ContextMenu editor={editor} />
    </>,
  );
  act(() => {
    editor.commands.setContent({
      content: [a, { type: "paragraph" }, b, { type: "paragraph" }],
      type: "doc",
    });
  });
  await flush();
  act(() => {
    for (const io of MockIntersectionObserver.instances) io.triggerIntersect();
  });
  await waitFor(() => {
    expect(
      view.container.querySelectorAll(
        '[data-type="mermaidBlock"]:not([data-render-state="done"])',
      ).length,
    ).toBe(0);
  });
  const wrappers = view.container.querySelectorAll<HTMLElement>(
    '[data-type="mermaidBlock"], [data-type="svgBlock"]',
  );
  if (wrappers.length !== 2) throw new Error("two blocks did not mount");
  return { editor, view, wrapperA: wrappers[0], wrapperB: wrappers[1] };
}

/** Block A (pos 0) into its edit session, then its own menu via the live
 *  preview. */
async function openMenuOnEditingA(editor: Editor, wrapperA: HTMLElement) {
  act(() => {
    editor.commands.setNodeSelection(0);
  });
  await flush();
  const preview = wrapperA.querySelector<HTMLElement>(
    ".mermaid-block-svg, .svg-block-render-faded",
  );
  if (!preview) throw new Error("editing-state preview did not mount");
  fireEvent.contextMenu(preview, { clientX: 20, clientY: 80 });
  await flush();
}

/** Labels of every item the document-level menu currently shows. */
function documentMenuLabels(): string[] {
  return [...document.querySelectorAll(".context-menu .context-menu-item")].map(
    (el) => el.textContent?.trim() ?? "",
  );
}

function menus(selector: string): HTMLElement[] {
  return [...document.body.querySelectorAll<HTMLElement>(selector)];
}

/** The real right-click sequence on a preview-state block: the button-2
 *  mousedown its wrapper stops, then the contextmenu. */
async function rightClickPreview(wrapper: HTMLElement, x: number, y: number) {
  fireEvent.mouseDown(wrapper, { button: 2, clientX: x, clientY: y });
  fireEvent.contextMenu(wrapper, { clientX: x, clientY: y });
  await flush();
}

describe("one context menu at a time (issue 521)", () => {
  it("opening block B's menu closes block A's — two mermaid blocks", async () => {
    const mermaid = { attrs: { code: MERMAID }, type: "mermaidBlock" };
    const { editor, wrapperA, wrapperB } = await mountPair(mermaid, mermaid);
    await openMenuOnEditingA(editor, wrapperA);
    expect(menus(".mermaid-context-menu")).toHaveLength(1);

    await rightClickPreview(wrapperB, 300, 400);

    const remaining = menus(".mermaid-context-menu");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].style.left).toBe("300px");
    expect(remaining[0].style.top).toBe("400px");
  });

  it("opening the svg block's menu closes the mermaid block's", async () => {
    const { editor, wrapperA, wrapperB } = await mountPair(
      { attrs: { code: MERMAID }, type: "mermaidBlock" },
      { attrs: { code: SVG }, type: "svgBlock" },
    );
    await openMenuOnEditingA(editor, wrapperA);
    expect(menus(".mermaid-context-menu")).toHaveLength(1);

    await rightClickPreview(wrapperB, 300, 400);

    expect(menus(".mermaid-context-menu")).toHaveLength(0);
    expect(menus(".svg-context-menu")).toHaveLength(1);
  });

  it("opening a block menu closes the document-level menu", async () => {
    const mermaid = { attrs: { code: MERMAID }, type: "mermaidBlock" };
    const { editor, view, wrapperB } = await mountPair(mermaid, mermaid);
    const paragraph = view.container.querySelector<HTMLElement>("p");
    if (!paragraph) throw new Error("paragraph did not mount");
    // jsdom has no layout — hand the generic branch a real position.
    const paragraphPos = editor.state.doc.content.size - 1;
    vi.spyOn(editor.view, "posAtCoords").mockReturnValue({
      inside: paragraphPos - 1,
      pos: paragraphPos,
    });
    fireEvent.contextMenu(paragraph, { clientX: 20, clientY: 200 });
    await flush();
    expect(documentMenuLabels().length).toBeGreaterThan(0);

    await rightClickPreview(wrapperB, 300, 400);

    expect(documentMenuLabels()).toEqual([]);
    expect(menus(".mermaid-context-menu")).toHaveLength(1);
  });

  it("yielding to the browser on block B's caption input closes block A's menu", async () => {
    // The caption opens from the toolbar button, whose mousedown is stopped
    // too — so A's menu is still open when the caption input is right-clicked.
    const mermaid = { attrs: { code: MERMAID }, type: "mermaidBlock" };
    const { editor, wrapperA, wrapperB } = await mountPair(mermaid, mermaid);
    await openMenuOnEditingA(editor, wrapperA);
    expect(menus(".mermaid-context-menu")).toHaveLength(1);
    const captionButton = wrapperB.querySelector<HTMLElement>(
      'button[title="Caption"]',
    );
    if (!captionButton) throw new Error("caption button did not mount");
    fireEvent.click(captionButton);
    await flush();
    const input = wrapperB.querySelector<HTMLInputElement>(
      "input.block-caption-input",
    );
    if (!input) throw new Error("caption input did not mount");
    expect(menus(".mermaid-context-menu")).toHaveLength(1);

    const nativeMenuAllowed = fireEvent.contextMenu(input, {
      clientX: 300,
      clientY: 420,
    });
    await flush();

    expect(nativeMenuAllowed).toBe(true);
    expect(menus(".mermaid-context-menu")).toHaveLength(0);
  });
});
