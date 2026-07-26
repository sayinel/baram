// §298 Phase 0a — vim keybindings loader for source mode.
//
// The vim module (~74KB gzip) is imported dynamically so users who never
// enable the setting never download it. The promise is cached: repeated
// source-mode entries reuse the same loaded extension.
//
// Prec.highest is required — @replit/codemirror-vim must sit ahead of the
// default keymaps. Note the DOM reality: ALL keymaps (any Prec) execute
// through CodeMirror's single Prec.default handleKeyEvents handler, while
// vim's Prec.highest ViewPlugin keydown handler runs BEFORE it. So no keymap
// can sit "above" vim; Mod-/ keeps working only because vim binds no
// <M-/>/<C-/> (see SourceCodeEditor + the S3 window-level escape hatch).

import type { Extension } from "@codemirror/state";

import { Prec } from "@codemirror/state";

let cached: null | Promise<Extension> = null;

export function loadVimExtension(): Promise<Extension> {
  // .then().catch() rather than the two-argument .then form: the catch must
  // also cover a synchronous throw from m.vim() itself, or a rejected promise
  // would stay cached and disable vim until app restart (Codex S1 gate).
  cached ??= import("@replit/codemirror-vim")
    .then((m) => Prec.highest(m.vim()))
    .catch((err: unknown) => {
      cached = null;
      throw err;
    });
  return cached;
}
