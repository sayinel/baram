// §298 Vim Phase 1 — line/char operations (design §9, spike #7).
//
// Pure builders: EditorState in, Transaction out — nothing here dispatches.
// The S2 plugin owns dispatch and cursor normalization, which keeps every §9
// rule testable against the real schema without a view.
//
// Outcome semantics: `tr: null` with a `reason` is a refusal (§9 no-op +
// 메시지); `tr: null` without a reason is a pure register operation (yank).

import type { VisualState } from "../core/types";
import type { LineContext, VimRegister } from "./register";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";

import { Fragment } from "@tiptap/pm/model";
import { CellSelection, deleteRow } from "@tiptap/pm/tables";

import { visualRange } from "../core/visual-state";
import { nextUnitBoundary } from "./graphemes";
import { type LineUnit, resolveLineUnit } from "./line-units";

export interface OperationOutcome {
  /** Set on refusal — surfaced by the status line (S5). */
  reason?: string;
  register?: VimRegister;
  tr: null | Transaction;
}

interface UnitDeletion {
  /** Where the cursor should land to resolve the NEXT unit. */
  landing: number;
  tr: Transaction;
  yanked: YankedUnit;
}

/** One yanked line unit, before it joins the register's content array. */
interface YankedUnit {
  content: unknown;
  context: LineContext;
}

// ── operations (alphabetical — sort-modules) ───────────────────────────────

/** Delete `count` cursor units (graphemes / inline atoms) forward — x. */
export function deleteCharForward(
  state: EditorState,
  pos: number,
  count: number,
): OperationOutcome {
  let end = pos;
  for (let i = 0; i < count; i++) {
    const next = nextUnitBoundary(state, end);
    if (next === end) break;
    end = next;
  }
  if (end === pos) return { reason: "nothing to delete", tr: null };
  return {
    register: { kind: "char", slice: state.doc.slice(pos, end).toJSON() },
    tr: state.tr.delete(pos, end),
  };
}

/**
 * dd — delete `count` line units starting at the unit under `pos`. Counts walk
 * forward on the mutated document (vim `3dd`), building one transaction —
 * one undo step. The register receives every deleted unit (line kind).
 */
export function deleteLine(
  state: EditorState,
  pos: number,
  count: number,
): OperationOutcome {
  const master = state.tr;
  let working = state;
  let cursor = pos;
  const yanked: YankedUnit[] = [];
  let reason: string | undefined;

  for (let i = 0; i < count; i++) {
    const unit = resolveLineUnit(working, cursor);
    const step = deleteUnitOnce(working, unit);
    if (!step.tr) {
      reason = step.reason;
      break;
    }
    yanked.push(step.yanked);
    for (const s of step.tr.steps) master.step(s);
    working = working.apply(step.tr);
    if (unit.kind === "tableRow") break; // Phase 1: counts stop at a table row
    cursor = clampIntoContent(working, step.landing);
  }

  if (yanked.length === 0) return { reason, tr: null };
  return {
    register: {
      content: yanked.map((y) => y.content),
      context: yanked[0].context,
      kind: "line",
    },
    reason,
    tr: master,
  };
}

export function deleteVisual(
  state: EditorState,
  visual: VisualState,
): OperationOutcome {
  const { from, to } = visualBounds(state, visual);
  return {
    register: { kind: "char", slice: state.doc.slice(from, to).toJSON() },
    tr: state.tr.delete(from, to),
  };
}

/** Inclusive realization of the visual selection (§6): the unit under the
 *  trailing cursor is part of the range. */
export function visualBounds(
  state: EditorState,
  visual: VisualState,
): { from: number; to: number } {
  const max = Math.max(visual.anchorCursor, visual.headCursor);
  return visualRange(visual, nextUnitBoundary(state, max));
}

/** yy — yank `count` line units without touching the document. */
export function yankLine(
  state: EditorState,
  pos: number,
  count: number,
): OperationOutcome {
  const yanked: YankedUnit[] = [];
  let cursor = pos;

  for (let i = 0; i < count; i++) {
    const unit = resolveLineUnit(state, cursor);
    yanked.push(yankUnit(state, unit));
    const end = unitEnd(state, unit);
    if (end >= state.doc.content.size) break; // clamp at EOF, like vim
    cursor = clampIntoContent(state, end + 1);
  }

  return {
    register: {
      content: yanked.map((y) => y.content),
      context: yanked[0].context,
      kind: "line",
    },
    tr: null,
  };
}

export function yankVisual(
  state: EditorState,
  visual: VisualState,
): OperationOutcome {
  const { from, to } = visualBounds(state, visual);
  return {
    register: { kind: "char", slice: state.doc.slice(from, to).toJSON() },
    tr: null,
  };
}

// ── single-unit building blocks (private) ─────────────────────────────────

/** §9 nested-list pin (spike #7): one replaceWith lifts the children. When
 *  the item is its list's only child, the LIST goes with it — nested lists
 *  surface as blocks; without them the empty list simply disappears. */
function buildListItemDelete(state: EditorState, unit: LineUnit): Transaction {
  if (unit.kind !== "listItem") throw new Error("not a list item");
  const nested = unit.nestedListPositions
    .map((p) => state.doc.nodeAt(p))
    .filter((n): n is PMNode => n !== null);

  const $item = state.doc.resolve(unit.itemPos);
  const list = $item.parent;
  if (list.childCount === 1) {
    const listPos = $item.before($item.depth);
    return nested.length > 0
      ? state.tr.replaceWith(
          listPos,
          listPos + list.nodeSize,
          Fragment.from(nested),
        )
      : deleteOrEmpty(state, listPos, listPos + list.nodeSize);
  }

  const items = nested.flatMap((n) => {
    const children: PMNode[] = [];
    n.forEach((child) => children.push(child));
    return children;
  });
  return items.length > 0
    ? state.tr.replaceWith(
        unit.itemPos,
        unit.itemPos + unit.nodeSize,
        Fragment.from(items),
      )
    : state.tr.delete(unit.itemPos, unit.itemPos + unit.nodeSize);
}

