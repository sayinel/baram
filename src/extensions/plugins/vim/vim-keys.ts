// §298 Phase 1 (§12-5) — vim plugin key + modal-state queries.
//
// Leaf module (plan R6 pin): imports only prosemirror-state, so hooks and
// NodeViews can ask "is vim modal right now?" without importing the vim
// module itself. The WYSIWYG vim plugin (design §2, vim-plugin.ts) registers
// under THIS key; until it lands, getState() is undefined and every query
// returns false — the guards wired against it are dormant, not dead.
import type { Editor } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";

import { PluginKey } from "@tiptap/pm/state";

export type VimMode = "insert" | "normal" | "visual";

/** The subset of vim plugin state that outside consumers may read. */
export interface VimStateSnapshot {
  enabled: boolean;
  /** Ex line being typed, WITHOUT the colon — null when none is open. Read
   *  by the status feed; mirrored from core so readers stay leaf-typed. */
  exLine: null | string;
  /** StatusBar label of the focused input island ("math", "mermaid", …) —
   *  null while not suspended or when the island is unknown. Read by the
   *  status feed for `-- INSERT (x) --` (§8). */
  island: null | string;
  mode: VimMode;
  /** Open `/`·`?` line in display form ("/te") — shown in the command slot
   *  like the ex line; null when closed. */
  searchLine: null | string;
  /** True while an input island owns the keys (§4). */
  suspended: boolean;
}

export const vimPluginKey = new PluginKey<VimStateSnapshot>("wysiwygVim");

/**
 * §12-⑩ — may NodeView chrome mutate the document right now?
 *
 * True write capability (`options.editable`) ANDed with "the only thing
 * making the view non-editable is vim's modal state". A plain
 * `editor.isEditable` gate would lock chrome and input islands during vim
 * normal; a plain OR would let modal state bypass a real read-only editor.
 * Attributing non-editability to vim is only safe because §12-⑪ pins that
 * nothing else in the repo contributes an `editable` prop (invariant test).
 *
 * Render-time use is not enough — mutation callbacks must re-check this at
 * event time (a stale-rendered button outlives any render condition).
 */
export function canUseEditorChrome(editor: Editor): boolean {
  if (editor.isDestroyed) return false;
  return (
    editor.options.editable &&
    (editor.view.editable || isWysiwygVimModal(editor.state))
  );
}

/**
 * True while vim owns the editor surface (normal/visual — design §5).
 * Suspension does not matter here: the PM body stays non-editable while an
 * input island holds focus, so body-directed mutations remain blocked.
 */
export function isWysiwygVimModal(state: EditorState): boolean {
  const vim = vimPluginKey.getState(state);
  return !!vim?.enabled && vim.mode !== "insert";
}

// ── External-edit provenance (§12-6, design §5b) ─────────────────────────
//
// Two-axis mutation taxonomy: transactions dispatched by UI chrome (toolbar,
// palette, menu, shortcut, AI apply) carry this meta so the vim plugin can
// apply the explicit-command mode matrix instead of the untagged fallback
// (which collapses visual to normal). Tagging is a UX contract, not a
// security boundary — untagged transactions still reconcile positions.

const VIM_EXTERNAL_EDIT_META = "vimExternalEdit";

/**
 * `editor.chain()` with the provenance tag pre-applied. A chain shares one
 * transaction, so every command appended after this covers itself. UI chrome
 * call sites should use this instead of `editor.chain()`; the nullable
 * overload mirrors the common `editor?.chain()` idiom.
 */
export function chainWithVimExternalEdit(
  editor: Editor,
): ReturnType<Editor["chain"]>;
export function chainWithVimExternalEdit(
  editor: Editor | null | undefined,
): ReturnType<Editor["chain"]> | undefined;
export function chainWithVimExternalEdit(
  editor: Editor | null | undefined,
): ReturnType<Editor["chain"]> | undefined {
  return editor?.chain().command(({ tr }) => {
    withVimExternalEdit(tr);
    return true;
  });
}

/** Read side — used by the vim plugin's apply() precedence (design §5b). */
export function isVimExternalEdit(tr: Transaction): boolean {
  return tr.getMeta(VIM_EXTERNAL_EDIT_META) === true;
}

/**
 * Tagged replacement for the NodeView `updateAttributes` prop, whose
 * internal dispatch cannot carry provenance. Chrome controls inside
 * NodeViews (collapse toggles, pickers, resize commits) use this;
 * focus-local input islands keep the untagged prop (design §5b/§4).
 */
export function updateNodeAttributesWithVim(
  editor: Editor,
  getPos: () => number | undefined,
  attrs: Record<string, unknown>,
): void {
  const pos = getPos();
  if (typeof pos !== "number") return;
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  editor.view.dispatch(
    withVimExternalEdit(
      editor.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        ...attrs,
      }),
    ),
  );
}

/**
 * Tag a transaction as an explicit user command. Chainable usage inside
 * Tiptap (one chain = one transaction, so the whole chain is covered):
 *
 *   editor.chain()
 *     .command(({ tr }) => { withVimExternalEdit(tr); return true; })
 *     .focus().toggleBold().run();
 */
export function withVimExternalEdit(tr: Transaction): Transaction {
  return tr.setMeta(VIM_EXTERNAL_EDIT_META, true);
}
