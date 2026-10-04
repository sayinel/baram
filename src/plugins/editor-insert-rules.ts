// §388 spec 0067 §6 — how parsed markdown (or literal text) replaces a target range.
//
// Builds the transaction or refuses; it never dispatches. ProseMirror's paste semantics
// (`Slice.maxOpen`) are NOT used — they turn a heading into body text and glue a table
// cell's paragraphs together (spec §6.1). `tr.replace`, not `replaceRange` (plan 0117 P6):
// the spec's measurements were taken with the former.
import type { AnchorKind } from "../extensions/plugins/selection-anchors";
import type { Fragment, Node as PmNode, ResolvedPos } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";

import { Slice } from "@tiptap/pm/model";

import { refuse } from "./editor-refusal";

export type InsertInput =
  | { fragment: Fragment; kind: "markdown"; source: string }
  | { kind: "text"; text: string };

export interface InsertTarget {
  from: number;
  kind: AnchorKind;
  to: number;
}

/**
 * Parents whose serializer writes one line, so blocks cannot go in (rule 5a). The corpus
 * is the schema's eight multi-paragraph containers (spec §6.2, `163b9e62`); the test
 * rederives it so a new container fails there instead of slipping past this list.
 */
export const BLOCK_REFUSING_PARENTS: ReadonlySet<string> = new Set([
  "tableCell",
  "tableHeader",
]);

export function buildInsertion(
  state: EditorState,
  target: InsertTarget,
  input: InsertInput,
  method: string,
  testOnly: { skipCellRule?: boolean } = {},
): Transaction {
  const { tr } = state;
  if (input.kind === "text") {
    return tr.insertText(input.text, target.from, target.to);
  }
  if (target.kind === "all") {
    checkFrontMatter(input.fragment, 0, method);
    return tr.replace(
      0,
      state.doc.content.size,
      new Slice(input.fragment, 0, 0),
    );
  }
  const $from = state.doc.resolve(target.from);
  const $to = state.doc.resolve(target.to);
  if (!$from.parent.isTextblock) {
    // A block node selection: replace that node with closed blocks (spec §6.2 table).
    checkFrontMatter(input.fragment, target.from, method);
    return checkedReplace(
      state,
      target.from,
      target.to,
      new Slice(input.fragment, 0, 0),
      method,
    );
  }
  const codeFrom = $from.parent.type.spec.code === true;
  const codeTo = $to.parent.type.spec.code === true;
  if (codeFrom || codeTo) {
    if (!$from.sameParent($to))
      refuse(
        "cannot-insert-here",
        method,
        "the range crosses a code block's edge",
      );
    return tr.insertText(input.source, target.from, target.to);
  }
  // Rule 2 for inline code too (2026-10-04 decision): code is literal. `insertText` takes the
  // marks at `from`, so the inserted source stays inside the code span.
  if (inInlineCode(state, $from, $to)) {
    return tr.insertText(input.source, target.from, target.to);
  }
  const fragment = input.fragment;
  const single =
    fragment.childCount === 1 && fragment.firstChild!.type.name === "paragraph";
  if (single) {
    if (!$from.sameParent($to) && !(isParagraph($from) && isParagraph($to))) {
      refuse(
        "cannot-insert-here",
        method,
        "a heading or other non-paragraph block would be merged",
      );
    }
    return checkedReplace(
      state,
      target.from,
      target.to,
      new Slice(fragment, 1, 1),
      method,
    );
  }
  if (!isParagraph($from) || !isParagraph($to)) {
    refuse("cannot-insert-here", method, "blocks go into a paragraph only");
  }
  if (!testOnly.skipCellRule && (refusesBlocks($from) || refusesBlocks($to))) {
    refuse(
      "cannot-insert-here",
      method,
      "a table cell holds inline content only",
    );
  }
  let from = target.from;
  let to = target.to;
  if ($from.sameParent($to) && from === $from.start() && to === $from.end()) {
    from = $from.before();
    to = $from.after();
  }
  checkFrontMatter(fragment, from, method);
  const openStart = fragment.firstChild!.type.name === "paragraph" ? 1 : 0;
  const openEnd = fragment.lastChild!.type.name === "paragraph" ? 1 : 0;
  return checkedReplace(
    state,
    from,
    to,
    new Slice(fragment, openStart, openEnd),
    method,
  );
}

function checkedReplace(
  state: EditorState,
  from: number,
  to: number,
  slice: Slice,
  method: string,
): Transaction {
  const depth = state.doc.resolve(from).sharedDepth(to);
  const tr = state.tr.replace(from, to, slice);
  const start = tr.mapping.map(from, -1);
  const end = tr.mapping.map(to, 1);
  // Rule 5c: only the target textblock itself may be split, never a node above it.
  if (tr.doc.resolve(start).sharedDepth(end) < depth - 1) {
    refuse(
      "cannot-insert-here",
      method,
      "the insertion would split a block above the paragraph",
    );
  }
  return tr;
}

function checkFrontMatter(
  fragment: Fragment,
  rangeStart: number,
  method: string,
): void {
  fragment.forEach((node: PmNode, _offset: number, index: number) => {
    if (
      node.type.name === "frontmatter" &&
      !(index === 0 && rangeStart === 0)
    ) {
      refuse(
        "cannot-insert-here",
        method,
        "front matter can only be at the start of a document",
      );
    }
  });
}

/**
 * Both ends in the same textblock and the code mark active at both and on every text node
 * between them — a caret or a range wholly inside one inline code span.
 */
function inInlineCode(
  state: EditorState,
  $from: ResolvedPos,
  $to: ResolvedPos,
): boolean {
  const code = state.schema.marks.code;
  if (!code || !$from.sameParent($to)) return false;
  if (!code.isInSet($from.marks()) || !code.isInSet($to.marks())) return false;
  let all = true;
  state.doc.nodesBetween($from.pos, $to.pos, (node) => {
    if (node.isText && !code.isInSet(node.marks)) all = false;
  });
  return all;
}

function isParagraph($pos: ResolvedPos): boolean {
  return $pos.parent.type.name === "paragraph";
}

function refusesBlocks($pos: ResolvedPos): boolean {
  return BLOCK_REFUSING_PARENTS.has($pos.node($pos.depth - 1).type.name);
}
