// issue 542 — an open context menu closes on ANY mousedown, including the ones
// a NodeView control stops.
//
// Every menu dismisses itself on document mousedown. MediaToolbar and
// BlockCaption stop the NATIVE mousedown at their element so ProseMirror does
// not select the block — and a bubble-phase document listener never sees that
// click, so the block menu stayed open beside the caption editor the user had
// just opened, Delete and all. Registering the dismiss in the capture phase
// puts it before any stopPropagation; the menu's own items are exempt, since
// a click needs its mousedown to leave the menu standing.
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

const editors: Editor[] = [];

afterEach(() => {
  cleanup();
  for (const e of editors.splice(0)) e.destroy();
});

function blockMenuOpen(): boolean {
  return document.body.querySelector(".mermaid-context-menu") !== null;
}

function documentMenuOpen(): boolean {
  return document.querySelector(".context-menu") !== null;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** A rendered mermaid block above a paragraph, with the real <ContextMenu>. */
async function mountBlock() {
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
      content: [
        { attrs: { code: MERMAID }, type: "mermaidBlock" },
        { type: "paragraph" },
      ],
      type: "doc",
    });
  });
  await flush();
  act(() => {
    for (const io of MockIntersectionObserver.instances) io.triggerIntersect();
  });
  await waitFor(() => {
    expect(
      view.container.querySelector(
        '[data-type="mermaidBlock"][data-render-state="done"]',
      ),
    ).not.toBeNull();
  });
  const wrapper = view.container.querySelector<HTMLElement>(
    '[data-type="mermaidBlock"]',
  );
  if (!wrapper) throw new Error("mermaid block did not mount");
  return { editor, view, wrapper };
}

/** The real right-click on a preview-state block: the button-2 mousedown its
 *  wrapper stops, then the contextmenu. */
async function openBlockMenu(wrapper: HTMLElement) {
  fireEvent.mouseDown(wrapper, { button: 2, clientX: 20, clientY: 80 });
  fireEvent.contextMenu(wrapper, { clientX: 20, clientY: 80 });
  await flush();
  const menu = document.body.querySelector<HTMLElement>(
    ".mermaid-context-menu",
  );
  if (!menu) throw new Error("block menu did not open");
  return menu;
}

function toolbarButton(wrapper: HTMLElement, title: string): HTMLElement {
  const button = wrapper.querySelector<HTMLElement>(`button[title="${title}"]`);
  if (!button) throw new Error(`toolbar button ${title} did not mount`);
  return button;
}

describe("a block menu and the controls that stop their mousedown (issue 542)", () => {
  it("closes on a mousedown on the hover toolbar", async () => {
    const { wrapper } = await mountBlock();
    await openBlockMenu(wrapper);

    // MediaToolbar's native onmousedown stops propagation — a bubble-phase
    // dismiss never saw this.
    fireEvent.mouseDown(toolbarButton(wrapper, "Caption"), { button: 0 });
    await flush();

    expect(blockMenuOpen()).toBe(false);
  });

  it("closes on a mousedown on the caption", async () => {
    const { wrapper } = await mountBlock();
    fireEvent.click(toolbarButton(wrapper, "Caption"));
    await flush();
    const input = wrapper.querySelector<HTMLInputElement>(
      "input.block-caption-input",
    );
    if (!input) throw new Error("caption input did not mount");
    await openBlockMenu(wrapper);

    fireEvent.mouseDown(input, { button: 0 });
    await flush();

    expect(blockMenuOpen()).toBe(false);
  });

  it("stays open for a mousedown on its own item, so the click can run it", async () => {
    const { editor, wrapper } = await mountBlock();
    const menu = await openBlockMenu(wrapper);
    const remove = [...menu.querySelectorAll<HTMLElement>("button")].find(
      (b) => b.textContent?.trim() === "Delete",
    );
    if (!remove) throw new Error("Delete item did not mount");

    fireEvent.mouseDown(remove, { button: 0 });
    await flush();
    expect(blockMenuOpen()).toBe(true);

    fireEvent.click(remove);
    await flush();

    let blocks = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "mermaidBlock") blocks += 1;
      return false;
    });
    expect(blocks).toBe(0);
  });

  it("the document-level menu closes on a toolbar mousedown too", async () => {
    const { editor, view, wrapper } = await mountBlock();
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
    expect(documentMenuOpen()).toBe(true);

    fireEvent.mouseDown(toolbarButton(wrapper, "Caption"), { button: 0 });
    await flush();

    expect(documentMenuOpen()).toBe(false);
  });
});

describe("the exemption cannot be forged by document content", () => {
  // The menu root is recognised by identity (the hook's ref), not by a class
  // or attribute: DOMPurify keeps data-* attributes, so an svg source carrying
  // the marker the menus used to be recognised by would otherwise pin its own
  // menu open under every click on the diagram.
  it("an svg root claiming to be the menu still dismisses it on mousedown", async () => {
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
        content: [
          {
            attrs: {
              code: '<svg data-block-menu="" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
            },
            type: "svgBlock",
          },
          { type: "paragraph" },
        ],
        type: "doc",
      });
    });
    await flush();
    const wrapper = view.container.querySelector<HTMLElement>(
      '[data-type="svgBlock"]',
    );
    if (!wrapper) throw new Error("svg block did not mount");

    fireEvent.mouseDown(wrapper, { button: 2, clientX: 20, clientY: 80 });
    fireEvent.contextMenu(wrapper, { clientX: 20, clientY: 80 });
    await flush();
    expect(document.body.querySelector(".svg-context-menu")).not.toBeNull();

    // Query the diagram after the menu opened. When this was written the view
    // re-applied dangerouslySetInnerHTML on every render (React 19 compares
    // the `{__html}` object by identity), so an element grabbed earlier was
    // detached by now; since issue 549 the element survives the re-render and
    // the order no longer matters. Kept as the form that holds either way.
    const rendered = wrapper.querySelector<HTMLElement>(
      ".svg-block-render svg",
    );
    if (!rendered) throw new Error("svg block did not render");
    expect(rendered.hasAttribute("data-block-menu")).toBe(true);

    fireEvent.mouseDown(rendered, { button: 0 });
    await flush();

    expect(document.body.querySelector(".svg-context-menu")).toBeNull();
  });
});
