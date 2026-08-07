// §298 Vim Phase 0a IME probe — CodeMirror instance under test.
//
// Mirrors SourceCodeEditor.tsx's extension set so the measurement reflects the
// surface Phase 0a will actually ship on, and includes @replit/codemirror-vim
// because the probe must prove a vim motion really ran — not merely that IME
// stayed quiet.
//
// vim() goes at Prec.highest rather than relying on array order: CodeMirror
// resolves precedence before source order, and the library requires vim to sit
// ahead of other keymaps.

import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { bracketMatching, indentUnit } from "@codemirror/language";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";
import { getCM, Vim, vim } from "@replit/codemirror-vim";

export interface ProbeEditor {
  /** Drive vim into a known mode so each step starts from a defined state. */
  forceVimMode(mode: "insert" | "normal"): void;
  /** Current vim mode ("normal" | "insert" | "visual" | …), best effort. */
  getVimMode(): null | string;
  /** CodeMirror's readOnly facet — must stay false so vim can still edit. */
  isReadOnly(): boolean;
  setEditable(editable: boolean): void;
  /** Candidate B variant: keep contentDOM focusable without contenteditable. */
  setTabIndex(enabled: boolean): void;
  view: EditorView;
}

const editableComp = new Compartment();

export function createProbeEditor(
  parent: HTMLElement,
  fixture: string,
): ProbeEditor {
  const state = EditorState.create({
    doc: fixture,
    extensions: [
      // Must precede other keymaps.
      Prec.highest(vim()),
      keymap.of([...defaultKeymap, ...historyKeymap, ...closeBracketsKeymap]),
      history(),
      drawSelection(),
      bracketMatching(),
      closeBrackets(),
      markdown(),
      EditorView.lineWrapping,
      EditorState.tabSize.of(2),
      indentUnit.of("  "),
      editableComp.of(EditorView.editable.of(true)),
      EditorView.theme({
        "&": {
          border: "1px solid var(--color-border-default)",
          height: "160px",
        },
        ".cm-content": {
          fontFamily: "var(--font-family-mono)",
          padding: "8px",
        },
      }),
    ],
  });

  const view = new EditorView({ parent, state });

  return {
    view,
    forceVimMode(mode: "insert" | "normal"): void {
      const cm = getCM(view);
      if (!cm) return;
      // Always land in normal first so "insert" is reached deterministically.
      Vim.handleKey(cm, "<Esc>", "probe");
      if (mode === "insert") Vim.handleKey(cm, "i", "probe");
    },
    getVimMode(): null | string {
      try {
        const cm = getCM(view);
        // The published vimState surface exposes booleans (insertMode,
        // visualMode) — not a mode string. Deriving from the booleans is the
        // reliable read; a `.mode` string is not guaranteed to exist.
        const vimState = (
          cm as null | {
            state?: { vim?: { insertMode?: boolean; visualMode?: boolean } };
          }
        )?.state?.vim;
        if (!vimState) return null;
        if (vimState.visualMode) return "visual";
        if (vimState.insertMode) return "insert";
        return "normal";
      } catch {
        return null;
      }
    },
    isReadOnly(): boolean {
      return view.state.readOnly;
    },
    setEditable(editable: boolean): void {
      view.dispatch({
        effects: editableComp.reconfigure(EditorView.editable.of(editable)),
      });
    },
    setTabIndex(enabled: boolean): void {
      if (enabled) view.contentDOM.setAttribute("tabindex", "-1");
      else view.contentDOM.removeAttribute("tabindex");
    },
  };
}

/**
 * Candidate C (raw-log discovery, 2026-07-26 run): on this WKWebView the
 * Korean IME inserts text via `beforeinput` with inputType `insertText` /
 * `insertReplacementText` — BEFORE the keydown is dispatched, and with NO
 * composition events at all. Both inputTypes were measured `cancelable: true`.
 * So canceling those beforeinput events in normal mode should block the jamo
 * insertion while the subsequent keydown still reaches vim through the normal
 * CodeMirror path — no editable flip, no tabindex, no focus loss.
 *
 * `insertCompositionText` is included for other-platform completeness even
 * though the spec marks it non-cancelable (preventDefault is then a no-op).
 *
 * Returns a disposer.
 */
