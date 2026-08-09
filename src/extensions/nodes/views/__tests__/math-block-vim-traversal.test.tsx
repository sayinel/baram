// §298 §12-⑩ (PR 307 device finding) — the editing UI follows ENTRY, not
// selection.
//
// WHAT BROKE: with the selection revert fixed, `j` landing a NodeSelection on
// a math block flipped the NodeView into its editing render — captured live:
//
//   [VD2-TX]     -> NodeSelection@8760
//   [VD2-DOMSEL] anchor=<DIV.math-block math-block-editing>   ← traversal opened it
//
// The render branch was `if (!selected)`: the §12-⑩ gate only stopped the
// textarea FOCUS, while the editing chrome (background box, textarea, live
// preview) appeared on mere selection. Before the revert fix the selection
// never survived long enough for anyone to see this.
//
// The contract, matching the code block's model: traversal shows the PREVIEW
// with the selectednode outline; the editing UI opens only on an explicit
// entry — a click, or focus arriving in the standby textarea (vim's `i`
// preflight). The standby textarea stays mounted (visually hidden) while
// selected so that preflight has something to focus; that textarea gaining
// focus IS the entry signal.

import { act, render } from "@testing-library/react";
import { Editor, type JSONContent } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBaramExtensions } from "../../..";
import { useSettingsStore } from "../../../../stores/settings/store";
import { _resetForTest } from "../lazy-visible";

vi.mock("katex", () => ({
  default: {
    render: (_expr: string, el: HTMLElement) => {
      el.textContent = "KATEX";
    },
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
    { attrs: { formula: "E=mc^2" }, type: "mathBlock" },
    { content: [{ text: "below", type: "text" }], type: "paragraph" },
  ],
  type: "doc",
};

function mathPos(editor: Editor): number {
  let pos = -1;
  editor.state.doc.forEach((node, at) => {
    if (node.type.name === "mathBlock") pos = at;
  });
  expect(pos).toBeGreaterThanOrEqual(0);
  return pos;
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
  const el = document.querySelector<HTMLElement>(".math-block");
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
  it("a NodeSelection landed by traversal does NOT open the editing UI", async () => {
    useSettingsStore.setState({ vimMode: true });
    const editor = setup();
    await flush();

    // The traversal shape: a NodeSelection arrives while vim is modal, with
    // no click and no preflight focus.
    act(() => {
      editor.commands.setNodeSelection(mathPos(editor));
    });
    await flush();

    expect(wrapper().className).toContain("math-block-preview");
    expect(wrapper().className).not.toContain("math-block-editing");
  });

  it("the standby textarea is mounted for vim's `i` preflight", async () => {
    // atom-insert.ts islandEntry() looks for a focusable inside nodeDOM —
    // remove this and `i` on a math block silently refuses.
    useSettingsStore.setState({ vimMode: true });
    const editor = setup();
    await flush();

    act(() => {
      editor.commands.setNodeSelection(mathPos(editor));
    });
    await flush();

    const ta = wrapper().querySelector<HTMLTextAreaElement>(
      "textarea[data-vim-suspend]",
    );
    expect(ta).not.toBeNull();
  });

  it("focus arriving in the standby textarea opens the editing UI", async () => {
    useSettingsStore.setState({ vimMode: true });
    const editor = setup();
    await flush();

    act(() => {
      editor.commands.setNodeSelection(mathPos(editor));
    });
    await flush();

    const ta = wrapper().querySelector<HTMLTextAreaElement>("textarea");
    expect(ta).not.toBeNull();
    act(() => {
      ta!.focus();
      ta!.dispatchEvent(new FocusEvent("focus"));
    });
    await flush();

    expect(wrapper().className).toContain("math-block-editing");
  });
});

describe("vim off: selection still opens the editor (positive control)", () => {
  it("a plain NodeSelection opens the editing UI as before", async () => {
    // A gate that keyed on nothing (always preview) would pass the pins above
    // while breaking every non-vim entry path.
    const editor = setup();
    await flush();

    act(() => {
      editor.commands.setNodeSelection(mathPos(editor));
    });
    await flush();

    expect(wrapper().className).toContain("math-block-editing");
  });
});
