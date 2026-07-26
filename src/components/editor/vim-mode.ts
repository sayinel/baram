// §298 Phase 0a — vim module loader for source mode.
//
// The vim module (~74KB gzip) is imported dynamically so users who never
// enable the setting never download it. The module promise is cached;
// repeated source-mode entries reuse it. Consumers build the extension with
// Prec.highest(mod.vim()) — see SourceCodeEditor for why Prec cannot put any
// keymap "above" vim's own ViewPlugin handler.

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
 * Markdown contexts get `insertNewlineContinueMarkup`; everything else (code
 * file tabs, non-list lines) returns false and falls back to the adapter's
 * own `newlineAndIndent`, keeping its dispatchChange/undo plumbing intact.
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
    const ran = insertNewlineContinueMarkup({
      dispatch: (tr) => view.dispatch(tr),
      state: view.state,
    });
    if (!ran) commands.newlineAndIndent(cm);
  };
  listContinuationRegistered = true;
}
