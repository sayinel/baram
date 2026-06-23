// §perf-large-file heavy-block windowing (Phase 2): math KaTeX is deferred until
// the node nears the viewport (lazy-visible), mirroring mermaid/code. Verifies
// KaTeX is NOT rendered at mount while off-screen, only once the block
// intersects — and that a selected node bypasses the gate (edit-entry).
//
// React NodeViews only mount through an <EditorContent> Portals host, so we
// render the editor via @testing-library/react (a bare `new Editor` never
// renders the React portals, so the view effects never run). Assertions read
// the PER-EDITOR DOM (the katex mock writes "KATEX" into its target element) so
// they are immune to cross-test bleed from the shared lazy-visible idle queue.
import { act, render } from "@testing-library/react";
import { Editor, type JSONContent } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBaramExtensions } from "../../..";
import { _resetForTest } from "../lazy-visible";

// Mock KaTeX: render() writes a sentinel into its target element so we can
// observe, per editor, whether a render happened — without spying on a shared
// module-level mock (which leaks calls across tests via async render chains).
vi.mock("katex", () => ({
  default: {
    render: (_expr: string, el: HTMLElement) => {
      el.textContent = "KATEX";
    },
  },
}));

declare const MockIntersectionObserver: {
  instances: { triggerIntersect: (v?: boolean) => void }[];
};

const editors: Editor[] = [];

/** Flush React passive effects + the mocked dynamic import microtask. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** Rendered KaTeX text in the given editor's katex target, "" if none. */
function katexText(editor: Editor, selector: string): string {
  return editor.view.dom.querySelector(selector)?.textContent ?? "";
}

function setup(content: JSONContent): Editor {
  const editor = new Editor({ content, extensions: createBaramExtensions() });
  editors.push(editor);
  render(<EditorContent editor={editor} />);
  return editor;
}

function triggerIntersect(): void {
  MockIntersectionObserver.instances.at(-1)!.triggerIntersect(true);
}

beforeEach(() => {
  _resetForTest();
});

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
  _resetForTest();
});

describe("Math lazy KaTeX (§perf-large-file Phase 2)", () => {
  it("inline math does not render KaTeX until it is visible", async () => {
    const editor = setup({
      content: [
        {
          content: [{ attrs: { formula: "x^2" }, type: "mathInline" }],
          type: "paragraph",
        },
      ],
      type: "doc",
    });
    await flush();

    // Off-screen at mount: KaTeX deferred.
    expect(katexText(editor, ".math-inline-rendered")).not.toContain("KATEX");

    // Enters viewport → renders.
    await act(async () => {
      triggerIntersect();
    });
    await flush();
    expect(katexText(editor, ".math-inline-rendered")).toContain("KATEX");
  });

  it("block math does not render KaTeX until it is visible", async () => {
    // Leading paragraph so the default cursor lands in text, not as a
    // NodeSelection on the sole atom (which would set selected=true at mount).
    const editor = setup({
      content: [
        { content: [{ text: "x", type: "text" }], type: "paragraph" },
        { attrs: { formula: "E=mc^2" }, type: "mathBlock" },
      ],
      type: "doc",
    });
    await flush();

    expect(katexText(editor, ".math-block-katex")).not.toContain("KATEX");

    await act(async () => {
      triggerIntersect();
    });
    await flush();
    expect(katexText(editor, ".math-block-katex")).toContain("KATEX");
  });

  it("selected block math renders even before intersection (edit-entry bypass)", async () => {
    const editor = setup({
      content: [
        { content: [{ text: "x", type: "text" }], type: "paragraph" },
        { attrs: { formula: "E=mc^2" }, type: "mathBlock" },
      ],
      type: "doc",
    });
    await flush();
    expect(katexText(editor, ".math-block-katex")).not.toContain("KATEX");

    // Select the math block WITHOUT triggering intersection — edit-entry must
    // not depend on the lazy observer (find/nav can select an unrendered node).
    let mbPos = 0;
    editor.state.doc.descendants((n, pos) => {
      if (n.type.name === "mathBlock") mbPos = pos;
    });
    await act(async () => {
      editor.commands.setNodeSelection(mbPos);
    });
    await flush();
    expect(katexText(editor, ".math-block-katex")).toContain("KATEX");
  });
});
