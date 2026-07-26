// §298 Phase 0a S2 — Korean-IME guard for vim normal/visual mode.
//
// Measured mechanism ("candidate C", IME spike 2026-07-26, Tauri/WKWebView):
// this WebKit emits ZERO composition events for the Korean 2-set IME and
// inserts text via cancelable `beforeinput` (insertText/insertReplacementText)
// BEFORE the keydown is dispatched. Keydown-phase defenses therefore cannot
// work in principle; canceling the beforeinput blocks the jamo insertion
// while the keydown still reaches vim through the normal CodeMirror path
// (the adapter's non-ASCII code fallback maps e.g. key="ㅓ"/code=KeyJ to `j`).
//
// Blocking set: normal + visual only. insert and replace ("R") need real text
// input. Lowercase "r" emits no mode change and stays normal — the raw
// insertion is cancelled and the following keydown drives vim's literal
// replacement, which is correct (Codex plan review).
//
// Static imports here are type-only for @replit/codemirror-vim — anything
// runtime would pull the vim chunk into the main bundle.

import type { EditorView } from "@codemirror/view";
import type { CodeMirror } from "@replit/codemirror-vim";

export type VimModeName = "insert" | "normal" | "replace" | "visual";

const BLOCKED_INPUT_TYPES = new Set([
  // Not used by the measured WKWebView path, and non-cancelable per spec
  // (preventDefault is a no-op there) — included for other-platform coverage.
  "insertCompositionText",
  "insertReplacementText",
  "insertText",
]);

/**
 * Attach the IME guard to a vim-enabled editor. Returns a disposer.
 *
 * `onModeChange` also fires once with the seeded initial mode — S3 uses it to
 * drive the StatusBar without attaching a second listener.
 */
export function attachVimImeGuard(
  view: EditorView,
  cm: CodeMirror,
  onModeChange?: (mode: VimModeName) => void,
): () => void {
  let blocking = shouldBlockImeInput(initialVimMode(cm));

  const onBeforeInput = (e: Event) => {
    const { inputType } = e as InputEvent;
    if (blocking && BLOCKED_INPUT_TYPES.has(inputType)) e.preventDefault();
  };
  // Capture phase: cancel before CodeMirror's own handlers see the event.
  view.contentDOM.addEventListener("beforeinput", onBeforeInput, true);

  const onVimModeChange = (ev: { mode: string }) => {
    const mode = ev.mode as VimModeName;
    blocking = shouldBlockImeInput(mode);
    onModeChange?.(mode);
  };
  cm.on("vim-mode-change", onVimModeChange);
  onModeChange?.(initialVimMode(cm));

  return () => {
    cm.off("vim-mode-change", onVimModeChange);
    view.contentDOM.removeEventListener("beforeinput", onBeforeInput, true);
  };
}

/**
 * Derive the current mode from vim state booleans — the published, reliable
 * surface. Needed because the FIRST "vim-mode-change" (normal) fires during
 * plugin creation, before any outside listener can attach (Codex plan
 * review): a listener alone would start with the blocker off in normal mode.
 */
export function initialVimMode(cm: CodeMirror): VimModeName {
  const state = (
    cm as unknown as {
      state?: {
        overwrite?: boolean;
        vim?: { insertMode?: boolean; visualMode?: boolean };
      };
    }
  ).state;
  if (state?.vim?.visualMode) return "visual";
  if (state?.vim?.insertMode) {
    // Replace mode (R) is insertMode + overwrite on the adapter surface —
    // without the overwrite check a seeded R editor would misreport
    // "insert" (Codex S2 gate finding).
    return state.overwrite ? "replace" : "insert";
  }
  return "normal";
}

export function shouldBlockImeInput(mode: VimModeName): boolean {
  return mode === "normal" || mode === "visual";
}
