// §388 spec 0067 — the editor operations both plugin tiers share. The trusted tier adds a
// readonly check on top; the sandboxed tier adds its capability gate, budget and frame
// caps. Everything else — what a selection read returns, how a ref is checked, how an
// insert is placed and sent — lives here once, so a fix cannot land in one tier only
// (the reason `readSelection` was already shared).
import type { AnchorFailure } from "../extensions/plugins/selection-anchors";
import type { PluginEditorHandle } from "./plugin-host-registry";
import type { EditorRefusalCode, EditorSelection } from "./types";
import type { EditorState, Transaction } from "@tiptap/pm/state";

import { closeHistory } from "@tiptap/pm/history";
import { Selection } from "@tiptap/pm/state";

import {
  anchorKindOf,
  issueAnchor,
  locateAnchor,
  releaseAnchor,
  verifyAnchor,
} from "../extensions/plugins/selection-anchors";
import { getSyntaxRevealExpanded } from "../extensions/plugins/syntax-reveal";
import { buildCollapseTr } from "../extensions/plugins/syntax-reveal-collapse";
import { markdownToProsemirrorAsync } from "../pipeline/md-to-pm";
import { buildInsertion, type InsertInput } from "./editor-insert-rules";
import { refuse } from "./editor-refusal";
import { NO_EDITOR_OPEN, readSelection } from "./plugin-host-registry";

export interface EditorOpsContext {
  live: (method: string) => PluginEditorHandle;
  owner: string;
}

/** The public code for an anchor failure (spec §10). */
export function editorRefusalCodeOf(reason: AnchorFailure): EditorRefusalCode {
  return reason === "unknown"
    ? "ref-unknown"
    : reason === "other-document"
      ? "ref-other-document"
      : "ref-range-changed";
}

/** `insertMarkdown` — parse, then place by the §6.2 rules on the ref's range (spec §7.3). */
export async function insertMarkdownAt(
  ctx: EditorOpsContext,
  options: {
    beforeDispatch?: () => void;
    beforeParse?: () => void;
    markdown: string;
    ref?: string;
  },
): Promise<void> {
  const method = "insertMarkdown";
  const first = ctx.live(method);
  const ref = acquire(ctx, first.state, options.ref, method);
  try {
    options.beforeParse?.();
    const parsed = await markdownToProsemirrorAsync(
      options.markdown,
      first.schema,
    );
    send(ctx.live(method), ctx.owner, ref, method, options.beforeDispatch, {
      fragment: parsed.content,
      kind: "markdown",
      source: options.markdown,
    });
    releaseAnchor(ref);
  } finally {
    if (options.ref === undefined) releaseAnchor(ref);
  }
}

/** `insertText` — plain text on the ref's range, through the same checks and send. */
export function insertTextAt(
  ctx: EditorOpsContext,
  options: { beforeDispatch?: () => void; ref?: string; text: string },
): void {
  const method = "insertText";
  const instance = ctx.live(method);
  const ref = acquire(ctx, instance.state, options.ref, method);
  try {
    send(instance, ctx.owner, ref, method, options.beforeDispatch, {
      kind: "text",
      text: options.text,
    });
    releaseAnchor(ref);
  } finally {
    if (options.ref === undefined) releaseAnchor(ref);
  }
}

/** The surface gate both tiers apply first (#322) — now with a code (spec §10). */
export function liveEditor(
  method: string,
  surfaceBlocked: () => null | string,
  editor: () => null | PluginEditorHandle,
): PluginEditorHandle {
  const blocked = surfaceBlocked();
  if (blocked) refuse("surface-blocked", method, blocked);
  const instance = editor();
  if (!instance) refuse("no-editor", method, NO_EDITOR_OPEN);
  return instance;
}

/** Spec §5 — the selected text as markdown would read it, plus a ref to it. */
export function readSelectionForPlugin(
  ctx: EditorOpsContext,
  method: string,
  options: { record: boolean },
): EditorSelection {
  const instance = ctx.live(method);
  // The text through the function both tiers already share, so the read rule has one home.
  const { from, text, to } = readSelection(instance);
  const ref = issueAnchor(ctx.owner, instance.state, {
    record: options.record,
  });
  return { from, ref, text, to };
}

/**
 * Replace the whole document (`setMarkdown`). Parsed off the main thread with the LIVE
 * schema; refused if the document changed while parsing. A tab switch installs another
 * document into the same editor with the same schema, so only node identity tells the
 * parsed-against document from the one now showing (§260 Phase 4b — the notes on
 * `editor_set_markdown` in `sandbox/host-editor-bridge.ts`). `parsedFrom` is read before the
 * await because a Tiptap editor's `state` getter returns the view's current state: read
 * afterwards, it would compare the new document with itself.
 */
