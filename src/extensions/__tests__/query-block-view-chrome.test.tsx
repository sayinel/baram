// issue 531 — the query builder under a refused commit.
//
// `updateDef` used to mirror the new definition into local state BEFORE
// committing it, so a refused commit (read-only editor) left the builder
// showing a query the document does not hold. It now mirrors only after
// updateNodeAttributesWithVim reports the dispatch.
//
// With vim off, selecting the block is enough to mount the builder (the
// view's `editing` gate passes for a non-modal editor), so the test drives
// the Source select straight from a NodeSelection.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
  invoke: vi.fn(async () => undefined),
}));

import { createBaramExtensions } from "../index";

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

async function openBuilder() {
  const editor = new Editor({ extensions: createBaramExtensions() });
  editors.push(editor);
  const view = render(<EditorContent editor={editor} />);
  act(() => {
    editor.commands.setContent({
      content: [
        { attrs: { query: "" }, type: "queryBlock" },
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
  const select = view.container.querySelector<HTMLSelectElement>(
    ".qb-builder select.qb-select",
  );
  if (!select) throw new Error("query builder did not mount");
  return { editor, select };
}

function queryOf(editor: Editor): string {
  let query = "";
  editor.state.doc.descendants((node) => {
    if (node.type.name === "queryBlock") query = node.attrs.query as string;
    return node.type.name !== "queryBlock";
  });
  return query;
}

describe("Query builder commit (issue 531)", () => {
  it("commits a source change and mirrors it into the builder (control)", async () => {
    const { editor, select } = await openBuilder();

    fireEvent.change(select, { target: { value: "tasks" } });
    await flush();

    expect(queryOf(editor)).toContain("source: tasks");
    expect(select.value).toBe("tasks");
  });

  it("under a silent lock: the document and the builder both keep the old source", async () => {
    const { editor, select } = await openBuilder();
    act(() => editor.setEditable(false, false));

    fireEvent.change(select, { target: { value: "tasks" } });
    await flush();

    expect(queryOf(editor)).toBe("");
    expect(select.value).toBe("files");
  });
});
