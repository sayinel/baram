// §298 Vim Phase 1 WYSIWYG probe — pure judgment layer.
//
// Every function here is pure (no DOM) so it can be unit-tested against
// recorded fixtures.
//
// THE CENTRAL RULE, inherited from the Phase 0a probe: a step that asks "did
// we block X?" must ALSO require that the keystroke actually ARRIVED. The
// absence of a compositionstart is not evidence of blocking — it is equally
// consistent with the key never reaching the DOM, or the editor not being
// focused. Blessing that as PASS is testing a circuit breaker with the power
// unplugged.
//
// What the probe is deciding (design §3, P3):
//   - Does `handleDOMEvents.keydown` still fire while `view.editable` is
//     false? prosemirror-view runs custom handlers BEFORE the editable gate
//     (dist index.ts: `view.editable || !(event.type in editHandlers)`), but
//     "the source says so" is not "WKWebView does so".
//   - Does `view.dispatch` still mutate a non-editable view? If not, the
//     editable gate blocks IME *and* vim's own edits, and P3 is dead.

import type {
  Check,
  ProbeEvent,
  StepId,
  StepObservation,
  StepVerdict,
} from "./types";

/** The physical key the operator presses for the Latin motion step. */
export const MOTION_CODE = "KeyJ";
/** The physical key that produces "ㅁ" on a 2-beolsik Korean layout. */
export const HANGUL_CODE = "KeyA";

/**
 * Step 1 — the load-bearing question: in pseudo-normal (editable=false), does
 * `handleDOMEvents.keydown` receive the key, and does consuming it suppress
 * the default?
 */
export function judgeStep1(obs: StepObservation): StepVerdict {
  const hits = keydownsFor(obs, MOTION_CODE);
  return verdictOf("1", [
    {
      label: "editable is false",
      detail: `view.editable=${String(obs.editable)}`,
      pass: obs.editable === false,
    },
    {
      // Arrival first: everything below is meaningless without it.
      label: "keydown reached handleDOMEvents",
      detail: `${hits.length} keydown(s) for ${MOTION_CODE}`,
      pass: hits.length > 0,
    },
    {
      label: "the handler consumed it",
      detail:
        hits.map((h) => `consumed=${String(h.consumed)}`).join(", ") || "—",
      pass: hits.length > 0 && hits.every((h) => h.consumed === true),
    },
    {
      label: "no text was inserted",
      detail: docUnchanged(obs)
        ? "doc unchanged"
        : `doc changed: ${obs.docAfter}`,
      pass: docUnchanged(obs),
    },
  ]);
}

/**
 * Step 2 — the other half of P3: a non-editable view must still accept
 * `view.dispatch`. If this fails, vim could block typing but never edit, and
 * the whole editable-gate mechanism has to be replaced.
 */
export function judgeStep2(obs: StepObservation): StepVerdict {
  return verdictOf("2", [
    {
      label: "editable is false",
      detail: `view.editable=${String(obs.editable)}`,
      pass: obs.editable === false,
    },
    {
      label: "programmatic dispatch changed the document",
      detail: obs.changedByDispatch
        ? `doc now: ${obs.docAfter}`
        : "dispatch did NOT change the document — P3 is not viable",
      pass: obs.changedByDispatch === true,
    },
  ]);
}

/** Step 3 — focus must survive the switch, or no key ever arrives. */
export function judgeStep3(obs: StepObservation): StepVerdict {
  return verdictOf("3", [
    {
      label: "editable is false",
      detail: `view.editable=${String(obs.editable)}`,
      pass: obs.editable === false,
    },
    {
      label: "the view still reports focus",
      detail: `hasFocus=${String(obs.hasFocus)}, activeElement=${obs.activeElementLabel}`,
      pass: obs.hasFocus,
    },
  ]);
}

/**
 * Step 4 — Korean IME in pseudo-normal. This is the reason the editable gate
 * exists at all: WKWebView's composition path is not cancelable from
 * beforeinput, so the editing host has to disappear instead.
 */
export function judgeStep4(obs: StepObservation): StepVerdict {
  const hits = keydownsFor(obs, HANGUL_CODE);
  const compositions = eventsFrom(obs, "dom.compositionstart");
  return verdictOf("4", [
    {
      label: "editable is false",
      detail: `view.editable=${String(obs.editable)}`,
      pass: obs.editable === false,
    },
    {
      // Without this the two checks below would pass for a key that never
      // arrived — the classic false PASS this probe exists to avoid.
      label: "the Hangul keystroke actually arrived",
      detail: `${hits.length} keydown(s) for ${HANGUL_CODE}`,
      pass: hits.length > 0,
    },
    {
      label: "no composition started",
      detail: `${compositions.length} compositionstart event(s)`,
      pass: compositions.length === 0,
    },
    {
      label: "no text was inserted",
      detail: docUnchanged(obs)
        ? "doc unchanged"
        : `doc changed: ${obs.docAfter}`,
      pass: docUnchanged(obs),
    },
  ]);
}

