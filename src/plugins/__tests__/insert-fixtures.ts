import type { InsertTarget } from "../editor-insert-rules";
// Shared fixtures for the insertion-rule tests (§388 spec 0067 §11): a markdown insert helper
// that goes through the real parser and `buildInsertion`, and position finders for nodes.
import type { Editor } from "@tiptap/core";

import { expect } from "vitest";

import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { serializeLiveDoc } from "../../utils/editor/serialize-live-doc";
import { buildInsertion } from "../editor-insert-rules";
import { codeOf, realEditor } from "./real-editor";

/** The markdown result at the marked range, serialized. */
export function at(source: string, markdown: string): string {
  const { editor, from, to } = realEditor(source);
  insert(editor, { from, kind: "text", to }, markdown);
  const out = serializeLiveDoc(editor);
  editor.destroy();
  return out;
}

export function insert(
  editor: Editor,
  target: InsertTarget,
  markdown: string,
): void {
  const fragment = markdownToProsemirror(markdown, editor.schema).content;
  editor.view.dispatch(
    buildInsertion(
      editor.state,
      target,
      { fragment, kind: "markdown", source: markdown },
      "insertMarkdown",
    ),
  );
}

/**
 * `[from, to]` of the first node of `name` (any depth) — whose text starts with `text`, when
 * given — as a node-selection target.
 */
export function nodeTarget(
  editor: Editor,
  name: string,
  text?: string,
): InsertTarget {
  let found: InsertTarget | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (
      found === null &&
      node.type.name === name &&
      (text === undefined || node.textContent.startsWith(text))
    ) {
      found = { from: pos, kind: "node", to: pos + node.nodeSize };
    }
  });
  if (found === null) throw new Error(`no ${name} in the document`);
  return found;
}

/** The refusal code `insert` throws with, and that the document was left untouched. */
export function refuseAt(
  editor: Editor,
  target: InsertTarget,
  markdown: string,
): void {
  const before = editor.state.doc;
  expect(codeOf(() => insert(editor, target, markdown))).toBe(
    "cannot-insert-here",
  );
  expect(editor.state.doc).toBe(before); // nothing dispatched
}

/** Marker range in `source` is refused for `markdown`. */
export function refused(source: string, markdown: string): void {
  const { editor, from, to } = realEditor(source);
  refuseAt(editor, { from, kind: "text", to }, markdown);
  editor.destroy();
}

export function topTypes(editor: Editor): string[] {
  const types: string[] = [];
  editor.state.doc.forEach((n) => void types.push(n.type.name));
  return types;
}
