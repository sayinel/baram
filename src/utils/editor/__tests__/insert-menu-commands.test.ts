// The native menu's Insert commands act on the editor they are given, whichever window holds it.
import { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../../extensions";
import {
  isInsertMenuCommand,
  runInsertMenuCommand,
} from "../insert-menu-commands";

let editor: Editor;

beforeEach(() => {
  editor = new Editor({
    content: "<p>text</p>",
    extensions: createBaramExtensions(),
  });
  editor.commands.selectAll();
});

afterEach(() => {
  editor.destroy();
});

describe("the Insert menu commands", () => {
  it("act on the editor given", async () => {
    await runInsertMenuCommand("insert_bold", editor as never);

    expect(editor.getHTML()).toContain("<strong>");
  });

  it("do nothing without an editor", async () => {
    await expect(
      runInsertMenuCommand("insert_bold", null),
    ).resolves.toBeUndefined();
    await expect(
      runInsertMenuCommand("insert_table", null),
    ).resolves.toBeUndefined();
  });

  it("are told apart by their prefix", () => {
    expect(isInsertMenuCommand("insert_bold")).toBe(true);
    expect(isInsertMenuCommand("file_save")).toBe(false);
    expect(isInsertMenuCommand("italic")).toBe(false);
  });
});
