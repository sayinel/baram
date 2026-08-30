// §384 Canonical serialization — the one path from a live editor to markdown.
//
// The bug this file closes: SyntaxReveal (§5.1) exposes a mark/link/image/wikilink as
// LITERAL delimiter text while the cursor sits inside it (`**bold**` becomes real
// characters, not a bold mark). Every call site that read `editor.state.doc` straight
// into `prosemirrorToMarkdown` was therefore serializing whatever the cursor happened to
// be resting in — the literal delimiters got escaped a second time by the serializer
// (`\*\*bold\*\*`), corrupting the saved file the moment the user paused mid-mark. Save
// timers, dirty-comparisons, exports, and every panel that reads "the current markdown"
// all shared this hazard because they all shared the naive read.
//
// The fix is one detour before serialization: collapse whatever is expanded — WITHOUT
// dispatching, since callers here are reading, not editing — and serialize that instead.
// `canonicalDoc` is the detour; everything else in this file is a thin, purpose-named
// wrapper around it so call sites stop hand-rolling `editor.state.doc` reads.
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import type { Mapping } from "@tiptap/pm/transform";

import { getSyntaxRevealExpanded } from "../../extensions/plugins/syntax-reveal";
import { buildCollapseTr } from "../../extensions/plugins/syntax-reveal-collapse";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";
import { logger } from "../logger";

/**
 * The doc this state WOULD have if any active SyntaxReveal expansion collapsed right now,
 * plus the position mapping through that (never-dispatched) collapse.
 *
 * §384: this is the one place that decides "what does this editor's document actually
 * say" for read-only purposes (serialize, compare, extract). No expansion → the mapping is
 * `null` and the doc is `state.doc` unchanged.
 *
 * §384 (design review M4): `buildCollapseTr` returning `null` means the expanded range's
 * delimiters no longer validate against the live doc — but that single signal covers two
 * situations this function cannot tell apart: (a) the user genuinely edited the expanded,
 * literal text (the delimiters legitimately changed underneath the stash — the literal text
 * IS the content now, and falling back to `state.doc` as-is is the correct read), or (b) a
 * codec gap failed to parse an expansion that was actually still well-formed, silently
 * corrupting what gets serialized (this is exactly the bug class §384's own fixes — F1, F2,
 * R3-1 — closed one instance of at a time). Every known case of (b) is pinned by a
 * regression test; falling back here instead of guessing is still the right call for both,
 * but a NEW case of (b) must not go unnoticed the way the original bug did — hence the
 * warning below on this path. It is expected-noisy for case (a) (this is a hot read path:
 * save timers, dirty-compares, exports all funnel through it) and is a dev-only breadcrumb
 * for someone investigating a report, not itself a defect signal.
 */
export function canonicalDoc(state: EditorState): {
  doc: PMNode;
  mapping: Mapping | null;
} {
  const expanded = getSyntaxRevealExpanded(state);
  if (!expanded) return { doc: state.doc, mapping: null };

  const tr = buildCollapseTr(state, expanded);
  if (!tr) {
    logger.warn(
      "[canonicalDoc] stale/unparseable syntax-reveal expansion — falling back to the live doc as-is",
    );
    return { doc: state.doc, mapping: null };
  }

  return { doc: tr.doc, mapping: tr.mapping };
}

/**
 * Markdown for an `EditorState` — collapsing any active reveal expansion first (§384).
 * Use this over a raw `prosemirrorToMarkdown(state.doc)` any time the doc might be mid-edit.
 */
export function serializeEditorState(state: EditorState): string {
  return prosemirrorToMarkdown(canonicalDoc(state).doc);
}

/** `serializeEditorState` for a live `Editor` — the common call shape. */
export function serializeLiveDoc(editor: Editor): string {
  return serializeEditorState(editor.state);
}

/**
 * Markdown for a doc that was never part of a live `EditorState` — one built for a
 * detached comparison (e.g. a pre/post snapshot) or constructed for a scoped export (e.g.
 * a single table wrapped in a fresh `doc` node).
 *
 * §384 (design review L2): this function exists not because "there's no EditorState to
 * canonicalize" — the pm→markdown import boundary (`pm-to-md-import-boundary.test.ts`)
 * blocks every other production file from calling `prosemirrorToMarkdown` directly, so a
 * detached/composed doc with no expansion to collapse still needs a named, sanctioned way
 * through the gate. `serializeDetachedDoc` is that gate for this legitimate case: it lets a
 * caller declare "this doc is not live, canonicalization does not apply" instead of reaching
 * around the boundary with its own direct import.
 */
export function serializeDetachedDoc(doc: PMNode): string {
  return prosemirrorToMarkdown(doc);
}

/**
 * The node at `posBefore` in the CANONICAL doc — i.e. after collapsing any active reveal
 * expansion (§384) — instead of whatever literal-delimiter text a raw `state.doc.nodeAt`
 * would return while that node is mid-expansion. `posBefore` is mapped through the
 * collapse first, so callers pass the position they captured from the live (pre-collapse)
 * doc. Returns `null` when the mapped position holds no node, or a node of a different
 * type than `expectedType` — callers should treat that exactly like their pre-§384 "not
 * found" path.
 */
export function canonicalNodeAt(
  state: EditorState,
  posBefore: number,
  expectedType: string,
): null | PMNode {
  const { doc, mapping } = canonicalDoc(state);
  const pos = mapping?.map(posBefore) ?? posBefore;

  let node: null | PMNode;
  try {
    node = doc.nodeAt(pos);
  } catch {
    return null;
  }

  if (!node || node.type.name !== expectedType) return null;
  return node;
}
