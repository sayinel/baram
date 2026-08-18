// §298 §12-⑩ — the svg block adopts the math block's entry model.
//
// Same disease, same organ: the render branch was `if (!selected)`, so a vim
// traversal NodeSelection opened the editing chrome (header, Expand button,
// textarea) — the device finding fixed for math in f12e2af0 and ported to
// mermaid in 69a8ec4a. Like mermaid, svg had no click bypass and no Esc stair.
//
// The contract, ported: traversal keeps the PREVIEW plus selectednode outline;
// a standby textarea stays mounted (visually hidden, inert to Tab and AT) so
// vim's `i` preflight has something to focus; that focus opens the session;
// Esc lands normal mode and the block's NodeSelection atomically.

import { act, fireEvent, render } from "@testing-library/react";
import { Editor, type JSONContent } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { EditorContent } from "@tiptap/react";
import { afterEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../..";
import { useSettingsStore } from "../../../../stores/settings/store";
import { vimPluginKey } from "../../../plugins/vim/vim-keys";

const editors: Editor[] = [];

/** Flush React effects, dynamic-import microtasks, and rAF callbacks. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => setTimeout(r, 0));
    }
  });
}

const DOC: JSONContent = {
  content: [
    { content: [{ text: "above", type: "text" }], type: "paragraph" },
    { attrs: { code: '<svg viewBox="0 0 10 10"></svg>' }, type: "svgBlock" },
    { content: [{ text: "below", type: "text" }], type: "paragraph" },
  ],
  type: "doc",
};

async function selectBlock(editor: Editor): Promise<void> {
  act(() => {
    editor.commands.setNodeSelection(svgPos(editor));
  });
  await flush();
}

function setup(): Editor {
  const editor = new Editor({
    content: DOC,
    extensions: createBaramExtensions(),
  });
  editors.push(editor);
  render(<EditorContent editor={editor} />);
  return editor;
}

function svgPos(editor: Editor): number {
  let pos = -1;
  editor.state.doc.forEach((node, at) => {
    if (node.type.name === "svgBlock") pos = at;
  });
  expect(pos).toBeGreaterThanOrEqual(0);
  return pos;
}

function wrapper(): HTMLElement {
  const el = document.querySelector<HTMLElement>(".svg-block");
  expect(el).not.toBeNull();
  return el!;
}

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
  document.body.innerHTML = "";
  useSettingsStore.setState({ vimMode: false });
});

describe("vim modal: selection alone keeps the preview render", () => {
  it("a traversal NodeSelection does NOT open the editing UI", async () => {
    useSettingsStore.setState({ vimMode: true });
    const editor = setup();
    await flush();

    await selectBlock(editor);

    expect(wrapper().className).toContain("svg-block-preview");
    expect(wrapper().className).not.toContain("svg-block-editing");
  });

  it("a click while modal only SELECTS the block — `i` is the entry", async () => {
    // UX decision (issue 408): normal mode is navigation. A click lands the
    // outline exactly like j/k; the editor opens via `i` (or click in insert
    // mode / vim off). The churn suppression keeps the landed NodeSelection
    // from being reverted, so the outline actually sticks.
    useSettingsStore.setState({ vimMode: true });
    const editor = setup();
    await flush();

    act(() => {
      fireEvent.click(wrapper());
    });
    await flush();

    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(editor.state.selection.from).toBe(svgPos(editor));
    expect(wrapper().className).toContain("svg-block-preview");
    expect(wrapper().className).not.toContain("svg-block-editing");
  });

  it("the standby textarea is mounted, inert to Tab and AT", async () => {
    useSettingsStore.setState({ vimMode: true });
    const editor = setup();
    await flush();

    await selectBlock(editor);

    const ta = wrapper().querySelector<HTMLTextAreaElement>(
      "textarea[data-vim-suspend]",
    );
    expect(ta).not.toBeNull();
    expect(ta!.tabIndex).toBe(-1);
    expect(ta!.getAttribute("aria-hidden")).toBe("true");
    // No auto-resize height measured at standby's 1px width.
    expect(ta!.style.height).toBe("");
  });

  it("focus arriving in the standby textarea opens the editing UI", async () => {
    useSettingsStore.setState({ vimMode: true });
    const editor = setup();
    await flush();

    await selectBlock(editor);
    const ta = wrapper().querySelector<HTMLTextAreaElement>("textarea")!;
    expect(ta).not.toBeNull();

    act(() => {
      ta.focus();
      ta.dispatchEvent(new FocusEvent("focus"));
    });
    await flush();

    expect(wrapper().className).toContain("svg-block-editing");
    expect(ta.tabIndex).toBe(0);
  });
});

describe("Esc follows the code block's stair (vim)", () => {
  it("lands normal mode and the block's NodeSelection atomically", async () => {
    useSettingsStore.setState({ vimMode: true });
    const editor = setup();
    await flush();
    await selectBlock(editor);
    const ta = wrapper().querySelector<HTMLTextAreaElement>("textarea")!;
    act(() => {
      ta.focus();
      ta.dispatchEvent(new FocusEvent("focus"));
    });
    await flush();
    expect(wrapper().className).toContain("svg-block-editing");

    act(() => {
      fireEvent.keyDown(ta, { key: "Escape" });
    });
    await flush();

    const vim = vimPluginKey.getState(editor.state);
    expect(vim?.mode).toBe("normal");
    expect(editor.view.editable).toBe(false);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(editor.state.selection.from).toBe(svgPos(editor));
    expect(wrapper().className).toContain("svg-block-preview");
  });

  it("entry from SURFACE insert mode still lands in normal on the block", async () => {
    // The math handoff finding, pinned here from day one: `i` in a paragraph
    // puts vim in insert, a click then opens the session with vim STILL in
    // insert — Esc must not leave insert+editable over a live NodeSelection.
    useSettingsStore.setState({ vimMode: true });
    const editor = setup();
    await flush();
    act(() => {
      editor.commands.setTextSelection(2);
    });
    act(() => {
      fireEvent.keyDown(editor.view.dom, { key: "i" });
    });
    await flush();

    act(() => {
      fireEvent.click(wrapper());
    });
    await flush();
    const ta = wrapper().querySelector<HTMLTextAreaElement>("textarea")!;
    expect(ta).not.toBeNull();

    act(() => {
      fireEvent.keyDown(ta, { key: "Escape" });
    });
    await flush();

    const vim = vimPluginKey.getState(editor.state);
    expect(vim?.mode).toBe("normal");
    expect(editor.view.editable).toBe(false);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(editor.state.selection.from).toBe(svgPos(editor));
  });
});

describe("vim off is untouched (positive controls)", () => {
  it("a plain NodeSelection opens the editing UI as before", async () => {
    const editor = setup();
    await flush();

    await selectBlock(editor);

    expect(wrapper().className).toContain("svg-block-editing");
  });

  it("Esc keeps the exit-below behavior", async () => {
    const editor = setup();
    await flush();
    await selectBlock(editor);
    const ta = wrapper().querySelector<HTMLTextAreaElement>("textarea")!;

    act(() => {
      fireEvent.keyDown(ta, { key: "Escape" });
    });
    await flush();

    expect(editor.state.selection).not.toBeInstanceOf(NodeSelection);
    expect(editor.state.selection.from).toBeGreaterThan(svgPos(editor));
  });
});
