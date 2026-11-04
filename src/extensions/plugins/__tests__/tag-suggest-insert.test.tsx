// §56m What the editor's `#` autocomplete inserts.
import type { SuggestionProps } from "@tiptap/suggestion";

import { act, cleanup, render } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { EditorContent } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { getVaultTags, getConfig, setConfig } = vi.hoisted(() => ({
  getConfig: vi.fn().mockResolvedValue(null),
  getVaultTags: vi.fn(),
  setConfig: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../ipc/invoke", () => ({ getConfig, getVaultTags, setConfig }));

// The popup is not under test: capture the props Suggestion hands it instead.
const opened = vi.hoisted(() => ({ props: null as null | SuggestionProps }));
vi.mock("../suggestion-renderer", () => ({
  createSuggestionRenderer: () => () => ({
    onExit: () => {},
    onKeyDown: () => false,
    onStart: (props: SuggestionProps) => {
      opened.props = props;
    },
    onUpdate: (props: SuggestionProps) => {
      opened.props = props;
    },
  }),
}));

import { prosemirrorToMarkdown } from "../../../pipeline/pm-to-md";
import { useFileStore } from "../../../stores/file/file";
import { Paragraph } from "../../nodes/paragraph";
import { TagNode } from "../../nodes/tag-node";
import { TagSuggest } from "../tag-suggest";

const editors: Editor[] = [];

afterEach(() => {
  cleanup();
  for (const e of editors.splice(0)) e.destroy();
  opened.props = null;
});

async function openTagMenu(): Promise<{
  editor: Editor;
  props: SuggestionProps;
}> {
  useFileStore.setState({ rootPath: "/vault" } as never);
  const editor = new Editor({
    extensions: [Document, Paragraph, Text, TagNode, TagSuggest],
  });
  editors.push(editor);
  render(<EditorContent editor={editor} />);
  await act(async () => {
    editor.commands.insertContent("#");
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(opened.props).not.toBeNull();
  return { editor, props: opened.props! };
}

describe("tag autocomplete (§56m)", () => {
  // What turns this red: inserting the name as the index row spells it. A row read from front
  // matter as `#solo` became the tag node `#solo`, saved as `##solo` — which is not a tag.
  it("inserts a #-spelled row as its name", async () => {
    getVaultTags.mockResolvedValue([{ count: 1, tag: "#solo" }]);
    const { editor, props } = await openTagMenu();
    expect(props.items).toEqual([{ count: 1, id: "0", tag: "#solo" }]);

    act(() => props.command(props.items[0]));
    expect(prosemirrorToMarkdown(editor.state.doc).trim()).toBe("#solo");
  });

  // What turns this red: offering every index row — a front-matter tag `"my tag"` is a tag
  // the index counts, and inserting it wrote `#my tag`, which reads back as the tag `my`.
  it("offers only names a tag in the body can spell", async () => {
    getVaultTags.mockResolvedValue([
      { count: 3, tag: "my tag" },
      { count: 2, tag: "a.b" },
      { count: 1, tag: "solo" },
    ]);
    const { props } = await openTagMenu();
    expect(props.items).toEqual([{ count: 1, id: "0", tag: "solo" }]);
  });

  it("inserts a bare row as it is", async () => {
    getVaultTags.mockResolvedValue([{ count: 1, tag: "solo" }]);
    const { editor, props } = await openTagMenu();
    act(() => props.command(props.items[0]));
    expect(prosemirrorToMarkdown(editor.state.doc).trim()).toBe("#solo");
  });
});
