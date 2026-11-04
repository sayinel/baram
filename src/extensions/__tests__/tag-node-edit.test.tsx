// §56m Editing an inline tag in place: what the tag node keeps.
import type { Editor } from "@tiptap/core";

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { Editor as TiptapEditor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, describe, expect, it } from "vitest";

import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";
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

/** Renames the paragraph's one tag by typing `typed` into its in-place editor, then Enter or a blur. */
async function editTag(
  typed: string,
  finish: "blur" | "enter" = "enter",
): Promise<string> {
  const editor = new TiptapEditor({ extensions: createBaramExtensions() });
  editors.push(editor);
  const view = render(<EditorContent editor={editor} />);
  act(() => {
    editor.commands.setContent({
      content: [
        {
          content: [{ attrs: { tag: "solo" }, type: "tagNode" }],
          type: "paragraph",
        },
      ],
      type: "doc",
    });
  });
  await flush();

  // A second mousedown before the single-click timer fires is the double-click that edits.
  const pill = view.container.querySelector('[data-tag="solo"]')!;
  fireEvent.mouseDown(pill);
  fireEvent.mouseDown(pill);
  await flush();
  const input = view.container.querySelector<HTMLInputElement>(
    "input.tag-node-input",
  )!;
  fireEvent.change(input, { target: { value: typed } });
  if (finish === "enter") fireEvent.keyDown(input, { key: "Enter" });
  else fireEvent.blur(input);
  await flush();
  return prosemirrorToMarkdown(editor.state.doc).trim();
}

describe("tag node in-place edit (§56m)", () => {
  // What turns this red: stripping one `#` — `##focus` left the node holding `#focus`, which
  // is saved as `##focus`, not a tag.
  it("keeps the typed name without any of its leading #s", async () => {
    expect(await editTag("##focus")).toBe("#focus");
  });

  // What turns this red: committing whatever was typed — a node holding `a b` is saved as
  // `#a b`, the tag `a` and the word `b`.
  it("refuses a name a tag in the body cannot spell, keeping the box open", async () => {
    expect(await editTag("a b")).toBe("#solo");
    const input = document.querySelector<HTMLInputElement>(
      "input.tag-node-input",
    );
    expect(input?.value).toBe("a b");
  });

  // What turns this red: committing an unspellable name when the box loses focus.
  it("leaves the tag as it was when the box loses focus on a refused name", async () => {
    expect(await editTag("a b", "blur")).toBe("#solo");
  });

  it("keeps a typed name as it is", async () => {
    expect(await editTag("focus")).toBe("#focus");
  });
});
