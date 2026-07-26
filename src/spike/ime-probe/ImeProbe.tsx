// §298 Vim Phase 0a IME probe — operator UI.
//
// human-in-the-loop by design: the harness verifies preconditions, sets up
// state and judges; the operator only presses physical keys. Synthetic key
// injection is deliberately NOT used — it takes a different path through the
// macOS text input service than a real keypress, and IME behavior is exactly
// what is being measured.

import { useCallback, useEffect, useRef, useState } from "react";

import type { ProbeEditor } from "./cm-instance";
import type { Precondition } from "./preconditions";
import type { StepId, StepObservation, StepVerdict } from "./types";

import {
  createProbeEditor,
  installBeforeinputBlocker,
  installCaptureInterceptor,
  installDocumentDispatcher,
  installEscapeFlip,
} from "./cm-instance";
import { EventRecorder } from "./event-recorder";
import {
  checkPreconditions,
  collectEnvironment,
  describeActiveElement,
  resetDocument,
  settle,
} from "./preconditions";
import { concludeMechanism, judgeStep, MOTION_CODE } from "./verdicts";

const FIXTURE = "line one\nline two\nline three";

interface StepDef {
  /** Candidate C: cancel beforeinput insertText/insertReplacementText — the
   *  measured WKWebView IME insertion path (fires before keydown, cancelable). */
  beforeinputBlock: boolean;
  /** Install a capture-phase interceptor that cancels the key and dispatches
   *  to vim explicitly (needed because CodeMirror skips its handlers once the
   *  event is already default-prevented). */
  captureIntercept: boolean;
  /** Candidate B production shape: document-level capture that forwards the
   *  key to vim (editable=false drops focus, so contentDOM never sees it). */
  docDispatch: boolean;
  editable: boolean;
  /** Flip editable→false synchronously when Escape lands (transition race). */
  escapeFlip: boolean;
  id: StepId;
  ime: "영문" | "한글";
  instruction: string;
  measures: string;
  tabindex: boolean;
  title: string;
  vimMode: "insert" | "normal";
}

