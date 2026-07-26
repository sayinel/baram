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
// it again: two characters per press.
//
// Fix shape (Codex rounds 5–6): the keydown must keep flowing — stopping it
// starves CodeMirror's InputState bookkeeping (compositionPendingKey never
// clears → Safari swallows the user's next Esc), and any key-based
// predicate breaks direct non-Latin layouts (é/ñ/κ overwrite). Instead,
// `cm.overWriteSelection` is wrapped per editor and skipped when the IME
// owns the text:
// - `view.compositionStarted` — CodeMirror's OWN composition state, NOT a
//   local compositionend listener: Safari sometimes never fires
//   compositionend for dead-key compositions and CM recovers via an
//   internal 20ms timer with no DOM event; a local flag would stick true
//   and permanently brick replace input (round-6 HIGH).
// - a just-seen matching insertText/insertCompositionText beforeinput
//   (probe-page mode where insertion precedes the keydown), NFC-normalized
//   on both sides and CONSUMED on match so one IME insertion suppresses at
//   most one manual overwrite.
// Direct-layout characters see neither signal and keep full overwrite
// semantics. Wrapping the METHOD also closes the adapter's keypress
// side-door (dead-key completions reach the same branch there).
//
// Known platform-scope limitation (Codex round 6, tracked): under the
// standards-order stream (first keydown BEFORE compositionstart — newer
// WebKit "correct composition event ordering", Chromium IMEs reporting
// printable keys), the FIRST composed character carries no IME evidence at
// wrapper time and would double again. Phase 0a targets the measured Tauri
// WKWebView surface (composition/beforeinput precede the trailing keydown).
// A staged/deferred classifier was deliberately rejected: delaying the
// first overwrite re-orders fast input — round 6's own warning. Re-check
// when the bundled WebKit updates its composition ordering.
//
// Interim semantics: R + IME text INSERTS composed syllables without
// consuming the character under the cursor (overwrite emulation is a
// follow-up pending device iteration).
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
  let lastImeText: null | string = null;
  let lastImeAt = 0;

  const onBeforeInput = (e: Event) => {
    const { data, inputType } = e as InputEvent;
    if (inputType === "insertText" || inputType === "insertCompositionText") {
      // Evidence trail for the overwrite wrapper (probe-page IME mode
      // delivers a cancelable insertText BEFORE the keydown). InputEvent
      // data has no normalization contract — compare in NFC (round 6).
      lastImeText = data == null ? null : data.normalize("NFC");
      lastImeAt = Date.now();
    }
    if (shouldBlockImeInput(mode) && BLOCKED_INPUT_TYPES.has(inputType)) {
      e.preventDefault();
    }
  };
  // Capture phase: cancel before CodeMirror's own handlers see the event.
  view.contentDOM.addEventListener("beforeinput", onBeforeInput, true);

  // Replace-mode dedupe: skip vim's manual overwrite when the IME owns the
  // text (see header). The keydown itself is never touched, so CodeMirror's
  // InputState bookkeeping stays intact.
  const origOverWrite = cm.overWriteSelection;
  cm.overWriteSelection = function (text: string) {
    if (mode !== "replace") {
      origOverWrite.call(cm, text);
      return;
    }
    const freshMatch =
      lastImeText !== null &&
      lastImeText === text.normalize("NFC") &&
      Date.now() - lastImeAt < 100;
    if (view.compositionStarted || freshMatch) {
      // Consume on match: one IME insertion suppresses at most one manual
      // overwrite (an immediate same-character direct key must still work).
      if (freshMatch) lastImeText = null;
      return;
    }
    origOverWrite.call(cm, text);
  };

  const onVimModeChange = (ev: { mode: string }) => {
    mode = ev.mode as VimModeName;
    // Stale evidence must not leak across mode transitions (round 6).
    lastImeText = null;
    onModeChange?.(mode);
  };
  cm.on("vim-mode-change", onVimModeChange);
  onModeChange?.(mode);

  return () => {
    cm.off("vim-mode-change", onVimModeChange);
    view.contentDOM.removeEventListener("beforeinput", onBeforeInput, true);
    cm.overWriteSelection = origOverWrite;
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