export function installBeforeinputBlocker(editor: ProbeEditor): () => void {
  const contentDOM = editor.view.contentDOM;
  const BLOCKED = new Set([
    "insertCompositionText",
    "insertReplacementText",
    "insertText",
  ]);
  const handler = (e: InputEvent) => {
    if (BLOCKED.has(e.inputType)) e.preventDefault();
  };
  contentDOM.addEventListener("beforeinput", handler as EventListener, true);
  return () =>
    contentDOM.removeEventListener(
      "beforeinput",
      handler as EventListener,
      true,
    );
}

/**
 * Candidate A variant: intercept in the CAPTURE phase, cancel the key, and
 * dispatch to vim explicitly.
 *
 * The explicit dispatch is mandatory, not a convenience. CodeMirror's
 * `runHandlers` breaks out of its handler loop when `event.defaultPrevented`
 * is already true, and `eventBelongsToEditor` returns false for a
 * default-prevented event. So a bare capture-phase `preventDefault()` would
 * silently disable the vim keymap — the probe would report "no composition,
 * but no motion either" and that FAIL would be an artifact of the harness
 * rather than a fact about the platform.
 *
 * Returns a disposer.
 */
export function installCaptureInterceptor(
  editor: ProbeEditor,
  codes: string[],
): () => void {
  const owned = new Set(codes);
  const contentDOM = editor.view.contentDOM;
  const handler = (e: KeyboardEvent) => {
    if (!owned.has(e.code)) return;
    e.preventDefault();
    const cm = getCM(editor.view);
    if (cm) Vim.handleKey(cm, keyNameFor(e.code), "probe-capture");
  };
  contentDOM.addEventListener("keydown", handler, true);
  return () => contentDOM.removeEventListener("keydown", handler, true);
}

/**
 * Candidate B production shape (research §4.3): editable=false drops focus,
 * so keys land on `document` — production would capture there and dispatch to
 * vim explicitly. Without this step the harness cannot tell "candidate B is
 * impossible" apart from "the harness never forwarded the key".
 *
 * Returns a disposer.
 */
export function installDocumentDispatcher(
  editor: ProbeEditor,
  codes: string[],
): () => void {
  const owned = new Set(codes);
  const handler = (e: KeyboardEvent) => {
    if (!owned.has(e.code)) return;
    e.preventDefault();
    const cm = getCM(editor.view);
    if (cm) Vim.handleKey(cm, keyNameFor(e.code), "probe-doc");
  };
  document.addEventListener("keydown", handler, true);
  return () => document.removeEventListener("keydown", handler, true);
}

/**
 * Flip `editable` to false synchronously when Escape lands, in the BUBBLE
 * phase so CodeMirror's own handlers run first.
 *
 * NOTE (verified against @codemirror/view ignoreDuringComposition): while a
 * composition has pending changes, CodeMirror DROPS key events entirely, so
 * vim will NOT see this Escape and will NOT leave insert mode. That is not a
 * harness bug — it is part of what step 5 measures: what actually happens to
 * the composed text and the editor state when editable flips mid-composition.
 * Flipping later (e.g. on a button click) would not exercise the race at all.
 */
export function installEscapeFlip(
  editor: ProbeEditor,
  onEscape: () => void,
): () => void {
  const contentDOM = editor.view.contentDOM;
  const handler = (e: KeyboardEvent) => {
    if (e.code === "Escape") onEscape();
  };
  contentDOM.addEventListener("keydown", handler, false);
  return () => contentDOM.removeEventListener("keydown", handler, false);
}

/**
 * Map a KeyboardEvent.code to the key name vim's handleKey expects.
 *
 * Deliberately minimal: the probe only ever dispatches KeyJ and Escape. The
 * real adapter (vimKeyFromEvent) also handles modifiers, digits, punctuation
 * and langmap — production code must go through that path, not this one.
 */
function keyNameFor(code: string): string {
  if (code.startsWith("Key")) return code.slice(3).toLowerCase();
  if (code === "Escape") return "<Esc>";
  return code;
}
