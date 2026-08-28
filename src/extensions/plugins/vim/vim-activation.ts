// §298 Phase 1 — document activation boundary (design v3 D2).
//
// Showing a document again is not the same as loading one. A keep-alive editor
// is simply made visible: no state install, no vim transaction. So whatever
// was half-typed when the user switched away was still there when they came
// back — `d`, switch tab, return, press `w`, and a word they never asked about
// disappears. A count prefix, insert/visual mode and an open ex line have the
// same shape.
//
// OWNERSHIP: the document lifecycle decides WHEN a document becomes active
// (tab switch, whole-state install, keep-alive reveal); this module only knows
// HOW to bring vim back to a clean normal. Keeping the trigger out here is
// deliberate — vim must not grow its own idea of what "activation" means.
//
// The reset is ONE transaction and it includes the PM selection, because
// visual mode's actual range lives there rather than in core state: clearing
// the meta alone leaves normal mode sitting on a range the user can no longer
// see, and the next edit would act on it.

import type { VimPluginState } from "./vim-plugin-state";
import type { EditorView } from "@tiptap/pm/view";

import { cursorSelection } from "./adapters/cursor-selection";
import { collapseTarget } from "./core/visual-state";
import { vimPluginKey } from "./vim-keys";

/**
 * Return an activated document's vim state to a clean normal mode.
 *
 * A no-op when vim is off or already clean, so the common tab switch costs
 * nothing: an unconditional dispatch would wake every store subscriber (and
 * the status feed's equality gate exists for exactly that reason).
 */
export function activateEditorForDocument(view: EditorView): void {
  if (view.isDestroyed) return;
  // The public snapshot deliberately hides `core`; a reset has to see it.
  const vim = vimPluginKey.getState(view.state) as unknown as
    undefined | VimPluginState;
  if (!vim?.enabled) return;

  const core = vim.core;
  const transient =
    core.mode !== "normal" ||
    core.count !== null ||
    core.pending !== null ||
    core.pendingCount !== null ||
    core.visual !== null ||
    core.exLine !== null ||
    core.searchLine !== null;
  if (!transient) return;

  const tr = view.state.tr;
  // Collapse to where the vim head was: leaving visual mode keeps the cursor
  // under the head, not at the anchor the range started from (§6).
  if (core.visual) {
    const target = Math.min(
      collapseTarget(core.visual),
      view.state.doc.content.size,
    );
    tr.setSelection(cursorSelection(tr.doc, target));
  } else if (!view.state.selection.empty) {
    tr.setSelection(cursorSelection(tr.doc, view.state.selection.head));
  }

  tr.setMeta(vimPluginKey, {
    core: {
      count: null,
      exLine: null,
      lastFind: core.lastFind, // f/; repeats are not transient — vim keeps them
      lastSearch: core.lastSearch, // n/N history survives, like lastFind
      mode: "normal" as const,
      pending: null,
      pendingCount: null,
      searchLine: null, // an open `/` line is as transient as the ex line
      visual: null,
    },
    type: "core",
  });
  view.dispatch(tr);
}
