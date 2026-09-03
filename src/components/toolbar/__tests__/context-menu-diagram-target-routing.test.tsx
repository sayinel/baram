// issue 521 (audit follow-up) — who owns a right-click on a diagram block is
// decided by the ELEMENT under the pointer, not by the block's mode.
//
// The first cut split ownership by mode: the NodeView handled right-clicks
// only in preview state, and the document-level ContextMenu stepped aside
// for native text controls. That left two holes. While editing, the live
// preview and the header are still visible, and a right-click there fell
// through to the generic text menu (Cut / Bold / Italic over an atom). In
// preview state, the caption <input> sat under the NodeView's handler, which
// swallowed the event before the document-level rule could yield to the
// browser. Both views now route by target: a native text control bubbles up
// untouched, everything else opens the block's own menu — in either mode.
//
// Mounted through a real editor + the real <ContextMenu>, mermaid's renderer
// mocked as in export-heavy-blocks.test.tsx. svg needs no mock (sanitizeSvg
// is synchronous).
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

// src/test-setup.ts installs this mock; the mermaid block renders lazily
// (onFirstVisible) and never intersects on its own in jsdom.
declare const MockIntersectionObserver: {
  instances: { triggerIntersect: (v?: boolean) => void }[];
};

const MERMAID = "flowchart LR\n  A --> B";
const MERMAID_EDITED = "flowchart LR\n  A --> B --> C";
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

async function mount(block: Record<string, unknown>) {
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
      content: [block, { type: "paragraph" }],
      type: "doc",
    });
  });
  await flush();
  return { editor, view };
}

/** Preview-state mermaid with its diagram rendered (the render is async). */
async function mountMermaid() {
  const mounted = await mount({
    attrs: { code: MERMAID },
    type: "mermaidBlock",
  });
  // Trigger EVERY registered observer — the block's is not reliably the
  // newest (stale editors from earlier tests register observers too).
  act(() => {
    for (const io of MockIntersectionObserver.instances) io.triggerIntersect();
  });
  await waitFor(() => {
    expect(
      mounted.view.container.querySelector(
        '[data-type="mermaidBlock"][data-render-state="done"]',
      ),
    ).not.toBeNull();
  });
  return mounted;
}

/** Vim is off in these editors, so a bare NodeSelection opens the editing
 *  session (with vim modal it would be a preview traversal). */
async function enterEditing(editor: Editor): Promise<void> {
  act(() => {
    editor.commands.setNodeSelection(0);
  });
  await flush();
}

/** Labels of every item the document-level menu currently shows. */
function documentMenuLabels(): string[] {
  return [...document.querySelectorAll(".context-menu .context-menu-item")].map(
    (el) => el.textContent?.trim() ?? "",
  );
}

function localMenu(selector: string): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(selector);
}

/** Toolbar Caption button → the caption <input> mounts (preview state). */
async function openCaptionInput(
  view: ReturnType<typeof render>,
): Promise<HTMLInputElement> {
  fireEvent.click(view.getByTitle("Caption"));
  await flush();
  const input = view.container.querySelector<HTMLInputElement>(
    "input.block-caption-input",
  );
  if (!input) throw new Error("caption input did not mount");
  return input;
}

function required<T>(value: null | T, what: string): T {
  if (value === null) throw new Error(`${what} did not mount`);
  return value;
}

describe("mermaid block: right-click ownership by target", () => {
  it("editing: the live preview opens the block's own menu, not the generic text menu", async () => {
    const { editor, view } = await mountMermaid();
    await enterEditing(editor);
    const preview = required(
      view.container.querySelector<HTMLElement>(
        ".mermaid-block-editing .mermaid-block-svg",
      ),
      "editing-state preview",
    );

    const nativeMenuAllowed = fireEvent.contextMenu(preview, {
      clientX: 20,
      clientY: 80,
    });
    await flush();

    expect(nativeMenuAllowed).toBe(false);
    expect(localMenu(".mermaid-context-menu")).not.toBeNull();
    expect(documentMenuLabels()).toEqual([]);
  });

  it("editing: Edit Fullscreen from that menu seeds the session's code, not the committed one", async () => {
    const { editor, view } = await mountMermaid();
    await enterEditing(editor);
    const textarea = required(
      view.container.querySelector<HTMLTextAreaElement>(
        ".mermaid-block-editing textarea",
      ),
      "editing textarea",
    );
    fireEvent.change(textarea, { target: { value: MERMAID_EDITED } });
    await flush();
    const preview = required(
      view.container.querySelector<HTMLElement>(
        ".mermaid-block-editing .mermaid-block-svg",
      ),
      "editing-state preview",
    );

    fireEvent.contextMenu(preview, { clientX: 20, clientY: 80 });
    await flush();
    const edit = [
      ...document.body.querySelectorAll<HTMLElement>(
        ".mermaid-context-menu-item",
      ),
    ].find((b) => b.textContent === "Edit Fullscreen");
    fireEvent.click(required(edit ?? null, "Edit Fullscreen item"));
    await flush();

    expect(
      document.body.querySelector<HTMLTextAreaElement>(
        ".mermaid-fullscreen-editor textarea",
      )?.value,
    ).toBe(MERMAID_EDITED);
  });

  it("preview: the caption input is left to the browser", async () => {
    const { view } = await mountMermaid();
    const input = await openCaptionInput(view);

    const nativeMenuAllowed = fireEvent.contextMenu(input, {
      clientX: 20,
      clientY: 120,
    });
    await flush();

    expect(nativeMenuAllowed).toBe(true);
    expect(localMenu(".mermaid-context-menu")).toBeNull();
    expect(documentMenuLabels()).toEqual([]);
  });

  it("editing: stepping aside for the textarea also closes a block menu left open", async () => {
    // The block menu's own dismiss listens for document mousedown, which the
    // toolbar and the caption stop — so a menu can still be open when the
    // next right-click lands on a text control. It must not linger beside
    // the native menu (it carries Delete).
    const { editor, view } = await mountMermaid();
    await enterEditing(editor);
    const preview = required(
      view.container.querySelector<HTMLElement>(
        ".mermaid-block-editing .mermaid-block-svg",
      ),
      "editing-state preview",
    );
    const textarea = required(
      view.container.querySelector<HTMLTextAreaElement>(
        ".mermaid-block-editing textarea",
      ),
      "editing textarea",
    );
    fireEvent.contextMenu(preview, { clientX: 20, clientY: 80 });
    await flush();
    expect(localMenu(".mermaid-context-menu")).not.toBeNull();

    const nativeMenuAllowed = fireEvent.contextMenu(textarea, {
      clientX: 20,
      clientY: 20,
    });
    await flush();

    expect(nativeMenuAllowed).toBe(true);
    expect(localMenu(".mermaid-context-menu")).toBeNull();
  });

  it("fullscreen editor: a right-click on its preview is left to the browser", async () => {
    // The fullscreen modals are portals: rendered into body, but in this
    // component's React tree, so their events bubble to the wrapper's
    // handler. A block menu there would act on the inline state, not on the
    // fullscreen draft — the wrapper must ignore what is not inside it.
    const { editor, view } = await mountMermaid();
    await enterEditing(editor);
    fireEvent.click(view.getByTitle("Edit full-screen"));
    await flush();
    const fullscreenPreview = required(
      document.body.querySelector<HTMLElement>(".mermaid-fullscreen-preview"),
      "fullscreen preview",
    );

    const nativeMenuAllowed = fireEvent.contextMenu(fullscreenPreview, {
      clientX: 400,
      clientY: 300,
    });
    await flush();

    expect(nativeMenuAllowed).toBe(true);
    expect(localMenu(".mermaid-context-menu")).toBeNull();
  });
});

