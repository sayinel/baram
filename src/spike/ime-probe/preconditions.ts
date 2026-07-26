// §298 Vim Phase 0a IME probe — step preconditions and isolation.
//
// A step whose verdict is "an event did NOT happen" is only meaningful if the
// step started from a known-clean state. Without isolation, a composition left
// running by the previous step can deliver a late `compositionend` that gets
// attributed to this step (a false FAIL), or a stale document can mask a real
// change.
//
// WebKit makes this worse: @codemirror/view carries a workaround because
// "Safari will occasionally forget to fire compositionend at the end of a
// dead-key composition" and re-fires it on a 20ms timer. So we also need a
// settle window before judging, comfortably longer than that.

import type { EditorView } from "@codemirror/view";

/** Settle window before judging an absence-based verdict. */
export const SETTLE_MS = 150;

export interface Precondition {
  detail: string;
  label: string;
  ok: boolean;
}

interface PreconditionInput {
  /** Expected `contenteditable` attribute value for this step. */
  expectContentEditable: string;
  /** Whether this step needs the editor focused before the keystroke. */
  expectFocus: boolean;
  fixture: string;
  recordedCount: number;
  view: EditorView;
}

/**
 * Verify a step may start. All must be ok; the UI blocks the step otherwise so
 * the operator never produces an uninterpretable run.
 */
export function checkPreconditions({
  expectContentEditable,
  expectFocus,
  fixture,
  recordedCount,
  view,
}: PreconditionInput): Precondition[] {
  const attr = view.contentDOM.getAttribute("contenteditable");
  const doc = view.state.doc.toString();
  const composing = view.compositionStarted;

  return [
    {
      label: "이전 조합이 종료됨 (compositionStarted === false)",
      ok: !composing,
      detail: composing
        ? "조합이 아직 진행 중 — 이 상태로 시작하면 늦은 compositionend가 이번 스텝 결과로 오인된다"
        : "조합 없음",
    },
    {
      label: "문서가 fixture 초기 상태",
      ok: doc === fixture,
      detail: doc === fixture ? "일치" : `현재 "${doc}" ≠ fixture "${fixture}"`,
    },
    {
      label: "이벤트 로그 비어 있음",
      ok: recordedCount === 0,
      detail:
        recordedCount === 0 ? "비어 있음" : `${recordedCount}건 남아 있음`,
    },
    {
      label: `contenteditable === "${expectContentEditable}"`,
      ok: attr === expectContentEditable,
      detail: `실측값: ${JSON.stringify(attr)}`,
    },
    {
      label: expectFocus ? "에디터 포커스 있음" : "포커스 상태 기록됨",
      ok: expectFocus ? view.hasFocus : true,
      detail: `hasFocus=${String(view.hasFocus)}, activeElement=${describeActiveElement(view)}`,
    },
  ];
}

/** Environment metadata so results can be grouped per macOS/WebKit build. */
export function collectEnvironment(): Record<string, string> {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    // Distinguishes the authoritative Tauri/WKWebView run from a Safari run.
    runtime: "__TAURI_INTERNALS__" in window ? "tauri (WKWebView)" : "browser",
  };
}

export function describeActiveElement(view: EditorView): string {
  const active = document.activeElement;
  if (active === view.contentDOM) return "contentDOM";
  if (active === document.body) return "body";
  if (!active) return "(none)";
  return active.tagName.toLowerCase();
}

/** Restore the fixture document and cursor without going through the DOM. */
export function resetDocument(view: EditorView, fixture: string): void {
  view.dispatch({
    changes: { from: 0, insert: fixture, to: view.state.doc.length },
    selection: { anchor: 0 },
  });
}

/** Wait out late-arriving composition/mutation events before judging. */
export function settle(ms: number = SETTLE_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
