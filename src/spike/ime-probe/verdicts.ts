// §298 Vim Phase 0a IME probe — pure judgment layer.
//
// Every function here is pure so it can be unit-tested against recorded-event
// fixtures (see __tests__/verdicts.test.ts). No DOM access.
//
// THE CENTRAL DESIGN RULE (plan §7): a step that asks "did we block IME
// composition?" must ALSO require that the keystroke actually arrived. Absence
// of `compositionstart` on its own is NOT evidence that composition was
// blocked — it is equally consistent with the key never reaching the DOM (the
// OS IME swallowed it) or the editor not being focused. Treating that as PASS
// is testing a circuit breaker with the power unplugged.

import type {
  Check,
  RecordedEvent,
  StepId,
  StepObservation,
  StepVerdict,
} from "./types";

/** The physical key the operator is asked to press in motion steps. */
export const MOTION_CODE = "KeyJ";

/**
 * Which mechanism the run supports. Mirrors plan §8, with two rules the first
 * version got wrong (caught by audit + Codex):
 *
 * 1. A candidate-B conclusion REQUIRES step 4 (Q5, programmatic edit) — if
 *    `editable=false` also blocks `view.dispatch`, B blocks IME but vim can
 *    never edit, so declaring "B 성립" on step 3 alone would bless a dead
 *    mechanism.
 * 2. The conclusion carries explicit caveats for the round-trip steps (5/6)
 *    instead of silently ignoring them.
 */
export function concludeMechanism(verdicts: StepVerdict[]): string {
  const passed = (s: StepId) =>
    verdicts.find((v) => v.step === s)?.verdict === "PASS";

  if (!passed("0"))
    return "판정 불가 — 영문 대조군(Step 0)이 실패했다. 하네스 자체를 먼저 고칠 것";
  if (!passed("1"))
    return "Q1/Q2 실패 — IME 활성 시 keydown이 도달하지 않거나 code가 유지되지 않는다. 후보 A·B 공통 전제가 붕괴 → OS 입력기 전환(§8-D) 검토";

  const roundTripCaveat = (forB: boolean): string => {
    const notes: string[] = [];
    if (forB && !passed("5"))
      notes.push("전환 race(Step 5) 미통과 — 전환 시점 재설계 필요");
    if (!passed("6")) notes.push("insert 왕복(Step 6) 미확인");
    return notes.length ? ` · 주의: ${notes.join(" / ")}` : "";
  };

  if (passed("2"))
    return (
      "후보 A 성립 (vim 자체 preventDefault) — 추가 코드 없이 성립. 포커스·contenteditable 유지, Phase 0a 설계 최소화 가능" +
      roundTripCaveat(false)
    );
  if (passed("2v"))
    return (
      "후보 A 변형 성립 (capture 가로채기 + Vim.handleKey 직접 dispatch) — vim의 자체 preventDefault는 IME보다 늦지만, capture 단계 취소는 유효하다" +
      roundTripCaveat(false)
    );
  if (passed("2b"))
    return (
      "후보 C 성립 (normal mode에서 beforeinput insertText 계열 차단) — editable 토글·tabindex·포커스 이동 전부 불필요. 전환 race 자체가 소멸" +
      roundTripCaveat(false)
    );

  const bMechanism = passed("3d")
    ? "후보 B 성립 (editable=false + document 캡처 dispatch — 프로덕션 형태)"
    : passed("3v")
      ? "후보 B 변형 성립 (editable=false + tabindex) — contentDOM 포커스 보존"
      : passed("3")
        ? "후보 B 성립 (editable=false) — 포커스 상실 여부에 따라 키 리스너 위치 결정 필요"
        : null;
  if (bMechanism) {
    if (!passed("4"))
      return `${bMechanism} …이지만 Q5(Step 4, editable=false에서 프로그래매틱 편집) 미통과 — 이대로는 normal mode 편집이 불가하므로 B 확정 불가`;
    return bMechanism + roundTripCaveat(true);
  }
  return "후보 A·B 모두 실패 — 방어층 조합(inputHandler / beforeinput / focus sink) 또는 OS 입력기 전환 검토";
}

/**
 * Judge one step. `step` selects the required check set.
 *
 * Steps 0/2/2v/3/3v all demand the full end-to-end chain (key arrived → code
 * intact → no composition → doc untouched → no transient mutation → vim ran),
 * because the plan's stop condition is one end-to-end flow, not four
 * independently-passing parts.
 */
