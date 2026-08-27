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
  isIdleNormal,
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
  /** issue 477 — ATTEMPT plain INSERT on the island session for an
   *  editing-continuity entry. Queued acceptance, not delivery: the queued
   *  microtask drops on a generation change, and a readOnly island can
   *  refuse the entry — so the CALLER owns the intent memo and burns it
   *  only when a mode publish confirms "insert" (retrying on every earlier
   *  publish). Returns false when vim is not attached yet. "Ensure", not
   *  "send i": a stale visual/replace/pending session ends first (bounded
   *  Esc, same convergence as exitToNormal) because upstream maps
   *  lowercase i only in the bare-normal context. Throws report through
   *  onOperationError; a mere refusal is NOT an error — the publish-driven retry
   *  owns it, and the install-failure rollback must not fire for it. */
  ensureInsert(): boolean;
  /** issue 475 — end any insert/visual/pending vim session so the island
   *  sits in bare normal mode. Returns whether that state was reached;
   *  true when vim is not attached (nothing to normalize). Best-effort:
   *  a throw reports through onOperationError and returns false — the caller
   *  decides, it is never re-thrown. */
  exitToNormal(): boolean;
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
  /** INSTALL failures only (load rejection, plugin-init rollback) — the
   *  caller may respond destructively (roll back to plain editing). */
  onError?: (err: unknown) => void;
  /** S3: StatusBar mode feed. Receives null whenever vim turns off. */
  onModeChange?: (mode: null | VimModeName) => void;
  /** Best-effort OPERATION failures (ensureInsert / exitToNormal throws) —
   *  report-only. Routing these through onError fired the install rollback
   *  for a transient handleKey throw, stripping a working island's editing
   *  host (quality review M3). */
  onOperationError?: (err: unknown) => void;
  /** Phase 0b: a CM recreation (settings change) resets vim to normal —
   *  consumed ONCE after attach to re-enter the mode the user was in.
   *  Visual is not restorable (its range died with the old view). */
  restoreMode?: () => "insert" | "replace" | null;
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
  /** Live vim handles for exitToNormal. Set only on a successful install,
   *  cleared wherever the guards detach — so it obeys the same generation
   *  contract (re-apply, rollback, dispose) and can never outlive its CM. */
  let session: null | {
    cm: NonNullable<ReturnType<VimModule["getCM"]>>;
    mod: VimModule;
  } = null;

  const detachGuard = () => {
    guardDispose?.();
    guardDispose = null;
    boundaryDispose?.();
    boundaryDispose = null;
    session = null;
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
      // A queued host flip from the PREVIOUS generation must never fire
      // into this one — enable→disable→enable would otherwise let the
      // stale restore reopen the editing host mid-load.
      pendingEditable = null;
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
          // Anything failing from here on leaves a HALF-ENABLED plugin
          // (slot + tabindex already installed) — one rollback path
          // detaches partial hooks and restores plain editing.
          const rollbackInstall = (err: unknown) => {
            detachGuard();
            view.dispatch({ effects: compartment.reconfigure([]) });
            handleMode(null);
            deps.onError?.(err);
          };
          const cm = mod.getCM(view);
          if (!cm) {
            rollbackInstall(new Error("vim plugin failed to initialize"));
            return;
          }
          session = { cm, mod };
          try {
            guardDispose = attach(view, cm, handleMode);
            if (deps.boundaryHooks) {
              boundaryDispose = attachVimBoundary(view, cm, deps.boundaryHooks);
            }
            const restored = deps.restoreMode?.();
            if (restored) {
              // Deferred one microtask: the adapter REFUSES insert entry
              // while readOnly (installed dist :3048), and the loading
              // barrier's readOnly pin only lifts with the initial mode
              // publish's deferred editing-host flush queued just above.
              queueMicrotask(() => {
                if (disposed || token !== revision) return;
                mod.Vim.handleKey(
                  cm,
                  restored === "insert" ? "i" : "R",
                  "user",
                );
              });
            }
          } catch (err) {
            rollbackInstall(err);
          }
        })
        .catch((err: unknown) => {
          // token check: a STALE load's rejection is not this apply's error —
          // without it a dropped generation would still ring onError (Codex).
          // handleMode(null) also removes the caller-added tabindex and
          // reopens the host, so a failed load never leaves a dead island.
          if (!disposed && token === revision) {
            handleMode(null);
            deps.onError?.(err);
          }
        });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      revision++;
      detachGuard();
      handleMode(null);
    },
    /** issue 477 — deferred one microtask like the restoreMode consumer:
     *  the adapter refuses insert entry while the loading barrier's
     *  readOnly still holds, and that pin lifts with the deferred editable
     *  flush. Generation-guarded: a re-apply, rollback, or dispose between
     *  the request and the microtask drops it (`session` identity). Replace
     *  counts as NOT plain insert (insertMode + adapter overwrite) — it is
     *  ended and re-entered as ordinary insert. */
    ensureInsert(): boolean {
      const s = session;
      if (!s) return false;
      queueMicrotask(() => {
        if (disposed || session !== s) return;
        try {
          const st = (
            s.cm as unknown as {
              state?: { overwrite?: boolean; vim?: { insertMode?: boolean } };
            }
          ).state;
          if (st?.vim?.insertMode && !st.overwrite) return; // already editing
          for (let i = 0; i < 3 && !isIdleNormal(s.cm); i++) {
            s.mod.Vim.handleKey(s.cm, "<Esc>", "user");
          }
          s.mod.Vim.handleKey(s.cm, "i", "user");
          // No postcondition here: reaching insert publishes a mode change,
          // and THAT is the delivery confirmation the caller burns its memo
          // on. A refusal (readOnly window) simply leaves the memo armed.
        } catch (err) {
          deps.onOperationError?.(err);
        }
      });
      return true;
    },
    /** issue 475 — bounded because one Esc is NOT idempotent: after `<C-o>`
     *  the first Esc runs as the pending normal command, and its
     *  vim-command-done fires the armed one-shot listener that re-enters
     *  insert — only the SECOND Esc ends that insert. Upstream itself
     *  normalizes programmatically with this exact handleKey Esc idiom
     *  (status-button handler in the installed dist). */
    exitToNormal(): boolean {
      const s = session;
      if (!s) return true; // vim not attached — nothing to normalize
      try {
        for (let i = 0; i < 3 && !isIdleNormal(s.cm); i++) {
          s.mod.Vim.handleKey(s.cm, "<Esc>", "user");
        }
        return isIdleNormal(s.cm);
      } catch (err) {
        deps.onOperationError?.(err);
        return false;
      }
    },
  };
}
