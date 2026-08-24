// §298 Vim Phase 0a IME probe — judgment layer tests.
//
// These do NOT test platform IME behavior (impossible without a real IME and a
// real keypress). They pin the judgment logic, whose v1 version contained a
// false-PASS bug: it accepted "no compositionstart" as proof that composition
// was blocked, even when the keystroke never arrived at all.

import type {
  RecordedEvent,
  StepId,
  StepObservation,
  StepVerdict,
} from "../types";

import { describe, expect, it } from "vitest";

import { concludeMechanism, judgeStep, MOTION_CODE } from "../verdicts";

function keydown(overrides: Partial<RecordedEvent> = {}): RecordedEvent {
  return {
    code: MOTION_CODE,
    isComposing: false,
    key: "j",
    phase: "bubble",
    seq: 0,
    t: 1,
    targetLabel: "contentDOM",
    type: "keydown",
    ...overrides,
  };
}

function observation(
  overrides: Partial<StepObservation> = {},
): StepObservation {
  return {
    activeElementLabel: "contentDOM",
    compositionStartedAfter: false,
    contentEditableAttr: "true",
    cursorMoved: true,
    docAfter: "line one",
    docBefore: "line one",
    events: [keydown()],
    hasFocus: true,
    readOnly: false,
    selectionAfter: { anchor: 9, head: 9 },
    selectionBefore: { anchor: 0, head: 0 },
    vimModeAfter: "normal",
    vimModeBefore: "normal",
    ...overrides,
  };
}

describe("judgeStep — control group (step 0)", () => {
  it("FAILs when the doc changed even though the cursor moved", () => {
    // If vim failed to initialize, `j` self-inserts: doc changes AND cursor
    // moves. cursorMoved alone would misread that as PASS (Codex finding).
    const v = judgeStep(
      "0",
      observation({ docAfter: "jline one", cursorMoved: true }),
    );
    expect(v.verdict).toBe("FAIL");
  });

  it("PASSes the clean motion chain", () => {
    expect(judgeStep("0", observation()).verdict).toBe("PASS");
  });
});

describe("judgeStep — candidate A (step 2)", () => {
  it("PASSes the full end-to-end chain", () => {
    expect(judgeStep("2", observation()).verdict).toBe("PASS");
  });

  it("FAILs when the keystroke never arrived, even though no composition started", () => {
    // THE REGRESSION THIS FILE EXISTS FOR. An empty event log means the OS IME
    // swallowed the key (or focus was elsewhere) — absence of compositionstart
    // is not evidence the block worked.
    const v = judgeStep("2", observation({ cursorMoved: false, events: [] }));
    expect(v.verdict).toBe("FAIL");
    expect(
      v.checks.find((c) => c.label.includes("keydown이 DOM에 도달"))?.pass,
    ).toBe(false);
  });

  it("FAILs when composition started", () => {
    const v = judgeStep(
      "2",
      observation({
        events: [
          keydown({ key: "Process" }),
          { ...keydown(), data: "ㅓ", seq: 1, type: "compositionstart" },
        ],
      }),
    );
    expect(v.verdict).toBe("FAIL");
  });

  it("FAILs when a transient mutation occurred even if the final doc matches", () => {
    const v = judgeStep(
      "2",
      observation({
        events: [
          keydown(),
          {
            ...keydown(),
            mutation: 'characterData: "line one" → "ㅓline one"',
            seq: 1,
            type: "mutation",
          },
        ],
      }),
    );
    expect(v.verdict).toBe("FAIL");
  });

  it("FAILs when vim did not move the cursor", () => {
    const v = judgeStep(
      "2",
      observation({
        cursorMoved: false,
        selectionAfter: { anchor: 0, head: 0 },
      }),
    );
    expect(v.verdict).toBe("FAIL");
    expect(v.checks.find((c) => c.label.includes("vim motion"))?.pass).toBe(
      false,
    );
  });

  it("FAILs when e.code was not preserved", () => {
    const v = judgeStep(
      "2",
      observation({ events: [keydown({ code: "", key: "Process" })] }),
    );
    expect(v.verdict).toBe("FAIL");
  });
});

describe("judgeStep — candidate A variant (step 2v)", () => {
  it("applies the same end-to-end criteria as step 2", () => {
    expect(judgeStep("2v", observation()).verdict).toBe("PASS");
    expect(judgeStep("2v", observation({ cursorMoved: false })).verdict).toBe(
      "FAIL",
    );
  });

  it("FAILs on an empty event log just like step 2", () => {
    // Guards the same false PASS: capture-phase interception that also kills
    // the vim keymap would otherwise look like a clean block.
    expect(judgeStep("2v", observation({ events: [] })).verdict).toBe("FAIL");
  });
});

describe("judgeStep — candidate C (step 2b)", () => {
  it("applies the same end-to-end criteria as step 2", () => {
    expect(judgeStep("2b", observation()).verdict).toBe("PASS");
    expect(judgeStep("2b", observation({ events: [] })).verdict).toBe("FAIL");
    expect(
      judgeStep("2b", observation({ docAfter: "ㅓline one" })).verdict,
    ).toBe("FAIL");
  });
});