describe("svg block: right-click ownership by target", () => {
  it("editing: the faded preview opens the block's own menu, not the generic text menu", async () => {
    const { editor, view } = await mount({
      attrs: { code: SVG },
      type: "svgBlock",
    });
    await enterEditing(editor);
    const preview = required(
      view.container.querySelector<HTMLElement>(
        ".svg-block-editing .svg-block-render-faded",
      ),
      "editing-state preview",
    );

    const nativeMenuAllowed = fireEvent.contextMenu(preview, {
      clientX: 20,
      clientY: 80,
    });
    await flush();

    expect(nativeMenuAllowed).toBe(false);
    expect(localMenu(".svg-context-menu")).not.toBeNull();
    expect(documentMenuLabels()).toEqual([]);
  });

  it("editing: the source textarea is left to the browser", async () => {
    const { editor, view } = await mount({
      attrs: { code: SVG },
      type: "svgBlock",
    });
    await enterEditing(editor);
    const textarea = required(
      view.container.querySelector<HTMLTextAreaElement>(
        ".svg-block-editing textarea",
      ),
      "editing textarea",
    );

    const nativeMenuAllowed = fireEvent.contextMenu(textarea, {
      clientX: 20,
      clientY: 20,
    });
    await flush();

    expect(nativeMenuAllowed).toBe(true);
    expect(localMenu(".svg-context-menu")).toBeNull();
    expect(documentMenuLabels()).toEqual([]);
  });

  it("preview: the caption input is left to the browser", async () => {
    const { view } = await mount({ attrs: { code: SVG }, type: "svgBlock" });
    const input = await openCaptionInput(view);

    const nativeMenuAllowed = fireEvent.contextMenu(input, {
      clientX: 20,
      clientY: 120,
    });
    await flush();

    expect(nativeMenuAllowed).toBe(true);
    expect(localMenu(".svg-context-menu")).toBeNull();
    expect(documentMenuLabels()).toEqual([]);
  });

  it("editing: stepping aside for the textarea also closes a block menu left open", async () => {
    const { editor, view } = await mount({
      attrs: { code: SVG },
      type: "svgBlock",
    });
    await enterEditing(editor);
    const preview = required(
      view.container.querySelector<HTMLElement>(
        ".svg-block-editing .svg-block-render-faded",
      ),
      "editing-state preview",
    );
    const textarea = required(
      view.container.querySelector<HTMLTextAreaElement>(
        ".svg-block-editing textarea",
      ),
      "editing textarea",
    );
    fireEvent.contextMenu(preview, { clientX: 20, clientY: 80 });
    await flush();
    expect(localMenu(".svg-context-menu")).not.toBeNull();

    const nativeMenuAllowed = fireEvent.contextMenu(textarea, {
      clientX: 20,
      clientY: 20,
    });
    await flush();

    expect(nativeMenuAllowed).toBe(true);
    expect(localMenu(".svg-context-menu")).toBeNull();
  });

  it("fullscreen editor: a right-click on its preview is left to the browser", async () => {
    const { editor, view } = await mount({
      attrs: { code: SVG },
      type: "svgBlock",
    });
    await enterEditing(editor);
    fireEvent.click(view.getByTitle("Edit full-screen"));
    await flush();
    const fullscreenPreview = required(
      document.body.querySelector<HTMLElement>(".svg-fullscreen-preview"),
      "fullscreen preview",
    );

    const nativeMenuAllowed = fireEvent.contextMenu(fullscreenPreview, {
      clientX: 400,
      clientY: 300,
    });
    await flush();

    expect(nativeMenuAllowed).toBe(true);
    expect(localMenu(".svg-context-menu")).toBeNull();
  });
});
