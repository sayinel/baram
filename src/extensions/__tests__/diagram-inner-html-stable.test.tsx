// issue 549 — the diagram views keep their rendered <svg> DOM across
// re-renders that do not change the markup.
//
// React 19 re-assigns innerHTML whenever the dangerouslySetInnerHTML prop is a
// new object, and an inline `{{ __html }}` literal is a new object every
// render. Opening the block's right-click menu is such a render: nothing about
// the svg string changes, yet the browser re-parsed it and replaced the
// element — the svg element captured before the click was detached after it
// (found while writing PR 550's forgery test). The views now memoise the
// object per string (use-inner-html.ts), and this pins it the repo's way: by
// COUNT (identity + zero childList mutations), not by timing. One case per
// render site: svg preview, editing-state faded preview and fullscreen viewer
// (svgMarkup), svg fullscreen editor (fullscreenMarkup), mermaid preview and
// editing-state faded preview (svgMarkup), mermaid viewer (freshSvgMarkup),
// mermaid editor (fullscreenMarkup) — plus the preview across a resize drag,
// the heaviest real trigger (dragPct changes on every mousemove).
//
// The trigger is a right-click on the wrapper: it opens the block menu (a
// state change → re-render) without changing the mode, so the branch under
// test stays mounted — a mode flip would legitimately replace the element and
// prove nothing. (The hover toolbar is NOT a trigger: its reveal is pure CSS.)
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

import { createBaramExtensions } from "../index";

declare const MockIntersectionObserver: {
  instances: { triggerIntersect: (v?: boolean) => void }[];
};

const SVG =
  '<svg viewBox="0 0 10 10" width="10" height="10"><rect width="10" height="10"/></svg>';
const SVG_CHANGED =
  '<svg viewBox="0 0 10 10" width="10" height="10"><circle r="5"/></svg>';
const MERMAID = "flowchart LR\n  A --> B";

const editors: Editor[] = [];

