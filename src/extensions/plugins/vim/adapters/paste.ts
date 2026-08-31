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
import type { NodeType, Node as PMNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";

import { Fragment, Slice } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";

import { asTaskState } from "../../../../utils/tasks/task-state";
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
  if (!register) return { reason: "register is empty", silent: true, tr: null };
  return register.kind === "char"
    ? pasteChar(state, pos, register.slice, after, count)
    : pasteLine(state, pos, register, after, count);
}

// ── line ───────────────────────────────────────────────────────────────────

/** Register blocks reshaped for where they land (§9 호환표): items become
 *  the ANCHOR's item type inside a list — a taskList only admits taskItem,
 *  so wrapping with a generic listItem would make the fitter split the list
 *  (impl review R1) — and demote to their child blocks outside one. */
function adaptToAnchor(
  nodes: PMNode[],
  anchorItemType: NodeType | null,
): { blocks: PMNode[] } | { reason: string } {
  const blocks: PMNode[] = [];
  for (const node of nodes) {
    const isItem =
      node.type.name === "listItem" || node.type.name === "taskItem";
    if (isItem && !anchorItemType) {
      node.forEach((child) => blocks.push(child));
      continue;
    }
    if (anchorItemType) {
      if (isItem) {
        if (node.type === anchorItemType) {
          blocks.push(node);
        } else if (asTaskState(node.attrs.state) !== "todo") {
          // Converting would silently drop the state (impl review R2) —
          // refuse instead of lying about the data. §18.18 M4 widened the
          // test from "checked" to "not todo": `[/]` and `[-]` are just as
          // unrepresentable in a plain list item as `[x]` is.
          return { reason: "a checked task line cannot convert here" };
        } else {
          blocks.push(anchorItemType.create(null, node.content));
        }
        continue;
      }
      blocks.push(anchorItemType.create(null, Fragment.from(node)));
      continue;
    }
    blocks.push(node);
  }
  return { blocks };
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
    // ALWAYS blockPos: containerPos is dd's escalation target only. Pasting
    // relative to the container would escape it — §9 wants siblings INSIDE
    // (impl review R1).
    const node = state.doc.nodeAt(unit.blockPos);
    return [unit.blockPos, unit.blockPos + (node?.nodeSize ?? 1)];
  }
  // hardBreakSegment with block content: sibling AFTER the paragraph (§9).
  if (unit.kind === "hardBreakSegment") {
    const textblock = state.doc.nodeAt(unit.textblockPos);
    return [unit.textblockPos, unit.textblockPos + (textblock?.nodeSize ?? 1)];
  }
  return [pos, pos];
}

/**
 * Counted paste is BUDGETED. A vim count reaches MAX_COUNT (9999) entirely
 * independently of what the register holds, so `9999p` after yanking a long
 * line asks for gigabytes of synchronous insertion on the UI thread — a
 * frozen or dead WebView with unsaved work, not an edit (measured: a 4k-unit
 * slice at full count killed the test worker outright). Every paste shape
 * projects count × unit size through this gate first.
 */
const PASTE_BUDGET = 2_000_000;

/** …and a ceiling on NODES created, so a full count of atoms cannot each
 *  mount a NodeView (an image or html block renders on mount). Generous
 *  for real use — duplicating a 10-line block 100 times is 1,000 nodes. */
const PASTE_NODE_BUDGET = 5_000;

/** Exported as a test seam — the budget contract is the security boundary. */
export function budgetRefusal(
  unitSize: number,
  count: number,
  nodeCount = 1,
): null | OperationOutcome {
  // count 1 is NOT amplification: it inserts exactly what the user just
  // yanked, already bounded by the open document. Refusing it would break
  // legitimate "cut a huge block, paste it elsewhere" moves, so only a
  // MULTIPLIED paste is budgeted.
  if (count <= 1) return null;
  if (
    unitSize * count <= PASTE_BUDGET &&
    nodeCount * count <= PASTE_NODE_BUDGET
  ) {
    return null;
  }
  return { reason: "paste is too large for one command", tr: null };
}

function attrsBytes(node: PMNode): number {
  let total = 0;
  for (const value of Object.values(node.attrs)) {
    if (typeof value === "string") total += value.length;
  }
  return total;
}

/**
 * Cost of inserting `node` once. Positions alone lie: an atom's nodeSize is
 * 1 no matter what it carries, and htmlBlock/svgBlock/image keep their raw
 * payload in ATTRS (a 200KB html block is one position). Attribute bytes
 * and node count are the parts that actually cost sanitizing, rendering
 * and memory (final review).
 */
function nodeCost(node: PMNode): { nodes: number; weight: number } {
  let nodes = 1;
  let weight = node.nodeSize + attrsBytes(node);
  node.descendants((child) => {
    nodes += 1;
    weight += attrsBytes(child);
    return true;
  });
  return { nodes, weight };
}