/** Clamp a landing position into the document and off node boundaries, so
 *  the next resolveLineUnit sees the block under it. */
function clampIntoContent(state: EditorState, pos: number): number {
  const max = Math.max(0, state.doc.content.size - 1);
  const clamped = Math.min(Math.max(pos, 0), max);
  const $pos = state.doc.resolve(clamped);
  if ($pos.parent.isTextblock) return clamped;
  // Sitting between blocks — step inside the next one when possible.
  return Math.min(clamped + 1, max);
}

/** Deleting everything must leave one empty paragraph — vim's dd on the only
 *  line clears it, it does not produce an (unschematic) empty doc. */
function deleteOrEmpty(
  state: EditorState,
  from: number,
  to: number,
): Transaction {
  if (from === 0 && to === state.doc.content.size) {
    return state.tr.replaceWith(
      0,
      state.doc.content.size,
      state.schema.nodes.paragraph.create(),
    );
  }
  return state.tr.delete(from, to);
}

function deleteTableRow(
  state: EditorState,
  unit: LineUnit,
): UnitDeletion | { reason?: string; tr: null; yanked?: undefined } {
  if (unit.kind !== "tableRow") throw new Error("not a table row");
  const row = state.doc.nodeAt(unit.rowPos);
  if (!row) return { reason: "no row under cursor", tr: null };

  // v2 pins: the header row and the only data row are untouchable.
  if (rowIsHeader(row)) {
    return { reason: "cannot delete the header row", tr: null };
  }
  const $row = state.doc.resolve(unit.rowPos);
  const table = $row.parent;
  let dataRows = 0;
  table.forEach((r) => {
    if (!rowIsHeader(r)) dataRows++;
  });
  if (dataRows <= 1) {
    return { reason: "cannot delete the only table row", tr: null };
  }

  // §9: normalize to a single-row CellSelection, then delegate to
  // prosemirror-tables (rectangle deletion stays impossible).
  const rowSelection = CellSelection.rowSelection(
    state.doc.resolve(unit.cellPos),
  );
  const selectionState = state.apply(state.tr.setSelection(rowSelection));
  let captured: null | Transaction = null;
  deleteRow(selectionState, (t) => {
    captured = t;
  });
  if (!captured) return { reason: "table refused the deletion", tr: null };

  const master = state.tr;
  for (const s of (captured as Transaction).steps) master.step(s);
  return {
    landing: unit.rowPos,
    tr: master,
    yanked: { content: row.toJSON(), context: "tableRow" },
  };
}

// ── shared helpers ─────────────────────────────────────────────────────────

function deleteUnitOnce(
  state: EditorState,
  unit: LineUnit,
): UnitDeletion | { reason?: string; tr: null; yanked?: undefined } {
  if (unit.kind === "tableRow") return deleteTableRow(state, unit);

  if (unit.kind === "hardBreakSegment") {
    const { from, to } = unit.deleteRange;
    return {
      landing: from,
      tr: state.tr.delete(from, to),
      yanked: yankUnit(state, unit),
    };
  }

  if (unit.kind === "listItem") {
    return {
      landing: unit.itemPos,
      tr: buildListItemDelete(state, unit),
      yanked: yankUnit(state, unit),
    };
  }

  // structural
  if (unit.protectedFirstChild) {
    return { reason: "toggle summary cannot be deleted", tr: null };
  }
  const from = unit.containerPos ?? unit.blockPos;
  const node = state.doc.nodeAt(from);
  if (!node) return { reason: "no block under cursor", tr: null };
  return {
    landing: from,
    tr: deleteOrEmpty(state, from, from + node.nodeSize),
    yanked: yankUnit(state, unit),
  };
}

function rowIsHeader(row: PMNode): boolean {
  let header = false;
  row.forEach((cell) => {
    if (cell.type.name === "tableHeader") header = true;
  });
  return header;
}

function unitEnd(state: EditorState, unit: LineUnit): number {
  if (unit.kind === "tableRow") {
    return unit.rowPos + (state.doc.nodeAt(unit.rowPos)?.nodeSize ?? 1);
  }
  if (unit.kind === "listItem") return unit.itemPos + unit.nodeSize;
  if (unit.kind === "hardBreakSegment") return unit.to;
  const from = unit.containerPos ?? unit.blockPos;
  return from + (state.doc.nodeAt(from)?.nodeSize ?? 1);
}

function yankUnit(state: EditorState, unit: LineUnit): YankedUnit {
  if (unit.kind === "tableRow") {
    return {
      content: state.doc.nodeAt(unit.rowPos)?.toJSON(),
      context: "tableRow",
    };
  }
  if (unit.kind === "listItem") {
    return {
      content: state.doc.nodeAt(unit.itemPos)?.toJSON(),
      context: "listItem",
    };
  }
  if (unit.kind === "hardBreakSegment") {
    // Demoted paragraph (§9): yy on a segment gives a top-context line, and
    // an empty segment gives a real, empty line.
    const textblock = state.doc.nodeAt(unit.textblockPos);
    const base = unit.textblockPos + 1;
    const inline = textblock
      ? textblock.cut(unit.from - base, unit.to - base).content
      : Fragment.empty;
    return {
      content: state.schema.nodes.paragraph.create(null, inline).toJSON(),
      context: "top",
    };
  }
  const from = unit.containerPos ?? unit.blockPos;
  return { content: state.doc.nodeAt(from)?.toJSON(), context: "top" };
}
