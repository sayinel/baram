// §298 vim island sync — the plugin's PluginView lifecycle (vim-plugin split,
// issue 372).
//
// §7 settings lifecycle + §8 status feed (owner-gated inside vim-status) +
// §4-CM readOnly sync: PM never calls NodeView.update() on an editable flip,
// so live CodeMirror blocks are reconfigured by broadcast whenever this
// PluginView sees the prop change.
//
// The shared state across the lifecycle is three closure variables —
// `unregister`, `prevEffective`, `prevVimEnabled` — plus `effective()`, whose
// only reason to take `tiptapEditor` as an argument (rather than reading it
// off the view) is that a NON-editable Editor option must veto CM readOnly
// even while vim reports itself editable (review S5/S6-R4).

import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";

import {
  broadcastCodeBlockEditable,
  broadcastCodeBlockVim,
} from "../../nodes/views/code-block-cm-registry";
import { releaseGraphemeIndex } from "./adapters/graphemes";
import { shouldSuspendFor } from "./adapters/suspension";
import { registerVimLifecycle } from "./vim-lifecycle";
import { dispatchMeta, read } from "./vim-plugin-state";
import {
  clearWysiwygVimStatusFor,
  publishWysiwygVimStatus,
} from "./vim-status";

interface IslandSync {
  destroy(): void;
  update(view: EditorView): void;
}

/** PluginView factory for `createVimPlugin`'s `view:` prop. `tiptapEditor` is
 *  the same instance the plugin closes over — passed explicitly rather than
 *  read off `editorView` because `effective()` needs the Editor's OWN
 *  editable option, distinct from the ProseMirror view's. */
export function createIslandSync(
  editorView: EditorView,
  tiptapEditor: TiptapEditor,
): IslandSync {
  publishWysiwygVimStatus(editorView);
  const unregister = registerVimLifecycle(editorView);
  // EFFECTIVE editability for CM islands: modal keeps view.editable
  // false through suspension by design (§4), but a focused island must
  // accept the keys vim is passing through — readOnly there would
  // reject the user's own typing (review S5/S6-R4).
  const effective = (view: EditorView): boolean =>
    tiptapEditor.options.editable &&
    (view.editable || read(view.state).suspended);
  let prevEffective = effective(editorView);
  broadcastCodeBlockEditable(editorView, prevEffective);
  // Phase 0b: code blocks follow the SAME switch — enabled flag only,
  // mode transitions stay per-island (each CM has its own vim).
  let prevVimEnabled = read(editorView.state).enabled;
  broadcastCodeBlockVim(editorView, prevVimEnabled);
  return {
    destroy: () => {
      unregister();
      clearWysiwygVimStatusFor(editorView);
      // The boundary index holds the last segmented line — a closed
      // editor must not retain its longest one (security review).
      releaseGraphemeIndex();
    },
    update: (view) => {
      publishWysiwygVimStatus(view);
      const next = effective(view);
      if (next !== prevEffective) {
        prevEffective = next;
        broadcastCodeBlockEditable(view, next);
      }
      const nextVim = read(view.state).enabled;
      if (nextVim !== prevVimEnabled) {
        prevVimEnabled = nextVim;
        broadcastCodeBlockVim(view, nextVim);
        if (nextVim) {
          // Enabling while focus already sits INSIDE an input island:
          // no new focusin will ever fire, so without this the island
          // stays readOnly until a blur/refocus. Same microtask
          // re-evaluation as the focusout path (§4).
          queueMicrotask(() => {
            if (view.isDestroyed) return;
            // Re-read state AND require containment: the lifecycle
            // broadcasts enable to every live editor, and the document-
            // global activeElement must not suspend a foreign or
            // meanwhile-disabled keep-alive view.
            const vim = read(view.state);
            if (!vim.enabled || vim.suspended) return;
            const active = view.root.activeElement;
            if (
              active instanceof Element &&
              view.dom.contains(active) &&
              shouldSuspendFor(active)
            ) {
              dispatchMeta(view, { suspended: true, type: "setSuspended" });
            }
          });
        }
      }
    },
  };
}
