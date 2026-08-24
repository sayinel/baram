// §298 Vim Phase 0a IME probe — shared types.
//
// Kept separate from verdicts.ts/event-recorder.ts so the pure judgment layer
// can be unit-tested against fixtures without pulling in DOM setup.

/** One named assertion inside a step verdict. */
export interface Check {
  detail: string;
  label: string;
  pass: boolean;
}

/** A single observed DOM event, normalized for judgment + JSON export. */
export interface RecordedEvent {
  /** beforeinput/input: whether the event could be canceled (decides the
   *  `insertCompositionText` non-cancelable question from the plan §2.2). */
  cancelable?: boolean;
  /** keydown: physical key ("KeyJ") — survives IME composition. */
  code?: string;
  /** composition events: the composing/committed string. */
  data?: null | string;
  defaultPrevented?: boolean;
  /** beforeinput/input: e.g. "insertCompositionText". */
  inputType?: string;
  /** keydown: true once composition is underway. */
  isComposing?: boolean;
  /** keydown: "Process" while an IME is consuming the key. */
  key?: string;
  keyCode?: number;
  /** Summary of a MutationObserver record (transient DOM changes). */
  mutation?: string;
  phase: "bubble" | "capture";
  seq: number;
  /** ms since the recorder was armed. */
  t: number;
  targetLabel: TargetLabel;
  type: string;
}

export interface SelectionSnapshot {
  anchor: number;
  head: number;
}

export type StepId =
  "0" | "1" | "2" | "2b" | "2v" | "3" | "3d" | "3v" | "4" | "5" | "6";

/** Everything observed for one step run, before judgment. */
export interface StepObservation {
  /** Description of `document.activeElement` after the step. Free-form on
   *  purpose — it can be any element ("button", "(none)", …), so typing it as
   *  TargetLabel would just be a lie enforced by a cast. */
  activeElementLabel: string;
  /** CodeMirror's `compositionStarted` at judge time — a stale `true` after
   *  the step settled means the editor thinks a composition is still open
   *  (the step-5 "stale state" question from the plan). */
  compositionStartedAfter?: boolean;
  /** Measured `contentDOM.getAttribute("contenteditable")` — the real value.
   *  CM 6.43.6 sets "false" rather than removing the attribute, so a harness
   *  expecting null would produce a false FAIL (plan §2.1). */
  contentEditableAttr: null | string;
  /** Did the cursor move? Stands in for "a vim motion actually ran". */
  cursorMoved: boolean;
  docAfter: string;
  docBefore: string;
  events: RecordedEvent[];
  hasFocus: boolean;
  /** CodeMirror's `readOnly` facet value, when the step records it. */
  readOnly?: boolean;
  selectionAfter: SelectionSnapshot;
  selectionBefore: SelectionSnapshot;
  /** vim mode reported by @replit/codemirror-vim, when available. */
  vimModeAfter?: null | string;
  vimModeBefore?: null | string;
}

export interface StepVerdict {
  checks: Check[];
  step: StepId;
  /** FAIL if any check failed. */
  verdict: "FAIL" | "PASS";
}

/** Which element an event was observed on. */
export type TargetLabel = "body" | "contentDOM" | "document" | "other";
