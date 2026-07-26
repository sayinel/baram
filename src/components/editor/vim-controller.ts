// §298 Phase 0a S2 — vim lifecycle controller for SourceCodeEditor.
//
// Extracted from the component so the enable/disable/race/dispose contract is
// unit-testable with fakes (Codex S2 gate: a guard-level disposer test is not
// evidence that the CALLER actually calls it). The component keeps only:
// create controller → apply(setting) → subscribe → dispose.

import type { Compartment } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import { Prec } from "@codemirror/state";

import { attachVimImeGuard, type VimModeName } from "./vim-ime-guard";
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

  const detachGuard = () => {
    guardDispose?.();
    guardDispose = null;
  };

  return {
    apply(enabled: boolean): void {
      if (disposed) return;
      const token = ++revision;
      // Every (re)apply starts guard-free — a leftover guard would keep
      // cancelling IME input with vim off.
      detachGuard();
      if (!enabled) {
        deps.onModeChange?.(null);
        view.dispatch({ effects: compartment.reconfigure([]) });
        return;
      }
      load()
        .then((mod) => {
          if (disposed || token !== revision) return;
          view.dispatch({
            effects: compartment.reconfigure(Prec.highest(mod.vim())),
          });
          // The vim ViewPlugin is created synchronously during the dispatch
          // above, so getCM is non-null unless plugin creation itself failed —
          // in that unlikely case we simply run without the IME guard.
          const cm = mod.getCM(view);
          if (cm) guardDispose = attach(view, cm, deps.onModeChange);
        })
        .catch((err: unknown) => {
          if (!disposed) deps.onError?.(err);
        });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      revision++;
      detachGuard();
      deps.onModeChange?.(null);
    },
  };
}
