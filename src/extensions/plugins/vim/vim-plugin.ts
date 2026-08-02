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

import type { VimCoreState, VimMode } from "./core/types";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { Plugin } from "@tiptap/pm/state";

import { executeCoreCommand } from "./adapters/execute-command";
import { isSuspendTarget, shouldSuspendFor } from "./adapters/suspension";
import { isMacPlatform, toKeyToken } from "./core/keys";
import { step } from "./core/state-machine";
import { initialCoreState } from "./core/types";
import { isVimExternalEdit, vimPluginKey } from "./vim-keys";

export interface VimPluginState {
  core: VimCoreState;
  enabled: boolean;
  /** Mirror of core.mode so vim-keys' snapshot readers stay leaf-typed. */
  mode: VimMode;
  suspended: boolean;
}

type VimMeta =
  | { core: VimCoreState; type: "core" }
  | { enabled: boolean; type: "setEnabled" }
  | { mode: VimMode; type: "setMode" }
  | { suspended: boolean; type: "setSuspended" };

export function createVimPlugin(): Plugin<VimPluginState> {
  return new Plugin<VimPluginState>({
    key: vimPluginKey as never,

    props: {
      /** §3b: vim owns the root tabindex while modal — first-writer-wins in
       *  computeDocDeco, and this plugin sorts before the core Tabindex
       *  extension (priority 10000). */
      attributes: (state): Record<string, string> =>
        isModal(read(state)) ? { tabindex: "0" } : {},

      /** §3 IME block: no editing host in normal/visual. */
      editable: (state) => !isModal(read(state)),

      handleDOMEvents: {
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
          if (suspended !== vim.suspended) {
            dispatchMeta(view, { suspended, type: "setSuspended" });
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
            cursor: view.state.selection.head,
          });
          if (!result.handled) return false; // Mod chords, unknowns — §5

          // Single consumer (§4): the key must not also reach document-level
          // keybinding listeners.
          event.preventDefault();
          event.stopPropagation();
          dispatchMeta(view, { core: result.state, type: "core" });
          if (result.command) {
            // PRE-step visual: step() clears it on the visual→normal
            // transition, which is exactly when d/y need the range.
            executeCoreCommand(view, result.command, vim.core.visual);
          }
          return true;
        },

        /** §5: browser-default paste is actively consumed while modal. */
        paste: (view, event) => consumeClipboard(view, event),
      },

      /** Insert-mode Esc — through PM preprocessing (P3), and through the
       *  SAME core.step as the modal path: the core owns the modifier
       *  guards (Alt/Ctrl/Mod+Escape pass). The transient stack arbitration
       *  (§5c/§6 pins) joins in S6. */
      handleKeyDown: (view, event) => {
        const vim = read(view.state);
        if (!vim.enabled || vim.suspended || isModal(vim)) return false;
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
            visual: null,
          });
        }

        // §5b priority 3 — untagged doc change: reconcile positions.
        if (tr.docChanged) {
          const visual = prev.core.visual
            ? {
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
          mode: "insert",
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

function dispatchMeta(view: EditorView, meta: VimMeta): void {
  view.dispatch(view.state.tr.setMeta(vimPluginKey, meta));
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
      // §7: enabling lands in normal with a clean slate; disabling returns
      // the surface to plain editing.
      return {
        core: initialCoreState(meta.enabled ? "normal" : "insert"),
        enabled: meta.enabled,
        mode: meta.enabled ? "normal" : "insert",
        suspended: false,
      };
    case "setMode":
      return withCore(prev, {
        ...prev.core,
        count: null,
        mode: meta.mode,
        pending: null,
        visual: meta.mode === "visual" ? prev.core.visual : null,
      });
    case "setSuspended":
      // §5b focusLocal: entering an island clears count/pending — an
      // operator must not survive a trip through an input island.
      return {
        ...withCore(prev, { ...prev.core, count: null, pending: null }),
        suspended: meta.suspended,
      };
  }
}

function withCore(prev: VimPluginState, core: VimCoreState): VimPluginState {
  return { ...prev, core, mode: core.mode };
}

declare module "@tiptap/pm/view" {
  interface EditorView {
    /** prosemirror-view ships this; its typings lag behind. */
    isDestroyed: boolean;
  }
}
