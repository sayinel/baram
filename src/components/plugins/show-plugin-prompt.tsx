// §385 The host-drawn prompt a plugin asked for (spec 0061 §8) — one at a time, app-wide.
//
// Shaped like show-symbol-picker.tsx: an imperative launcher that mounts its own React root,
// settles once, and hands focus back on every exit AFTER it took focus (a refusal — occluded,
// or a render that failed before mount — never took it, so there is nothing to hand back).
// Two differences carry the spec:
//  - it checks that nothing covers the input BEFORE taking focus (D9): the danger is an input
//    nobody can see receiving keystrokes, so that is what gets measured;
//  - it registers with the gate (`markPromptOpen`), which is how the teardown sweep closes it
//    and how input inside it is told apart from input elsewhere.
// It lives in components/plugins, not components/command: the body-mounted popup scan in
// editor-popup-layering.test.ts walks the latter and requires `--z-editor-popup` (plan 0109 P2).
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import type { PromptSpec } from "./PluginPrompt";

import {
  editorSurfaceBlocked,
  getEditorInstance,
} from "../../plugins/plugin-host-registry";
import {
  markPromptClosed,
  markPromptOpen,
  type OpenPrompt,
  PromptOccludedError,
} from "../../plugins/prompt-gate";
import { useUIStore } from "../../stores/ui/ui";
import { deepActiveElement } from "../../utils/deep-active-element";
import { focusEditorView } from "../../utils/editor/focus-editor-view";
import { logger } from "../../utils/logger";
import { restoreFocus } from "../../utils/restore-focus";
import { PluginPrompt } from "./PluginPrompt";

export function showPluginPrompt(
  pluginId: string,
  source: string,
  spec: PromptSpec,
): Promise<string | undefined> {
  // Through any open shadow root (§4.1): a trusted plugin's own panel can hold focus there, and
  // `document.activeElement` alone would report the shadow HOST, which is not what to give
  // focus back to.
  const returnFocusTo = deepActiveElement();
  const overlay = document.createElement("div");
  overlay.className = "plugin-prompt-overlay";
  document.body.appendChild(overlay);
  let mounted = false;
  let mountError: unknown = undefined;
  const root = createRoot(overlay, {
    onUncaughtError: (error) => {
      if (!mounted) {
        // Read once, right after `flushSync` below — the ordinary path.
        mountError = error;
        return;
      }
      failLate(error);
    },
  });
  const entry: OpenPrompt = { close: () => {}, pluginId, root: overlay };
  let settled = false;
  let stopWatchingPalettes = (): void => {};
  let resolveAnswer: (value: string | undefined) => void = () => {};
  let rejectAnswer: (error: unknown) => void = () => {};
  const answer = new Promise<string | undefined>((resolve, reject) => {
    resolveAnswer = resolve;
    rejectAnswer = reject;
  });

  const dismantle = (): void => {
    settled = true;
    markPromptClosed(entry);
    stopWatchingPalettes();
    root.unmount();
    overlay.remove();
  };
  const settle = (value: string | undefined): void => {
    if (settled) return;
    try {
      dismantle();
      returnFocus(returnFocusTo);
    } finally {
      // Outside the `try`'s protected work, so a throwing teardown still resolves the promise
      // rather than leaving a caller awaiting forever.
      resolveAnswer(value);
    }
  };
  entry.close = () => settle(undefined);

  /**
   * A render error AFTER the prompt is live (spec 0061 D5 — free the slot, not just at mount).
   * By the time `onUncaughtError` calls this, React has already torn down this root's tree
   * itself (there is no error boundary above it to stop that), and we are running INSIDE
   * React's own commit for that teardown — so `root.unmount()` here would be both redundant
   * (there is nothing left to unmount) and an unsafe re-entrant call into the reconciler while
   * it is still unwinding. Everything else below is ordinary bookkeeping, not React, so it is
   * safe to run right here rather than deferred: a `setTimeout`/microtask would leave the slot
   * looking open to a second prompt from the very frame that is failing.
   */
  const failLate = (error: unknown): void => {
    logger.error(
      "[PluginPrompt] render failed after the prompt was live",
      error,
    );
    if (settled) return;
    settled = true;
    try {
      markPromptClosed(entry);
      stopWatchingPalettes();
      overlay.remove();
      returnFocus(returnFocusTo);
    } finally {
      // Outside the `try`'s protected work, so a throwing teardown still rejects the promise
      // rather than leaving a caller awaiting forever — mirrors `settle` above.
      rejectAnswer(error instanceof Error ? error : new Error(String(error)));
    }
  };

  markPromptOpen(entry);
  try {
    // Synchronous, so the occlusion check below has a laid-out input to measure.
    flushSync(() => {
      root.render(
        <PluginPrompt
          onCancel={() => settle(undefined)}
          onSubmit={settle}
          source={source}
          spec={spec}
        />,
      );
    });
  } catch (err) {
    dismantle();
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
  if (mountError !== undefined) {
    dismantle();
    return Promise.reject(
      mountError instanceof Error ? mountError : new Error(String(mountError)),
    );
  }
  const input = overlay.querySelector<HTMLInputElement>(".plugin-prompt-input");
  if (!input || !isUnobstructed(input, overlay)) {
    dismantle();
    return Promise.reject(new PromptOccludedError());
  }
  input.focus({ preventScroll: true });
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) {
      // The true backdrop: outside the dialog entirely.
      event.preventDefault();
      settle(undefined);
      return;
    }
    if (event.target !== input) {
      // Anywhere else inside the dialog — header, empty-state text, list padding; rows already
      // do this themselves — so a click that lands on none of the prompt's own controls does
      // not drop focus to <body> (spec 0061 §8).
      event.preventDefault();
    }
  });
  // An app palette opening is a cancel (spec 0061 §5.5).
  stopWatchingPalettes = useUIStore.subscribe((state, prev) => {
    if (
      (state.commandPaletteOpen && !prev.commandPaletteOpen) ||
      (state.quickSwitcherOpen && !prev.quickSwitcherOpen)
    ) {
      settle(undefined);
    }
  });
  mounted = true;
  return answer;
}

/**
 * Whether the input's centre is the prompt's own, i.e. nothing is painted over it (spec 0061
 * D9). An input with no box — nothing laid out — counts as covered: refusal, not a crash.
 * Blind to a `pointer-events: none` cover, which `elementFromPoint` skips.
 */
function isUnobstructed(input: HTMLElement, root: HTMLElement): boolean {
  const box = input.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return false;
  const hit = document.elementFromPoint(
    box.left + box.width / 2,
    box.top + box.height / 2,
  );
  return hit !== null && root.contains(hit);
}

/**
 * Hand focus back (spec 0061 §8): to what had it, or — when that was <body> or has been removed
 * (the palette's input, a sandboxed request arriving after the palette closed) — to the editor,
 * but only when the Tiptap document really is the surface in front of the user.
 */
function returnFocus(target: Element | null): void {
  if (
    target instanceof HTMLElement &&
    target !== document.body &&
    target.isConnected
  ) {
    restoreFocus(target);
    return;
  }
  if (editorSurfaceBlocked() !== null) return;
  const editor = getEditorInstance();
  if (editor) focusEditorView(editor.view);
}