function pasteChar(
  state: EditorState,
  pos: number,
  sliceJSON: null | unknown,
  after: boolean,
  count: number,
): OperationOutcome {
  if (sliceJSON === null)
    return { reason: "register is empty", silent: true, tr: null };
  const slice = Slice.fromJSON(state.schema, sliceJSON);
  const sliceNodes: PMNode[] = [];
  slice.content.forEach((node) => sliceNodes.push(node));
  const over = projectedCost(sliceNodes, count);
  if (over) return over;
  const insertAt = after ? nextUnitBoundary(state, pos) : pos;
  const tr = state.tr.setSelection(TextSelection.create(state.doc, insertAt));
  for (let i = 0; i < count; i++) tr.replaceSelection(slice);
  return { tr };
}

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
    // After-paste inserts AT unit.to — before any following break — so the
    // existing separator keeps belonging to the next line (impl review R1:
    // deleteRange.to landed past the break and merged lines).
    const insertAt = after ? unit.to : unit.from;
    const breakNode = state.schema.nodes.hardBreak.create();
    const inlineOver = projectedCost(nodes, count);
    if (inlineOver) return inlineOver;
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
  const anchorItemType =
    unit.kind === "listItem"
      ? (state.doc.nodeAt(unit.itemPos)?.type ?? null)
      : null;
  const adapted = adaptToAnchor(nodes, anchorItemType);
  if ("reason" in adapted) return { reason: adapted.reason, tr: null };
  const { blocks } = adapted;
  if (blocks.length === 0)
    return { reason: "register is empty", silent: true, tr: null };
  // AFTER adaptation: wrapping top-level blocks as list items grows the
  // inserted shape (an empty paragraph becomes a 4-position item), so
  // budgeting the raw register would let twice the cap through.
  const blockOver = projectedCost(blocks, count);
  if (blockOver) return blockOver;
  const repeated: PMNode[] = [];
  for (let i = 0; i < count; i++) repeated.push(...blocks);

  const [from, to] = anchorBounds(state, unit, pos);
  return { tr: state.tr.insert(after ? to : from, Fragment.from(repeated)) };
}

// ── table rows ─────────────────────────────────────────────────────────────

function pasteRows(
  state: EditorState,
  rowPos: number,
  rows: PMNode[],
  after: boolean,
  count: number,
): OperationOutcome {
  const anchorRow = state.doc.nodeAt(rowPos);
  if (!anchorRow) {
    return { reason: "no row under cursor", silent: true, tr: null };
  }

  // Width comes from the TABLE grid, not the anchor row — a rowspan-shadowed
  // row's own cells undercount (impl review R1). Merged rows are refused
  // outright: a raw row insert inside a rowspan region breaks the grid.
  const table = state.doc.resolve(rowPos).parent;
  if (tableHasRowspan(table)) {
    return { reason: "tables with merged rows are not supported", tr: null };
  }
  const targetWidth = TableMap.get(table).width;

  // Markdown holds ONE header row on top, and the md pipeline normalizes
  // every table to that shape on reload. Only CANONICAL tables take rows —
  // first row all tableHeader, every later cell tableCell — otherwise the
  // paste would lock in a structure the roundtrip rewrites (impl reviews
  // R2·R3: multi-header, headerless, mixed first row). Nothing pastes
  // ABOVE the header either (impl review R1).
  let canonical = true;
  let rowIndex = 0;
  table.forEach((row) => {
    const headerRow = rowIndex === 0;
    row.forEach((cell) => {
      if ((cell.type.name === "tableHeader") !== headerRow) canonical = false;
    });
    rowIndex++;
  });
  if (!canonical) {
    return { reason: "table header layout is not supported", tr: null };
  }
  if (rowHasHeaderCells(anchorRow) && !after) {
    return { reason: "cannot paste above the header row", tr: null };
  }
  for (const row of rows) {
    if (row.type.name !== "tableRow") {
      return { reason: "register does not hold table rows", tr: null };
    }
    if (rowHasRowspan(row)) {
      return { reason: "merged rows are not supported", tr: null };
    }
    if (spanWidth(row) !== targetWidth) {
      return { reason: "row width does not match this table", tr: null };
    }
    if (rowHasHeaderCells(row)) {
      return { reason: "header rows cannot be pasted here", tr: null };
    }
  }

  const insertAt = after ? rowPos + anchorRow.nodeSize : rowPos;
  const rowsOver = projectedCost(rows, count);
  if (rowsOver) return rowsOver;
  const repeated: PMNode[] = [];
  for (let i = 0; i < count; i++) repeated.push(...rows);
  return { tr: state.tr.insert(insertAt, Fragment.from(repeated)) };
}

/** Projected cost of `nodes` repeated `count` times. */
function projectedCost(
  nodes: PMNode[],
  count: number,
): null | OperationOutcome {
  let weight = 0;
  let nodeCount = 0;
  for (const node of nodes) {
    const cost = nodeCost(node);
    weight += cost.weight;
    nodeCount += cost.nodes;
  }
  return budgetRefusal(weight, count, nodeCount);
}

function rowHasHeaderCells(row: PMNode): boolean {
  let header = false;
  row.forEach((cell) => {
    if (cell.type.name === "tableHeader") header = true;
  });
  return header;
}

function rowHasRowspan(row: PMNode): boolean {
  let merged = false;
  row.forEach((cell) => {
    if (((cell.attrs.rowspan as number) || 1) > 1) merged = true;
  });
  return merged;
}

/** Column count with colspans resolved (§9 "span 해소 후 열 수"). */
function spanWidth(row: PMNode): number {
  let width = 0;
  row.forEach((cell) => {
    width += (cell.attrs.colspan as number) || 1;
  });
  return width;
}

// ── shared ─────────────────────────────────────────────────────────────────

function tableHasRowspan(table: PMNode): boolean {
  let merged = false;
  table.forEach((row) => {
    if (rowHasRowspan(row)) merged = true;
  });
  return merged;
}