describe("judgeStep — candidate B (steps 3, 3d, 3v)", () => {
  it('requires contenteditable === "false", not null', () => {
    // CM 6.43.6 sets the attribute to "false" rather than removing it; a
    // harness expecting null would report a false FAIL.
    expect(
      judgeStep("3", observation({ contentEditableAttr: "false" })).verdict,
    ).toBe("PASS");
    const nullAttr = judgeStep("3", observation({ contentEditableAttr: null }));
    expect(nullAttr.verdict).toBe("FAIL");
  });

  it("3d accepts keydown landing on document (focus loss is expected there)", () => {
    const v = judgeStep(
      "3d",
      observation({
        contentEditableAttr: "false",
        events: [keydown({ targetLabel: "document" })],
        hasFocus: false,
      }),
    );
    expect(v.verdict).toBe("PASS");
  });

  it("3v FAILs when composed text slipped into the doc even though the cursor moved", () => {
    // Audit finding: 3v originally lacked doc/mutation checks, so composition
    // text + cursor movement would have passed.
    const v = judgeStep(
      "3v",
      observation({
        contentEditableAttr: "false",
        docAfter: "ㅓline one",
      }),
    );
    expect(v.verdict).toBe("FAIL");
  });
});

describe("judgeStep — step 4 (programmatic edit under editable=false)", () => {
  it("PASSes only when the doc changed, readOnly is false, AND editable is really off", () => {
    const base = { contentEditableAttr: "false" as const };
    expect(
      judgeStep(
        "4",
        observation({ ...base, docAfter: "ine one", readOnly: false }),
      ).verdict,
    ).toBe("PASS");
    expect(
      judgeStep(
        "4",
        observation({ ...base, docAfter: "ine one", readOnly: true }),
      ).verdict,
    ).toBe("FAIL");
    expect(
      judgeStep("4", observation({ ...base, docAfter: "line one" })).verdict,
    ).toBe("FAIL");
    // contenteditable re-verified at judge time — a step that silently
    // flipped back to editable validates nothing (Codex finding).
    expect(
      judgeStep(
        "4",
        observation({
          contentEditableAttr: "true",
          docAfter: "ine one",
          readOnly: false,
        }),
      ).verdict,
    ).toBe("FAIL");
  });
});

describe("judgeStep — step 5 (transition race)", () => {
  // A realistic step-5 run: composing '하' NECESSARILY mutates the DOM. The
  // first version failed on any mutation, guaranteeing FAIL for a correctly
  // executed scenario (audit + Codex, independently). These fixtures include
  // the mutations on purpose.
  const composeEvents = (endData: null | string) => [
    keydown({ key: "Process", seq: 0 }),
    { ...keydown(), data: "ㅎ", seq: 1, type: "compositionstart" },
    {
      ...keydown(),
      mutation: 'characterData: "line one" → "ㅎline one"',
      seq: 2,
      type: "mutation",
    },
    { ...keydown(), data: "하", seq: 3, type: "compositionupdate" },
    { ...keydown(), data: endData, seq: 4, type: "compositionend" },
  ];

  it("PASSes a clean COMMIT (mutations present, syllable landed)", () => {
    const v = judgeStep(
      "5",
      observation({
        compositionStartedAfter: false,
        docAfter: "하line one",
        events: composeEvents("하"),
      }),
    );
    expect(v.verdict).toBe("PASS");
  });

  it("PASSes a clean CANCEL (doc restored to pre-step content)", () => {
    const v = judgeStep(
      "5",
      observation({
        compositionStartedAfter: false,
        docAfter: "line one",
        events: composeEvents(""),
        hasFocus: false, // focus loss after the flip is recorded, not judged
      }),
    );
    expect(v.verdict).toBe("PASS");
  });

  it("FAILs a torn state (lone jamo left in the doc)", () => {
    const v = judgeStep(
      "5",
      observation({
        compositionStartedAfter: false,
        docAfter: "ㅎline one",
        events: composeEvents("ㅎ"),
      }),
    );
    expect(v.verdict).toBe("FAIL");
  });

  it("FAILs when composition state is stale after settle", () => {
    const v = judgeStep(
      "5",
      observation({
        compositionStartedAfter: true,
        docAfter: "하line one",
        events: composeEvents("하"),
      }),
    );
    expect(v.verdict).toBe("FAIL");
  });

  it("FAILs when no text-entry evidence exists (operator never composed)", () => {
    // Default observation has only a keydown — a run where nothing was
    // composed must not read as a clean "cancel".
    expect(judgeStep("5", observation()).verdict).toBe("FAIL");
  });

  it("PASSes the composition-event-free WKWebView path (insertText only)", () => {
    // Measured 2026-07-26: this platform emits ZERO composition events for
    // Korean 2-set — insertion arrives as beforeinput/input insertText and
    // insertReplacementText. Requiring compositionend guaranteed a false FAIL.
    const v = judgeStep(
      "5",
      observation({
        compositionStartedAfter: false,
        docAfter: "하line one",
        events: [
          {
            ...keydown(),
            data: "ㅎ",
            inputType: "insertText",
            seq: 0,
            type: "beforeinput",
          },
          {
            ...keydown(),
            mutation: 'characterData: "line one" → "ㅎline one"',
            seq: 1,
            type: "mutation",
          },
          {
            ...keydown(),
            data: null,
            inputType: "insertReplacementText",
            seq: 2,
            type: "input",
          },
          { ...keydown(), code: "Escape", key: "Escape", seq: 3 },
        ],
        hasFocus: false,
      }),
    );
    expect(v.verdict).toBe("PASS");
  });
});

