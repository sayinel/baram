// §5.1 — an HTML block's edit is committed as what the file will read back as.
//
// The block's textarea takes any text, and saving writes it as it is. But
// CommonMark ends a `<div>`-style HTML block at a blank line, text that does
// not start like an HTML block is not one, and an unclosed `<!--` or `<pre>`
// runs on through the blocks after it until a line holding its closing
// marker, so the next open read something else than the editor showed.
// Committing an edit now asks the loader what the text reads as between two
// paragraphs standing in for its neighbours: when those blocks are ones the
// schema allows and save as markdown that reads the same, they replace the
// block; otherwise the block keeps the text as typed and a notice says the
// file will read it differently or that it may merge with its neighbours.

import type { JSONContent } from "@tiptap/core";

import { act, fireEvent, render } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { EditorContent } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../..";
import { markdownToProsemirror } from "../../../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../../../pipeline/pm-to-md";
import { useSettingsStore } from "../../../../stores/settings/store";
import { useUIStore } from "../../../../stores/ui/ui";
import { vimPluginKey } from "../../../plugins/vim/vim-keys";

const editors: Editor[] = [];

function docWith(content: string): JSONContent {
  return {
    content: [
      { content: [{ text: "above", type: "text" }], type: "paragraph" },
      { attrs: { content }, type: "htmlBlock" },
      { content: [{ text: "below", type: "text" }], type: "paragraph" },
    ],
    type: "doc",
  };
}

/** Flush React effects, dynamic-import microtasks, and rAF callbacks. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => setTimeout(r, 0));
    }
  });
}

function setup(): Editor {
  const editor = new Editor({
    content: docWith("<div>hello</div>"),
    extensions: createBaramExtensions(),
  });
  editors.push(editor);
  render(<EditorContent editor={editor} />);
  return editor;
}

beforeEach(() => {
  useUIStore.setState({ toast: null });
});

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
  document.body.innerHTML = "";
  useSettingsStore.setState({ vimMode: false });
});

const BLOCK_AT = 1 + "above".length + 1;

function textarea(): HTMLTextAreaElement {
  const ta = document.querySelector<HTMLTextAreaElement>(
    ".html-block textarea",
  );
  expect(ta).not.toBeNull();
  return ta!;
}

/** Open the block and type `content` into its textarea. */
async function typeIntoBlock(editor: Editor, content: string): Promise<void> {
  act(() => {
    editor.commands.setNodeSelection(BLOCK_AT);
  });
  await flush();
  act(() => {
    textarea().focus();
    fireEvent.change(textarea(), { target: { value: content } });
  });
  await flush();
}

/** Click away from the block. */
async function deselect(editor: Editor): Promise<void> {
  act(() => {
    editor.commands.setTextSelection(2);
  });
  await flush();
}

/** The document's blocks between "above" and "below", as JSON. */
function middle(editor: Editor): JSONContent[] {
  const { doc } = editor.state;
  expect(doc.firstChild?.textContent).toBe("above");
  expect(doc.lastChild?.textContent).toBe("below");
  return ((doc.toJSON() as JSONContent).content ?? []).slice(1, -1);
}

/** What the file reads between "above" and "below" when it holds `content`
 *  there — the way the document is saved. */
function fileReadsAs(editor: Editor, content: string): JSONContent[] {
  const doc = markdownToProsemirror(
    `above\n\n${content}\n\nbelow\n`,
    editor.schema,
  );
  return ((doc.toJSON() as JSONContent).content ?? []).slice(1, -1);
}

/** Saving the document and opening it again gives the same document. */
function expectSameAfterSave(editor: Editor): void {
  const saved = prosemirrorToMarkdown(editor.state.doc);
  expect(markdownToProsemirror(saved, editor.schema).toJSON()).toEqual(
    editor.state.doc.toJSON(),
  );
}

