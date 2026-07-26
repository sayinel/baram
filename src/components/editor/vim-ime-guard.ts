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
// Replace-mode double input (real-device smoke, 2026-07-27): the adapter's
// overwrite branch manually inserts `e.key` on keydown whenever key.length
// is 1 — and macOS WKWebView reports the REAL jamo on Korean keydowns
// (key="ㅇ"), so vim inserts it AND the (non-cancelable) composition commits
// it again: two characters per press. Fix: in replace mode, non-ASCII
// printable keydowns are stopped in the capture phase on view.dom, before
// vim's handler — the composition alone owns the key. Interim semantics:
// R + Korean INSERTS composed syllables without consuming the character
// under the cursor (overwrite emulation is a follow-up pending device
// iteration); English R overwrite is untouched.
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
  let mode = initialVimMode(cm);

  const onBeforeInput = (e: Event) => {
    const { inputType } = e as InputEvent;
    if (shouldBlockImeInput(mode) && BLOCKED_INPUT_TYPES.has(inputType)) {
      e.preventDefault();
    }
  };
  // Capture phase: cancel before CodeMirror's own handlers see the event.
  view.contentDOM.addEventListener("beforeinput", onBeforeInput, true);

  const onKeyDown = (e: KeyboardEvent) => {
    if (mode !== "replace") return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Non-ASCII printable key = IME-bound. Stop it before vim's overwrite
    // branch double-inserts (see header). Esc/Enter/Backspace have
    // multi-char key names and pass through untouched.
    if (e.key.length !== 1 || e.key.charCodeAt(0) < 128) return;
    e.stopPropagation();
  };
  // view.dom capture: fires while descending toward contentDOM, i.e. before
  // ANY contentDOM listener (vim's handler is registered at the target,
  // where capture flags no longer order anything).
  view.dom.addEventListener("keydown", onKeyDown, true);

  const onVimModeChange = (ev: { mode: string }) => {
    mode = ev.mode as VimModeName;
    onModeChange?.(mode);
  };
  cm.on("vim-mode-change", onVimModeChange);
  onModeChange?.(mode);

  return () => {
    cm.off("vim-mode-change", onVimModeChange);
    view.contentDOM.removeEventListener("beforeinput", onBeforeInput, true);
    view.dom.removeEventListener("keydown", onKeyDown, true);
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
