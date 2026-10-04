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
    return insertLiteral(tr, input.text, target);
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
    // Rule 5a is judged by the selected node's parent, which is `$from.parent` here.
    if (
      BLOCK_REFUSING_PARENTS.has($from.parent.type.name) &&
      !isSingleParagraph(input.fragment)
    ) {
      refuse(
        "cannot-insert-here",
        method,
        "a table cell holds inline content only",
      );
    }
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
    return insertLiteral(tr, input.source, target);
  }
  // Rule 2 for inline code too (2026-10-04 decision): code is literal. `insertLiteral` takes
  // the marks from the document at the target, so the inserted source stays inside the code span.
  if (inInlineCode(state, $from, $to)) {
    return insertLiteral(tr, input.source, target);
  }
  const fragment = input.fragment;
  if (isInlineParagraph(fragment)) {
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
  // Not for one paragraph, which here holds a block node (rule 3 took the all-inline ones).
  // Widened, the replace has to place that open paragraph between blocks, and for
  // `x ![a](y.png) z` over an empty paragraph or a paragraph's whole content it threw a
  // TypeError (final review F1). Unwidened, it is rule 3's replace: the same slice on the
  // same range.
  if (
    !isSingleParagraph(fragment) &&
    $from.sameParent($to) &&
    from === $from.start() &&
    to === $from.end()
  ) {
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

/**
 * `Transaction.insertText` prefers `tr.storedMarks` — which starts as the state's stored marks,
 * e.g. bold toggled at the user's caret elsewhere — and reads the marks from the document at
 * the target only when that is null (prosemirror-state, `Transaction.insertText`). Clearing
 * it first makes a literal insert take the target's own marks, so code stays code and a stray
 * stored mark does not leak in.
 */
function insertLiteral(
  tr: Transaction,
  text: string,
  target: InsertTarget,
): Transaction {
  tr.setStoredMarks(null);
  return tr.insertText(text, target.from, target.to);
}

/**
 * Rule 3's result: one paragraph whose children are all inline, so it opens into the target
 * textblock. One paragraph is not enough. The loader keeps an image that shares a line with
 * text inside the paragraph — `x ![a](y.png) z` parses to `paragraph[text, image, text]`, the
 * issue-509 shape `expandMediaAtom` will not reveal — and the image is `group: "block"`.
 * Opened into a textblock, the replace closed it at the image: in a heading the tail became a
 * body paragraph, and in a table cell `tr.replace` threw a TypeError with no code (final
 * review F1). Such a result takes rule 4, which checks the target first. An empty paragraph
 * (`insertMarkdown("")`) has no children and passes; a hard break is inline.
 */
function isInlineParagraph(fragment: Fragment): boolean {
  if (!isSingleParagraph(fragment)) return false;
  let inline = true;
  fragment.firstChild!.forEach((child) => {
    if (!child.isInline) inline = false;
  });
  return inline;
}

function isParagraph($pos: ResolvedPos): boolean {
  return $pos.parent.type.name === "paragraph";
}

/**
 * One paragraph, whatever it holds. Rule 5a on the node path asks only this: a closed
 * paragraph goes into a cell whole, an image inside it too, and the cell still writes one
 * line (`| x ![a](y.png) z | d |` loads to that shape and writes back the same).
 */
function isSingleParagraph(fragment: Fragment): boolean {
  return (
    fragment.childCount === 1 && fragment.firstChild!.type.name === "paragraph"
  );
}

function refusesBlocks($pos: ResolvedPos): boolean {
  return BLOCK_REFUSING_PARENTS.has($pos.node($pos.depth - 1).type.name);
}
