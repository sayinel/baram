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

import type { CoreCommand, StepResult } from "./core/types";
import type { VimPluginState } from "./vim-plugin-state";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";

import { NodeSelection, Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { planAtomInsert } from "./adapters/atom-insert";
import { hasAnyEditorTransient } from "./adapters/esc-arbitration";
import { executeCoreCommand } from "./adapters/execute-command";
import { nextUnitBoundary } from "./adapters/graphemes";
import { insertArrowEntry } from "./adapters/insert-entry";
import { scrollCursorIntoView } from "./adapters/scroll";
import {
  islandLabel,
  isSuspendTarget,
  shouldSuspendFor,
} from "./adapters/suspension";
import { isMacPlatform, toKeyToken } from "./core/keys";
import { step } from "./core/state-machine";
import { createIslandSync } from "./vim-island-sync";
import { vimPluginKey } from "./vim-keys";
import {
  applyVimTransaction,
  initialVimPluginState,
} from "./vim-plugin-reducer";
import { dispatchMeta, isModal, read } from "./vim-plugin-state";
import { createPointerGoalWatch } from "./vim-pointer-goal";
import {
  appendNormalCursorFixes,
  escapeInsertCursor,
  runSelectionCommand,
  vimCursor,
} from "./vim-selection-commands";
import { publishVimRefusal } from "./vim-status";

export function createVimPlugin(
  tiptapEditor: TiptapEditor,
): Plugin<VimPluginState> {
  const pointerGoal = createPointerGoalWatch();
  return new Plugin<VimPluginState>({
    /** issue 776 — forget the goal column when a pointer press moved the
     *  cursor (vim-pointer-goal.ts), and keep the normal-mode caret ON a
     *  unit — in one appended transaction (appendNormalCursorFixes). */
    appendTransaction: (trs, _old, state) =>
      appendNormalCursorFixes(state, pointerGoal.settle(trs, state)),

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
         *  NodeSelection is written by PM's pointer handling, not through
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
          pointerGoal.disarm();
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

        /** issue 776 — arm the pointer watch (vim-pointer-goal.ts): the goal
         *  column is forgotten only if this press moves the cursor. Both
         *  events, since touch and pen raise pointerdown first. */
        mousedown: (view) => {
          pointerGoal.arm(view);
          return false;
        },
        pointerdown: (view) => {
          pointerGoal.arm(view);
          return false;
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
        if (result.state.mode === "normal") {
          escapeInsertCursor(view, result.state);
        } else {
          dispatchMeta(view, { core: result.state, type: "core" });
        }
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
     *  broadcast whenever this PluginView sees the prop change. Lifecycle
     *  itself lives in vim-island-sync.ts (vim-plugin split, issue 372) —
     *  `tiptapEditor` is the same instance this closure already captures. */
    view: (editorView) => createIslandSync(editorView, tiptapEditor),

    state: {
      apply: applyVimTransaction,
      init: initialVimPluginState,
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
      // ONE transaction for the caret and the insert mode (issue 776): a
      // caret placed while still in normal mode at a line end is a terminal
      // boundary, and the normal-mode clamp (appendNormalCursorFixes) would
      // pull it back one unit before insert began — `A` then typed before
      // the last character.
      const tr = view.state.tr
        .setSelection(plan.selection)
        .setMeta(vimPluginKey, { core: result.state, type: "core" });
      view.dispatch(tr.scrollIntoView());
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

declare module "@tiptap/pm/view" {
  interface EditorView {
    /** prosemirror-view ships this; its typings lag behind. */
    isDestroyed: boolean;
  }
}
