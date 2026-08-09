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

import {
  abortEditorMutationTasks,
  invalidateEditorMutationTasks,
} from "../../../utils/editor/mutation-tasks";
import { activateEditorForDocument } from "./vim-activation";

export type EditorStateInstallReason =
  "cached-restore" | "fresh-document" | "source-return";

export function replaceEditorStateWithVim(
  view: PMView,
  state: EditorState,
  _reason: EditorStateInstallReason,
): void {
  // §12-9 trigger (design §5c, R6 핀 1): a whole-state install re-targets
  // this view — outstanding async mutations (AI tokens, image imports)
  // must go dead BEFORE the swap, then get their sources cancelled.
  invalidateEditorMutationTasks(view);
  view.updateState(state);
  abortEditorMutationTasks(view);
  // §298 D2 — the document that is now on screen is a different one, so any
  // half-typed vim command belongs to the document the user left.
  //
  // `reason` does not branch here, and that is measured rather than assumed:
  // `EditorState.create({plugins})` copies the plugin list, so PM rebuilds the
  // PluginViews and registerVimLifecycle replays the vim SETTING on its own —
  // enablement needs no help from this function. What it does not replay is
  // transient state, which is what this call clears. (An earlier reading of
  // this file claimed the opposite and blamed source-mode round trips for
  // turning vim off; with the setting genuinely enabled, vim survives.)
  activateEditorForDocument(view);
}