export async function replaceDocument(
  ctx: EditorOpsContext,
  options: {
    beforeDispatch?: (target: PluginEditorHandle) => void;
    markdown: string;
  },
): Promise<void> {
  const method = "setMarkdown";
  const instance = ctx.live(method);
  const parsedFrom = instance.state.doc;
  const next = await markdownToProsemirrorAsync(
    options.markdown,
    instance.schema,
  );
  const target = ctx.live(method);
  if (target.state.doc !== parsedFrom) {
    refuse(
      "document-changed",
      method,
      "the document changed while this one was parsing — retry",
    );
  }
  options.beforeDispatch?.(target);
  target.view.dispatch(
    target.state.tr.replaceWith(0, target.state.doc.content.size, next.content),
  );
}

/** A ref for this write: the caller's (checked before any parse), or an implicit one. */
function acquire(
  ctx: EditorOpsContext,
  state: EditorState,
  ref: string | undefined,
  method: string,
): string {
  if (ref === undefined) {
    const implicit = issueAnchor(ctx.owner, state, { implicit: true });
    const kind = anchorKindOf(ctx.owner, implicit);
    if (kind === "cell" || kind === "gap") {
      releaseAnchor(implicit);
      refuse("cannot-insert-here", method, UNPLACEABLE[kind]);
    }
    return implicit;
  }
  const kind = anchorKindOf(ctx.owner, ref);
  if (kind === null) refuse("ref-unknown", method, reasonText("unknown"));
  if (kind === "cell" || kind === "gap")
    refuse("cannot-insert-here", method, UNPLACEABLE[kind]);
  return ref;
}

/**
 * The selection kinds a write refuses: a CellSelection (spec §6.2 — its `from`/`to` sit
 * inside the head cell, so replacing them would put the content in one cell) and a gap
 * cursor (plan 0117 Ruling 7 — §6.2 defines no placement for it).
 */
const UNPLACEABLE = {
  cell: "a multi-cell table selection cannot be replaced",
  gap: "a gap cursor between blocks is not an insertion point",
} as const;

/** Build the insert on `state`, or refuse (spec §7.3 steps 4–5 and rule 6). */
function buildOn(
  state: EditorState,
  owner: string,
  ref: string,
  method: string,
  input: InsertInput,
): Transaction {
  // For "all", `verifyAnchor` has already refused anything but exactly [0, doc.content.size].
  const target = verifyAnchor(owner, ref, state.doc);
  if (!target.ok)
    refuse(
      editorRefusalCodeOf(target.reason),
      method,
      reasonText(target.reason),
    );
  const tr = buildInsertion(state, target, input, method);
  const s = state.selection;
  if (s.from >= target.from && s.to <= target.to) {
    const end = tr.mapping.map(target.to, 1);
    tr.setSelection(Selection.near(tr.doc.resolve(end), -1)).scrollIntoView();
  }
  return tr;
}

/** Spec §7.3 step 3 — the collapse to apply first, or null. Throws for an atom's inside. */
function collapseFor(
  state: EditorState,
  owner: string,
  ref: string,
  method: string,
): null | Transaction {
  const at = locateAnchor(owner, ref, state.doc);
  if (!at.ok)
    refuse(editorRefusalCodeOf(at.reason), method, reasonText(at.reason));
  const expanded = getSyntaxRevealExpanded(state);
  if (!expanded || at.to < expanded.from || at.from > expanded.to) return null;
  if (expanded.kind === "image" || expanded.kind === "wikilink") {
    const inside = (p: number) => p > expanded.from && p < expanded.to;
    if (inside(at.from) || inside(at.to)) {
      refuse(
        "cannot-insert-here",
        method,
        "the selection is inside a link or image source",
      );
    }
  }
  return buildCollapseTr(state, expanded);
}

function reasonText(reason: AnchorFailure): string {
  return reason === "unknown"
    ? "unknown or expired ref — read the selection again"
    : reason === "other-document"
      ? "the ref belongs to another document — read the selection again"
      : "the range this ref points to has changed — read the selection again";
}

/**
 * D9 — check everything on a shadow state first; only then send the collapse (outside
 * history, so one undo returns to the canonical document — spec §2.2) and rebuild the
 * insert on the live state. `closeHistory` on the insert and on an empty transaction after
 * it keeps the user's typing on either side out of its undo step (P1).
 */
function send(
  target: PluginEditorHandle,
  owner: string,
  ref: string,
  method: string,
  beforeDispatch: (() => void) | undefined,
  input: InsertInput,
): void {
  const collapse = collapseFor(target.state, owner, ref, method);
  buildOn(
    collapse ? target.state.apply(collapse) : target.state,
    owner,
    ref,
    method,
    input,
  );
  beforeDispatch?.();
  if (collapse) {
    collapse.setMeta("addToHistory", false);
    target.view.dispatch(collapse);
  }
  const tr = buildOn(target.state, owner, ref, method, input);
  closeHistory(tr);
  target.view.dispatch(tr);
  target.view.dispatch(closeHistory(target.state.tr));
}
