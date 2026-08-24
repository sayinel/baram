// §298 — the single place that turns "vim's cursor is at this position" into a
// ProseMirror Selection.
//
// A TextSelection endpoint MUST resolve inside inline content (review S3-R1),
// and ProseMirror does not enforce it: `checkTextSelection` merely warns, and
// the warning is gated by a module-level `warnedAboutTextSelection` flag
// (prosemirror-state dist:217). It therefore fires ONCE per page load and
// every later offender is silent — an invalid TextSelection installs cleanly
// and the surface goes on holding it, with the modal cursor pointing at a
// position that has no inline content to sit in.
//
// Leaf module: it takes the DOCUMENT rather than an EditorState, so a caller
// that is already building a transaction can hand over `tr.doc`. The
// activation reset needs exactly that, and routing it through a state would
// have re-resolved against the pre-transaction doc.

import type { Node as PMNode } from "@tiptap/pm/model";

import { NodeSelection, Selection } from "@tiptap/pm/state";

/**
 * A normal-mode cursor at `target`: a NodeSelection when the position sits on
 * a block atom line (image, math, mermaid, svg, html, hr — a line with no
 * inline content to put a caret in), a caret otherwise.
 *
 * `Selection.near` is the fallback rather than a bare TextSelection because
 * `target` can land at doc level, where no caret exists at all: it walks to
 * the closest position that can actually hold one.
 */
export function cursorSelection(doc: PMNode, target: number): Selection {
  const $target = doc.resolve(target);
  if (!$target.parent.isTextblock) {
    const after = $target.nodeAfter;
    if (
      after &&
      (after.isAtom || after.isLeaf) &&
      NodeSelection.isSelectable(after)
    ) {
      return NodeSelection.create(doc, target);
    }
  }
  return Selection.near($target, 1);
}
