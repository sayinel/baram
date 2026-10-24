// §56m The front-matter tag bar in a live editor: what its pills show and what an add writes.
import type { Editor } from "@tiptap/core";

import {
  act,
  cleanup,
  fireEvent,
  render,
  type RenderResult,
} from "@testing-library/react";
import { Editor as TiptapEditor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

import { createBaramExtensions } from "../index";

const editors: Editor[] = [];

afterEach(() => {
  cleanup();
  for (const e of editors.splice(0)) e.destroy();
});

/** Flush React passive effects + the deferred NodeView portal mount. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

function frontmatterText(editor: Editor): string {
  return editor.state.doc.firstChild!.textContent;
}

async function mount(
  yaml: string,
): Promise<{ editor: Editor; view: RenderResult }> {
  const editor = new TiptapEditor({ extensions: createBaramExtensions() });
  editors.push(editor);
  const view = render(<EditorContent editor={editor} />);
  act(() => {
    editor.commands.setContent({
      content: [
        { content: [{ text: yaml, type: "text" }], type: "frontmatter" },
        { type: "paragraph" },
      ],
      type: "doc",
    });
  });
  await flush();
  return { editor, view };
}

function typeTag(view: RenderResult, text: string): HTMLInputElement {
  const input = view.getByLabelText("Add tag") as HTMLInputElement;
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
  return input;
}

describe("front-matter tag bar (§56m)", () => {
  // What turns this red: showing an item's value as written — the pill read `##solo` and its
  // remove button "Remove tag #solo".
  it("shows a #-spelled item as its name, and an add keeps the item's spelling", async () => {
    const { editor, view } = await mount(`tags: ["#solo"]`);
    expect(view.getByLabelText("Remove tag solo")).toBeTruthy();
    expect(view.queryByLabelText("Remove tag #solo")).toBeNull();

    const input = typeTag(view, "#x");
    expect(parse(frontmatterText(editor))).toEqual({ tags: ["#solo", "x"] });
    expect(input.value).toBe("");
  });

  // What turns this red: writing a `tags: [...]` line beside a `tags:` the bar cannot read —
  // a duplicate key, which YAML rejects — and clearing the input as if it had been added.
  it("leaves a tags field it cannot rewrite alone, and keeps what was typed", async () => {
    const { editor, view } = await mount("tags: solo");
    let transactions = 0;
    editor.on("transaction", () => {
      transactions += 1;
    });

    const input = typeTag(view, "x");
    expect(frontmatterText(editor)).toBe("tags: solo");
    expect(transactions).toBe(0);
    expect(input.value).toBe("x");
  });
});