export function judgeStep(step: StepId, o: StepObservation): StepVerdict {
  const checks: Check[] = [];

  switch (step) {
    // Control group: English IME. Confirms the harness itself works. Doc
    // checks included — if vim failed to initialize, `j` would self-insert
    // and move the cursor, which cursorMoved alone would misread as PASS.
    case "0":
      checks.push(
        chkKeydownArrived(o),
        chkCodePreserved(o, MOTION_CODE),
        chkNoCompositionStart(o),
        chkDocUnchanged(o),
        chkNoTransientMutation(o),
        chkVimMotionRan(o),
      );
      break;

    // Q1/Q2 only — no blocking attempted, so composition IS expected here.
    case "1":
      checks.push(chkKeydownArrived(o), chkCodePreserved(o, MOTION_CODE));
      break;

    // Q3 candidate A ("2"): vim's own preventDefault — CodeMirror calls it
    // whenever a keymap binding handles the key, so no extra interception.
    // Q3 candidate A variant ("2v"): capture-phase preventDefault + explicit
    // dispatch to vim.
    // Candidate C ("2b"): cancel `beforeinput` insertText/insertReplacementText
    // in normal mode — the measured WKWebView insertion path, which fires
    // BEFORE keydown and was recorded cancelable:true.
    // Same success criteria for all three; only the interception point
    // differs, so they share this check set.
    case "2":
    case "2b":
    case "2v":
      checks.push(
        chkKeydownArrived(o),
        chkCodePreserved(o, MOTION_CODE),
        chkNoCompositionStart(o),
        chkDocUnchanged(o),
        chkNoTransientMutation(o),
        chkVimMotionRan(o),
      );
      break;

    // Q4 candidate B: editable=false
    case "3":
      checks.push(
        chkKeydownArrived(o),
        chkCodePreserved(o, MOTION_CODE),
        chkContentEditable(o, "false"),
        chkNoCompositionStart(o),
        chkDocUnchanged(o),
        chkNoTransientMutation(o),
        chkVimMotionRan(o),
      );
      break;

    // Candidate B production shape: editable=false + document-level capture
    // that forwards to vim. Keydown may legitimately land on document/body
    // here, so no contentDOM-target requirement.
    case "3d":
      checks.push(
        chkKeydownArrived(o),
        chkCodePreserved(o, MOTION_CODE),
        chkContentEditable(o, "false"),
        chkNoCompositionStart(o),
        chkDocUnchanged(o),
        chkNoTransientMutation(o),
        chkVimMotionRan(o),
      );
      break;

    // Candidate B variant: keep contentDOM focusable via tabindex. Same doc
    // checks as step 3 — without them, composed text slipping in while the
    // cursor also moves would PASS (audit finding).
    case "3v":
      checks.push(
        chkKeydownArrived(o),
        chkKeydownTarget(o, "contentDOM"),
        chkCodePreserved(o, MOTION_CODE),
        chkContentEditable(o, "false"),
        chkNoCompositionStart(o),
        chkDocUnchanged(o),
        chkNoTransientMutation(o),
        chkVimMotionRan(o),
      );
      break;

    // Q5: programmatic edit under editable=false. contenteditable re-checked
    // at judge time — otherwise a step that silently flipped back to editable
    // would validate nothing.
    case "4":
      checks.push(
        chkContentEditable(o, "false"),
        chkDocChanged(o),
        chkReadOnlyFalse(o),
      );
      break;

    // Q6: the transition race — composing, then Esc, then editable→false.
    //
    // NOT judged on "no mutation": composing '하' mutates the DOM by
    // definition, so that check would guarantee FAIL for a correctly-executed
    // scenario. NOT judged on hasFocus: the flip may drop focus — recorded,
    // not judged. And NOT judged on `compositionend` arriving: the measured
    // WKWebView Korean path uses insertText/insertReplacementText with ZERO
    // composition events, so requiring compositionend guaranteed a FAIL on an
    // event this platform never emits (2026-07-26 raw log). What IS required:
    // evidence that text entry actually happened (guards against "operator
    // never composed" reading as a clean cancel), no stale composition state,
    // and a defined outcome — full commit or full cancel, never torn.
    case "5":
      checks.push(
        chkCompositionEvidence(o),
        chkNoStaleComposition(o),
        chkCompositionOutcomeDefined(o),
      );
      break;

    // Round trip back to insert mode with Korean input. docChanged alone is
    // NOT enough: with a Korean IME in normal mode, `i` can start composing
    // 'ㅣ' instead of entering insert — text lands in the doc while insert
    // was never entered, which is exactly the failure this spike exists to
    // detect (audit + Codex, independently).
    case "6":
      checks.push(chkVimModeIs(o, "insert"), chkHangulCommitted(o));
      break;
  }

  return {
    step,
    checks,
    verdict: checks.every((c) => c.pass) ? "PASS" : "FAIL",
  };
}

