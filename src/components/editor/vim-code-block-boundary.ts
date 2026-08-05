// §298 Phase 0b S3 — code-block boundary handler (design v3 §3).
//
// Vim's key handling runs through CodeMirror's BUBBLE listener on
// contentDOM, and no keymap can sit above it — so boundary crossing
// listens in the CAPTURE phase on contentDOM itself (not the CM root:
// vim's `:`/`/` panels mount under view.dom and own their input; a root
// capture would misroute `u` typed into `:quit` to PM undo).
//
// Consumption is preventDefault + stopPropagation, never
// stopImmediatePropagation — CodeMirror's same-target bookkeeping
// listener must keep running.

import type { EditorView } from "@codemirror/view";
import type { CodeMirror } from "@replit/codemirror-vim";

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
    if (event.metaKey || event.altKey) return;
    if (!isIdleNormal(cm)) return;

    const consume = () => {
      event.preventDefault();
      event.stopPropagation();
    };

    if (event.ctrlKey) {
      if (event.key === "r") {
        consume();
        hooks.redo();
      }
      return;
    }

    if (event.key === "u") {
      consume();
      hooks.undo();
      return;
    }

    const { head } = view.state.selection.main;
    const line = view.state.doc.lineAt(head);
    if (
      (event.key === "j" || event.key === "ArrowDown") &&
      line.number === view.state.doc.lines
    ) {
      consume();
      hooks.escape(1);
      return;
    }
    if ((event.key === "k" || event.key === "ArrowUp") && line.number === 1) {
      consume();
      hooks.escape(-1);
    }
  };

  view.contentDOM.addEventListener("keydown", onKeydown, true);
  return () => {
    view.contentDOM.removeEventListener("keydown", onKeydown, true);
  };
}

/**
 * True only when vim sits in bare NORMAL mode with nothing pending.
 * The count of `2j` lives ONLY in inputState.keyBuffer before the `j`
 * arrives (prefixRepeat fills after a complete command), so keyBuffer
 * emptiness IS the pending-state contract; `g` of `gj` buffers the same
 * way. Any unreadable shape says "not idle" — never intervene on a race.
 */
function isIdleNormal(cm: CodeMirror): boolean {
  const vim = (cm.state as { vim?: VimStateLike }).vim;
  if (!vim) return false;
  if (vim.insertMode || vim.visualMode) return false;
  const input = vim.inputState;
  if (!input) return false;
  if (input.operator) return false;
  return Array.isArray(input.keyBuffer) && input.keyBuffer.length === 0;
}
