// issue 531 — the SVG block's fullscreen editor under a refused commit.
//
// `closeFullscreen` commits through updateNodeAttributesWithVim and then
// updates local state (mirror, dirty flag, modal). With the helper now the
// capability gate, a refused commit must NOT run that tail: the mirror would
// say "saved" over an unchanged document, and closing would throw the edit
// away. The modal stays open with a toast, and Discard is the explicit exit.
//
// Driven through a real editor with the React portal host (the view is a
// ReactNodeViewRenderer; a bare `new Editor` never mounts it), the same shape
// as export-heavy-blocks.test.tsx.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
  invoke: vi.fn(async () => undefined),
}));

import { useUIStore } from "../../stores/ui/ui";
import { createBaramExtensions } from "../index";

const ORIGINAL =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
const EDITED =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle r="9"/></svg>';
const INLINE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><rect width="3" height="3"/></svg>';

const editors: Editor[] = [];

afterEach(() => {
  cleanup();
  for (const e of editors.splice(0)) e.destroy();
});

beforeEach(() => {
  useUIStore.getState().dismissToast();
});

function closeButton(): HTMLElement {
  const buttons = [
    ...document.body.querySelectorAll<HTMLElement>(".svg-fullscreen-close"),
  ];
  const close = buttons.find((b) => b.textContent === "Close");
  if (!close) throw new Error("no Close button in the fullscreen modal");
  return close;
}

function discardButton(): HTMLElement {
  const buttons = [
    ...document.body.querySelectorAll<HTMLElement>(".svg-fullscreen-close"),
  ];
  const discard = buttons.find((b) => b.textContent === "Discard");
  if (!discard) throw new Error("no Discard button in the fullscreen modal");
  return discard;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

function modalOpen(): boolean {
  return document.body.querySelector(".svg-fullscreen-modal") !== null;
}

async function openFullscreen() {
  const editor = new Editor({ extensions: createBaramExtensions() });
  editors.push(editor);
  const view = render(<EditorContent editor={editor} />);
  act(() => {
    editor.commands.setContent({
      content: [
        { attrs: { code: ORIGINAL }, type: "svgBlock" },
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
    ".svg-fullscreen-editor textarea",
  );
  if (!textarea) throw new Error("fullscreen editor did not open");
  fireEvent.change(textarea, { target: { value: EDITED } });
  return { editor, view };
}

function svgCodeOf(editor: Editor): string {
  let code = "";
  editor.state.doc.descendants((node) => {
    if (node.type.name === "svgBlock") code = node.attrs.code as string;
    return node.type.name !== "svgBlock";
  });
  return code;
}

describe("SVG fullscreen close (issue 531)", () => {
  it("commits the edit and closes while capability holds (control)", async () => {
    const { editor } = await openFullscreen();

    fireEvent.click(closeButton());
    await flush();

    expect(svgCodeOf(editor)).toBe(EDITED);
    expect(modalOpen()).toBe(false);
    expect(useUIStore.getState().toast).toBeNull();
  });

  it("under a silent lock: keeps the document, keeps the modal, says so", async () => {
    const { editor } = await openFullscreen();
    act(() => editor.setEditable(false, false));

    fireEvent.click(closeButton());
    await flush();

    expect(svgCodeOf(editor)).toBe(ORIGINAL);
    expect(modalOpen()).toBe(true);
    expect(useUIStore.getState().toast?.message).toMatch(/not saved/);
    // The edit is still in the modal, ready to be copied out.
    expect(
      document.body.querySelector<HTMLTextAreaElement>(
        ".svg-fullscreen-editor textarea",
      )?.value,
    ).toBe(EDITED);
  });

  it("Discard leaves without committing — the way out after a refusal", async () => {
    const { editor } = await openFullscreen();
    act(() => editor.setEditable(false, false));

    fireEvent.click(discardButton());
    await flush();

    expect(svgCodeOf(editor)).toBe(ORIGINAL);
    expect(modalOpen()).toBe(false);
  });

  it("Discard also works while capability holds, and does not commit", async () => {
    const { editor } = await openFullscreen();

    fireEvent.click(discardButton());
    await flush();

    expect(svgCodeOf(editor)).toBe(ORIGINAL);
    expect(modalOpen()).toBe(false);
  });

  it("refusal then Discard: the inline buffer and its dirty edit are untouched", async () => {
    // A mutant that runs setLocalCode/clearDirty before returning on a
    // refusal would pass the single-step cases above. This is the sequence
    // that catches it: an inline edit (dirty), then a fullscreen edit on top,
    // refused, discarded — the inline buffer must still hold the INLINE
    // text, and once capability is back, deselecting must commit it.
    const { editor, view } = await openFullscreen();
    // openFullscreen seeded fullscreen from the inline buffer; make the
    // inline buffer diverge first, so the two are distinguishable.
    fireEvent.click(discardButton());
    await flush();
    const inline =
      view.container.querySelector<HTMLTextAreaElement>("textarea");
    if (!inline) throw new Error("inline textarea did not mount");
    fireEvent.change(inline, { target: { value: INLINE } });
    fireEvent.click(view.getByTitle("Edit full-screen"));
    await flush();
    const fullscreen = document.body.querySelector<HTMLTextAreaElement>(
      ".svg-fullscreen-editor textarea",
    );
    if (!fullscreen) throw new Error("fullscreen editor did not open");
    expect(fullscreen.value).toBe(INLINE);
    fireEvent.change(fullscreen, { target: { value: EDITED } });

    act(() => editor.setEditable(false, false));
    fireEvent.click(closeButton());
    await flush();
    fireEvent.click(discardButton());
    await flush();

    expect(svgCodeOf(editor)).toBe(ORIGINAL);
    expect(
      view.container.querySelector<HTMLTextAreaElement>("textarea")?.value,
    ).toBe(INLINE);

    // Capability back, session ends by deselecting → the dirty inline edit
    // commits through the session's own save path, proving the refusal did
    // not clear the dirty flag.
    act(() => editor.setEditable(true, false));
    act(() => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    });
    await flush();
    expect(svgCodeOf(editor)).toBe(INLINE);
  });

  it("a successful retry after a refusal retires the refusal toast", async () => {
    const { editor } = await openFullscreen();
    act(() => editor.setEditable(false, false));
    fireEvent.click(closeButton());
    await flush();
    expect(useUIStore.getState().toast?.message).toMatch(/not saved/);

    act(() => editor.setEditable(true, false));
    fireEvent.click(closeButton());
    await flush();

    expect(svgCodeOf(editor)).toBe(EDITED);
    expect(modalOpen()).toBe(false);
    expect(useUIStore.getState().toast).toBeNull();
  });
});
