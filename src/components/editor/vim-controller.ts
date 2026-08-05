// §298 Phase 0a S2 — vim lifecycle controller for SourceCodeEditor.
//
// Extracted from the component so the enable/disable/race/dispose contract is
// unit-testable with fakes (Codex S2 gate: a guard-level disposer test is not
// evidence that the CALLER actually calls it). The component keeps only:
// create controller → apply(setting) → subscribe → dispose.

import type { Compartment } from "@codemirror/state";

import { Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import {
  attachVimBoundary,
  type BoundaryHooks,
} from "./vim-code-block-boundary";
import {
  attachVimImeGuard,
  shouldBlockImeInput,
  type VimModeName,
} from "./vim-ime-guard";
import { loadVimModule } from "./vim-mode";

export interface VimController {
  /** Enable/disable vim. Safe to call repeatedly; stale loads are dropped. */
  apply(enabled: boolean): void;
  /** Final teardown — detaches the guard and invalidates in-flight loads. */
  dispose(): void;
}

export interface VimControllerDeps {
  /** Test seam — defaults to the real IME guard. */
  attachGuard?: typeof attachVimImeGuard;
  /** Phase 0b: island boundary hooks (edge j/k/arrows escape, u/C-r →
   *  PM undo). Attached with the IME guard, detached with it too. */
  boundaryHooks?: BoundaryHooks;
  /** Whether removing the editing host may PULL focus onto contentDOM.
   *  Source mode owns its surface (default true); a code-block island must
   *  never steal focus from PM on a lazy load (Phase 0b). */
  claimFocus?: boolean;
  /**
   * Mechanism 3v (measured fallback, promoted after the real-surface smoke):
   * in normal/visual mode `contenteditable` is removed entirely so WebKit has
   * NO editing host — the composition path (insertCompositionText, which is
   * non-cancelable per spec) can never start, and CodeMirror's
   * composition-adjacent keydown suppression never engages. `tabindex` keeps
   * contentDOM focusable so keys still flow through the normal CM path.
   * The smoke trace showed candidate C alone fails on the production
   * surface: WebKit switches Korean input to the composition path there.
   */
  editableCompartment?: Compartment;
  /** Test seam — defaults to the cached dynamic loader. */
  loadModule?: () => Promise<VimModule>;
  onError?: (err: unknown) => void;
  /** S3: StatusBar mode feed. Receives null whenever vim turns off. */
  onModeChange?: (mode: null | VimModeName) => void;
}

type VimModule = Awaited<ReturnType<typeof loadVimModule>>;

export function createVimController(
  view: EditorView,
  compartment: Compartment,
  deps: VimControllerDeps = {},
): VimController {
  const load = deps.loadModule ?? loadVimModule;
  const attach = deps.attachGuard ?? attachVimImeGuard;

  let disposed = false;
  let revision = 0;
  let guardDispose: (() => void) | null = null;
  let boundaryDispose: (() => void) | null = null;

  const detachGuard = () => {
    guardDispose?.();
    guardDispose = null;
    boundaryDispose?.();
    boundaryDispose = null;
  };

  /** Latest requested editing-host state, applied on the next microtask. */
  let pendingEditable: boolean | null = null;
  let flushScheduled = false;

  /** 3v: remove/restore the editing host. No editing host = the composition
   *  path cannot start, so the non-cancelable insertCompositionText problem
   *  never arises. `readOnly` stays false — vim's programmatic edits (x/dd)
   *  keep working (measured, probe step 4).
   *
   *  DEFERRED, and that is load-bearing: `vim-mode-change` can fire from
   *  INSIDE CodeMirror's update cycle — a mouse selection reaches
   *  handleExternalSelection via onBeforeEndOperation. Dispatching there
   *  throws ("not allowed while an update is in progress"), CodeMirror logs
   *  once and DEACTIVATES the plugin, and the abandoned cursor layer is what
   *  the user sees as a second caret. A microtask lands after the update
   *  unwinds but still before the next key event, so "no editing host before
   *  the next keystroke" — the entire point of 3v — still holds. */
  const setEditingHost = (editable: boolean) => {
    const comp = deps.editableCompartment;
    if (!comp) return;
    pendingEditable = editable;
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(() => {
      flushScheduled = false;
      const next = pendingEditable;
      pendingEditable = null;
      if (disposed || next === null) return;
      view.dispatch({
        effects: comp.reconfigure(next ? [] : EditorView.editable.of(false)),
      });
      if (
        !next &&
        (deps.claimFocus ?? true) &&
        document.activeElement !== view.contentDOM
      ) {
        // Keys must keep landing on contentDOM (tabindex makes it focusable —
        // measured, probe step 3v). view.focus() over raw contentDOM.focus():
        // it re-syncs the DOM selection and prevents scroll jumps (Codex).
        view.focus();
      }
    });
  };

  /** Single funnel for every mode transition: flips the editing host, then
   *  forwards to the caller (StatusBar feed). null = vim off. */
  const handleMode = (mode: null | VimModeName) => {
    if (mode === null) {
      setEditingHost(true);
      view.contentDOM.removeAttribute("tabindex");
    } else {
      setEditingHost(!shouldBlockImeInput(mode));
    }
    deps.onModeChange?.(mode);
  };

  return {
    apply(enabled: boolean): void {
      if (disposed) return;
      const token = ++revision;
      // Every (re)apply starts guard-free — a leftover guard would keep
      // cancelling IME input with vim off.
      detachGuard();
      if (!enabled) {
        handleMode(null);
        view.dispatch({ effects: compartment.reconfigure([]) });
        return;
      }
      load()
        .then((mod) => {
          if (disposed || token !== revision) return;
          view.dispatch({
            effects: compartment.reconfigure(Prec.highest(mod.vim())),
          });
          // Focusable BEFORE the first editable flip, so focus never drops.
          view.contentDOM.setAttribute("tabindex", "-1");
          // The vim ViewPlugin is created synchronously during the dispatch
          // above, so getCM is non-null unless plugin creation itself
          // failed. CodeMirror DEACTIVATES a throwing ViewPlugin instead of
          // propagating, so a null here IS the initialization-failure path:
          // running on silently would leave the pre-raised editing-host
          // barrier in place forever — a locked, key-eating island. Roll
          // everything back to plain editing and report.
          const cm = mod.getCM(view);
          if (!cm) {
            view.dispatch({ effects: compartment.reconfigure([]) });
            handleMode(null);
            deps.onError?.(new Error("vim plugin failed to initialize"));
            return;
          }
          guardDispose = attach(view, cm, handleMode);
          if (deps.boundaryHooks) {
            boundaryDispose = attachVimBoundary(view, cm, deps.boundaryHooks);
          }
        })
        .catch((err: unknown) => {
          // token check: a STALE load's rejection is not this apply's error —
          // without it a dropped generation would still ring onError (Codex).
          if (!disposed && token === revision) deps.onError?.(err);
        });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      revision++;
      detachGuard();
      handleMode(null);
    },
  };
}
