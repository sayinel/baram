// §298 Phase 0b S3 — code-block boundary handler (design v3 §3).
//
// Vim's key handling runs through CodeMirror's listener on contentDOM,
// and no keymap can sit above it — so boundary crossing listens in the
// CAPTURE phase on the CM ROOT (an ancestor: at the target itself even
// capture listeners run in registration order, and CodeMirror registered
// first). Panel input (`:`/`/` mounts outside contentDOM) is filtered by
// composedPath, so `u` typed into `:quit` never reaches PM undo.
//
// Consumption is preventDefault + stopPropagation, never
// stopImmediatePropagation — CodeMirror's same-target bookkeeping
// listener must keep running.

import type { EditorView } from "@codemirror/view";
import type { CodeMirror } from "@replit/codemirror-vim";

import { layoutKey } from "../../extensions/plugins/vim/core/keys";

export interface BoundaryHooks {
  /** Leave the block toward the PM neighbour (dir -1 = up, 1 = down). */
  escape(dir: -1 | 1): void;
  redo(): void;
  /** PM is the single undo authority — the island has no CM history. */
  undo(): void;
}

interface VimInputState {
  keyBuffer?: string[];
  operator?: null | string;
}

interface VimStateLike {
  inputState?: VimInputState;
  insertMode?: boolean;
  /** `<C-o>`: normal for ONE command, then a vim-command-done listener
   *  re-enters insert. Idle-looking flags, armed spring (issue 475). */
  insertModeReturn?: boolean;
  visualMode?: boolean;
}

/** Attach the boundary handler; returns the detach function. */
export function attachVimBoundary(
  view: EditorView,
  cm: CodeMirror,
  hooks: BoundaryHooks,
): () => void {
  const onKeydown = (event: KeyboardEvent) => {
    // IME composition owns these events (WebKit emits keyCode 229).
    if (event.isComposing || event.keyCode === 229) return;
    // Panel inputs (`:`/`/`) never pass through contentDOM.
    if (!event.composedPath().includes(view.contentDOM)) return;
    if (event.metaKey || event.altKey || event.shiftKey) return;
    if (!isIdleNormal(cm)) return;

    // Korean input source: the j key arrives as key="\u3153" — resolve
    // commands through the PHYSICAL key exactly like the PM vim core
    // (device finding: boundary j/k/u were dead under the hangul layout).
    const key = layoutKey(event);

    const consume = () => {
      event.preventDefault();
      event.stopPropagation();
    };

    if (event.ctrlKey) {
      if (key === "r") {
        consume();
        hooks.redo();
      }
      return;
    }

    if (key === "u") {
      consume();
      hooks.undo();
      return;
    }

    if (key === "Escape") {
      // The Esc stair's second step: vim consumes even a normal-mode Esc
      // on the real surface, so the boundary owns it — idle normal Esc
      // leaves the block (matches the plain-arrow customKeys contract).
      consume();
      hooks.escape(-1);
      return;
    }

    const { head } = view.state.selection.main;
    const line = view.state.doc.lineAt(head);
    if (
      (key === "j" || key === "ArrowDown") &&
      line.number === view.state.doc.lines
    ) {
      consume();
      hooks.escape(1);
      return;
    }
    if ((key === "k" || key === "ArrowUp") && line.number === 1) {
      consume();
      hooks.escape(-1);
    }
  };

  // The ROOT, not contentDOM: in normal mode the key TARGET is contentDOM
  // itself, and at the target even capture listeners run in REGISTRATION
  // order — CodeMirror (and vim) registered earlier and stop propagation,
  // so a same-target listener never fires on the real surface. Capture on
  // an ANCESTOR always precedes target listeners; panel input isolation is
  // preserved by the composedPath filter above.
  view.dom.addEventListener("keydown", onKeydown, true);
  return () => {
    view.dom.removeEventListener("keydown", onKeydown, true);
  };
}

/**
 * True only when vim sits in bare NORMAL mode with nothing pending.
 * The count of `2j` lives ONLY in inputState.keyBuffer before the `j`
 * arrives (prefixRepeat fills after a complete command), so keyBuffer
 * emptiness IS the pending-state contract; `g` of `gj` buffers the same
 * way. `insertModeReturn` (`<C-o>`) also counts as pending — consuming
 * its one normal command here would escape the block while the armed
 * insert-return listener stays behind (issue 475). Any unreadable shape
 * says "not idle" — never intervene on a race.
 *
 * Exported for the vim controller: exit-time normalization uses the same
 * predicate as its "already bare normal" gate.
 */
export function isIdleNormal(cm: CodeMirror): boolean {
  const vim = (cm.state as { vim?: VimStateLike }).vim;
  if (!vim) return false;
  if (vim.insertMode || vim.visualMode || vim.insertModeReturn) return false;
  const input = vim.inputState;
  if (!input) return false;
  if (input.operator) return false;
  return Array.isArray(input.keyBuffer) && input.keyBuffer.length === 0;
}
