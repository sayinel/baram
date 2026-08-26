// §298 Vim Phase 1 — the WYSIWYG vim plugin (design §2/§3/§4/§5/§5b, S2).
//
// Dual entry points (P3): normal/visual keys arrive through
// handleDOMEvents.keydown — prosemirror-view runs custom handlers BEFORE its
// editable gate, so this is the one path that still fires while the view is
// non-editable. Insert-mode Esc arrives through handleKeyDown instead,
// inheriting PM's composition-adjacent preprocessing. Both feed the same
// core.step().
//
// IME is blocked declaratively: `editable(state)` returns false in
// normal/visual, so WebKit never has an editing host to compose into (the
// measured 3v mechanism from Phase 0a). The tabindex that keeps the DOM
// focusable is supplied through the `attributes` prop — the core Tabindex
// extension drops its own while non-editable, and a manual setAttribute
// would be clobbered by PM's outer-deco patch (design §3b).

import type {
  CoreCommand,
  StepResult,
  VimCoreState,
  VimMode,
  VisualState,
} from "./core/types";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import {
  NodeSelection,
  Plugin,
  Selection,
  TextSelection,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import {
  broadcastCodeBlockEditable,
  broadcastCodeBlockVim,
  enterCodeBlockSelection,
} from "../../nodes/views/code-block-cm-registry";
import { planAtomInsert } from "./adapters/atom-insert";
import { cursorSelection } from "./adapters/cursor-selection";
import { hasAnyEditorTransient } from "./adapters/esc-arbitration";
import { executeCoreCommand } from "./adapters/execute-command";
import { nextUnitBoundary, releaseGraphemeIndex } from "./adapters/graphemes";
import { insertArrowEntry } from "./adapters/insert-entry";
import { resolveFindChar, resolveMotion } from "./adapters/motions";
import { visualBounds } from "./adapters/operations";
import { scrollCursorIntoView, scrollCursorToCenter } from "./adapters/scroll";
import { resolveSearch } from "./adapters/search";
import {
  islandLabel,
  isSuspendTarget,
  shouldSuspendFor,
} from "./adapters/suspension";
import { isMacPlatform, toKeyToken } from "./core/keys";
import { step } from "./core/state-machine";
import { initialCoreState } from "./core/types";
import { collapseTarget, moveVisualHead } from "./core/visual-state";
import { isVimExternalEdit, vimPluginKey } from "./vim-keys";
import { registerVimLifecycle } from "./vim-lifecycle";
import {
  clearWysiwygVimStatusFor,
  publishVimRefusal,
  publishWysiwygVimStatus,
} from "./vim-status";

export interface VimPluginState {
  core: VimCoreState;
  enabled: boolean;
  /** Mirror of core.exLine — same reason as `mode`. */
  exLine: null | string;
  /** Label of the focused input island while suspended ("math", …) — null
   *  when not suspended or unknown. Drives `-- INSERT (x) --` (§8). */
  island: null | string;
  /** Mirror of core.mode so vim-keys' snapshot readers stay leaf-typed. */
  mode: VimMode;
  /** core.searchLine mirrored AS ITS DISPLAY FORM ("/te", "?a") — the status
   *  feed shows it in the command slot exactly like the ex line. */
  searchLine: null | string;
  suspended: boolean;
}

type VimMeta =
  | { boundary?: boolean; mode: VimMode; type: "setMode" }
  | { core: VimCoreState; type: "core" }
  | { enabled: boolean; type: "setEnabled" }
  | { island?: null | string; suspended: boolean; type: "setSuspended" };

export function createVimPlugin(
  tiptapEditor: TiptapEditor,
): Plugin<VimPluginState> {
  return new Plugin<VimPluginState>({
    key: vimPluginKey as never,

    props: {
      /** §3b: vim owns the root tabindex while modal — first-writer-wins in
       *  computeDocDeco, and this plugin sorts before the core Tabindex
       *  extension (priority 10000). */
      attributes: (state): Record<string, string> =>
        isModal(read(state)) ? { class: "vim-modal", tabindex: "0" } : {},

      /** §10 block cursor — the native caret does not render on a
       *  non-editable view, so normal mode paints the unit under the vim
       *  cursor (simple recalculation, pos-existence guarded). Visual mode
       *  keeps the native selection; a NodeSelection atom line keeps PM's
       *  selectednode chrome. */
      decorations: (state) => {
        const vim = read(state);
        if (!vim.enabled || vim.suspended || vim.mode !== "normal") {
          return null;
        }
        const head = vimCursor(state);
        if (head < 0 || head > state.doc.content.size) return null;
        const $head = state.doc.resolve(head);
        if (!$head.parent.isTextblock) return null; // atom line — NodeSelection
        const end = nextUnitBoundary(state, head);
        if (end > head) {
          return DecorationSet.create(state.doc, [
            Decoration.inline(head, end, { class: "vim-cursor" }),
          ]);
        }
        // Empty line or terminal boundary — a zero-width widget caret.
        return DecorationSet.create(state.doc, [
          Decoration.widget(head, eolCursorWidget, { side: 1 }),
        ]);
      },

      /** §3 IME block: no editing host in normal/visual. */
      editable: (state) => !isModal(read(state)),

      handleDOMEvents: {
        /** §12-⑩ pointer entry (issue 408) — a click that lands a
         *  NodeSelection is the ONE selection write that does not go through
         *  dispatchCursor, so it got no churn suppression: PM's pointer
         *  dispatch wrote the node range, WebKit re-normalised it, and the
         *  late selectionchange deselected the block — closing the edit
         *  session the click had just opened (measured: gate PASS, then
         *  DESELECT with no input). Microtask so the React click handlers
         *  (entry latch, setNodeSelection) run first; the TextSelection
         *  guard keeps drag-copy clicks live, since suppression re-asserts
         *  state into the DOM for 50 ms. */
        click: (view, event) => {
          if (!read(view.state).enabled) return false;
          const target = event.target;
          queueMicrotask(() => {
            if (view.isDestroyed) return;
            const sel = view.state.selection;
            if (!(sel instanceof NodeSelection)) return;
            // Correlate with the CLICKED atom: with an atom parked-selected,
            // an ordinary text click's state update can arrive through the
            // LATE selectionchange — a suppression armed off the stale
            // NodeSelection would answer that click by re-asserting the old
            // selection, eating the user's click (adversarial review).
            const dom = view.nodeDOM(sel.from);
            if (
              !(dom instanceof Node) ||
              !(target instanceof Node) ||
              !dom.contains(target)
            ) {
              return;
            }
            (
              view as unknown as {
                domObserver?: { suppressSelectionUpdates?: () => void };
              }
            ).domObserver?.suppressSelectionUpdates?.();
          });
          return false;
        },

        /** §5: browser-default cut is actively consumed while modal. */
        cut: (view, event) => consumeClipboard(view, event),

        /** §5: text-selection drag stays allowed (copy semantics). */
        dragstart: () => false,

        /** §5: drop is consumed AND stopped — document-level handlers
         *  (useExternalDrop editor zone) must not see it either. */
        drop: (view, event) => {
          const vim = read(view.state);
          if (!vim.enabled || vim.suspended || !isModal(vim)) return false;
          event.preventDefault();
          event.stopPropagation();
          return true;
        },

        focusin: (view, event) => {
          const vim = read(view.state);
          if (!vim.enabled) return false;
          const suspended = isSuspendTarget(event);
          // The label must track suspended-to-suspended handoffs too: focus
          // moving from a math textarea to another suspended host keeps the
          // boolean true, and a boolean-only dispatch left the bar naming an
          // island that no longer owned the keys (adversarial review).
          const island = suspended ? islandLabel(event) : null;
          if (suspended !== vim.suspended || island !== vim.island) {
            dispatchMeta(view, { island, suspended, type: "setSuspended" });
          }
          return false;
        },

        /** §4: release is NOT focusout-synchronous — re-evaluate the active
         *  element on a microtask (input → island button must not resume). */
        focusout: (view) => {
          const vim = read(view.state);
          if (!vim.enabled || !vim.suspended) return false;
          queueMicrotask(() => {
            if (view.isDestroyed) return;
            const active = view.root.activeElement;
            if (!shouldSuspendFor(active)) {
              dispatchMeta(view, { suspended: false, type: "setSuspended" });
            }
          });
          return false;
        },

        /** P3 entry point: the ONLY key path while non-editable. */
        keydown: (view, event) => {
          const vim = read(view.state);
          if (!vim.enabled || vim.suspended || !isModal(vim)) return false;
          if (isSuspendTarget(event)) return false; // §4 pre-focus safety

          const token = toKeyToken(event, isMacPlatform());
          const result = step(vim.core, token, {
            cursor: vimCursor(view.state),
          });
          if (!result.handled) return false; // Mod chords, unknowns — §5

          // Single consumer (§4): the key must not also reach document-level
          // keybinding listeners.
          event.preventDefault();
          event.stopPropagation();
          if (runSelectionCommand(view, result, vim.core.visual)) return true;
          // §D1: an atom decides insert entry BEFORE the mode is dispatched.
          // `editable` is derived from the mode, so a veto afterwards would
          // already have opened an editable view over a live NodeSelection —
          // the state where typing replaces the selected node.
          if (runAtomInsert(view, result)) return true;
          dispatchMeta(view, { core: result.state, type: "core" });
          if (result.command) {
            // PRE-step visual: step() clears it on the visual→normal
            // transition, which is exactly when d/y need the range.
            const exec = executeCoreCommand(
              view,
              result.command,
              vim.core.visual,
            );
            // A refused CHANGE must not leave the editor in insert — the
            // core flips the mode before the adapter can veto (ops-R2).
            // A PARTIALLY applied change is not a refusal: the document
            // already changed and the empty line awaits input (ops-R3).
            if (
              exec.reason &&
              !exec.applied &&
              isChangeCommand(result.command)
            ) {
              dispatchMeta(view, { mode: "normal", type: "setMode" });
            }
            // Routine no-ops stay quiet: the app has ONE toast slot and
            // it also carries save and plugin errors (final review).
            if (exec.reason && !exec.silent) publishVimRefusal(exec.reason);
          }
          return true;
        },

        /** §5: browser-default paste is actively consumed while modal. */
        paste: (view, event) => consumeClipboard(view, event),
      },

      /** Vim owns cursor-follow scrolling while enabled: PM's default
       *  measures hidden (windowed) blocks, adds VISUAL deltas to a
       *  content-space scrollTop (src/utils/zoom-coords.ts), and follows
       *  the normalized PM head — the wrong, anchored end of an inverted
       *  visual selection (review ops-R8). The vim head decides. */
      handleScrollToSelection: (view) => {
        const vim = read(view.state);
        if (!vim.enabled || vim.suspended) return false;
        scrollCursorIntoView(
          view,
          vim.core.visual?.headCursor ?? vimCursor(view.state),
        );
        return true;
      },

      /** Insert-mode Esc — through PM preprocessing (P3), and through the
       *  SAME core.step as the modal path: the core owns the modifier
       *  guards (Alt/Ctrl/Mod+Escape pass). An active transient (popup,
       *  ghost text, diff) takes the first Esc — see the guard below. */
      handleKeyDown: (view, event) => {
        const vim = read(view.state);
        if (!vim.enabled || vim.suspended || isModal(vim)) return false;
        // §4 arbitration: an active transient (popup/ghost/diff/…) owns the
        // first Esc — its handler runs after vim in the prop chain.
        if (event.key === "Escape" && hasAnyEditorTransient(view.state)) {
          return false;
        }
        // issue 477 — insert-mode arrows next to a code block: PM insert is
        // an editable view, but a vim island keeps its 3v editing-host
        // barrier, and the browser caret cannot step into a non-editable
        // subtree — a plain arrow skipped the whole block (device log:
        // sel 5→61). An edge arrow hands off explicitly and lands in
        // INSERT (arrows while editing mean "keep editing"). Modifiers
        // stay native — Shift starts a selection — and an active transient
        // (slash/mention popup) owns its own arrows (adversarial review).
        if (
          (event.key === "ArrowDown" || event.key === "ArrowUp") &&
          !event.shiftKey &&
          !event.metaKey &&
          !event.altKey &&
          !event.ctrlKey &&
          !hasAnyEditorTransient(view.state) &&
          insertArrowEntry(view, event.key === "ArrowDown" ? 1 : -1)
        ) {
          event.preventDefault();
          event.stopPropagation();
          return true;
        }
        const token = toKeyToken(event, isMacPlatform());
        const result = step(vim.core, token, {
          cursor: view.state.selection.head,
        });
        if (!result.handled) return false;
        event.preventDefault();
        event.stopPropagation();
        dispatchMeta(view, { core: result.state, type: "core" });
        if (result.command) {
          executeCoreCommand(view, result.command, vim.core.visual);
        }
        return true;
      },

      /** §3 second line of defence: no text lands while modal. */
      handleTextInput: (view) => isModal(read(view.state)),
    },

    /** §7 settings lifecycle + §8 status feed (owner-gated inside
     *  vim-status) + §4-CM readOnly sync: PM never calls NodeView.update()
     *  on an editable flip, so live CodeMirror blocks are reconfigured by
     *  broadcast whenever this PluginView sees the prop change. */
    view: (editorView) => {
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
    },

    state: {
      apply(tr, prev): VimPluginState {
        // §5b priority 1 — vim's own meta.
        const meta = tr.getMeta(vimPluginKey) as undefined | VimMeta;
        if (meta) return reduce(prev, meta);

        if (!prev.enabled) return prev;

        // §5b priority 2 — explicit external command: clear count/pending,
        // apply the mode matrix (visual collapses to normal). Applies to
        // selection/meta-only transactions too (v7 pin 4).
        if (isVimExternalEdit(tr)) {
          return withCore(prev, {
            ...prev.core,
            count: null,
            mode: prev.core.mode === "visual" ? "normal" : prev.core.mode,
            pending: null,
            pendingCount: null,
            visual: null,
          });
        }

        // §5b priority 3 — untagged doc change: reconcile positions.
        if (tr.docChanged) {
          const visual = prev.core.visual
            ? {
                ...prev.core.visual,
                anchorCursor: tr.mapping.map(prev.core.visual.anchorCursor),
                headCursor: tr.mapping.map(prev.core.visual.headCursor),
              }
            : null;
          return withCore(prev, { ...prev.core, visual });
        }

        // §5b priority 4 — external selection: a foreign selectionSet drops
        // visual back to normal (the anchor no longer means anything).
        if (tr.selectionSet && prev.core.mode === "visual") {
          return withCore(prev, {
            ...prev.core,
            mode: "normal",
            visual: null,
          });
        }

        return prev;
      },

      init(): VimPluginState {
        return {
          core: initialCoreState("insert"),
          enabled: false,
          exLine: null,
          island: null,
          mode: "insert",
          searchLine: null,
          suspended: false,
        };
      },
    },
  });
}

// ── helpers ────────────────────────────────────────────────────────────────

function consumeClipboard(view: EditorView, event: Event): boolean {
  const vim = read(view.state);
  if (!vim.enabled || vim.suspended || !isModal(vim)) return false;
  event.preventDefault();
  return true;
}

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

function dispatchMeta(view: EditorView, meta: VimMeta): void {
  view.dispatch(view.state.tr.setMeta(vimPluginKey, meta));
}

function eolCursorWidget(): HTMLElement {
  const el = document.createElement("span");
  el.className = "vim-cursor-eol";
  return el;
}

function isChangeCommand(command: CoreCommand): boolean {
  return (
    command.type === "changeLine" ||
    (command.type === "operatorMotion" && command.op === "c") ||
    (command.type === "operatorFind" && command.op === "c")
  );
}

function isModal(vim: VimPluginState): boolean {
  return vim.enabled && vim.mode !== "insert";
}

function read(state: EditorState): VimPluginState {
  return vimPluginKey.getState(state) as unknown as VimPluginState;
}

function reduce(prev: VimPluginState, meta: VimMeta): VimPluginState {
  switch (meta.type) {
    case "core":
      return withCore(prev, meta.core);
    case "setEnabled":
      if (!meta.enabled) releaseGraphemeIndex();
      // §7: enabling lands in normal with a clean slate; disabling returns
      // the surface to plain editing — and drops the boundary index, which
      // only vim builds (performance review P3).
      return {
        core: initialCoreState(meta.enabled ? "normal" : "insert"),
        enabled: meta.enabled,
        exLine: null,
        island: null,
        mode: meta.enabled ? "normal" : "insert",
        searchLine: null,
        suspended: false,
      };
    case "setMode":
      // issue 478 — a BOUNDARY handoff (mode following the cursor out of a
      // code block island) needs a clean core: an outer `:`/`/` buffer left
      // open before entering the island must not resurrect on exit. The
      // ordinary setMode (change-refusal recovery) keeps them.
      return withCore(prev, {
        ...prev.core,
        count: null,
        exLine: meta.boundary ? null : prev.core.exLine,
        mode: meta.mode,
        pending: null,
        pendingCount: null,
        searchLine: meta.boundary ? null : prev.core.searchLine,
        visual: meta.mode === "visual" ? prev.core.visual : null,
      });
    case "setSuspended":
      // §5b focusLocal: entering an island clears count/pending — an
      // operator must not survive a trip through an input island.
      return {
        ...withCore(prev, {
          ...prev.core,
          count: null,
          pending: null,
          pendingCount: null,
        }),
        island: meta.suspended ? (meta.island ?? null) : null,
        suspended: meta.suspended,
      };
  }
}

/**
 * §D1 insert-entry preflight for atoms. Returns true when the key is fully
 * handled here, so the caller must NOT dispatch the core's insert state.
 *
 * Three outcomes, none of which may leave a live NodeSelection under an
 * editable view:
 *
 * - inline atom → place an exact caret, then let insert proceed. `i` before
 *   the atom, `a` after: those are real text positions inside the textblock.
 * - block atom with an editing island → ask the island for focus and stay in
 *   NORMAL. The `focusin` that follows suspends vim, which is what actually
 *   hands the keys over; we never assume it succeeded, so a NodeView that
 *   mounts its input asynchronously simply takes longer, and one that fails
 *   leaves the document modal and intact.
 * - block atom without an island → consume the key and stay in normal. `o`/`O`
 *   are how vim adds a line next to something it cannot enter.
 */
function runAtomInsert(view: EditorView, result: StepResult): boolean {
  const command = result.command;
  if (command?.type !== "enterInsert") return false;

  const plan = planAtomInsert(view, command.at);
  switch (plan.kind) {
    case "caret": {
      const tr = view.state.tr.setSelection(plan.selection);
      view.dispatch(tr.scrollIntoView());
      dispatchMeta(view, { core: result.state, type: "core" });
      return true;
    }
    case "island":
      plan.enter();
      return true;
    case "ordinary":
      return false;
    case "refuse":
      return true;
  }
}

/**
 * Motions and visual transitions change the SELECTION together with the vim
 * state, in one transaction — meta first, so apply()'s priority 1 handles
 * it and the foreign-selectionSet rule (priority 4) never misfires on
 * vim's own cursor moves. Returns false for commands it does not own.
 */
function runSelectionCommand(
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
function vimCursor(state: EditorState): number {
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

function withCore(prev: VimPluginState, core: VimCoreState): VimPluginState {
  return {
    ...prev,
    core,
    exLine: core.exLine,
    mode: core.mode,
    searchLine:
      core.searchLine === null
        ? null
        : (core.searchLine.direction === "forward" ? "/" : "?") +
          core.searchLine.text,
  };
}

declare module "@tiptap/pm/view" {
  interface EditorView {
    /** prosemirror-view ships this; its typings lag behind. */
    isDestroyed: boolean;
  }
}