afterEach(() => {
  cleanup();
  for (const e of editors.splice(0)) e.destroy();
  vi.restoreAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

function menuItem(menuClass: string, label: string): HTMLElement {
  const menu = document.body.querySelector(`.${menuClass}`);
  const item = [...(menu?.querySelectorAll<HTMLElement>("button") ?? [])].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!item) throw new Error(`menu item ${label} did not mount`);
  return item;
}

function mountEditor(content: Record<string, unknown>) {
  const editor = new Editor({ extensions: createBaramExtensions() });
  editors.push(editor);
  const view = render(<EditorContent editor={editor} />);
  act(() => {
    editor.commands.setContent({
      content: [content, { type: "paragraph" }],
      type: "doc",
    });
  });
  return { editor, view };
}

/** A rendered mermaid block (lazy render triggered, render state done). */
async function mountMermaid() {
  const { editor, view } = mountEditor({
    attrs: { code: MERMAID },
    type: "mermaidBlock",
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
  return { editor, view, wrapper: wrapperOf(view, "mermaidBlock") };
}

/** An svg block in preview state. */
async function mountSvg() {
  const { editor, view } = mountEditor({
    attrs: { code: SVG },
    type: "svgBlock",
  });
  await flush();
  return { editor, view, wrapper: wrapperOf(view, "svgBlock") };
}

function renderedSvg(root: ParentNode, selector: string): SVGSVGElement {
  const svg = root.querySelector<SVGSVGElement>(selector);
  if (!svg) throw new Error(`${selector} did not render`);
  return svg;
}

function required(root: ParentNode, selector: string): Element {
  const el = root.querySelector(selector);
  if (!el) throw new Error(`${selector} did not mount`);
  return el;
}

/** The unrelated re-render: a right-click on the wrapper opens the block menu. */
async function reRenderByRightClick(wrapper: HTMLElement, menuClass: string) {
  fireEvent.mouseDown(wrapper, { button: 2, clientX: 20, clientY: 80 });
  fireEvent.contextMenu(wrapper, { clientX: 20, clientY: 80 });
  await flush();
  if (!document.body.querySelector(`.${menuClass}`)) {
    throw new Error("block menu did not open — the trigger did not re-render");
  }
}

/** Records childList mutations under `el` until read. */
function watchChildren(el: Element): () => number {
  let count = 0;
  const observer = new MutationObserver((records) => {
    count += records.length;
  });
  observer.observe(el, { childList: true, subtree: true });
  return () => {
    count += observer.takeRecords().length;
    observer.disconnect();
    return count;
  };
}

function wrapperOf(view: ReturnType<typeof render>, type: string): HTMLElement {
  const wrapper = view.container.querySelector<HTMLElement>(
    `[data-type="${type}"]`,
  );
  if (!wrapper) throw new Error(`${type} did not mount`);
  return wrapper;
}

/** The pin: the element captured before the re-render is the one still there. */
async function expectStable(
  container: Element,
  wrapper: HTMLElement,
  menuClass: string,
) {
  const before = renderedSvg(container, "svg");
  const mutations = watchChildren(container);

  await reRenderByRightClick(wrapper, menuClass);

  expect(before.isConnected).toBe(true);
  expect(renderedSvg(container, "svg")).toBe(before);
  expect(mutations()).toBe(0);
}

describe("diagram svg DOM survives an unrelated re-render (issue 549)", () => {
  it("svg block: the preview <svg>", async () => {
    const { wrapper } = await mountSvg();
    const content = required(wrapper, ".media-resize-content");
    await expectStable(content, wrapper, "svg-context-menu");
  });

  it("svg block: the editing-state faded preview's <svg>", async () => {
    const { editor, wrapper } = await mountSvg();
    act(() => {
      editor.commands.setNodeSelection(0);
    });
    await flush();
    const faded = required(wrapper, ".svg-block-render-faded");
    await expectStable(faded, wrapper, "svg-context-menu");
  });

  it("svg block: the preview <svg> across a resize drag", async () => {
    // jsdom has no layout — the drag needs a container width to work from.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 100,
      height: 100,
      left: 0,
      right: 400,
      toJSON: () => ({}),
      top: 0,
      width: 400,
      x: 0,
      y: 0,
    } as DOMRect);
    const { wrapper } = await mountSvg();
    const content = required(wrapper, ".media-resize-content");
    const before = renderedSvg(content, "svg");
    const mutations = watchChildren(content);

    fireEvent.mouseDown(required(wrapper, ".media-resize-handle-right"), {
      button: 0,
      clientX: 400,
    });
    for (const clientX of [380, 340, 300]) {
      fireEvent.mouseMove(document, { clientX });
      await flush();
    }
    // The percentage label only renders while a drag is in progress — proof
    // that each mousemove re-rendered the view.
    expect(wrapper.querySelector(".media-resize-label")).not.toBeNull();
    expect(before.isConnected).toBe(true);
    expect(renderedSvg(content, "svg")).toBe(before);
    expect(mutations()).toBe(0);

    fireEvent.mouseUp(document, { clientX: 300 });
    await flush();
    // Ending a drag arms swallowNextClick (a one-shot capture listener on
    // window with a 300ms safety timeout). Consume it here so it cannot eat the
    // next test's click.
    fireEvent.click(document.body);
  });

  it("svg block: the fullscreen viewer's <svg>", async () => {
    const { wrapper } = await mountSvg();
    fireEvent.click(required(wrapper, 'button[title="Fullscreen view"]'));
    await flush();
    // The portal lives in the block's React tree: a re-render of the view is a
    // re-render of the modal.
    const body = required(document.body, ".svg-view-fullscreen-body");
    await expectStable(body, wrapper, "svg-context-menu");
  });

  it("svg block: the fullscreen editor's preview <svg>", async () => {
    const { editor, view, wrapper } = await mountSvg();
    // The header with the fullscreen-editor button shows in editing state.
    act(() => {
      editor.commands.setNodeSelection(0);
    });
    await flush();
    fireEvent.click(view.getByTitle("Edit full-screen"));
    await flush();
    const preview = required(document.body, ".svg-fullscreen-preview");
    await expectStable(preview, wrapper, "svg-context-menu");
  });

  it("mermaid block: the preview <svg>", async () => {
    const { wrapper } = await mountMermaid();
    const content = required(wrapper, ".media-resize-content");
    await expectStable(content, wrapper, "mermaid-context-menu");
  });

  it("mermaid block: the editing-state faded preview's <svg>", async () => {
    const { editor, wrapper } = await mountMermaid();
    const previewId = renderedSvg(wrapper, ".media-resize-content svg").id;
    act(() => {
      editor.commands.setNodeSelection(0);
    });
    await flush();
    const faded = required(wrapper, ".mermaid-block-svg");
    // Selecting the block re-runs the render effect (`selected` is a dep), and
    // that render lands asynchronously with a NEW svg id — a changed string,
    // which legitimately replaces the element. Let it land before pinning.
    await waitFor(() => {
      expect(renderedSvg(faded, "svg").id).not.toBe(previewId);
    });
    await expectStable(faded, wrapper, "mermaid-context-menu");
  });

  it("mermaid block: the fullscreen viewer's <svg>", async () => {
    const { wrapper } = await mountMermaid();
    fireEvent.click(required(wrapper, 'button[title="Fullscreen view"]'));
    await flush();
    const body = required(document.body, ".mermaid-view-fullscreen-body");
    await expectStable(body, wrapper, "mermaid-context-menu");
  });

  it("mermaid block: the fullscreen editor's preview <svg>", async () => {
    const { wrapper } = await mountMermaid();
    await reRenderByRightClick(wrapper, "mermaid-context-menu");
    fireEvent.click(menuItem("mermaid-context-menu", "Edit Fullscreen"));
    await flush();
    const preview = required(document.body, ".mermaid-fullscreen-preview");
    await expectStable(preview, wrapper, "mermaid-context-menu");
  });
});

describe("a changed markup still replaces the DOM (issue 549)", () => {
  // The memo is keyed on the string: a new string is a new object and React
  // re-seeds — the view never shows a stale diagram for a changed source.
  it("svg block: a new source produces a new <svg> with the new content", async () => {
    const { editor, wrapper } = await mountSvg();
    const content = required(wrapper, ".media-resize-content");
    const before = renderedSvg(content, "svg");
    expect(before.querySelector("rect")).not.toBeNull();

    act(() => {
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(0, undefined, { code: SVG_CHANGED }),
      );
    });
    await flush();

    const after = renderedSvg(content, "svg");
    expect(after).not.toBe(before);
    expect(after.querySelector("circle")).not.toBeNull();
    expect(before.isConnected).toBe(false);
  });
});
