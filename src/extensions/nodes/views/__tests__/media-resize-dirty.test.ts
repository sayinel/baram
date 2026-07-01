// Regression (§5.1/§5.5/§3.3 + dirty tracking): resizing a media block marks the
// tab dirty even when the resize is the FIRST doc-changing action after a file
// loads. Previously that first update was unconditionally absorbed as the dirty
// baseline (a DOM-normalization allowance), so a lone attr-only resize/caption —
// which does not change content.size — was silently swallowed and never dirtied.
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../..";
import {
  markdownToProsemirror,
  prosemirrorToMarkdown,
} from "../../../../pipeline";
import {
  clearOriginalDoc,
  markContentLoaded,
  shouldSkipDirty,
} from "../../../../utils/editor/programmatic-update";

// Destroy every editor after each test. Otherwise ProseMirror's DOMObserver
// keeps a scheduled flush timer that fires after the jsdom environment is torn
// down → "document is not defined" surfaces as an unhandled error in CI.
const editors: Editor[] = [];
afterEach(() => {
  for (const e of editors) e.destroy();
  editors.length = 0;
});

function buildEditor(md: string): Editor {
  const editor = new Editor({ extensions: createBaramExtensions() });
  editor.commands.setContent(markdownToProsemirror(md, editor.schema).toJSON());
  editors.push(editor);
  return editor;
}

/** Replays the use-auto-save dirty handler; the resize is the first update. */
function dirtyAfterFirstResize(
  tabId: string,
  md: string,
  typeName: string,
  resizeAttrs: Record<string, unknown>,
): boolean {
  clearOriginalDoc(tabId);
  const editor = buildEditor(md);
  let dirty = false;
  editor.on("update", ({ transaction }) => {
    const skip = shouldSkipDirty(tabId, editor.state.doc, {
      beforeDoc: transaction.before,
      markdownEqual: (a, b) =>
        prosemirrorToMarkdown(a) === prosemirrorToMarkdown(b),
    });
    if (!skip) dirty = true;
  });

  markContentLoaded(tabId);
  const { attrs, pos } = nodePos(editor, typeName);
  editor.view.dispatch(
    editor.state.tr.setNodeMarkup(pos, undefined, { ...attrs, ...resizeAttrs }),
  );
  return dirty;
}

function nodePos(
  editor: Editor,
  typeName: string,
): { attrs: object; pos: number } {
  let found: null | { attrs: object; pos: number } = null;
  editor.state.doc.descendants((node, pos) => {
    if (!found && node.type.name === typeName)
      found = { attrs: node.attrs, pos };
    return !found;
  });
  if (!found) throw new Error(`node ${typeName} not found`);
  return found;
}

describe("media resize marks dirty even as the first post-load action", () => {
  it("mermaid width", () => {
    expect(
      dirtyAfterFirstResize(
        "m",
        "```mermaid\nflowchart LR\n  A --> B\n```\n",
        "mermaidBlock",
        { width: 50 },
      ),
    ).toBe(true);
  });

  it("svg code width", () => {
    expect(
      dirtyAfterFirstResize(
        "s",
        '```svg\n<svg viewBox="0 0 10 10"><rect/></svg>\n```\n',
        "svgBlock",
        { code: '<svg width="50%" viewBox="0 0 10 10"><rect/></svg>' },
      ),
    ).toBe(true);
  });

  it("image widthPercent", () => {
    expect(
      dirtyAfterFirstResize("i", "![alt](img.png)\n", "image", {
        widthPercent: 50,
      }),
    ).toBe(true);
  });
});