describe("an edit that reads back as other blocks, whole", () => {
  // What fails these: committing the text as the block's attribute again —
  // the document keeps one block and the next open reads another.
  it.each([
    ["a blank line inside a div", "<div>\n\nhello\n</div>"],
    ["a line of only spaces inside a div", "<div>\n  \nhello\n</div>"],
    ["plain words", "plain words"],
    ["front matter's spelling", "---\ntitle: x\n---"],
    ["nothing", ""],
  ])("%s becomes what the file reads", async (_label, content) => {
    const editor = setup();
    await flush();
    await typeIntoBlock(editor, content);
    await deselect(editor);

    expect(middle(editor)).toEqual(fileReadsAs(editor, content));
    expectSameAfterSave(editor);
    expect(useUIStore.getState().toast).toBeNull();
  });

  // What fails this: keeping the replacement out of the undo history. (Two
  // transactions in a row would pass too — the history groups them.)
  it("can be undone back to the block", async () => {
    const editor = setup();
    await flush();
    await typeIntoBlock(editor, "<div>\n\nhello\n</div>");
    await deselect(editor);

    act(() => {
      editor.commands.undo();
    });
    await flush();

    expect(middle(editor)).toEqual([
      { attrs: { content: "<div>hello</div>" }, type: "htmlBlock" },
    ]);
  });
});

describe("an edit the file reads differently", () => {
  // Kept as typed, with a notice. What fails these: replacing the block with
  // what the loader reads anyway — the tag or the definition is gone at once,
  // or the blocks after it become part of the comment — or committing without
  // the notice, or with the other one.
  it.each([
    ["an inline tag", '<span style="color:red">warn</span>', "differently"],
    ["a definition line", "[foo]: https://example.com", "differently"],
    ["an unclosed comment", "<!-- note", "merge"],
    ["an unclosed pre", "<pre>\nfoo", "merge"],
    ["a definition list's description", ": x", "merge"],
  ])("%s is kept as typed", async (_label, content, notice) => {
    const editor = setup();
    await flush();
    await typeIntoBlock(editor, content);
    await deselect(editor);

    expect(middle(editor)).toEqual([{ attrs: { content }, type: "htmlBlock" }]);
    expect(useUIStore.getState().toast?.message).toContain(notice);
  });

  // The notice is about text the block no longer holds once a later edit
  // goes through. What fails these: leaving that commit path without
  // retiring the notice.
  it.each([
    ["reads back as itself", "<div>bye</div>"],
    ["reads back as other blocks", "plain words"],
  ])("is retired by a later edit that %s", async (_label, content) => {
    const editor = setup();
    await flush();
    await typeIntoBlock(editor, '<span style="color:red">warn</span>');
    await deselect(editor);
    expect(useUIStore.getState().toast).not.toBeNull();

    await typeIntoBlock(editor, content);
    await deselect(editor);

    expect(middle(editor)).toEqual(fileReadsAs(editor, content));
    expect(useUIStore.getState().toast).toBeNull();
  });
});

describe("an edit that reads back as itself", () => {
  // Control: the block stays one block holding what was typed, no notice.
  it("is committed as the block's content", async () => {
    const editor = setup();
    await flush();
    await typeIntoBlock(editor, "<div>bye</div>");
    await deselect(editor);

    expect(middle(editor)).toEqual([
      { attrs: { content: "<div>bye</div>" }, type: "htmlBlock" },
    ]);
    expect(useUIStore.getState().toast).toBeNull();
  });
});

