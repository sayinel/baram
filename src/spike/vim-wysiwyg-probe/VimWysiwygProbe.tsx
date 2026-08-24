// §298 Vim Phase 1 WYSIWYG probe — operator UI.
//
// Replaces the app when VITE_VIM_PROBE=1. The operator walks six steps; each
// one arms the recorder, waits for a physical action, then judges what the
// probe plugin actually observed. Judgment lives in verdicts.ts (pure).

import { useCallback, useEffect, useRef, useState } from "react";

import type { ProbeMode, StepId, StepObservation, StepVerdict } from "./types";

import { Editor } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";

import { Paragraph } from "../../extensions/nodes/paragraph";
import {
  armProbeRecorder,
  createPseudoNormalPlugin,
  recordedEvents,
  setProbeMode,
} from "./pseudo-normal-plugin";
import { HANGUL_CODE, judgeStep, MOTION_CODE, summarize } from "./verdicts";

interface StepDef {
  id: StepId;
  instruction: string;
  /** Mode the probe switches to before the operator acts. */
  mode: ProbeMode;
  question: string;
  /** Runs instead of an operator action (step 2 drives itself). */
  selfDriving?: boolean;
  title: string;
}

const STEPS: StepDef[] = [
  {
    id: "1",
    mode: "normal",
    title: "keydown arrival while non-editable",
    question:
      "Does handleDOMEvents.keydown still fire when view.editable is false?",
    instruction:
      `Click into the text, then press the physical "j" key once (${MOTION_CODE}). ` +
      "Nothing should appear in the document.",
  },
  {
    id: "2",
    mode: "normal",
    selfDriving: true,
    title: "programmatic edit while non-editable",
    question: "Does view.dispatch still mutate a non-editable view?",
    instruction:
      "No action needed — press Judge and the probe will dispatch an edit itself.",
  },
  {
    id: "3",
    mode: "normal",
    title: "focus survives the mode switch",
    question: "Does the view keep focus once the editing host is removed?",
    instruction:
      "Click into the text FIRST, then press Judge. Do not click anywhere else.",
  },
  {
    id: "4",
    mode: "normal",
    title: "Korean IME is blocked",
    question: "Does the editable gate stop WKWebView composition?",
    instruction:
      "Switch the input source to 한글, click into the text, then press the " +
      `physical "a" key once (${HANGUL_CODE} → ㅁ). Nothing should appear.`,
  },
  {
    id: "5",
    mode: "insert",
    title: "insert-mode Escape during composition",
    question: "Does Escape reach handleKeyDown with PM's composition handling?",
    instruction:
      "With 한글 active, click into the text, type ㅁ (do NOT commit it), " +
      "then press Escape once.",
  },
  {
    id: "6",
    mode: "normal",
    title: "clipboard contract",
    question: "Does copy survive while cut/paste are actively consumed?",
    instruction:
      "Select some text with the mouse, then press Cmd+C, then Cmd+V, then Cmd+X. " +
      "Only the copy should work.",
  },
];

const PROBE_DOC = "<p>probe target line one</p><p>probe target line two</p>";

