// §298 Phase 0a — vim module loader for source mode.
//
// The vim module (~74KB gzip) is imported dynamically so users who never
// enable the setting never download it. The module promise is cached;
// repeated source-mode entries reuse it. Consumers build the extension with
// Prec.highest(mod.vim()) — see SourceCodeEditor for why Prec cannot put any
// keymap "above" vim's own ViewPlugin handler.

import type { Transaction } from "@codemirror/state";

import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown";

import { getAction } from "../../keybindings/keybinding-actions";

let exCommandsRegistered = false;

let listContinuationRegistered = false;

let modulePromise: null | Promise<VimModule> = null;

type VimModule = typeof import("@replit/codemirror-vim");

export function loadVimModule(): Promise<VimModule> {
  // Do not cache a rejection — a transient chunk-load failure would
  // otherwise disable vim until app restart (Codex S1 gate finding).
  modulePromise ??= import("@replit/codemirror-vim")
    .then((m) => {
      registerExCommands(m);
      registerListContinuation(m);
      return m;
    })
    .catch((err: unknown) => {
      modulePromise = null;
      throw err;
    });
  return modulePromise;
}

/**
 * §298 S3 — Baram ex commands. Vim is a module-level singleton, so this runs
 * ONCE per app; the callbacks resolve actions at invocation time (App.tsx
 * registers them at startup), never capturing an editor closure.
 *
 * NOTE: `:write`/`:w` overrides the adapter's built-in write globally — the
 * override will also apply to any future vim-enabled CodeMirror instance
 * (Phase 0b code blocks). Documented contract, not an accident.
 */
export function registerExCommands(mod: VimModule): void {
  if (exCommandsRegistered) return;
  mod.Vim.defineEx("write", "w", () => {
    getAction("file.save")?.();
  });
  mod.Vim.defineEx("quit", "q", () => {
    // Goes through the app's close flow, so the unsaved-changes guard applies.
    getAction("file.closeTab")?.();
  });
  // Set AFTER both registrations succeed — if defineEx ever threw mid-way, a
  // pre-set flag would skip retries forever (Codex final gate, hardening).
  exCommandsRegistered = true;
}

/**
 * §298 smoke fix — vim's `o`/`O` (and `r<CR>`) never reach CodeMirror keymaps;
 * they call the adapter's `newlineAndIndent` directly, losing markdown list /
 * quote continuation ("- ", "1. ", "> "). The adapter deliberately leaves the
 * CM5 comment-addon slot `newlineAndIndentContinueComment` empty and prefers
 * it when set — that slot IS the designed extension point, so we fill it.
 *
 * The Enter command cannot be reused verbatim (Codex BLOCK review,
 * session 019f9c90): its transaction is captured, inspected, and rebuilt —
 * - r<CR> keeps a plain line break: `o`/`O` set vim.insertMode BEFORE the
 *   slot runs, `replace` never does, which discriminates the call sites;
 * - the Enter command's empty-item branch DELETES the marker — destructive
 *   for `o`. Any replaced range starting before the cursor is that branch
 *   (renumbering rewrites start after the cursor), so it falls back;
 * - the rebuilt dispatch tags input.type.compose(.start) exactly like the
 *   adapter's internal dispatchChange, keeping undo-group PARITY with the
 *   stock path (which is itself two-step for o + typed text — probe-verified;
 *   single-u atomicity does not exist upstream).
 * Known limitation: `O` on the FIRST document line bypasses this slot inside
 * the adapter (special-cased replaceRange) and opens without a bullet.
 * Global singleton, same contract as registerExCommands.
 */
export function registerListContinuation(mod: VimModule): void {
  if (listContinuationRegistered) return;
  const commands = mod.CodeMirror.commands;
  commands.newlineAndIndentContinueComment = (
    cm: InstanceType<VimModule["CodeMirror"]>,
  ) => {
    const view = cm.cm6;
    // Parity with the adapter's own commands: its dispatchChange refuses
    // writes under state.readOnly, but insertNewlineContinueMarkup has no
    // such guard (verified: no readOnly check in @codemirror/lang-markdown).
    if (view.state.readOnly) return;
    // Call-site discrimination (probe-verified: vim state flags are IDENTICAL
    // for `o` and `<C-o>r<CR>` at slot time, so flags alone cannot work):
    // - !insertMode → plain/visual r<CR> (replace never enters insert);
    // - op.lastChange → a change already ran in this op. o/O reach the slot
    //   as the op's FIRST change; every r<CR> variant (incl. <C-o>r<CR>)
    //   deletes the replaced character through the adapter first.
    const op = (cm as { curOp?: null | { lastChange?: unknown } }).curOp;
    if (!cm.state.vim?.insertMode || op?.lastChange) {
      commands.newlineAndIndent(cm);
      return;
    }
    const head = view.state.selection.main.head;
    let captured: null | Transaction = null;
    const ran = insertNewlineContinueMarkup({
      dispatch: (tr) => {
        captured = tr;
      },
      state: view.state,
    });
    // TS cannot see the synchronous callback assignment above and narrows
    // `captured` back to null — re-widen at the read site.
    const tr = captured as null | Transaction;
    if (!ran || !tr) {
      commands.newlineAndIndent(cm);
      return;
    }
    // `o` must never restructure existing text. Acceptable changes are:
    // pure insertions at the cursor (the continuation itself), anything
    // starting after the cursor (ordered-list renumbering), and ONE benign
    // before-cursor case — the Enter command's trailing-whitespace trim
    // (whitespace-only replacement ending exactly at the cursor). Everything
    // else is a destructive Enter branch: empty-item deletion/dedent, or the
    // tight-list blank-line insertion BEFORE the item (re-review finding 3).
    let unsafe = false;
    tr.changes.iterChangedRanges((fromA, toA) => {
      if (fromA > head) return;
      if (fromA === head) {
        if (toA > head) unsafe = true;
        return;
      }
      if (toA !== head || !/^[ \t]+$/.test(view.state.sliceDoc(fromA, toA))) {
        unsafe = true;
      }
    });
    if (unsafe) {
      commands.newlineAndIndent(cm);
      return;
    }
    view.dispatch({
      changes: tr.changes,
      effects: tr.effects,
      scrollIntoView: true,
      selection: tr.selection,
      // The discriminator above guarantees this is the op's first change,
      // matching what the adapter's dispatchChange would tag here.
      userEvent: "input.type.compose.start",
    });
  };
  listContinuationRegistered = true;
}
