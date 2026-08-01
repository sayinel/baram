// §298 Vim Phase 1 — CoreCommand execution (design §2 adapters, S2).
//
// The core hands back INTENTS; this module turns them into dispatches using
// the S4 builders. Refusals surface through the returned reason (S5 status
// line); motions land in S3 and are consumed as no-ops until then, so an
// unbound motion never leaks a keystroke into the document.

import type { CoreCommand, VisualState } from "../core/types";
import type { EditorView } from "@tiptap/pm/view";

import { redo, undo } from "@tiptap/pm/history";
import { TextSelection } from "@tiptap/pm/state";

import {
  deleteCharForward,
  deleteLine,
  deleteVisual,
  type OperationOutcome,
  yankLine,
  yankVisual,
} from "./operations";
import { pasteRegister } from "./paste";
import { readVimRegister, writeVimRegister } from "./register";

export interface ExecutionResult {
  /** Refusal message for the status line, when the operation said no. */
  reason?: string;
}

export function executeCoreCommand(
  view: EditorView,
  command: CoreCommand,
  visual: null | VisualState,
): ExecutionResult {
  const state = view.state;
  const head = state.selection.head;

  switch (command.type) {
    case "deleteCharForward":
      return dispatchOutcome(
        view,
        deleteCharForward(state, head, command.count),
      );
    case "deleteLine":
      return dispatchOutcome(view, deleteLine(state, head, command.count));
    case "deleteVisual":
      if (!visual) return {};
      return dispatchOutcome(view, deleteVisual(state, visual));
    case "enterInsert": {
      // Cursor placement for i/a/I/A refines in S3 (grapheme-aware a, line
      // ends). i keeps the head; the others approximate to it until then.
      return {};
    }
    case "enterVisual":
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
      view.dispatch(tr);
      return {};
    }
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
      redo(state, view.dispatch);
      return {};
    case "undo":
      undo(state, view.dispatch);
      return {};
    case "yankLine":
      return dispatchOutcome(view, yankLine(state, head, command.count));
    case "yankVisual":
      if (!visual) return {};
      return dispatchOutcome(view, yankVisual(state, visual));
  }
}

/** Registers first, then dispatches — a yank has no tr and that is fine. */
function dispatchOutcome(
  view: EditorView,
  outcome: OperationOutcome,
): ExecutionResult {
  if (outcome.register) writeVimRegister(outcome.register);
  if (outcome.tr) view.dispatch(outcome.tr);
  return outcome.reason ? { reason: outcome.reason } : {};
}