// ── individual checks ───────────────────────────────────────────────────────

function chkCodePreserved(o: StepObservation, code: string): Check {
  const ks = keydowns(o);
  const match = ks.find((k) => k.code === code);
  return {
    label: `e.code가 물리 키 유지 (${code})`,
    pass: Boolean(match),
    detail: match
      ? `code="${match.code}", key="${match.key}", isComposing=${match.isComposing}`
      : `code=${code} 인 keydown 없음. 관측: ${ks.map((k) => `${k.code}/${k.key}`).join(", ") || "(없음)"}`,
  };
}

/**
 * Step 5: proof that text entry was actually attempted. Without this, an
 * operator who never composed anything would read as a clean "cancel" and
 * false-PASS. Composition events are NOT required — the measured WKWebView
 * Korean path emits none, inserting via insertText/insertReplacementText.
 */
function chkCompositionEvidence(o: StepObservation): Check {
  const evidence = o.events.filter(
    (e) =>
      e.type === "compositionstart" ||
      e.type === "mutation" ||
      ((e.type === "beforeinput" || e.type === "input") &&
        (e.inputType === "insertText" ||
          e.inputType === "insertReplacementText" ||
          e.inputType === "insertCompositionText")),
  );
  return {
    label: "텍스트 입력 시도의 증거 존재 (조합 이벤트 또는 insertText 계열)",
    pass: evidence.length > 0,
    detail:
      evidence.length > 0
        ? `${evidence.length}건 — ${[...new Set(evidence.map((e) => e.inputType ?? e.type))].join(", ")}${has(o, "compositionend") ? " (compositionend 있음)" : " (compositionend 없음 — 이 플랫폼 정상 거동)"}`
        : "입력 시도 흔적 없음 — 조합을 하지 않고 판정한 실행은 해석 불가",
  };
}

/**
 * Step 5: the composed text must end in a DEFINED state — fully committed
 * (complete syllable in the doc, no lone jamo) or fully cancelled (doc back
 * to its pre-step content). A torn state (stray "ㅎ", duplicated text) fails.
 * Both commit and cancel are acceptable platform behaviors; tearing is not.
 */
function chkCompositionOutcomeDefined(o: StepObservation): Check {
  const loneJamo = /[ㄱ-ㅎㅏ-ㅣ]/.test(o.docAfter);
  const cancelled = o.docAfter === o.docBefore;
  const committed = !cancelled && !loneJamo && /[가-힣]/.test(o.docAfter);
  const pass = cancelled || committed;
  return {
    label: "조합 결과가 정의된 상태 (commit 또는 cancel)",
    pass,
    detail: cancelled
      ? "cancel — 문서가 조합 전과 동일 (focus/activeElement는 관찰 기록 참조)"
      : committed
        ? `commit — "${o.docAfter}" (hasFocus=${String(o.hasFocus)}, activeElement=${o.activeElementLabel})`
        : `찢어진 상태 — docAfter="${o.docAfter}"${loneJamo ? " (미완성 자모 잔존)" : ""}`,
  };
}

function chkContentEditable(o: StepObservation, expected: string): Check {
  return {
    label: `contenteditable === "${expected}"`,
    pass: o.contentEditableAttr === expected,
    detail: `실측값: ${JSON.stringify(o.contentEditableAttr)}`,
  };
}

function chkDocChanged(o: StepObservation): Check {
  const changed = o.docBefore !== o.docAfter;
  return {
    label: "문서가 실제로 변경됨",
    pass: changed,
    detail: changed ? `"${o.docBefore}" → "${o.docAfter}"` : "변경 없음",
  };
}

function chkDocUnchanged(o: StepObservation): Check {
  const same = o.docBefore === o.docAfter;
  return {
    label: "문서 무변경",
    pass: same,
    detail: same ? "동일" : `"${o.docBefore}" → "${o.docAfter}"`,
  };
}

