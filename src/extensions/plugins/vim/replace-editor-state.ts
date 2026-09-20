// §298 Phase 1 (§12-7) — the single choke point for whole-EditorState
// installation (design §8, plan review 5차 M2).
//
// `view.updateState()` bypasses the transaction pipeline entirely: no plugin
// apply() runs, so the vim plugin cannot see the swap. Every install must
// flow through here so S1 can wire the post-install sequence in ONE place:
//
//   0. reconcilePlugins(view, state)      (§260 — the live view owns the
//        plugin set; a state snapshot never does. See that function.)
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
import type { EditorState, Plugin } from "@tiptap/pm/state";
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
  view.updateState(reconcilePlugins(view, state));
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

/**
 * Take the plugin set from the LIVE view, not from the state being installed.
 *
 * §260 — a state is a record of a DOCUMENT, not of the editor's configuration.
 * Baram caches one whole `EditorState` per tab and restores it wholesale
 * (`hooks/tab-switching/save-outgoing-tab.ts` → `restore-cached-state.ts`), and
 * `EditorState.plugins` rides along in that snapshot. So a snapshot taken
 * before a runtime registration, or after one that has since been undone, used
 * to overwrite the live plugin list on every tab switch. The repo owner met all
 * four faces of that with a plugin contributing a ProseMirror plugin: already-
 * open tabs never got the effect; unloading cleared it from the active tab
 * only; loading again threw "Adding different instances of a keyed plugin"
 * because the snapshot had put the removed instance back; and the load after
 * that worked, because the throw had removed it.
 *
 * The live view is the authority, deliberately: it is what `plugins/editor-
 * surfaces.ts` — and anything else that calls `registerPlugin` at runtime, such
 * as @tiptap/react's menus — has been maintaining. A snapshot cannot know about
 * a registration that happened after it was taken.
 *
 * This reconciles ALL plugins, not only contributed ones. That is intended: the
 * invariant is general, and `load-tab-content.ts` already had to hand-roll this
 * same `reconfigure` for ViewportVirtualize (§perf-large-file C4) because a
 * passive effect registers plugins between capturing a state and applying it.
 *
 * Compared by instance identity in order, not by key, because `reconfigure`
 * needs the actual instances — two instances sharing a key are precisely the
 * case that throws.
 *
 * `reconfigure` keeps doc, selection, storedMarks and scrollToSelection (they
 * are own properties of the source state), and keeps the field of every plugin
 * whose key is present in both sets; only genuinely new plugins get `init`.
 * Measured against prosemirror-state, not assumed — `EditorState.reconfigure`
 * copies `this[name]` whenever `this.hasOwnProperty(name)`, and a field's name
 * is its plugin's key. That is what carries fold state and friends across a tab
 * switch untouched.
 */
function reconcilePlugins(view: PMView, state: EditorState): EditorState {
  const live: readonly Plugin[] = view.state.plugins;
  const incoming = state.plugins;
  if (
    incoming.length === live.length &&
    incoming.every((plugin, i) => plugin === live[i])
  ) {
    // The common case — most call sites build from `editor.state.plugins`
    // already. Pass the state through so nothing is rebuilt needlessly.
    return state;
  }
  return state.reconfigure({ plugins: live });
}
