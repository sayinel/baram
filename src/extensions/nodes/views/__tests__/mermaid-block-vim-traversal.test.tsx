// §298 §12-⑩ — the mermaid block adopts the math block's entry model.
//
// Same disease, same organ: the render branch was `if (!selected)`, so a vim
// traversal NodeSelection opened the editing chrome (header, template button,
// textarea) — the exact device finding fixed for math in f12e2af0. Mermaid was
// worse off in two ways: its entry gate had no click bypass at all (clicking a
// preview while modal opened the render but never focused it), and its Esc had
// no stair (exitBlock("down") unconditionally).
//
// The contract, ported: traversal keeps the PREVIEW plus selectednode outline;
// a standby textarea stays mounted (visually hidden, inert to Tab and AT) so
// vim's `i` preflight has something to focus; that focus opens the session;
// Esc lands normal mode and the block's NodeSelection atomically.

import { act, fireEvent, render } from "@testing-library/react";
import { Editor, type JSONContent } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { EditorContent } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBaramExtensions } from "../../..";
import { useSettingsStore } from "../../../../stores/settings/store";
import { vimPluginKey } from "../../../plugins/vim/vim-keys";
import { _resetForTest } from "../lazy-visible";

// Mermaid renders async via dynamic import; the render/entry signals asserted
// here (wrapper classes, textarea state) do not depend on it, but stub it so
// the block never throws while rendering.
vi.mock("mermaid", () => ({
  default: {
    initialize: () => {},
    render: async (id: string) => ({ svg: `<svg id="${id}"></svg>` }),
  },
}));

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
    { attrs: { code: "flowchart TD\n  A-->B" }, type: "mermaidBlock" },
    { content: [{ text: "below", type: "text" }], type: "paragraph" },
  ],
  type: "doc",
};

function mermaidPos(editor: Editor): number {
  let pos = -1;
  editor.state.doc.forEach((node, at) => {
    if (node.type.name === "mermaidBlock") pos = at;
  });
  expect(pos).toBeGreaterThanOrEqual(0);
  return pos;
}

async function selectBlock(editor: Editor): Promise<void> {
  act(() => {
    editor.commands.setNodeSelection(mermaidPos(editor));
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

function wrapper(): HTMLElement {
  const el = document.querySelector<HTMLElement>(".mermaid-block");
  expect(el).not.toBeNull();
  return el!;
}

beforeEach(() => {
  _resetForTest();
});

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
  _resetForTest();
  document.body.innerHTML = "";
  useSettingsStore.setState({ vimMode: false });
});

describe("vim modal: selection alone keeps the preview render", () => {
  it("a traversal NodeSelection does NOT open the editing UI", async () => {
    useSettingsStore.setState({ vimMode: true });
    const editor = setup();
    await flush();

    await selectBlock(editor);

    expect(wrapper().className).toContain("mermaid-block-preview");
    expect(wrapper().className).not.toContain("mermaid-block-editing");
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
    expect(editor.state.selection.from).toBe(mermaidPos(editor));
    expect(wrapper().className).toContain("mermaid-block-preview");
    expect(wrapper().className).not.toContain("mermaid-block-editing");
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

    expect(wrapper().className).toContain("mermaid-block-editing");
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
    expect(wrapper().className).toContain("mermaid-block-editing");

    act(() => {
      fireEvent.keyDown(ta, { key: "Escape" });
    });
    await flush();

    const vim = vimPluginKey.getState(editor.state);
    expect(vim?.mode).toBe("normal");
    expect(editor.view.editable).toBe(false);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(editor.state.selection.from).toBe(mermaidPos(editor));
    expect(wrapper().className).toContain("mermaid-block-preview");
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
    expect(editor.state.selection.from).toBe(mermaidPos(editor));
  });
});

describe("vim off is untouched (positive controls)", () => {
  it("a plain NodeSelection opens the editing UI as before", async () => {
    const editor = setup();
    await flush();

    await selectBlock(editor);

    expect(wrapper().className).toContain("mermaid-block-editing");
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
    expect(editor.state.selection.from).toBeGreaterThan(mermaidPos(editor));
  });
});