describe("a document replaced while the block holds typing", () => {
  // A reload sets a whole new document (`setContent`, as a file window does
  // for an external change) while the textarea still holds unsaved typing;
  // ProseMirror reuses this view for the new document's HTML block. What
  // fails this: committing on the deselect that follows — the typing lands in
  // the new document's block.
  it("does not write the typing into the new document on deselect", async () => {
    const editor = setup();
    await flush();
    await typeIntoBlock(editor, "<div>typed</div>");

    act(() => {
      editor.commands.setContent(docWith("<div>other</div>"));
    });
    await flush();

    expect(middle(editor)).toEqual([
      { attrs: { content: "<div>other</div>" }, type: "htmlBlock" },
    ]);
  });

  // With the HTML block last, the selection stays on the new document's
  // block and the session stays open. What fails this: leaving the typing in
  // the textarea once the block's text changed under the session — Esc then
  // writes it over the reloaded block.
  it("shows the new text and keeps it on Esc", async () => {
    const lastBlock = (above: string, content: string): JSONContent => ({
      content: [
        { content: [{ text: above, type: "text" }], type: "paragraph" },
        { attrs: { content }, type: "htmlBlock" },
      ],
      type: "doc",
    });
    const editor = new Editor({
      content: lastBlock("above", "<div>hello</div>"),
      extensions: createBaramExtensions(),
    });
    editors.push(editor);
    render(<EditorContent editor={editor} />);
    await flush();
    await typeIntoBlock(editor, "<div>typed</div>");

    act(() => {
      editor.commands.setContent(lastBlock("other", "<div>other</div>"));
    });
    await flush();
    expect(textarea().value).toBe("<div>other</div>");

    act(() => {
      fireEvent.keyDown(textarea(), { key: "Escape" });
    });
    await flush();

    expect(editor.state.doc.child(1).attrs.content).toBe("<div>other</div>");
  });
});

describe("an edit read where the block stands in its document", () => {
  /** An editor holding what the file `markdown` loads as. */
  function open(markdown: string): Editor {
    const scratch = new Editor({ extensions: createBaramExtensions() });
    const content = markdownToProsemirror(markdown, scratch.schema).toJSON();
    scratch.destroy();
    const editor = new Editor({
      content,
      extensions: createBaramExtensions(),
    });
    editors.push(editor);
    render(<EditorContent editor={editor} />);
    return editor;
  }

  /** Open the block at `at`, type `content`, and click into `below`. */
  async function editBlockAt(
    editor: Editor,
    at: number,
    content: string,
  ): Promise<void> {
    act(() => {
      editor.commands.setNodeSelection(at);
    });
    await flush();
    act(() => {
      textarea().focus();
      fireEvent.change(textarea(), { target: { value: content } });
    });
    await flush();
  }

  // What fails this: reading the text without the document's footnote
  // definitions — `[^1]` becomes text, saved as `\[^1]`.
  it("keeps a footnote reference whose definition is elsewhere", async () => {
    const editor = open("above\n\n<div>hello</div>\n\nbelow\n\n[^1]: note\n");
    await flush();
    await editBlockAt(editor, BLOCK_AT, "See[^1] here");
    await deselect(editor);

    const types: string[] = [];
    editor.state.doc.child(1).descendants((node) => {
      types.push(node.type.name);
    });
    expect(types).toContain("footnoteRef");
  });

  // What fails this: reading the first block after a paragraph — the front
  // matter becomes a rule and a heading.
  it("reads front matter in the document's first block", async () => {
    const editor = open("<div>x</div>\n\nbelow\n");
    await flush();
    await editBlockAt(editor, 0, "---\ntitle: x\n---");
    act(() => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    });
    await flush();

    expect(editor.state.doc.firstChild?.type.name).toBe("frontmatter");
  });

  // The loader reads `- <div>x</div>` as a list item that starts with an HTML
  // block, which the schema does not allow; replacing that block, ProseMirror
  // adds the paragraph a list item starts with. What fails this: stepping
  // over the blocks read rather than what now stands in the block's place —
  // the caret lands inside the heading.
  it("steps over what ProseMirror put in the block's place", async () => {
    const editor = open("- <div>x</div>\n\nbelow\n");
    await flush();
    await editBlockAt(editor, 2, "# h");
    const ta = textarea();
    ta.setSelectionRange(ta.value.length, ta.value.length);

    act(() => {
      fireEvent.keyDown(ta, { key: "ArrowDown" });
    });
    await flush();

    let headingEnd = -1;
    editor.state.doc.descendants((node, offset) => {
      if (node.type.name === "heading") headingEnd = offset + node.nodeSize;
    });
    expect(headingEnd).toBeGreaterThan(0);
    expect(editor.state.selection.from).toBeGreaterThanOrEqual(headingEnd);
  });
});