export function VimWysiwygProbe() {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const docBeforeRef = useRef("");
  const [stepIndex, setStepIndex] = useState(0);
  const [armed, setArmed] = useState(false);
  const [verdicts, setVerdicts] = useState<StepVerdict[]>([]);
  const [observations, setObservations] = useState<
    Partial<Record<StepId, StepObservation>>
  >({});
  const [ready, setReady] = useState(false);

  const step = STEPS[stepIndex];

  useEffect(() => {
    if (!hostRef.current) return;
    const ProbeExtension = Extension.create({
      name: "vimWysiwygProbe",
      addProseMirrorPlugins: () => [createPseudoNormalPlugin()],
    });
    const editor = new Editor({
      content: PROBE_DOC,
      element: hostRef.current,
      extensions: [Document, Paragraph, Text, ProbeExtension],
    });
    editorRef.current = editor;
    setReady(true);
    return () => {
      editor.destroy();
      editorRef.current = null;
    };
  }, []);

  const arm = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    docBeforeRef.current = editor.state.doc.textContent;
    armProbeRecorder();
    setProbeMode(editor.view, step.mode);
    setArmed(true);
  }, [step.mode]);

  const judge = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    let changedByDispatch: boolean | undefined;
    if (step.selfDriving) {
      // The whole point of step 2: prove a non-editable view still accepts a
      // programmatic transaction, which is how vim will do every edit.
      const before = editor.state.doc.textContent;
      editor.view.dispatch(editor.state.tr.insertText("!", 1));
      changedByDispatch = editor.state.doc.textContent !== before;
    }

    const obs: StepObservation = {
      activeElementLabel: activeElementLabel(editor.view),
      changedByDispatch,
      docAfter: editor.state.doc.textContent,
      docBefore: docBeforeRef.current,
      editable: editor.view.editable,
      events: recordedEvents(),
      hasFocus: editor.view.hasFocus(),
      mode: step.mode,
    };
    setObservations((prev) => ({ ...prev, [step.id]: obs }));
    setVerdicts((prev) => [
      ...prev.filter((v) => v.step !== step.id),
      judgeStep(step.id, obs),
    ]);
    setArmed(false);
  }, [step]);

  const reset = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    setProbeMode(editor.view, "insert");
    editor.commands.setContent(PROBE_DOC);
    setArmed(false);
  }, []);

  const summary = verdicts.length ? summarize(verdicts) : null;
  const current = verdicts.find((v) => v.step === step.id);

  return (
    <div style={{ fontFamily: "var(--font-family-sans)", padding: 24 }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>
        §298 Vim Phase 1 — WYSIWYG mechanism probe
      </h1>
      <p style={{ color: "var(--color-text-muted)", marginBottom: 16 }}>
        Authoritative only under <code>npm run tauri dev</code> (WKWebView). A
        browser run is a smoke check, not evidence.
      </p>

      <ol
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          listStyle: "none",
          marginBottom: 16,
          padding: 0,
        }}
      >
        {STEPS.map((s, i) => {
          const v = verdicts.find((x) => x.step === s.id);
          return (
            <li key={s.id} style={{ fontWeight: i === stepIndex ? 700 : 400 }}>
              <button onClick={() => setStepIndex(i)} type="button">
                {s.id}. {s.title}
              </button>{" "}
              {v ? <strong>{v.verdict}</strong> : <em>not run</em>}
            </li>
          );
        })}
      </ol>

      <section
        style={{
          border: "1px solid var(--color-border-subtle)",
          borderRadius: 6,
          marginBottom: 16,
          padding: 12,
        }}
      >
        <h2 style={{ fontSize: 16 }}>
          Step {step.id}: {step.title}
        </h2>
        <p>
          <strong>Question.</strong> {step.question}
        </p>
        <p>
          <strong>Do this.</strong> {step.instruction}
        </p>
        <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
          <button disabled={!ready} onClick={arm} type="button">
            {armed ? "Re-arm" : "Arm"}
          </button>
          <button disabled={!armed} onClick={judge} type="button">
            Judge
          </button>
          <button onClick={reset} type="button">
            Reset document
          </button>
        </div>
        <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
          Mode for this step: <code>{step.mode}</code>
          {armed ? " — armed, perform the action now" : ""}
        </p>
      </section>

      <div
        ref={hostRef}
        style={{
          border: "1px solid var(--color-border-default)",
          borderRadius: 6,
          marginBottom: 16,
          minHeight: 120,
          padding: 12,
        }}
      />

      {current ? (
        <section>
          <h3>
            Verdict: <strong>{current.verdict}</strong>
          </h3>
          <ul>
            {current.checks.map((c) => (
              <li key={c.label}>
                {c.pass ? "PASS" : "FAIL"} — {c.label} <code>{c.detail}</code>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {summary ? (
        <section>
          <h3>P3 mechanism: {summary.p3Viable ? "viable" : "NOT viable"}</h3>
          <p>{summary.detail}</p>
        </section>
      ) : null}

      <details>
        <summary>Raw observations (paste this back)</summary>
        <pre>{JSON.stringify({ observations, verdicts }, null, 2)}</pre>
      </details>
    </div>
  );
}

function activeElementLabel(view: Editor["view"]): string {
  const el = document.activeElement;
  if (!el) return "(none)";
  if (el === view.dom) return "view.dom";
  if (view.dom.contains(el))
    return `inside view.dom <${el.tagName.toLowerCase()}>`;
  return `<${el.tagName.toLowerCase()}>`;
}
