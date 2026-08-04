// §298 Vim Phase 1 WYSIWYG probe — shared types.
//
// Split from verdicts.ts so the judgment layer stays pure and unit-testable
// against fixtures, exactly like the Phase 0a IME probe.

/** One named assertion inside a step verdict. */
export interface Check {
  detail: string;
  label: string;
  pass: boolean;
}

/** One observation from a probe handler, normalized for judgment + export. */
export interface ProbeEvent {
  /** Physical key ("KeyJ") — survives IME composition, unlike `key`. */
  code?: string;
  /** True when the handler returned true / called preventDefault. */
  consumed?: boolean;
  data?: null | string;
  defaultPrevented?: boolean;
  isComposing?: boolean;
  key?: string;
  /** Mode at the moment the event was seen. */
  mode: ProbeMode;
  seq: number;
  source: ProbeSource;
  /** ms since the recorder was armed. */
  t: number;
}

/** Pseudo-vim mode. The probe implements the MECHANISM (design P3), not vim. */
export type ProbeMode = "insert" | "normal";

/** Which handler slot observed an event. The whole point of the probe is to
 *  learn WHICH of these fire while the PM view is non-editable. */
export type ProbeSource =
  | "dom.compositionend"
  | "dom.compositionstart"
  | "handleDOMEvents.copy"
  | "handleDOMEvents.cut"
  | "handleDOMEvents.drop"
  | "handleDOMEvents.keydown"
  | "handleDOMEvents.paste"
  | "handleKeyDown"
  | "handleTextInput";

export type StepId = "1" | "2" | "3" | "4" | "5" | "6";

/** Everything captured for one step, before judgment. */
export interface StepObservation {
  /** Description of `document.activeElement` after the step. Free-form: it
   *  can legitimately be any element, so a narrow union would be a lie. */
  activeElementLabel: string;
  /** `view.editable` as PM computed it — the mechanism actually under test. */
  changedByDispatch?: boolean;
  /** Text content before/after, to prove the doc did (not) change. */
  clipboardText?: null | string;
  docAfter: string;
  docBefore: string;
  editable: boolean;
  events: ProbeEvent[];
  /** Whether `view.hasFocus()` held after the mode switch. */
  hasFocus: boolean;
  mode: ProbeMode;
}

export interface StepVerdict {
  checks: Check[];
  step: StepId;
  /** FAIL if any check failed. */
  verdict: "FAIL" | "PASS";
}