/**
 * Step 5 — insert-mode Esc arrives through `handleKeyDown`, which is what
 * buys us PM's composition preprocessing (design §3). Pressing Esc mid
 * composition is where Phase 0a found its hardest bugs.
 */
export function judgeStep5(obs: StepObservation): StepVerdict {
  const escapes = eventsFrom(obs, "handleKeyDown").filter(
    (e) => e.key === "Escape",
  );
  const domEscapes = keydownsFor(obs, "Escape");
  return verdictOf("5", [
    {
      label: "editable is true (insert)",
      detail: `view.editable=${String(obs.editable)}`,
      pass: obs.editable === true,
    },
    {
      label: "Escape reached handleKeyDown",
      detail: `${escapes.length} handleKeyDown Escape(s)`,
      pass: escapes.length > 0,
    },
    {
      // The dual-entry design says insert Esc goes through handleKeyDown, NOT
      // handleDOMEvents — if both see it we would transition twice.
      label: "handleDOMEvents did not also consume it",
      detail: `${domEscapes.length} DOM-level Escape(s) consumed`,
      pass: domEscapes.every((e) => e.consumed !== true),
    },
  ]);
}

/**
 * Step 6 — the §5 clipboard contract. copy must survive in normal mode
 * (macOS Cmd+C on a non-editable view), while cut/paste/drop are ACTIVELY
 * consumed: the editable gate stops PM's built-in handlers, not the browser.
 */
export function judgeStep6(obs: StepObservation): StepVerdict {
  const copies = eventsFrom(obs, "handleDOMEvents.copy");
  const cuts = eventsFrom(obs, "handleDOMEvents.cut");
  const pastes = eventsFrom(obs, "handleDOMEvents.paste");
  const blocked = [...cuts, ...pastes];
  return verdictOf("6", [
    {
      label: "editable is false",
      detail: `view.editable=${String(obs.editable)}`,
      pass: obs.editable === false,
    },
    {
      label: "copy fired and was NOT consumed",
      detail: `${copies.length} copy event(s)`,
      pass: copies.length > 0 && copies.every((e) => e.consumed !== true),
    },
    {
      label: "cut/paste were consumed when they fired",
      detail: blocked.length
        ? blocked
            .map((e) => `${e.source}:consumed=${String(e.consumed)}`)
            .join(", ")
        : "none fired (operator may have skipped them)",
      pass: blocked.every((e) => e.consumed === true),
    },
    {
      label: "no text was inserted or removed",
      detail: docUnchanged(obs)
        ? "doc unchanged"
        : `doc changed: ${obs.docAfter}`,
      pass: docUnchanged(obs),
    },
  ]);
}

function docUnchanged(obs: StepObservation): boolean {
  return obs.docBefore === obs.docAfter;
}

function eventsFrom(obs: StepObservation, source: ProbeEvent["source"]) {
  return obs.events.filter((e) => e.source === source);
}

/** Keydowns the plugin's DOM-level handler saw for a given physical key. */
function keydownsFor(obs: StepObservation, code: string) {
  return eventsFrom(obs, "handleDOMEvents.keydown").filter(
    (e) => e.code === code,
  );
}

function verdictOf(step: StepId, checks: Check[]): StepVerdict {
  return {
    checks,
    step,
    verdict: checks.every((c) => c.pass) ? "PASS" : "FAIL",
  };
}

const JUDGES: Record<StepId, (obs: StepObservation) => StepVerdict> = {
  "1": judgeStep1,
  "2": judgeStep2,
  "3": judgeStep3,
  "4": judgeStep4,
  "5": judgeStep5,
  "6": judgeStep6,
};

export function judgeStep(step: StepId, obs: StepObservation): StepVerdict {
  return JUDGES[step](obs);
}

/**
 * Overall conclusion. P3 (the editable-gate mechanism) is only viable when
 * BOTH halves hold: keys still arrive (step 1) AND the view still accepts
 * programmatic edits (step 2). Steps 3–6 are integration quality on top.
 */
export function summarize(verdicts: StepVerdict[]): {
  detail: string;
  p3Viable: boolean;
} {
  const byStep = new Map(verdicts.map((v) => [v.step, v]));
  const keysArrive = byStep.get("1")?.verdict === "PASS";
  const canEdit = byStep.get("2")?.verdict === "PASS";
  if (!byStep.has("1") || !byStep.has("2")) {
    return { detail: "steps 1 and 2 must both run", p3Viable: false };
  }
  if (keysArrive && canEdit) {
    const rest = verdicts.filter(
      (v) => v.step !== "1" && v.step !== "2" && v.verdict === "FAIL",
    );
    return {
      detail: rest.length
        ? `P3 holds; integration gaps in step(s) ${rest.map((r) => r.step).join(", ")}`
        : "P3 holds and every observed integration check passed",
      p3Viable: true,
    };
  }
  return {
    detail: !keysArrive
      ? "keys do NOT reach handleDOMEvents while non-editable — P3 needs replacing"
      : "a non-editable view rejects programmatic edits — P3 needs replacing",
    p3Viable: false,
  };
}
