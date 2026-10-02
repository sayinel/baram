// §298 issue 776 — a pointer interaction forgets the goal column only when it
// actually moved the vim cursor.
//
// Most clicks need nothing from here: they land as a foreign selection and
// the plugin state's priority 4 forgets the goal. The exception is a click
// that syntax reveal turns into an expansion (a wikilink, an image): its one
// transaction moves the cursor AND carries the ephemeral tag the reducer
// exempts, so the goal would survive a cursor move the user made. Clearing on
// every mousedown instead also forgot it for clicks that move nothing — a
// right-click, a Cmd-click that opens a link, a scrollbar drag.
//
// So the press only ARMS a watch with the cursor it found; the plugin view's
// update forgets the goal once the cursor differs from it, and the next key
// disarms it (from then on the keys own the cursor).

import type { EditorView } from "@tiptap/pm/view";

import { dispatchMeta, read } from "./vim-plugin-state";
import { vimCursor } from "./vim-selection-commands";

export interface PointerGoalWatch {
  /** pointerdown / mousedown: remember where the cursor was. */
  arm(view: EditorView): void;
  /** A key arrived — vim's own commands decide the goal from here. */
  disarm(): void;
  /** PluginView update: forget the goal if the press moved the cursor. */
  settle(view: EditorView): void;
}

export function createPointerGoalWatch(): PointerGoalWatch {
  let from: null | number = null;
  return {
    arm(view) {
      const vim = read(view.state);
      from =
        vim.enabled && vim.core.goalColumn !== null
          ? vimCursor(view.state)
          : null;
    },
    disarm() {
      from = null;
    },
    settle(view) {
      if (from === null) return;
      const vim = read(view.state);
      if (!vim.enabled || vim.core.goalColumn === null) {
        from = null; // already forgotten — an ordinary click did it
        return;
      }
      if (vimCursor(view.state) === from) return;
      from = null;
      dispatchMeta(view, {
        core: { ...vim.core, goalColumn: null },
        type: "core",
      });
    },
  };
}
