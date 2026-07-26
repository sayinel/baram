// §298 Phase 0a — vim module loader for source mode.
//
// The vim module (~74KB gzip) is imported dynamically so users who never
// enable the setting never download it. The module promise is cached;
// repeated source-mode entries reuse it. Consumers build the extension with
// Prec.highest(mod.vim()) — see SourceCodeEditor for why Prec cannot put any
// keymap "above" vim's own ViewPlugin handler.

let modulePromise: null | Promise<VimModule> = null;

type VimModule = typeof import("@replit/codemirror-vim");

export function loadVimModule(): Promise<VimModule> {
  // Do not cache a rejection — a transient chunk-load failure would
  // otherwise disable vim until app restart (Codex S1 gate finding).
  modulePromise ??= import("@replit/codemirror-vim").catch((err: unknown) => {
    modulePromise = null;
    throw err;
  });
  return modulePromise;
}
