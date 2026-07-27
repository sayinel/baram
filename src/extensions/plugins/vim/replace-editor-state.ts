// §298 Phase 1 (§12-7) — the single choke point for whole-EditorState
// installation (design §8, plan review 5차 M2).
//
// `view.updateState()` bypasses the transaction pipeline entirely: no plugin
// apply() runs, so the vim plugin cannot see the swap. Every install must
// flow through here so S1 can wire the post-install sequence in ONE place:
//
//   1. view.updateState(state)            (below — already live)
//   2. dispatchSetVimEnabled(view, ...)   (S1 — re-establishes editable/mode;
//        PM recalculates view.editable and runs PluginView.update before
//        returning, which also rebroadcasts CM readOnly, §12-4)
//   3. publishVimSnapshot(editorId)       (S1 — owner-gated status publish)
//
// The `reason` drives the S1 mode matrix (design §8):
//   fresh-document  → vim re-enable + normal reset
//   cached-restore  → normal reset (NEVER restore cached visual/pending)
//   source-return   → normal reset (source mode owned the keys meanwhile)
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView as PMView } from "@tiptap/pm/view";

export type EditorStateInstallReason =
  "cached-restore" | "fresh-document" | "source-return";

export function replaceEditorStateWithVim(
  view: PMView,
  state: EditorState,
  reason: EditorStateInstallReason,
): void {
  // Dormant until S1: reason only classifies the install (see header).
  void reason;
  view.updateState(state);
}
