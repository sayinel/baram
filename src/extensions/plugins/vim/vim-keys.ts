// §298 Phase 1 (§12-5) — vim plugin key + modal-state queries.
//
// Leaf module (plan R6 pin): imports only prosemirror-state, so hooks and
// NodeViews can ask "is vim modal right now?" without importing the vim
// module itself. The WYSIWYG vim plugin (design §2, vim-plugin.ts) registers
// under THIS key; until it lands, getState() is undefined and every query
// returns false — the guards wired against it are dormant, not dead.
import type { EditorState } from "@tiptap/pm/state";

import { PluginKey } from "@tiptap/pm/state";

export type VimMode = "insert" | "normal" | "visual";

/** The subset of vim plugin state that outside consumers may read. */
export interface VimStateSnapshot {
  enabled: boolean;
  mode: VimMode;
}

export const vimPluginKey = new PluginKey<VimStateSnapshot>("wysiwygVim");

/**
 * True while vim owns the editor surface (normal/visual — design §5).
 * Suspension does not matter here: the PM body stays non-editable while an
 * input island holds focus, so body-directed mutations remain blocked.
 */
export function isWysiwygVimModal(state: EditorState): boolean {
  const vim = vimPluginKey.getState(state);
  return !!vim?.enabled && vim.mode !== "insert";
}
