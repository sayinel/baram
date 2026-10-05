// §298 issue 776 — the goal column after a pointer press.
//
// Most clicks need nothing from here: they land as a foreign selection and
// the plugin state's priority 4 forgets the goal. A click on the spot the
// cursor already holds dispatches nothing (ProseMirror skips an equal
// selection), so it KEEPS the goal — vim's mouse click would re-set curswant
// there; a test pins the difference. The exception is a click that syntax
// reveal turns into an expansion (a wikilink, an image): its transaction
// changes the document and moves the cursor, carrying the ephemeral tag
// that keeps the goal at the reducer's priority 3. The goal would survive a
// cursor move the user made. Clearing on every mousedown instead also forgot
// it for presses that write no selection at all — a right-click, a Cmd-click that
// opens a link, a scrollbar drag.
//
// So the press only ARMS a watch with the cursor and the document it found;
// the plugin's appendTransaction forgets the goal once a transaction of that
// same document leaves the cursor elsewhere, and the next key disarms it.
// appendTransaction, not the PluginView's update: a cached tab state installed
// with view.updateState runs no transactions, so a press left armed in one
// document can never be read against another document's cursor and goal.

import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { vimCursor } from "./adapters/cursor-selection";
import { read } from "./vim-plugin-state";

interface PointerGoalWatch {
  /** pointerdown / mousedown: remember where the cursor was, and in what. */
  arm(view: EditorView): void;
  /** A key arrived — vim's own commands decide the goal from here. */
  disarm(): void;
  /** appendTransaction: true when the armed press moved the cursor and the
   *  goal must be forgotten. The caller builds the one transaction that also
   *  carries any caret fix-up (appendClampAndGoalReset). */
  takeMovedPress(
    transactions: readonly Transaction[],
    state: EditorState,
  ): boolean;
}

export function createPointerGoalWatch(): PointerGoalWatch {
  let armed: null | { doc: PMNode; from: number } = null;
  return {
    arm(view) {
      const vim = read(view.state);
      armed =
        vim.enabled && vim.core.goalColumn !== null
          ? { doc: view.state.doc, from: vimCursor(view.state) }
          : null;
    },
    disarm() {
      armed = null;
    },
    takeMovedPress(transactions, state) {
      if (armed === null) return false;
      // A transaction that did not start from the document the press saw
      // belongs to something else (another tab's state, an edit since).
      if (transactions[0]?.before !== armed.doc) {
        armed = null;
        return false;
      }
      const vim = read(state);
      if (!vim.enabled || vim.core.goalColumn === null) {
        armed = null; // already forgotten — an ordinary click did it
        return false;
      }
      if (vimCursor(state) === armed.from) return false;
      armed = null;
      return true;
    },
  };
}
