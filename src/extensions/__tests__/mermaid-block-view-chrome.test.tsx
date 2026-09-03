// issue 531 — the Mermaid block's fullscreen editor under a refused commit.
// Same contract as svg-block-view-chrome.test.tsx: a refused commit keeps
// the document, keeps the modal (with the edit in it) and says so; Discard
// is the explicit exit. Mermaid's renderer is mocked as in
// export-heavy-blocks.test.tsx — the test is about the commit path, not
// the diagram.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { useUIStore } from "../../stores/ui/ui";
import { createBaramExtensions } from "../index";

const ORIGINAL = "flowchart LR\n  A --> B";
const EDITED = "flowchart LR\n  A --> B --> C";
const INLINE = "flowchart TD\n  X --> Y";

const editors: Editor[] = [];

afterEach(() => {
  cleanup();
  for (const e of editors.splice(0)) e.destroy();
});

beforeEach(() => {
  useUIStore.getState().dismissToast();
});

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

function headerButton(label: "Close" | "Discard"): HTMLElement {
  const button = [
    ...document.body.querySelectorAll<HTMLElement>(
      ".mermaid-fullscreen-modal .mermaid-fullscreen-close",
    ),
  ].find((b) => b.textContent === label);
  if (!button) throw new Error(`no ${label} button in the fullscreen modal`);
  return button;
}

function mermaidCodeOf(editor: Editor): string {
  let code = "";
  editor.state.doc.descendants((node) => {
    if (node.type.name === "mermaidBlock") code = node.attrs.code as string;
    return node.type.name !== "mermaidBlock";
  });
  return code;
}

function modalOpen(): boolean {
  return document.body.querySelector(".mermaid-fullscreen-modal") !== null;
}

async function openFullscreen() {
  const editor = new Editor({ extensions: createBaramExtensions() });
  editors.push(editor);
  const view = render(<EditorContent editor={editor} />);
  act(() => {
    editor.commands.setContent({
      content: [
        { attrs: { code: ORIGINAL }, type: "mermaidBlock" },
        { type: "paragraph" },
      ],
      type: "doc",
    });
  });
  await flush();
  act(() => {
    editor.commands.setNodeSelection(0);
  });
  await flush();

  fireEvent.click(view.getByTitle("Edit full-screen"));
  await flush();
  const textarea = document.body.querySelector<HTMLTextAreaElement>(
    ".mermaid-fullscreen-editor textarea",
  );
  if (!textarea) throw new Error("fullscreen editor did not open");
  fireEvent.change(textarea, { target: { value: EDITED } });
  return { editor, view };
}

describe("Mermaid fullscreen close (issue 531)", () => {
  it("commits the edit and closes while capability holds (control)", async () => {
    const { editor } = await openFullscreen();

    fireEvent.click(headerButton("Close"));
    await flush();

    expect(mermaidCodeOf(editor)).toBe(EDITED);
    expect(modalOpen()).toBe(false);
    expect(useUIStore.getState().toast).toBeNull();
  });

  it("under a silent lock: keeps the document, keeps the modal, says so", async () => {
    const { editor } = await openFullscreen();
    act(() => editor.setEditable(false, false));

    fireEvent.click(headerButton("Close"));
    await flush();

    expect(mermaidCodeOf(editor)).toBe(ORIGINAL);
    expect(modalOpen()).toBe(true);
    expect(useUIStore.getState().toast?.message).toMatch(/not saved/);
    expect(
      document.body.querySelector<HTMLTextAreaElement>(
        ".mermaid-fullscreen-editor textarea",
      )?.value,
    ).toBe(EDITED);
  });

  it("Discard leaves without committing — the way out after a refusal", async () => {
    const { editor } = await openFullscreen();
    act(() => editor.setEditable(false, false));

    fireEvent.click(headerButton("Discard"));
    await flush();

    expect(mermaidCodeOf(editor)).toBe(ORIGINAL);
    expect(modalOpen()).toBe(false);
  });

  it("refusal then Discard: the inline buffer and its dirty edit are untouched", async () => {
    // Same sequence as the SVG suite: inline edit (dirty) → fullscreen edit
    // on top → refused → discarded. The inline buffer must still hold the
    // INLINE text, and once capability is back, deselecting must commit it.
    const { editor, view } = await openFullscreen();
    fireEvent.click(headerButton("Discard"));
    await flush();
    const inline =
      view.container.querySelector<HTMLTextAreaElement>("textarea");
    if (!inline) throw new Error("inline textarea did not mount");
    fireEvent.change(inline, { target: { value: INLINE } });
    fireEvent.click(view.getByTitle("Edit full-screen"));
    await flush();
    const fullscreen = document.body.querySelector<HTMLTextAreaElement>(
      ".mermaid-fullscreen-editor textarea",
    );
    if (!fullscreen) throw new Error("fullscreen editor did not open");
    expect(fullscreen.value).toBe(INLINE);
    fireEvent.change(fullscreen, { target: { value: EDITED } });

    act(() => editor.setEditable(false, false));
    fireEvent.click(headerButton("Close"));
    await flush();
    fireEvent.click(headerButton("Discard"));
    await flush();

    expect(mermaidCodeOf(editor)).toBe(ORIGINAL);
    expect(
      view.container.querySelector<HTMLTextAreaElement>("textarea")?.value,
    ).toBe(INLINE);

    act(() => editor.setEditable(true, false));
    act(() => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    });
    await flush();
    expect(mermaidCodeOf(editor)).toBe(INLINE);
  });

  it("a successful retry after a refusal retires the refusal toast", async () => {
    const { editor } = await openFullscreen();
    act(() => editor.setEditable(false, false));
    fireEvent.click(headerButton("Close"));
    await flush();
    expect(useUIStore.getState().toast?.message).toMatch(/not saved/);

    act(() => editor.setEditable(true, false));
    fireEvent.click(headerButton("Close"));
    await flush();

    expect(mermaidCodeOf(editor)).toBe(EDITED);
    expect(modalOpen()).toBe(false);
    expect(useUIStore.getState().toast).toBeNull();
  });
});
