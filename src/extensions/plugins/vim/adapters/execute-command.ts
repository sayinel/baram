// §298 Vim Phase 1 — CoreCommand execution (design §2 adapters, S2).
//
// The core hands back INTENTS; this module turns them into dispatches using
// the S4 builders. Refusals surface through the returned reason (S5 status
// line); motions land in S3 and are consumed as no-ops until then, so an
// unbound motion never leaks a keystroke into the document.

import type { CoreCommand, Motion, VisualState } from "../core/types";
import type { Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { redo, undo } from "@tiptap/pm/history";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";

import { nextUnitBoundary } from "./graphemes";
import { resolveFindChar, wordEndAt } from "./motions";
import { resolveMotion } from "./motions";
import {
  changeLines,
  deleteCharForward,
  deleteLine,
  deleteVisual,
  linewiseSpan,
  type OperationOutcome,
  yankLine,
  yankVisual,
} from "./operations";
import { pasteRegister } from "./paste";
import { readVimRegister, writeVimRegister } from "./register";

export interface ExecutionResult {
  /** True when a transaction landed. A PARTIALLY applied change returns a
   *  reason AND applied — rolling such a change back to normal would lie
   *  about a document that already changed (review ops-R3). */
  applied?: boolean;
  /** Refusal message for the status line, when the operation said no. */
  reason?: string;
}

export function executeCoreCommand(
  view: EditorView,
  command: CoreCommand,
  visual: null | VisualState,
): ExecutionResult {
  const state = view.state;
  // A NodeSelection (block atom line) reads as its own position — PM's head
  // points past the node and would resolve the NEXT line (review S3-R1).
  const head =
    state.selection instanceof NodeSelection
      ? state.selection.from
      : state.selection.head;

  switch (command.type) {
    case "changeLine":
      // cc — the register holds exactly what the change removes (review
      // ops-R1: a counted yank next to a single-segment delete lied).
      return dispatchOutcome(view, changeLines(state, head, command.count));
    case "deleteCharForward":
      return dispatchOutcome(
        view,
        deleteCharForward(state, head, command.count),
      );
    case "deleteLine":
      return dispatchOutcome(view, deleteLine(state, head, command.count));
    case "deleteVisual": {
      if (!visual) return {};
      if (visual.kind === "line") {
        const span = linewiseSpan(state, visual);
        return dispatchOutcome(view, deleteLine(state, span.start, span.count));
      }
      return dispatchOutcome(view, deleteVisual(state, visual));
    }
    case "enterInsert": {
      // Cursor placement for i/a/I/A refines in S3 (grapheme-aware a, line
      // ends). i keeps the head; the others approximate to it until then.
      return {};
    }
    case "enterVisual":
    case "findChar": // the plugin's selection path owns finds — like move
    case "leaveVisual":
      // Selection rendering for visual mode lands with S5 decorations.
      return {};
    case "move":
      // S3: motions. Consumed (never a document keystroke), not yet moving.
      return {};
    case "openLine": {
      // §9 minimal o/O: a sibling empty paragraph next to the current block;
      // the segment/container refinements arrive with S3 cursor work.
      const $head = state.doc.resolve(head);
      const depth = $head.depth === 0 ? 0 : $head.depth;
      const blockPos = depth === 0 ? head : $head.before(depth);
      const node = state.doc.nodeAt(blockPos);
      const at = command.below ? blockPos + (node?.nodeSize ?? 1) : blockPos;
      const paragraph = state.schema.nodes.paragraph.create();
      const tr = state.tr.insert(at, paragraph);
      tr.setSelection(TextSelection.create(tr.doc, at + 1));
      return { applied: dispatchLanded(view, tr) };
    }
    case "operatorFind": {
      const match = resolveFindChar(
        state,
        head,
        command.char,
        command.kind === "f" || command.kind === "t" ? "f" : "F",
        command.count,
      );
      if (match === head) return { reason: "char not found" };
      const forward = command.kind === "f" || command.kind === "t";
      const lo = forward
        ? head
        : command.kind === "T"
          ? nextUnitBoundary(state, match)
          : match;
      const hi = forward
        ? command.kind === "f"
          ? nextUnitBoundary(state, match)
          : match
        : head;
      // FOUND but an empty range (T with the match right next door): vim
      // enters insert for c and quietly does nothing for d/y — the register
      // survives either way (vim-verified, review ops-R3).
      if (hi <= lo) return {};
      writeVimRegister({
        kind: "char",
        slice: state.doc.slice(lo, hi).toJSON(),
      });
      if (command.op !== "y") {
        const tr = state.tr.delete(lo, hi);
        tr.setSelection(TextSelection.create(tr.doc, lo));
        return { applied: dispatchLanded(view, tr) };
      }
      return {};
    }
    case "operatorMotion":
      return runOperatorMotion(view, command, head);
    case "paste":
      return dispatchOutcome(
        view,
        pasteRegister(
          state,
          head,
          readVimRegister(),
          command.after,
          command.count,
        ),
      );
    case "redo":
      runHistory(view, redo, command.count);
      return {};
    case "scrollCursor":
      // Owned by the plugin's selection path (z. moves the cursor, both
      // variants scroll the view) — never reaches the executor.
      return {};
    case "undo":
      runHistory(view, undo, command.count);
      return {};
    case "yankLine":
      return dispatchOutcome(view, yankLine(state, head, command.count));
    case "yankVisual": {
      if (!visual) return {};
      if (visual.kind === "line") {
        const span = linewiseSpan(state, visual);
        return dispatchOutcome(view, yankLine(state, span.start, span.count));
      }
      return dispatchOutcome(view, yankVisual(state, visual));
    }
  }
}

/** Motions that make an operator act LINEWISE, like vim (dj deletes two
 *  whole lines, dG to the end of the document). */
const LINEWISE_MOTIONS = new Set<Motion>([
  "docEnd",
  "docStart",
  "lineDown",
  "lineUp",
]);

/**
 * Dispatches and reports whether the transaction was ACCEPTED. A coexisting
 * plugin's filterTransaction can drop the dispatch wholesale — `applied`
 * must not lie about a transaction that never landed (review ops-R4).
 * Acceptance is STATE identity, exactly runHistory's progress guard: a
 * dropped transaction keeps the same state object, while an accepted one
 * always makes a new one — even when the resulting document happens to
 * equal the original, as in 2cc on an empty line whose second line refuses
 * (document equality misread that as a drop, review ops-R5).
 */
function dispatchLanded(view: EditorView, tr: Transaction): boolean {
  const before = view.state;
  view.dispatch(tr);
  return view.state !== before;
}

/** Registers first, then dispatches — a yank has no tr and that is fine. */
function dispatchOutcome(
  view: EditorView,
  outcome: OperationOutcome,
): ExecutionResult {
  if (outcome.register) writeVimRegister(outcome.register);
  const result: ExecutionResult = {
    applied: outcome.tr !== null && dispatchLanded(view, outcome.tr),
  };
  if (outcome.reason) result.reason = outcome.reason;
  return result;
}

/**
 * Counted history with a PROGRESS guard. PM's undo/redo return "history
 * exists", not "the dispatch landed" — a filterTransaction-style drop keeps
 * returning true while view.state never changes, and a bare count loop
 * would spin to the full count (or forever) doing nothing (review S2-R2).
 */
function runHistory(
  view: EditorView,
  command: typeof undo,
  count: number,
): void {
  for (let i = 0; i < count; i++) {
    const before = view.state;
    if (!command(view.state, view.dispatch)) break;
    if (view.state === before) break; // dispatch was dropped — no progress
  }
}

function runOperatorMotion(
  view: EditorView,
  command: Extract<CoreCommand, { type: "operatorMotion" }>,
  head: number,
): ExecutionResult {
  const state = view.state;
  const { count, motion, op } = command;

  if (LINEWISE_MOTIONS.has(motion)) {
    const target = resolveMotion(state, head, motion, count);
    const span = linewiseSpan(state, {
      anchorCursor: head,
      headCursor: target,
      kind: "line",
    });
    if (op === "y") {
      return dispatchOutcome(view, yankLine(state, span.start, span.count));
    }
    if (op === "c") {
      // change: context-aware replacement in ONE transaction (review
      // ops-R1: a post-inserted top-level paragraph split lists).
      return dispatchOutcome(view, changeLines(state, span.start, span.count));
    }
    return dispatchOutcome(view, deleteLine(state, span.start, span.count));
  }

  // Charwise. Exclusive by default; \u0024 runs through the line end, and
  // cw acts as ce (change the word only — vim's famous special case).
  let target = resolveMotion(state, head, motion, count);
  if (
    op === "c" &&
    motion === "wordForward" &&
    wordEndAt(state, head) !== null
  ) {
    // vim's cw-as-ce, counted: c2w ends at the SECOND word's end (review
    // ops-R1: overwriting with the current word's end dropped the count).
    const nthStart =
      count > 1 ? resolveMotion(state, head, "wordForward", count - 1) : head;
    target = wordEndAt(state, nthStart) ?? target;
  }
  if (motion === "charRight") {
    // Operators need the half-open endpoint — the cursor motion clamps to
    // the last unit START, making dl/cl a no-op there (review ops-R1).
    let boundary = head;
    for (let i = 0; i < count; i++) {
      const next = nextUnitBoundary(state, boundary);
      if (next === boundary) break;
      boundary = next;
    }
    target = boundary;
  }
  const lo = Math.min(head, target);
  let hi = Math.max(head, target);
  if (motion === "lineEnd") hi = nextUnitBoundary(state, hi);
  if (hi <= lo) return {};

  writeVimRegister({ kind: "char", slice: state.doc.slice(lo, hi).toJSON() });
  if (op !== "y") {
    const tr = state.tr.delete(lo, hi);
    tr.setSelection(TextSelection.create(tr.doc, lo));
    return { applied: dispatchLanded(view, tr) };
  }
  return {};
}
