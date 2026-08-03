// §298 Vim Phase 1 — insert-Esc arbitration (design §4/§5c, S6).
//
// While any transient UI is active — a suggestion popup, ghost text, the
// inline math editor, an expanded syntax reveal, an AI diff — the FIRST Esc
// belongs to it, not to vim: stealing it would flip to normal mode with a
// popup still open. Vim yields (returns unhandled) and the transient's own
// handler, running after vim in the prop chain, consumes the key.
//
// The §5c refinement — ONE Esc atomically dismissing a whole STACK of
// transients plus invalidating mutation tasks — needs a per-plugin dismiss
// survey and lands as the S6 follow-up; until then a stack costs one Esc
// per layer, never a stolen one.

import type { EditorState } from "@tiptap/pm/state";

import { aiDiffPluginKey } from "../../ai-diff";
import { ghostTextPluginKey } from "../../ghost-text";
import { mathEditKey } from "../../math-inline-edit";
import { suggestionPluginKeys } from "../../suggestion-keys";
import { syntaxRevealKey } from "../../syntax-reveal-state";

export function hasAnyEditorTransient(state: EditorState): boolean {
  for (const key of suggestionPluginKeys) {
    const popup = key.getState(state) as undefined | { active?: boolean };
    if (popup?.active) return true;
  }
  const ghost = ghostTextPluginKey.getState(state) as
    undefined | { text: null | string };
  if (ghost?.text != null) return true;

  if (mathEditKey.getState(state)?.active) return true;
  if (syntaxRevealKey.getState(state)?.expanded != null) return true;

  const diff = aiDiffPluginKey.getState(state) as undefined | { phase: string };
  return diff !== undefined && diff.phase !== "idle";
}