/** Step 6: a complete Hangul syllable actually landed in the document. */
function chkHangulCommitted(o: StepObservation): Check {
  const pass = o.docBefore !== o.docAfter && /[가-힣]/.test(o.docAfter);
  return {
    label: "한글 음절이 문서에 입력됨",
    pass,
    detail: pass
      ? `"${o.docAfter}"`
      : `docAfter="${o.docAfter}" — 완성 음절 없음 (조합이 keymap을 우회해 자모만 남았거나 입력 자체가 안 됨)`,
  };
}

/** P0: the keystroke reached the DOM at all. Guards the false PASS above. */
function chkKeydownArrived(o: StepObservation): Check {
  const ks = keydowns(o);
  return {
    label: "keydown이 DOM에 도달",
    pass: ks.length > 0,
    detail:
      ks.length > 0
        ? `keydown ${ks.length}건 (target: ${[...new Set(ks.map((k) => k.targetLabel))].join(", ")})`
        : "keydown 없음 — OS IME가 키를 삼켰거나 포커스가 없음. 조합 미발생을 PASS로 읽으면 안 된다",
  };
}

function chkKeydownTarget(o: StepObservation, expected: string): Check {
  const targets = [...new Set(keydowns(o).map((k) => k.targetLabel))];
  return {
    label: `keydown이 ${expected}에 도달`,
    pass: targets.includes(expected as RecordedEvent["targetLabel"]),
    detail: `관측 target: ${targets.join(", ") || "(없음)"}`,
  };
}

function chkNoCompositionStart(o: StepObservation): Check {
  const started = has(o, "compositionstart");
  return {
    label: "compositionstart 미발생",
    pass: !started,
    detail: started
      ? `조합이 시작됨: ${o.events
          .filter((e) => e.type === "compositionstart")
          .map((e) => JSON.stringify(e.data))
          .join(", ")}`
      : "조합 시작 이벤트 없음",
  };
}

/**
 * Step 5: CodeMirror must not be left believing a composition is still open
 * after settle. Pass requires an explicit `false` — an unrecorded value is
 * not evidence of health.
 */
function chkNoStaleComposition(o: StepObservation): Check {
  return {
    label: "조합 상태 stale 아님 (compositionStarted === false)",
    pass: o.compositionStartedAfter === false,
    detail:
      o.compositionStartedAfter === undefined
        ? "미기록 — 하네스가 compositionStartedAfter를 남기지 않았다"
        : `compositionStarted=${String(o.compositionStartedAfter)}`,
  };
}

/** Final-doc equality can hide a character that appeared and was removed. */
function chkNoTransientMutation(o: StepObservation): Check {
  const muts = o.events.filter((e) => e.type === "mutation");
  return {
    label: "중간 DOM mutation 없음",
    pass: muts.length === 0,
    detail:
      muts.length === 0
        ? "mutation 없음"
        : `${muts.length}건 — 조합 문자가 잠시 삽입됐다 사라졌을 수 있음: ${muts.map((m) => m.mutation).join(" | ")}`,
  };
}

function chkReadOnlyFalse(o: StepObservation): Check {
  return {
    label: "readOnly facet === false",
    pass: o.readOnly === false,
    detail: `readOnly=${String(o.readOnly)}`,
  };
}

/** Step 6: vim must actually be in the expected mode, not just "doc changed". */
function chkVimModeIs(o: StepObservation, mode: string): Check {
  return {
    label: `vim mode === "${mode}"`,
    pass: o.vimModeAfter === mode,
    detail: `vimModeAfter=${JSON.stringify(o.vimModeAfter ?? null)} (before=${JSON.stringify(o.vimModeBefore ?? null)})`,
  };
}

/** P0: proves vim actually consumed the key, not merely that IME was quiet. */
function chkVimMotionRan(o: StepObservation): Check {
  return {
    label: "vim motion 실행됨 (cursor 이동)",
    pass: o.cursorMoved,
    detail: o.cursorMoved
      ? `selection ${o.selectionBefore.head} → ${o.selectionAfter.head}`
      : `cursor 이동 없음 (head ${o.selectionBefore.head} 고정) — IME 차단과 무관하게 vim이 키를 못 받았다`,
  };
}

// ── per-step judgment ───────────────────────────────────────────────────────

function has(o: StepObservation, type: string): boolean {
  return o.events.some((e) => e.type === type);
}

function keydowns(o: StepObservation): RecordedEvent[] {
  return o.events.filter((e) => e.type === "keydown");
}
