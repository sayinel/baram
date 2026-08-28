// §298 vim selection commands (vim-plugin split, issue 372).
//
// Motions and visual transitions change the SELECTION together with the vim
// state, in one transaction — meta first, so `state.apply()`'s priority 1
// handles it and the foreign-selectionSet rule (priority 4) never misfires
// on vim's own cursor moves. `runSelectionCommand` is the sole entry point;
// `dispatchCursor`, `vimCursor`, and `visualSelection` are its private
// machinery, kept in this module because none of them are needed by the
// PluginView lifecycle (vim-island-sync.ts) or by createVimPlugin's props
// handlers directly — except `vimCursor`, which those callers also need for
// the block-cursor decoration and the scroll-follow head, so it stays
// exported here rather than duplicated.

import type { CoreCommand, StepResult, VisualState } from "./core/types";
import type { EditorState, Selection, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { NodeSelection, TextSelection } from "@tiptap/pm/state";

import { enterCodeBlockSelection } from "../../nodes/views/code-block-cm-registry";
import { cursorSelection } from "./adapters/cursor-selection";
import {
  cursorLineStart,
  resolveFindChar,
  resolveMotion,
} from "./adapters/motions";
import { visualBounds } from "./adapters/operations";
import { scrollCursorIntoView, scrollCursorToCenter } from "./adapters/scroll";
import { resolveSearch } from "./adapters/search";
import { collapseTarget, moveVisualHead } from "./core/visual-state";
import { vimPluginKey } from "./vim-keys";
import { read } from "./vim-plugin-state";

/**
 * Dispatch a transaction that MOVES THE CURSOR, and keep the DOM observer from
 * undoing it.
 *
 * A modal surface is non-editable, so ProseMirror never writes vim's selection
 * to the DOM. The DOM selection therefore still points where the caret used to
 * be, and `DOMObserver.flush` (installed prosemirror-view :4788) reads that
 * disagreement as the BROWSER having moved the caret:
 *
 *   newSel = !suppressingSelectionUpdates && !currentSelection.eq(sel) && …
 *   … if (from > -1 || newSel) this.handleDOMChange(…)
 *
 * and readDOMChange then restores the stale position. Measured on device: `k`
 * onto a math block landed and the next keystroke started from the old spot
 * again, so the cursor looked stuck. Mutations are not involved — an atom
 * NodeView has no contentDOM, so Tiptap already ignores its mutations, and
 * `ignoreSelectionChange` consults the desc where the DOM selection SITS (the
 * paragraph vim just left), not the block it moved to.
 *
 * WHY THE REVERT CANNOT BE BASELINED AWAY: WebKit refuses to hold a DOM
 * selection that starts or ends between non-editable blocks
 * (`brokenSelectBetweenUneditable`, prosemirror-view :2309). PM's own
 * workaround — `temporarilyEditableNear` briefly makes a neighbour editable,
 * writes the selection, flips it back — cannot stick under vim either, because
 * the WHOLE root is non-editable: WebKit re-normalises the selection
 * afterwards and fires a LATE `selectionchange` with a collapsed position near
 * the block. `setCurSelection()` (re-baseline once at dispatch) was tried and
 * REFUTED on device — `j` skipped the block again — since a baseline taken now
 * cannot win against an event that arrives later; PM even calls it itself at
 * the end of `selectionToDOM` (:2303) and the revert fired regardless.
 *
 * suppressSelectionUpdates() is the instrument PM core itself uses for
 * same-class churn (:5202, upstream issue 820): for the next 50 ms every
 * incoming `selectionchange` is answered by RE-ASSERTING state into the DOM
 * (`onSelectionChange → selectionToDOM`), which outlasts the async churn.
 * The window does not eat real input — a mouse click travels PM's state path
 * (`updateSelection → view.dispatch`, :3243), so suppression re-asserts the
 * click's own selection; only the first ≤50 ms of a native drag-selection
 * started right after a vim keystroke is affected. use-source-mode.ts leans on
 * the same call for its source-mode return.
 */
function dispatchCursor(view: EditorView, tr: Transaction): boolean {
  view.dispatch(tr);
  (
    view as unknown as {
      domObserver?: { suppressSelectionUpdates?: () => void };
    }
  ).domObserver?.suppressSelectionUpdates?.();
  // Normal mode needs NO DOM selection: the cursor is a decoration and an
  // atom line keeps the selectednode outline. The range PM just wrote is the
  // seed of the churn above — WebKit re-normalises it into a root-anchored
  // block range (captured live: collapsed=false anchor=<div.tiptap> offset=24)
  // whose full-width paint `.ProseMirror-hideselection *::selection` cannot
  // hide, because that rule only silences TEXT selections. Removing the range
  // leaves the churn nothing to chew on. Visual mode is exempt — its range IS
  // the native selection the user is extending.
  if (read(view.state).mode === "normal") {
    const root = view.root as Document;
    const sel =
      typeof root.getSelection === "function"
        ? root.getSelection()
        : document.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) sel.removeAllRanges();
  }
  // §298 explicit island handoff — PM's selectionToDOM is gated by
  // editorOwnsSelection, whose non-editable preconditions (DOM selection
  // fully inside view.dom + activeElement containing view.dom) usually do
  // not hold while vim is modal — so PM's own descent into the code block
  // NodeView's setSelection (CM focus + cursor) cannot be relied on. The
  // landing would be invisible and the next j would sail past the block
  // (device log: dispatchCursor parent=codeBlock, no setSelection). Runs
  // AFTER the wipe so the DOM selection CodeMirror establishes on focus
  // survives it; the suppression armed above covers the focus's own
  // selectionchange fallout. Returns whether the island took focus, so
  // the caller can leave the scroll follow to CM (issue 472).
  return enterCodeBlockSelection(view);
}

