// §298 Vim Phase 1 probe — judgment-layer tests.
//
// These pin the rule the Phase 0a probe learned the hard way: "nothing
// happened" is only evidence of blocking when the keystroke is also proven to
// have ARRIVED. A judge that passes on an empty event list is a circuit
// breaker tested with the power unplugged.

import type { ProbeEvent, StepObservation } from "../types";

import { describe, expect, it } from "vitest";

import {
  HANGUL_CODE,
  judgeStep1,
  judgeStep2,
  judgeStep4,
  judgeStep5,
  judgeStep6,
  MOTION_CODE,
  summarize,
} from "../verdicts";

function ev(
  over: Partial<ProbeEvent> & Pick<ProbeEvent, "source">,
): ProbeEvent {
  return { mode: "normal", seq: 0, t: 0, ...over };
}

function obs(over: Partial<StepObservation> = {}): StepObservation {
  return {
    activeElementLabel: "view.dom",
    docAfter: "probe target",
    docBefore: "probe target",
    editable: false,
    events: [],
    hasFocus: true,
    mode: "normal",
    ...over,
  };
}

describe("step 1 — keydown arrival while non-editable", () => {
  it("passes when the key arrived and was consumed with no text inserted", () => {
    const v = judgeStep1(
      obs({
        events: [
          ev({
            code: MOTION_CODE,
            consumed: true,
            source: "handleDOMEvents.keydown",
          }),
        ],
      }),
    );
    expect(v.verdict).toBe("PASS");
  });

  it("FAILS when no keydown was observed, even though nothing was inserted", () => {
    // The tempting false PASS: doc unchanged, editable false — but the key
    // never reached the handler, so this run proves nothing.
    const v = judgeStep1(obs({ events: [] }));
    expect(v.verdict).toBe("FAIL");
    expect(v.checks.find((c) => c.label.includes("reached"))?.pass).toBe(false);
  });

  it("FAILS when the key arrived but text still landed in the document", () => {
    const v = judgeStep1(
      obs({
        docAfter: "probe targetj",
        events: [
          ev({
            code: MOTION_CODE,
            consumed: true,
            source: "handleDOMEvents.keydown",
          }),
        ],
      }),
    );
    expect(v.verdict).toBe("FAIL");
  });
});

describe("step 2 — programmatic edit while non-editable", () => {
  it("passes only when dispatch actually changed the document", () => {
    expect(judgeStep2(obs({ changedByDispatch: true })).verdict).toBe("PASS");
    expect(judgeStep2(obs({ changedByDispatch: false })).verdict).toBe("FAIL");
    expect(judgeStep2(obs()).verdict).toBe("FAIL"); // never measured
  });
});

describe("step 4 — Korean IME blocked", () => {
  it("passes when the Hangul key arrived and no composition started", () => {
    const v = judgeStep4(
      obs({
        events: [
          ev({
            code: HANGUL_CODE,
            consumed: true,
            source: "handleDOMEvents.keydown",
          }),
        ],
      }),
    );
    expect(v.verdict).toBe("PASS");
  });

  it("FAILS on an empty recording — absent composition is not proof", () => {
    expect(judgeStep4(obs({ events: [] })).verdict).toBe("FAIL");
  });

  it("FAILS when a composition did start", () => {
    const v = judgeStep4(
      obs({
        events: [
          ev({ code: HANGUL_CODE, source: "handleDOMEvents.keydown" }),
          ev({ data: "ㅁ", source: "dom.compositionstart" }),
        ],
      }),
    );
    expect(v.verdict).toBe("FAIL");
  });
});

describe("step 5 — insert Escape routes through handleKeyDown", () => {
  it("passes when handleKeyDown saw Escape and the DOM handler did not eat it", () => {
    const v = judgeStep5(
      obs({
        editable: true,
        events: [
          ev({ key: "Escape", mode: "insert", source: "handleKeyDown" }),
        ],
        mode: "insert",
      }),
    );
    expect(v.verdict).toBe("PASS");
  });

  it("FAILS when the DOM-level handler consumed Escape too (double transition)", () => {
    const v = judgeStep5(
      obs({
        editable: true,
        events: [
          ev({ key: "Escape", mode: "insert", source: "handleKeyDown" }),
          ev({
            code: "Escape",
            consumed: true,
            mode: "insert",
            source: "handleDOMEvents.keydown",
          }),
        ],
        mode: "insert",
      }),
    );
    expect(v.verdict).toBe("FAIL");
  });
});

describe("step 6 — clipboard contract", () => {
  it("passes when copy passed through and cut/paste were consumed", () => {
    const v = judgeStep6(
      obs({
        events: [
          ev({ consumed: false, source: "handleDOMEvents.copy" }),
          ev({ consumed: true, source: "handleDOMEvents.cut" }),
          ev({ consumed: true, source: "handleDOMEvents.paste" }),
        ],
      }),
    );
    expect(v.verdict).toBe("PASS");
  });

  it("FAILS when copy never fired — the operator's Cmd+C did not reach us", () => {
    const v = judgeStep6(
      obs({
        events: [ev({ consumed: true, source: "handleDOMEvents.paste" })],
      }),
    );
    expect(v.verdict).toBe("FAIL");
  });

  it("FAILS when paste was allowed through", () => {
    const v = judgeStep6(
      obs({
        events: [
          ev({ consumed: false, source: "handleDOMEvents.copy" }),
          ev({ consumed: false, source: "handleDOMEvents.paste" }),
        ],
      }),
    );
    expect(v.verdict).toBe("FAIL");
  });
});

describe("summarize — P3 viability", () => {
  const pass = (step: "1" | "2") => ({
    checks: [],
    step,
    verdict: "PASS" as const,
  });
  const fail = (step: "1" | "2") => ({
    checks: [],
    step,
    verdict: "FAIL" as const,
  });

  it("needs both halves before declaring the mechanism viable", () => {
    expect(summarize([pass("1")]).p3Viable).toBe(false);
    expect(summarize([pass("1"), fail("2")]).p3Viable).toBe(false);
    expect(summarize([fail("1"), pass("2")]).p3Viable).toBe(false);
    expect(summarize([pass("1"), pass("2")]).p3Viable).toBe(true);
  });

  it("reports which half broke", () => {
    expect(summarize([fail("1"), pass("2")]).detail).toContain(
      "do NOT reach handleDOMEvents",
    );
    expect(summarize([pass("1"), fail("2")]).detail).toContain(
      "rejects programmatic edits",
    );
  });

  it("still calls P3 viable when only later integration steps failed", () => {
    const s = summarize([
      pass("1"),
      pass("2"),
      { checks: [], step: "4", verdict: "FAIL" },
    ]);
    expect(s.p3Viable).toBe(true);
    expect(s.detail).toContain("integration gaps");
  });
});
