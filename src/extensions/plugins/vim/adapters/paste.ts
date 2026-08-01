// §298 Vim Phase 1 — paste (design §6 register, §9 matrix).
//
// Pure builder, like operations.ts. The compatibility matrix in one place:
//
//   char           → replaceSelection with the revived Slice (§6), so marks,
//                    inline atoms, and open depths survive the round trip.
//   line/top       → sibling blocks after/before the current structural unit;
//                    into a SEGMENT, inline-only content becomes new segments
//                    (§9), anything else lands after the paragraph.
//   line/listItem  → sibling items inside a list; outside, each item demotes
//                    to its child blocks (내용 보존 — the `nested` row of the
//                    matrix).
//   line/tableRow  → rows into a structurally matching table (span-resolved
//                    column count + header kind); anything else no-op + 메시지.
//
// Slice revival always uses THIS state's schema — a foreign schema makes the
// fitter drop everything silently (spike #7).

import type { OperationOutcome } from "./operations";
import type { VimRegister } from "./register";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";

import { Fragment, Slice } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";

import { nextUnitBoundary } from "./graphemes";
import { resolveLineUnit } from "./line-units";

type LineRegister = Extract<VimRegister, { kind: "line" }>;

// ── char ───────────────────────────────────────────────────────────────────

export function pasteRegister(
  state: EditorState,
  pos: number,
  register: null | VimRegister,
  after: boolean,
  count: number,
): OperationOutcome {
  if (!register) return { reason: "register is empty", tr: null };
  return register.kind === "char"
    ? pasteChar(state, pos, register.slice, after, count)
    : pasteLine(state, pos, register, after, count);
}

// ── line ───────────────────────────────────────────────────────────────────

/** Register blocks reshaped for where they land (§9 호환표): items stay
 *  items inside a list and demote to their child blocks outside; plain
 *  blocks wrap into items when the anchor is a list item. */
function adaptToAnchor(
  state: EditorState,
  nodes: PMNode[],
  intoList: boolean,
): PMNode[] {
  return nodes.flatMap((node) => {
    const isItem =
      node.type.name === "listItem" || node.type.name === "taskItem";
    if (isItem && !intoList) {
      const children: PMNode[] = [];
      node.forEach((child) => children.push(child));
      return children;
    }
    if (!isItem && intoList) {
      return [state.schema.nodes.listItem.create(null, Fragment.from(node))];
    }
    return [node];
  });
}

/** True when every node is a textblock of inline content only. */
function allInlineOnly(nodes: PMNode[]): boolean {
  return nodes.every((node) => node.isTextblock);
}

function anchorBounds(
  state: EditorState,
  unit: ReturnType<typeof resolveLineUnit>,
  pos: number,
): [number, number] {
  if (unit.kind === "listItem") {
    return [unit.itemPos, unit.itemPos + unit.nodeSize];
  }
  if (unit.kind === "structural") {
    const from = unit.containerPos ?? unit.blockPos;
    const node = state.doc.nodeAt(from);
    return [from, from + (node?.nodeSize ?? 1)];
  }
  // hardBreakSegment with block content: sibling AFTER the paragraph (§9).
  if (unit.kind === "hardBreakSegment") {
    const textblock = state.doc.nodeAt(unit.textblockPos);
    return [unit.textblockPos, unit.textblockPos + (textblock?.nodeSize ?? 1)];
  }
  return [pos, pos];
}

function pasteChar(
  state: EditorState,
  pos: number,
  sliceJSON: null | unknown,
  after: boolean,
  count: number,
): OperationOutcome {
  if (sliceJSON === null) return { reason: "register is empty", tr: null };
  const slice = Slice.fromJSON(state.schema, sliceJSON);
  const insertAt = after ? nextUnitBoundary(state, pos) : pos;
  const tr = state.tr.setSelection(TextSelection.create(state.doc, insertAt));
  for (let i = 0; i < count; i++) tr.replaceSelection(slice);
  return { tr };
}

// ── table rows ─────────────────────────────────────────────────────────────

function pasteLine(
  state: EditorState,
  pos: number,
  register: LineRegister,
  after: boolean,
  count: number,
): OperationOutcome {
  const unit = resolveLineUnit(state, pos);
  const nodes = register.content.map((json) => state.schema.nodeFromJSON(json));

  if (register.context === "tableRow") {
    if (unit.kind !== "tableRow") {
      return { reason: "a table row can only paste into a table", tr: null };
    }
    return pasteRows(state, unit.rowPos, nodes, after, count);
  }

  if (unit.kind === "tableRow") {
    return { reason: "only table rows paste into a table", tr: null };
  }

  if (unit.kind === "hardBreakSegment" && allInlineOnly(nodes)) {
    // §9: inline-only line content joins the paragraph as new segments.
    const insertAt = after ? unit.deleteRange.to : unit.from;
    const breakNode = state.schema.nodes.hardBreak.create();
    const pieces: PMNode[] = [];
    for (let i = 0; i < count; i++) {
      for (const node of nodes) {
        const inline: PMNode[] = [];
        node.forEach((child) => inline.push(child));
        if (after) pieces.push(breakNode, ...inline);
        else pieces.push(...inline, breakNode);
      }
    }
    return { tr: state.tr.insert(insertAt, Fragment.from(pieces)) };
  }

  // Block-level anchor: the unit's own bounds decide before/after.
  const blocks = adaptToAnchor(state, nodes, unit.kind === "listItem");
  if (blocks.length === 0) return { reason: "register is empty", tr: null };
  const repeated: PMNode[] = [];
  for (let i = 0; i < count; i++) repeated.push(...blocks);

  const [from, to] = anchorBounds(state, unit, pos);
  return { tr: state.tr.insert(after ? to : from, Fragment.from(repeated)) };
}

function pasteRows(
  state: EditorState,
  rowPos: number,
  rows: PMNode[],
  after: boolean,
  count: number,
): OperationOutcome {
  const anchorRow = state.doc.nodeAt(rowPos);
  if (!anchorRow) return { reason: "no row under cursor", tr: null };

  const targetWidth = spanWidth(anchorRow);
  for (const row of rows) {
    if (row.type.name !== "tableRow") {
      return { reason: "register does not hold table rows", tr: null };
    }
    if (spanWidth(row) !== targetWidth) {
      return { reason: "row width does not match this table", tr: null };
    }
    if (rowHasHeaderCells(row)) {
      // Header kind must match; body-side pastes never take header cells.
      return { reason: "header rows cannot be pasted here", tr: null };
    }
  }

  const insertAt = after ? rowPos + anchorRow.nodeSize : rowPos;
  const repeated: PMNode[] = [];
  for (let i = 0; i < count; i++) repeated.push(...rows);
  return { tr: state.tr.insert(insertAt, Fragment.from(repeated)) };
}

function rowHasHeaderCells(row: PMNode): boolean {
  let header = false;
  row.forEach((cell) => {
    if (cell.type.name === "tableHeader") header = true;
  });
  return header;
}

// ── shared ─────────────────────────────────────────────────────────────────

/** Column count with colspans resolved (§9 "span 해소 후 열 수"). */
function spanWidth(row: PMNode): number {
  let width = 0;
  row.forEach((cell) => {
    width += (cell.attrs.colspan as number) || 1;
  });
  return width;
}
