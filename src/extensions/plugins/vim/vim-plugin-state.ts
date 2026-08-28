// §298 vim plugin state — a dependency-free leaf (issue 372, vim-plugin split).
//
// `VimPluginState`, `VimMeta`, `read()`, `isModal()`, and `dispatchMeta()` are
// the shared vocabulary BOTH halves of the vim-plugin split need: the island
// sync (vim/vim-island-sync.ts) reads/dispatches meta from its PluginView
// lifecycle, and the selection commands (vim/vim-selection-commands.ts) read
// state and stamp meta onto the same transaction that moves the selection.
// Neither half may import the other, so this third leaf — importing only
// from vim-keys (the plugin key itself) and core/types — breaks what would
// otherwise be a two-way dependency, the same shape as utils/vim-island-
// markers.ts for #372.

import type { VimCoreState, VimMode } from "./core/types";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { vimPluginKey } from "./vim-keys";

export type VimMeta =
  | { boundary?: boolean; mode: VimMode; type: "setMode" }
  | { core: VimCoreState; type: "core" }
  | { enabled: boolean; type: "setEnabled" }
  | { island?: null | string; suspended: boolean; type: "setSuspended" };

export interface VimPluginState {
  core: VimCoreState;
  enabled: boolean;
  /** Mirror of core.exLine — same reason as `mode`. */
  exLine: null | string;
  /** Label of the focused input island while suspended ("math", …) — null
   *  when not suspended or unknown. Drives `-- INSERT (x) --` (§8). */
  island: null | string;
  /** Mirror of core.mode so vim-keys' snapshot readers stay leaf-typed. */
  mode: VimMode;
  /** core.searchLine mirrored AS ITS DISPLAY FORM ("/te", "?a") — the status
   *  feed shows it in the command slot exactly like the ex line. */
  searchLine: null | string;
  suspended: boolean;
}

export function dispatchMeta(view: EditorView, meta: VimMeta): void {
  view.dispatch(view.state.tr.setMeta(vimPluginKey, meta));
}

export function isModal(vim: VimPluginState): boolean {
  return vim.enabled && vim.mode !== "insert";
}

export function read(state: EditorState): VimPluginState {
  return vimPluginKey.getState(state) as unknown as VimPluginState;
}
