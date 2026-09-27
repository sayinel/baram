// §385 The host-drawn prompt a plugin asked for (spec 0061 §8) — one at a time, app-wide.
//
// Shaped like show-symbol-picker.tsx: an imperative launcher that mounts its own React root,
// settles once, and hands focus back on EVERY exit. Two differences carry the spec:
//  - it checks that nothing covers the input BEFORE taking focus (D9): the danger is an input
//    nobody can see receiving keystrokes, so that is what gets measured;
//  - it registers with the gate (`markPromptOpen`), which is how the teardown sweep closes it
//    and how input inside it is told apart from input elsewhere.
// It lives in components/plugins, not components/command: the body-mounted popup scan in
// editor-popup-layering.test.ts walks the latter and requires `--z-editor-popup` (plan 0109 P2).
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import type { OpenPrompt } from "../../plugins/prompt-gate";
import type { PromptSpec } from "./PluginPrompt";

import {
  editorSurfaceBlocked,
  getEditorInstance,
} from "../../plugins/plugin-host-registry";
import { markPromptClosed, markPromptOpen } from "../../plugins/prompt-gate";
import { useUIStore } from "../../stores/ui/ui";
import { focusEditorView } from "../../utils/editor/focus-editor-view";
import { restoreFocus } from "../../utils/restore-focus";
import { PluginPrompt } from "./PluginPrompt";

/** Another surface covers where the prompt's input would be (spec 0061 D9). */
export class PromptOccludedError extends Error {
  constructor() {
    super(
      "prompt refused: another window covers where the prompt would appear",
    );
    this.name = "PromptOccludedError";
  }
}

export function showPluginPrompt(
  pluginId: string,
  source: string,
  spec: PromptSpec,
): Promise<string | undefined> {
  const returnFocusTo = document.activeElement;
  const overlay = document.createElement("div");
  overlay.className = "plugin-prompt-overlay";
  document.body.appendChild(overlay);
  let mountError: unknown = undefined;
  const root = createRoot(overlay, {
    onUncaughtError: (error) => {
      mountError = error;
    },
  });
  const entry: OpenPrompt = { close: () => {}, pluginId, root: overlay };
  let settled = false;
  let stopWatchingPalettes = (): void => {};
  let resolveAnswer: (value: string | undefined) => void = () => {};
  const answer = new Promise<string | undefined>((resolve) => {
    resolveAnswer = resolve;
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
    dismantle();
    returnFocus(returnFocusTo);
    resolveAnswer(value);
  };
  entry.close = () => settle(undefined);

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
    if (event.target !== overlay) return;
    event.preventDefault();
    settle(undefined);
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