describe("judgeStep — step 6 (round trip into insert)", () => {
  it("FAILs when text landed but vim never entered insert mode", () => {
    // THE step-6 regression: with a Korean IME in normal mode, `i` can start
    // composing 'ㅣ' — doc changes, focus intact, insert never entered. The
    // first version passed on docChanged + focus alone (audit + Codex).
    const v = judgeStep(
      "6",
      observation({ docAfter: "하나line one", vimModeAfter: "normal" }),
    );
    expect(v.verdict).toBe("FAIL");
  });

  it("PASSes when insert was entered and a full syllable committed", () => {
    const v = judgeStep(
      "6",
      observation({ docAfter: "하나line one", vimModeAfter: "insert" }),
    );
    expect(v.verdict).toBe("PASS");
  });
});

describe("concludeMechanism", () => {
  const pass = (step: StepId): StepVerdict => ({
    checks: [],
    step,
    verdict: "PASS",
  });
  const fail = (step: StepId): StepVerdict => ({
    checks: [],
    step,
    verdict: "FAIL",
  });

  it("blocks any conclusion when the control group fails", () => {
    expect(concludeMechanism([fail("0")])).toContain("하네스 자체");
  });

  it("reports the common-premise collapse when Q1/Q2 fail", () => {
    expect(concludeMechanism([pass("0"), fail("1")])).toContain(
      "공통 전제가 붕괴",
    );
  });

  it("prefers candidate A when step 2 passes", () => {
    const out = concludeMechanism([pass("0"), pass("1"), pass("2"), pass("3")]);
    expect(out).toContain("후보 A 성립");
  });

  it("prefers the plain candidate A over its capture variant", () => {
    const out = concludeMechanism([
      pass("0"),
      pass("1"),
      pass("2"),
      pass("2v"),
    ]);
    expect(out).toContain("후보 A 성립");
    expect(out).not.toContain("변형");
  });

  it("reports the capture variant when only 2v passes", () => {
    const out = concludeMechanism([
      pass("0"),
      pass("1"),
      fail("2"),
      pass("2v"),
      pass("3"),
    ]);
    expect(out).toContain("후보 A 변형 성립");
  });

  it("falls back to candidate B when step 3 AND step 4 (Q5) pass", () => {
    const out = concludeMechanism([
      pass("0"),
      pass("1"),
      fail("2"),
      fail("2v"),
      pass("3"),
      pass("4"),
    ]);
    expect(out).toContain("후보 B 성립");
  });

  it("refuses to confirm candidate B when Q5 (step 4) did not pass", () => {
    // Blocking IME is worthless if editable=false also blocks vim's own
    // edits — B on step 3 alone would bless a dead mechanism (audit finding).
    const out = concludeMechanism([
      pass("0"),
      pass("1"),
      fail("2"),
      fail("2v"),
      pass("3"),
      fail("4"),
    ]);
    expect(out).toContain("B 확정 불가");
  });

  it("prefers candidate C over the B family when 2b passes", () => {
    const out = concludeMechanism([
      pass("0"),
      pass("1"),
      fail("2"),
      fail("2v"),
      pass("2b"),
      pass("3d"),
      pass("4"),
    ]);
    expect(out).toContain("후보 C 성립");
  });

  it("prefers the production shape (3d) over the tabindex variant", () => {
    const out = concludeMechanism([
      pass("0"),
      pass("1"),
      fail("2"),
      fail("2v"),
      pass("3"),
      pass("3d"),
      pass("3v"),
      pass("4"),
    ]);
    expect(out).toContain("document 캡처 dispatch");
  });

  it("annotates the conclusion when round-trip steps did not pass", () => {
    const out = concludeMechanism([pass("0"), pass("1"), pass("2"), fail("6")]);
    expect(out).toContain("후보 A 성립");
    expect(out).toContain("Step 6");
  });

  it("reports total failure when neither candidate passes", () => {
    const out = concludeMechanism([
      pass("0"),
      pass("1"),
      fail("2"),
      fail("3"),
      fail("3v"),
    ]);
    expect(out).toContain("모두 실패");
  });
});