const STEPS: StepDef[] = [
  {
    id: "0",
    title: "대조군 — 영문 IME",
    ime: "영문",
    vimMode: "normal",
    editable: true,
    beforeinputBlock: false,
    captureIntercept: false,
    docDispatch: false,
    escapeFlip: false,
    tabindex: false,
    instruction: "입력기를 영문으로 두고 j 를 한 번 누르세요.",
    measures: "하네스 정상성",
  },
  {
    id: "1",
    title: "Q1·Q2 — 한글 IME, 차단 없음 (insert 모드)",
    ime: "한글",
    vimMode: "insert",
    editable: true,
    beforeinputBlock: false,
    captureIntercept: false,
    docDispatch: false,
    escapeFlip: false,
    tabindex: false,
    instruction:
      "입력기를 한글로 바꾸고 j 를 한 번 누르세요. (조합이 시작되는 것이 정상입니다)",
    measures: "Q1 keydown 도달 · Q2 code 유지",
  },
  {
    id: "2",
    title: "후보 A — vim 자체 preventDefault (추가 코드 없음)",
    ime: "한글",
    vimMode: "normal",
    editable: true,
    // No interception installed on purpose. CodeMirror already calls
    // preventDefault() whenever a keymap binding handles the key, so vim in
    // normal mode does candidate A by itself. The open question is only
    // whether that cancel is early enough to stop the IME.
    beforeinputBlock: false,
    captureIntercept: false,
    docDispatch: false,
    escapeFlip: false,
    tabindex: false,
    instruction: "한글 상태 그대로 j 를 한 번 누르세요.",
    measures: "Q3 · Q7",
  },
  {
    id: "2b",
    title: "후보 C — beforeinput insertText 계열 차단 (raw 로그 발견)",
    ime: "한글",
    vimMode: "normal",
    editable: true,
    // Raw log (2026-07-26): this WKWebView inserts the jamo via cancelable
    // beforeinput BEFORE keydown, with zero composition events. Cancel that
    // and the keydown should still reach vim through the normal CM path.
    beforeinputBlock: true,
    captureIntercept: false,
    docDispatch: false,
    escapeFlip: false,
    tabindex: false,
    instruction: "한글 상태 그대로 j 를 한 번 누르세요.",
    measures: "Q3 · Q7 (후보 C)",
  },
  {
    id: "2v",
    title: "후보 A 변형 — capture 가로채기 + Vim.handleKey 직접 dispatch",
    ime: "한글",
    vimMode: "normal",
    editable: true,
    beforeinputBlock: false,
    captureIntercept: true,
    docDispatch: false,
    escapeFlip: false,
    tabindex: false,
    instruction: "한글 상태 그대로 j 를 한 번 누르세요.",
    measures: "Q3 · Q7 (가로채기 시점 변경)",
  },
  {
    id: "3",
    title: "후보 B — editable=false",
    ime: "한글",
    vimMode: "normal",
    editable: false,
    beforeinputBlock: false,
    captureIntercept: false,
    docDispatch: false,
    escapeFlip: false,
    tabindex: false,
    instruction: "한글 상태 그대로 j 를 한 번 누르세요.",
    measures: "Q4 · Q7",
  },
  {
    id: "3d",
    title: "후보 B 프로덕션 형태 — editable=false + document 캡처 dispatch",
    ime: "한글",
    vimMode: "normal",
    editable: false,
    beforeinputBlock: false,
    captureIntercept: false,
    // Research §4.3's actual candidate-B production design: focus is lost, so
    // a document-level capture listener forwards the key to vim. Without this
    // step, "B is impossible" and "the harness never forwarded the key" are
    // indistinguishable (audit + Codex, independently).
    docDispatch: true,
    escapeFlip: false,
    tabindex: false,
    instruction: "한글 상태 그대로 j 를 한 번 누르세요.",
    measures: "Q4 · Q7 (document 레벨 전달)",
  },
  {
    id: "3v",
    title: "후보 B 변형 — editable=false + tabindex",
    ime: "한글",
    vimMode: "normal",
    editable: false,
    beforeinputBlock: false,
    captureIntercept: false,
    docDispatch: false,
    escapeFlip: false,
    tabindex: true,
    instruction: "한글 상태 그대로 j 를 한 번 누르세요.",
    measures: "Q4 · 포커스 보존",
  },
  {
    id: "4",
    title: "Q5 — editable=false에서 프로그래매틱 편집",
    ime: "영문",
    vimMode: "normal",
    editable: false,
    beforeinputBlock: false,
    captureIntercept: false,
    docDispatch: false,
    escapeFlip: false,
    tabindex: false,
    // Judged on the programmatic path only. Pressing vim's `x` here too would
    // change the doc as well, making the verdict unattributable — the real
    // key-path edit is out of scope for this spike (see plan §9).
    instruction: "아래 '프로그래매틱 삭제' 버튼만 누르세요. (키 입력 없이)",
    measures: "Q5",
  },
  {
    id: "5",
    title: "Q6 — 조합 중 Esc → editable 전환 (최대 race)",
    ime: "한글",
    vimMode: "insert",
    editable: true,
    beforeinputBlock: false,
    captureIntercept: false,
    docDispatch: false,
    // The flip must happen inside the Escape dispatch, after CodeMirror's own
    // handlers — that is the ordering Phase 0a would have. Note: during an
    // active composition CM drops key events (ignoreDuringComposition), so
    // vim may never see this Esc — that is part of what this step measures.
    escapeFlip: true,
    tabindex: false,
    instruction:
      "한글로 '하'까지 조합한 상태(ㅎ 다음 ㅏ)에서 Esc 를 누르세요. 하네스가 같은 이벤트 안에서 editable을 false로 전환합니다.",
    measures: "Q6",
  },
  {
    id: "6",
    title: "왕복 — insert 복귀 후 한글 입력",
    ime: "한글",
    vimMode: "normal",
    editable: true,
    beforeinputBlock: false,
    captureIntercept: false,
    docDispatch: false,
    escapeFlip: false,
    tabindex: false,
    instruction: "i 를 눌러 insert로 돌아간 뒤 한글 두 글자를 입력하세요.",
    measures: "포커스 복원 · 왕복 재현성",
  },
];

