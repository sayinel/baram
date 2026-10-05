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

/**
 * Where a tier hooks into an insert's send (`send`). The trusted tier passes neither; the
 * sandboxed tier prices the transaction in both (`host-editor-bridge.ts`).
 */
interface SendHooks {
  /**
   * Runs before the shadow check, so a call it refuses has walked nothing (plan 0117 Ruling
   * 24). It must not charge: `beforeDispatch` stays the charge (spec §7.3-6).
   */
  beforeCheck?: () => void;
  /** Runs after the shadow check passed, right before the first transaction is sent. */
  beforeDispatch?: () => void;
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
  options: SendHooks & {
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
    const target = ctx.live(method);
    // Spec §7.3 step 2 / plan 0117 Ruling 12 — a keep-alive swap is another `Editor` with
    // another schema; the fragment was built with `first`'s. The editor is compared, not only
    // the document: a ref read on the editor that is live again has its document in the anchor
    // table, so the ref check passes, and the replace dropped the other schema's nodes with no
    // error (measured: "mid" selected in `beta mid end` → `beta  end`, resolved, ref spent).
    if (target !== first) {
      refuse("ref-other-document", method, reasonText("other-document"));
    }
    send(target, ctx.owner, ref, method, options, {
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
  options: SendHooks & { ref?: string; text: string },
): void {
  const method = "insertText";
  const instance = ctx.live(method);
  const ref = acquire(ctx, instance.state, options.ref, method);
  try {
    send(instance, ctx.owner, ref, method, options, {
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

/** Spec §5 — the selected text as plain text (`canonicalRangeText`, no markdown syntax), plus a ref to it. */
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
 * Replace the whole document (`setMarkdown`); refused if the document changed while parsing.
 * `beforeParse` runs after the surface gate, so a call the surface gate refuses is charged
 * nothing (spec §8). A `document-changed` refusal comes after the parse, when `beforeParse` has
 * already run.
 *
 * The §260 Phase 4b notes, moved here with the code from `sandbox/host-editor-bridge.ts`:
 *
 * - ASYNC, in the app's own Web Worker (security review MEDIUM-2): the synchronous parse put an
 *   attacker-sized remark run on the main thread the sandboxed tier exists to protect. Node
 *   construction and the replace still run on the main thread in one transaction — not the
 *   progressive path the app opens large files with (`mdastBlocksToPmNodes` +
 *   `appendChunksProgressively`), whose mid-fill tab switch can bless a truncated document as
 *   the save baseline: the app's hazard to own for a user action, not one to inherit for a
 *   plugin write (code review P4). The sandboxed tier bounds the cost with the frame check's
 *   2 MiB cap and its document budget.
 * - The LIVE schema: a node built against another Schema instance fails ProseMirror's
 *   identity-based validation on insert (the keep-alive lesson from the large-file work).
 * - ‼️ The DOCUMENT must still be the one parsed against, by IDENTITY (security review, NEW
 *   HIGH). Comparing schemas caught only a keep-alive handover: a tab switch installs another
 *   document into the SAME editor with the SAME schema (`replaceEditorStateWithVim` →
 *   `view.updateState`), so the write replaced ANOTHER FILE's document and marked it dirty for
 *   autosave. Identity, not a change signal, because a signal can be missed: of the non-test
 *   callers of `replaceEditorStateWithVim` (seven under `src`, 2026-10-05), the two in
 *   `use-editor-effects.ts` do not call `markContentLoaded`. The cost — a user keystroke during
 *   the parse also refuses — is the right trade for a whole-document replace: the plugin gets an
 *   error it can retry, where the alternative discards an edit the user just made.
 * - `parsedFrom` is read BEFORE the await: a Tiptap editor's `state` getter returns the view's
 *   current state, so read afterwards it compares the new document with itself. The first
 *   version of the guard did exactly that; the tab-switch test caught it.
 */
export async function replaceDocument(
  ctx: EditorOpsContext,
  options: {
    beforeDispatch?: (target: PluginEditorHandle) => void;
    beforeParse?: () => void;
    markdown: string;
  },
): Promise<void> {
  const method = "setMarkdown";
  const instance = ctx.live(method);
  const parsedFrom = instance.state.doc;
  options.beforeParse?.();
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
  dispatchAsUndoStep(
    target,
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

/**
 * Spec §5 — send a write as its own undo step: every insert, and `setMarkdown` (plan 0117
 * Ruling 22). `prosemirror-history` adds a transaction to the previous undo group when it
 * comes within `newGroupDelay` (500 ms) of the previous transaction and touches the range that
 * one changed — and a whole-document replace touches every range. `closeHistory` on the write
 * parts it from the user's typing before it; a step-less transaction carrying `closeHistory`
 * parts it from the typing after, since `applyTransaction` reads that mark before it looks
 * for steps. Tiptap emits `update`, the event autosave listens to, only when a transaction
 * changed the document, so the step-less one emits none (spec §14 — measured for inserts and
 * `setMarkdown`; a `setMarkdown` row counts one `update` per call).
 */
function dispatchAsUndoStep(target: PluginEditorHandle, tr: Transaction): void {
  closeHistory(tr);
  target.view.dispatch(tr);
  target.view.dispatch(closeHistory(target.state.tr));
}

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
    // An atom's source has no position to insert at (spec §7.3 step 3). A wikilink collapses
    // in place, `[from, to]`, so an endpoint at its edge survives. Block media sits in a
    // temporary paragraph its collapse replaces whole, `[from - 1, to + 1]`, so its edges are
    // lost too (plan 0117 Ruling 13). Corpus: `ExpandedRange.kind` is image · link · mark ·
    // wikilink; only `expandMediaAtom` (image and video nodes, never inside a textblock)
    // builds that paragraph, as "image", and both collapse paths — `buildCollapseTr` and the
    // `appendTransaction` collapse in syntax-reveal.ts — replace `[from - 1, to + 1]`.
    const edges = expanded.kind === "image";
    const inside = (p: number) =>
      edges
        ? p >= expanded.from && p <= expanded.to
        : p > expanded.from && p < expanded.to;
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
 * insert on the live state, sent as its own undo step (`dispatchAsUndoStep`, P1).
 * `beforeCheck` runs first, ahead of the collapse lookup, its shadow `apply` and the anchor
 * check (spec §8 prices the collapse inside the transaction charge); `beforeDispatch` runs
 * once the shadow check has passed, before anything is sent.
 */
function send(
  target: PluginEditorHandle,
  owner: string,
  ref: string,
  method: string,
  { beforeCheck, beforeDispatch }: SendHooks,
  input: InsertInput,
): void {
  beforeCheck?.();
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
  dispatchAsUndoStep(target, buildOn(target.state, owner, ref, method, input));
}