/**
 * Motions and visual transitions change the SELECTION together with the vim
 * state, in one transaction — meta first, so apply()'s priority 1 handles
 * it and the foreign-selectionSet rule (priority 4) never misfires on
 * vim's own cursor moves. Returns false for commands it does not own.
 */
export function runSelectionCommand(
  view: EditorView,
  result: StepResult,
  preVisual: null | VisualState,
): boolean {
  const command: CoreCommand | null = result.command;
  if (!command) return false;

  if (command.type === "move") {
    // In visual mode the motion moves the VIM head, not PM's selection head
    // (they diverge after an inversion — §6).
    const base =
      result.state.mode === "visual" && preVisual
        ? preVisual.headCursor
        : vimCursor(view.state);
    const inVisual = result.state.mode === "visual" && preVisual !== null;
    const target = resolveMotion(
      view.state,
      base,
      command.motion,
      command.count,
      // Issue 472: directional code-block landing is NORMAL-mode-only — a
      // visual head parked mid-block breaks the next walk's column math
      // and changes d/y ranges (adversarial review HIGH). Visual keeps the
      // first-line default.
      inVisual ? undefined : { codeBlockEntry: "directional" },
    );
    let core = result.state;
    const tr = view.state.tr;
    if (inVisual && preVisual) {
      const visual = moveVisualHead(preVisual, target);
      core = { ...result.state, visual };
      tr.setSelection(visualSelection(view.state, visual));
    } else {
      tr.setSelection(cursorSelection(view.state.doc, target));
    }
    tr.setMeta(vimPluginKey, { core, type: "core" });
    const islandTookFocus = dispatchCursor(view, tr);
    // ONE follow, ours. PM's scrollToSelection bails when the DOM selection
    // sits outside a non-editable view (vim modal), but it does NOT bail
    // when the surface still owns the selection — flagging the transaction
    // too ran the whole geometry pass twice per keystroke (performance
    // review P4).
    //
    // Issue 472: when the CM island took the handoff, the follow is ITS
    // job — the NodeView has no contentDOM, so PM's coordsAtPos maps every
    // interior offset to the wrapper's TOP edge (adversarial review HIGH:
    // a k-entry at the last line of a tall block would scroll the viewport
    // toward the block top, away from the caret). setSelection dispatches
    // with scrollIntoView, which follows the real CM caret line.
    if (!islandTookFocus) scrollCursorIntoView(view, target);
    return true;
  }

  if (command.type === "exCommand") {
    // issue 487 — `:N`/`:$` 줄 이동은 SELECTION 명령이다: move와 같은
    // 단일 트랜잭션(meta + 선택)으로 처리해 코드블록 착지의 진입
    // 핸드오프·스크롤 위임까지 기존 채널을 그대로 탄다. 숫자가 아니면
    // false — 실행부(:w/:q)가 이어받는다.
    const m = /^(\d+|\$)$/.exec(command.name.trim());
    if (!m) return false;
    const target = cursorLineStart(
      view.state,
      m[1] === "$" ? "$" : Number.parseInt(m[1], 10),
    );
    if (target === null) return true; // 빈 문서 — 명령줄만 닫는다
    const tr = view.state.tr;
    tr.setSelection(cursorSelection(view.state.doc, target));
    tr.setMeta(vimPluginKey, { core: result.state, type: "core" });
    const islandTookFocus = dispatchCursor(view, tr);
    if (!islandTookFocus) scrollCursorIntoView(view, target);
    return true;
  }

  if (command.type === "search") {
    // Buffer-local `/`·`?`·`n`·`N`. A miss (no match, invalid pattern) is the
    // same silence as an `f` miss — but the META must still land: Enter just
    // closed the search line and recorded lastSearch.
    const target = resolveSearch(
      view.state,
      vimCursor(view.state),
      command.pattern,
      command.direction,
      command.count,
    );
    const tr = view.state.tr;
    if (target !== null) {
      tr.setSelection(cursorSelection(view.state.doc, target));
    }
    tr.setMeta(vimPluginKey, { core: result.state, type: "core" });
    dispatchCursor(view, tr);
    if (target !== null) scrollCursorIntoView(view, target);
    return true;
  }

  if (command.type === "findChar") {
    const base =
      result.state.mode === "visual" && preVisual
        ? preVisual.headCursor
        : vimCursor(view.state);
    const target = resolveFindChar(
      view.state,
      base,
      command.char,
      command.kind,
      command.count,
      command.repeat ?? false,
    );
    let core = result.state;
    const tr = view.state.tr;
    if (result.state.mode === "visual" && result.state.visual) {
      const visual = moveVisualHead(result.state.visual, target);
      core = { ...result.state, visual };
      tr.setSelection(visualSelection(view.state, visual));
    } else if (target !== base) {
      tr.setSelection(cursorSelection(view.state.doc, target));
    }
    tr.setMeta(vimPluginKey, { core, type: "core" });
    dispatchCursor(view, tr);
    scrollCursorIntoView(view, target); // ops-R8 — see the move path
    return true;
  }

  if (command.type === "scrollCursor") {
    // z. homes to the first non-blank before centering; zz keeps the column.
    // In visual mode the selection survives and the VIM head is the center
    // target — PM's selection head diverges after an inversion (§6).
    const visual = result.state.mode === "visual" ? result.state.visual : null;
    let core = result.state;
    const tr = view.state.tr;
    let center = visual ? visual.headCursor : vimCursor(view.state);
    if (command.firstNonBlank) {
      const target = resolveMotion(view.state, center, "lineFirstNonBlank", 1);
      if (visual) {
        const moved = moveVisualHead(visual, target);
        core = { ...result.state, visual: moved };
        tr.setSelection(visualSelection(view.state, moved));
      } else if (target !== center) {
        tr.setSelection(cursorSelection(view.state.doc, target));
      }
      center = target;
    }
    tr.setMeta(vimPluginKey, { core, type: "core" });
    dispatchCursor(view, tr);
    scrollCursorToCenter(view, center);
    return true;
  }

  if (command.type === "enterVisual" && result.state.visual) {
    const tr = view.state.tr.setSelection(
      visualSelection(view.state, result.state.visual),
    );
    tr.setMeta(vimPluginKey, { core: result.state, type: "core" });
    dispatchCursor(view, tr);
    return true;
  }

  if (command.type === "leaveVisual" && preVisual) {
    // Esc collapses to the vim head — not PM's selection head (§6).
    const tr = view.state.tr.setSelection(
      cursorSelection(view.state.doc, collapseTarget(preVisual)),
    );
    tr.setMeta(vimPluginKey, { core: result.state, type: "core" });
    dispatchCursor(view, tr);
    return true;
  }

  return false;
}

