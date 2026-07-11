import type { Node as PMNode } from "@tiptap/pm/model";

// Regression: a block atom (math/mermaid) must still enter edit mode on click
// after an edit ABOVE it shifts its document position (merging table cells,
// typing in a paragraph above, …).
//
// Bug: @tiptap/react caches each NodeView's position in `currentPos`, refreshed
// only on mount / update() / handlePositionUpdate. The last is gated behind the
// `trackNodeViewPosition` option. A pure position shift never calls update() on
// the unchanged atom, so without the option currentPos goes stale;
// handleSelectionUpdate then compares the live NodeSelection against the stale
// pos (isNodeViewSelected → false) and never sets `selected`, so the block can
// no longer open its editor until the doc is reopened. Fix: the affected block
// atoms pass { trackNodeViewPosition: true } to ReactNodeViewRenderer.
import { act, render } from "@testing-library/react";
import { Editor, type JSONContent } from "@tiptap/core";
import { CellSelection, TableMap } from "@tiptap/pm/tables";
import { EditorContent } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBaramExtensions } from "../../..";
import { _resetForTest } from "../lazy-visible";

vi.mock("katex", () => ({
  default: {
    render: (_expr: string, el: HTMLElement) => {
      el.textContent = "KATEX";
    },
  },
}));

// Mermaid renders async via dynamic import; the edit-mode signal we assert on
// (the .mermaid-block-editing wrapper class) does not depend on it, but stub it
// so the block never throws while rendering.
vi.mock("mermaid", () => ({
  default: {
    initialize: () => {},
    render: async (id: string) => ({ svg: `<svg id="${id}"></svg>` }),
  },
}));

declare const MockIntersectionObserver: {
  instances: { triggerIntersect: (v?: boolean) => void }[];
};

const editors: Editor[] = [];

/** Flush React effects, the mocked dynamic-import microtasks, AND rAF callbacks
 *  — handleSelectionUpdate / handlePositionUpdate both run inside a rAF. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => setTimeout(r, 0));
    }
  });
}

function setup(content: JSONContent): Editor {
  const editor = new Editor({ content, extensions: createBaramExtensions() });
  editors.push(editor);
  render(<EditorContent editor={editor} />);
  return editor;
}

function triggerAllIntersect(): void {
  for (const inst of MockIntersectionObserver.instances)
    inst.triggerIntersect(true);
}

beforeEach(() => {
  _resetForTest();
});

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
  _resetForTest();
});

const cell = (t: string): JSONContent => ({
  type: "tableCell",
  content: [{ type: "paragraph", content: [{ type: "text", text: t }] }],
});
const hcell = (t: string): JSONContent => ({
  type: "tableHeader",
  content: [{ type: "paragraph", content: [{ type: "text", text: t }] }],
});

function atomPos(editor: Editor, typeName: string): number {
  let p = -1;
  editor.state.doc.descendants((n, pos) => {
    if (n.type.name === typeName) p = pos;
  });
  return p;
}

/** paragraph + 2x2 table + the atom under test (after the table). */
function docWith(atom: JSONContent): JSONContent {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "x" }] },
      {
        type: "table",
        content: [
          { type: "tableRow", content: [hcell("a"), hcell("b")] },
          { type: "tableRow", content: [cell("c"), cell("d")] },
        ],
      },
      atom,
    ],
  };
}

async function mergeBodyCells(editor: Editor): Promise<void> {
  await act(async () => {
    const { doc, tr } = editor.state;
    let tablePos = -1;
    let tableNode: null | PMNode = null;
    doc.descendants((n, pos) => {
      if (n.type.name === "table") {
        tablePos = pos;
        tableNode = n;
      }
    });
    const map = TableMap.get(tableNode!);
    const start = tablePos + 1;
    editor.view.dispatch(
      tr.setSelection(
        CellSelection.create(doc, start + map.map[2], start + map.map[3]),
      ),
    );
  });
  await act(async () => {
    editor.commands.mergeCells();
  });
}

/** Select the atom via its LIVE current position — exactly what the NodeView's
 *  click handler does (getPos() is always live/correct). */
async function selectAtom(editor: Editor, typeName: string): Promise<void> {
  await act(async () => {
    editor.commands.setNodeSelection(atomPos(editor, typeName));
  });
}

const CASES: { atom: JSONContent; editingSelector: string; type: string }[] = [
  {
    atom: { type: "mathBlock", attrs: { formula: "E=mc^2" } },
    editingSelector: ".math-block-editing",
    type: "mathBlock",
  },
  {
    atom: { type: "mermaidBlock", attrs: { code: "flowchart LR\n A --> B" } },
    editingSelector: ".mermaid-block-editing",
    type: "mermaidBlock",
  },
];

describe.each(CASES)(
  "$type enters edit mode after a position shift",
  ({ atom, editingSelector, type }) => {
    it("control: enters edit mode with no prior structural edit", async () => {
      const editor = setup(docWith(atom));
      await flush();
      triggerAllIntersect();
      await flush();

      await selectAtom(editor, type);
      await flush();
      expect(editor.view.dom.querySelector(editingSelector)).not.toBeNull();
    });

    it("still enters edit mode after typing in a paragraph above", async () => {
      const editor = setup(docWith(atom));
      await flush();
      triggerAllIntersect();
      await flush();

      await act(async () => {
        editor.commands.insertContentAt(1, "yyyyy");
      });
      await flush();

      await selectAtom(editor, type);
      await flush();
      expect(editor.view.dom.querySelector(editingSelector)).not.toBeNull();
    });

    it("still enters edit mode after merging table cells above", async () => {
      const editor = setup(docWith(atom));
      await flush();
      triggerAllIntersect();
      await flush();

      await mergeBodyCells(editor);
      await flush();

      await selectAtom(editor, type);
      await flush();
      expect(editor.view.dom.querySelector(editingSelector)).not.toBeNull();
    });
  },
);