describe("leaving the block by the keyboard after such an edit", () => {
  /** Where an exit downward puts the caret for any atom block that has a
   *  block after it: right before that block. */
  function belowAt(editor: Editor): number {
    let at = -1;
    editor.state.doc.forEach((node, offset) => {
      if (node.textContent === "below") at = offset;
    });
    return at;
  }

  // What fails these: placing the caret by the old block's size (one atom)
  // after it was replaced by several blocks — it lands after `<div>`.
  it.each([
    ["Esc", { key: "Escape" }],
    ["ArrowDown on the last line", { key: "ArrowDown" }],
  ])("%s lands after the blocks it now reads as", async (_label, key) => {
    const editor = setup();
    await flush();
    await typeIntoBlock(editor, "<div>\n\nhello\n</div>");
    const ta = textarea();
    ta.setSelectionRange(ta.value.length, ta.value.length);

    act(() => {
      fireEvent.keyDown(ta, key);
    });
    await flush();

    expect(middle(editor)).toEqual(
      fileReadsAs(editor, "<div>\n\nhello\n</div>"),
    );
    expect(editor.state.selection).toBeInstanceOf(TextSelection);
    expect(editor.state.selection.from).toBe(belowAt(editor));
  });

  // The blocks it reads as start with the block as it was, so ProseMirror
  // keeps this view on that first block and the deselect after the exit sees
  // the typing differ from it again. What fails this: leaving the session's
  // typing marked unsaved after the exit committed it — the deselect commits
  // it a second time and "more" appears twice.
  it("Esc commits once when the first block is the block as it was", async () => {
    const editor = setup();
    await flush();
    await typeIntoBlock(editor, "<div>hello</div>\n\nmore");

    act(() => {
      fireEvent.keyDown(textarea(), { key: "Escape" });
    });
    await flush();

    expect(middle(editor)).toEqual(
      fileReadsAs(editor, "<div>hello</div>\n\nmore"),
    );
  });

  /** Open the block under vim and type `content`. */
  async function typeUnderVim(editor: Editor, content: string): Promise<void> {
    act(() => {
      editor.commands.setNodeSelection(BLOCK_AT);
    });
    await flush();
    act(() => {
      textarea().focus();
      textarea().dispatchEvent(new FocusEvent("focus"));
    });
    await flush();
    act(() => {
      fireEvent.change(textarea(), { target: { value: content } });
    });
    await flush();
  }

  // The text reads as a paragraph and then an HTML block, and ProseMirror
  // keeps this view on that HTML block. What fails this: selecting whole
  // whatever stands at the position — a paragraph is not one to select
  // whole — or asking the view where it is after the save, which lands on
  // the HTML block after the paragraph.
  it("vim's Esc lands normal mode in a first block of text", async () => {
    useSettingsStore.setState({ vimMode: true });
    const editor = setup();
    await flush();
    await typeUnderVim(editor, "plain words\n\n<div>y</div>");

    act(() => {
      fireEvent.keyDown(textarea(), { key: "Escape" });
    });
    await flush();

    expect(middle(editor)).toEqual(
      fileReadsAs(editor, "plain words\n\n<div>y</div>"),
    );
    expect(editor.state.selection).toBeInstanceOf(TextSelection);
    expect(vimPluginKey.getState(editor.state)?.mode).toBe("normal");
    expect(editor.state.selection).not.toBeInstanceOf(NodeSelection);
    expect(editor.state.selection.$from.parent.textContent).toBe("plain words");
  });

  // What fails this: a landing that only places a caret — it skips the
  // first block, an atom, for the paragraph after it.
  it("vim's Esc selects a first block that is an atom", async () => {
    useSettingsStore.setState({ vimMode: true });
    const editor = setup();
    await flush();
    await typeUnderVim(editor, "<div>\n\nx\n</div>");
    const ta = document.querySelector<HTMLTextAreaElement>(
      ".html-block textarea",
    )!;

    act(() => {
      fireEvent.keyDown(ta, { key: "Escape" });
    });
    await flush();

    expect(middle(editor)).toEqual(fileReadsAs(editor, "<div>\n\nx\n</div>"));
    expect(vimPluginKey.getState(editor.state)?.mode).toBe("normal");
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(editor.state.selection.from).toBe(BLOCK_AT);
  });
});