/** The vim cursor: a NodeSelection's own position (a block atom line), or
 *  the collapsed head. PM's `head` on a NodeSelection points PAST the node —
 *  resolving lines from there lands on the wrong one (review S3-R1). */
export function vimCursor(state: EditorState): number {
  const sel = state.selection;
  return sel instanceof NodeSelection ? sel.from : sel.head;
}

/** Visual rendering. A range that is exactly one selectable block atom
 *  becomes a NodeSelection — TextSelection.between would snap both
 *  non-inline endpoints to the SAME caret and hide what d/y is about to
 *  destroy (review S3-R2). Mixed text+atom ranges keep the between() snap;
 *  exact atom-inclusive rendering is the S5 decoration work. d/y precision
 *  always comes from visualBounds, never from the rendered selection. */
function visualSelection(state: EditorState, visual: VisualState): Selection {
  const { from, to } = visualBounds(state, visual);
  const $from = state.doc.resolve(from);
  const atom = $from.parent.isTextblock ? null : $from.nodeAfter;
  if (
    atom &&
    (atom.isAtom || atom.isLeaf) &&
    from + atom.nodeSize === to &&
    NodeSelection.isSelectable(atom)
  ) {
    return NodeSelection.create(state.doc, from);
  }
  return TextSelection.between(state.doc.resolve(from), state.doc.resolve(to));
}