export function ImeProbe() {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<null | ProbeEditor>(null);
  const recorderRef = useRef<EventRecorder | null>(null);
  const blockerRef = useRef<(() => void) | null>(null);
  const beforeRef = useRef<null | Pick<
    StepObservation,
    "docBefore" | "selectionBefore" | "vimModeBefore"
  >>(null);

  const [stepIndex, setStepIndex] = useState(0);
  const [preconditions, setPreconditions] = useState<null | Precondition[]>(
    null,
  );
  const [armed, setArmed] = useState(false);
  const [judging, setJudging] = useState(false);
  const [verdicts, setVerdicts] = useState<StepVerdict[]>([]);
  const [observations, setObservations] = useState<
    Array<{ observation: StepObservation; step: StepId }>
  >([]);

  const step = STEPS[stepIndex];

  useEffect(() => {
    if (!hostRef.current) return;
    const editor = createProbeEditor(hostRef.current, FIXTURE);
    const recorder = new EventRecorder();
    recorder.arm(editor.view.contentDOM);
    editorRef.current = editor;
    recorderRef.current = recorder;
    return () => {
      blockerRef.current?.();
      blockerRef.current = null;
      recorder.stop();
      editor.view.destroy();
      editorRef.current = null;
      recorderRef.current = null;
    };
  }, []);

  const prepare = useCallback(() => {
    const editor = editorRef.current;
    const recorder = recorderRef.current;
    if (!editor || !recorder) return;

    // Guard BEFORE mutating anything: if a composition is still open from the
    // previous step, resetting the doc first would create setup artifacts and
    // then complain about the composition afterwards — wrong order (Codex).
    if (editor.view.compositionStarted) {
      setPreconditions([
        {
          label: "이전 조합이 종료됨 (compositionStarted === false)",
          ok: false,
          detail:
            "조합이 아직 진행 중 — 에디터를 클릭해 조합을 끝낸 뒤 다시 준비하세요. (이 상태에서는 문서/모드를 건드리지 않았습니다)",
        },
      ]);
      setArmed(false);
      return;
    }

    blockerRef.current?.();
    blockerRef.current = null;

    resetDocument(editor.view, FIXTURE);
    editor.setEditable(true);
    editor.setTabIndex(step.tabindex);
    editor.view.focus();
    editor.forceVimMode(step.vimMode);
    editor.setEditable(step.editable);
    if (step.beforeinputBlock) {
      blockerRef.current = installBeforeinputBlocker(editor);
    } else if (step.captureIntercept) {
      blockerRef.current = installCaptureInterceptor(editor, [MOTION_CODE]);
    } else if (step.docDispatch) {
      blockerRef.current = installDocumentDispatcher(editor, [MOTION_CODE]);
    } else if (step.escapeFlip) {
      blockerRef.current = installEscapeFlip(editor, () =>
        editor.setEditable(false),
      );
    }
    // Reset LAST: the setup above dispatches transactions and focuses the
    // editor, which can emit events that must not be attributed to the step.
    recorder.reset();

    setPreconditions(
      checkPreconditions({
        expectContentEditable: step.editable ? "true" : "false",
        expectFocus: step.editable,
        fixture: FIXTURE,
        // Read the real count, not a hardcoded 0: a precondition that cannot
        // fail is theater, and reset() emitting stray events would be exactly
        // the kind of leakage this check exists to catch.
        recordedCount: recorder.snapshot().length,
        view: editor.view,
      }),
    );
    beforeRef.current = {
      docBefore: editor.view.state.doc.toString(),
      selectionBefore: {
        anchor: editor.view.state.selection.main.anchor,
        head: editor.view.state.selection.main.head,
      },
      vimModeBefore: editor.getVimMode(),
    };
    setArmed(true);
  }, [step]);

  const judge = useCallback(async () => {
    const editor = editorRef.current;
    const recorder = recorderRef.current;
    const before = beforeRef.current;
    if (!editor || !recorder || !before) return;

    setJudging(true);
    try {
      // The step-5 editable flip already happened inside the Escape dispatch
      // (installEscapeFlip). Doing it here instead would measure a different,
      // much later transition and miss the race entirely.
      await settle();

      const sel = editor.view.state.selection.main;
      const observation: StepObservation = {
        ...before,
        activeElementLabel: describeActiveElement(editor.view),
        compositionStartedAfter: editor.view.compositionStarted,
        contentEditableAttr:
          editor.view.contentDOM.getAttribute("contenteditable"),
        cursorMoved: sel.head !== before.selectionBefore.head,
        docAfter: editor.view.state.doc.toString(),
        events: recorder.snapshot(),
        hasFocus: editor.view.hasFocus,
        readOnly: editor.isReadOnly(),
        selectionAfter: { anchor: sel.anchor, head: sel.head },
        vimModeAfter: editor.getVimMode(),
      };

      const verdict = judgeStep(step.id, observation);
      setVerdicts((v) => [...v.filter((x) => x.step !== step.id), verdict]);
      setObservations((o) => [
        ...o.filter((x) => x.step !== step.id),
        { observation, step: step.id },
      ]);
    } finally {
      // Dispose the step's interceptor/flip so it cannot leak into keystrokes
      // typed while browsing between steps (audit finding).
      blockerRef.current?.();
      blockerRef.current = null;
      setArmed(false);
      setJudging(false);
    }
  }, [step]);

  const programmaticDelete = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.view.dispatch({ changes: { from: 0, to: 1 } });
  }, []);

  const copyJson = useCallback(() => {
    const payload = {
      environment: collectEnvironment(),
      conclusion: concludeMechanism(verdicts),
      verdicts,
      observations,
    };
    void navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  }, [verdicts, observations]);

  const blocked = preconditions?.some((p) => !p.ok) ?? false;

  return (
    <div style={{ padding: 24, fontFamily: "var(--font-family-sans)" }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>
        IME Probe — Vim Phase 0a (#298)
      </h1>
      <p style={{ color: "var(--color-text-muted)", marginBottom: 16 }}>
        {collectEnvironment().runtime} · Tauri(WKWebView) 실행만 권위 있는
        결과입니다.
      </p>

      <div
        style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}
      >
        {STEPS.map((s, i) => {
          const v = verdicts.find((x) => x.step === s.id);
          return (
            <button
              key={s.id}
              onClick={() => {
                // Switching steps invalidates everything prepare() set up.
                // Without this, a step armed as 2v could be judged under 5's
                // id with 2v's listener and snapshot still live (Codex).
                blockerRef.current?.();
                blockerRef.current = null;
                beforeRef.current = null;
                setArmed(false);
                setPreconditions(null);
                setStepIndex(i);
              }}
              style={{
                background:
                  i === stepIndex ? "var(--color-bg-subtle)" : "transparent",
                border: "1px solid var(--color-border-default)",
                borderRadius: 4,
                color: v
                  ? v.verdict === "PASS"
                    ? "green"
                    : "crimson"
                  : undefined,
                padding: "4px 8px",
              }}
            >
              Step {s.id} {v ? (v.verdict === "PASS" ? "✓" : "✗") : ""}
            </button>
          );
        })}
      </div>

      <section
        style={{
          border: "1px solid var(--color-border-default)",
          borderRadius: 6,
          marginBottom: 16,
          padding: 16,
        }}
      >
        <h2 style={{ fontSize: 16 }}>
          Step {step.id} — {step.title}
        </h2>
        <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
          측정: {step.measures} · 입력기: <b>{step.ime}</b> · vim:{" "}
          <b>{step.vimMode}</b> · editable: <b>{String(step.editable)}</b>
          {step.beforeinputBlock ? " · beforeinput 차단 ON" : ""}
          {step.captureIntercept ? " · capture 가로채기 ON" : ""}
          {step.escapeFlip ? " · Esc 시 editable 전환 ON" : ""}
          {step.tabindex ? " · tabindex ON" : ""}
        </p>

        <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
          <button disabled={judging} onClick={prepare}>
            1. 스텝 준비
          </button>
          <button
            disabled={!armed || blocked || judging}
            onClick={() => void judge()}
          >
            {judging ? "판정 중…" : "3. 판정"}
          </button>
          {step.id === "4" && (
            <button disabled={!armed} onClick={programmaticDelete}>
              프로그래매틱 삭제
            </button>
          )}
        </div>

        {preconditions && (
          <ul style={{ fontSize: 13, listStyle: "none", marginBottom: 12 }}>
            {preconditions.map((p) => (
              <li key={p.label} style={{ color: p.ok ? "green" : "crimson" }}>
                {p.ok ? "✓" : "✗"} {p.label} — {p.detail}
              </li>
            ))}
          </ul>
        )}

        {armed && !blocked && (
          <p
            style={{
              background: "var(--color-bg-subtle)",
              borderRadius: 4,
              padding: 10,
            }}
          >
            <b>2. 지금 하세요:</b> {step.instruction} 그다음 <b>판정</b>을
            누르세요.
          </p>
        )}
        {blocked && (
          <p style={{ color: "crimson" }}>
            전제조건 실패 — 이 상태의 측정은 해석할 수 없습니다. 다시{" "}
            <b>스텝 준비</b>를 누르세요.
          </p>
        )}
      </section>

      <div ref={hostRef} style={{ marginBottom: 16 }} />

      {verdicts.length > 0 && (
        <section>
          <h2 style={{ fontSize: 16 }}>판정</h2>
          {verdicts
            .slice()
            .sort((a, b) => a.step.localeCompare(b.step))
            .map((v) => (
              <div key={v.step} style={{ marginBottom: 8 }}>
                <b
                  style={{ color: v.verdict === "PASS" ? "green" : "crimson" }}
                >
                  Step {v.step}: {v.verdict}
                </b>
                <ul style={{ fontSize: 13, listStyle: "none" }}>
                  {v.checks.map((c) => (
                    <li
                      key={c.label}
                      style={{ color: c.pass ? "green" : "crimson" }}
                    >
                      {c.pass ? "✓" : "✗"} {c.label} — {c.detail}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          <p
            style={{
              background: "var(--color-bg-subtle)",
              borderRadius: 4,
              marginTop: 12,
              padding: 10,
            }}
          >
            <b>결론:</b> {concludeMechanism(verdicts)}
          </p>
          <button onClick={copyJson} style={{ marginTop: 8 }}>
            결과 JSON 복사 (raw 이벤트 로그 포함)
          </button>
        </section>
      )}
    </div>
  );
}
