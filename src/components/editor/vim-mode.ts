// §298 Phase 0a — vim module loader for source mode.
//
// The vim module (~74KB gzip) is imported dynamically so users who never
// enable the setting never download it. The module promise is cached;
// repeated source-mode entries reuse it. Consumers build the extension with
// Prec.highest(mod.vim()) — see SourceCodeEditor for why Prec cannot put any
// keymap "above" vim's own ViewPlugin handler.

import { getAction } from "../../keybindings/keybinding-actions";

let exCommandsRegistered = false;

let modulePromise: null | Promise<VimModule> = null;

type VimModule = typeof import("@replit/codemirror-vim");

export function loadVimModule(): Promise<VimModule> {
  // Do not cache a rejection — a transient chunk-load failure would
  // otherwise disable vim until app restart (Codex S1 gate finding).
  modulePromise ??= import("@replit/codemirror-vim")
    .then((m) => {
      registerExCommands(m);
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
  exCommandsRegistered = true;
  mod.Vim.defineEx("write", "w", () => {
    getAction("file.save")?.();
  });
  mod.Vim.defineEx("quit", "q", () => {
    // Goes through the app's close flow, so the unsaved-changes guard applies.
    getAction("file.closeTab")?.();
  });
}
