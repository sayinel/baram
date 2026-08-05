// §298 Phase 0b S3 — boundary handler pins (design v3 §3).

import type { CodeMirror } from "@replit/codemirror-vim";

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import {
  attachVimBoundary,
  type BoundaryHooks,
} from "../vim-code-block-boundary";

const views: EditorView[] = [];

afterEach(() => {
  for (const v of views.splice(0)) v.destroy();
  document.body.innerHTML = "";
});

function fakeCM(vim: object | undefined): CodeMirror {
  return { state: { vim } } as unknown as CodeMirror;
}

function makeView(cursorLine: 1 | 3): EditorView {
  const doc = "aa\nbb\ncc";
  const anchor = cursorLine === 1 ? 0 : doc.length;
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc, selection: { anchor } }),
  });
  views.push(view);
  return view;
}

const idle = () => ({
  inputState: { keyBuffer: [] as string[], operator: null },
  insertMode: false,
  visualMode: false,
});

function hooks(): { calls: string[]; hooks: BoundaryHooks } {
  const calls: string[] = [];
  return {
    calls,
    hooks: {
      escape: (dir) => calls.push(`escape${dir}`),
      redo: () => calls.push("redo"),
      undo: () => calls.push("undo"),
    },
  };
}

function press(
  view: EditorView,
  key: string,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
    ...init,
  });
  view.contentDOM.dispatchEvent(event);
  return event;
}

describe("vim code block boundary (S3)", () => {
  it("j/ArrowDown at the LAST line escape down; elsewhere pass", () => {
    const view = makeView(3);
    const h = hooks();
    attachVimBoundary(view, fakeCM(idle()), h.hooks);
    const e = press(view, "j");
    expect(h.calls).toEqual(["escape1"]);
    expect(e.defaultPrevented).toBe(true);
    press(view, "ArrowDown");
    expect(h.calls).toEqual(["escape1", "escape1"]);

    const mid = makeView(1);
    const h2 = hooks();
    attachVimBoundary(mid, fakeCM(idle()), h2.hooks);
    press(mid, "j"); // first line of three — not a boundary downwards
    expect(h2.calls).toEqual([]);
  });

  it("k/ArrowUp at the FIRST line escape up", () => {
    const view = makeView(1);
    const h = hooks();
    attachVimBoundary(view, fakeCM(idle()), h.hooks);
    press(view, "k");
    press(view, "ArrowUp");
    expect(h.calls).toEqual(["escape-1", "escape-1"]);
  });

  it("a buffered count or operator suppresses the boundary (2j, d2j, gj)", () => {
    const view = makeView(3);
    const h = hooks();
    const vim = idle();
    vim.inputState.keyBuffer = ["2"];
    attachVimBoundary(view, fakeCM(vim), h.hooks);
    press(view, "j");
    press(view, "ArrowDown");
    const op = idle();
    (op.inputState as { operator: null | string }).operator = "d";
    const h2 = hooks();
    attachVimBoundary(view, fakeCM(op), h2.hooks);
    press(view, "j");
    expect(h.calls).toEqual([]);
    expect(h2.calls).toEqual([]);
  });

  it("insert/visual mode and unreadable vim state never intervene", () => {
    const view = makeView(3);
    const insert = { ...idle(), insertMode: true };
    const visual = { ...idle(), visualMode: true };
    for (const vim of [insert, visual, undefined]) {
      const h = hooks();
      const off = attachVimBoundary(view, fakeCM(vim), h.hooks);
      press(view, "j");
      press(view, "u");
      expect(h.calls).toEqual([]);
      off();
    }
  });

  it("u and Ctrl-r delegate to PM undo/redo in idle normal", () => {
    const view = makeView(1);
    const h = hooks();
    attachVimBoundary(view, fakeCM(idle()), h.hooks);
    const e = press(view, "u");
    press(view, "r", { ctrlKey: true });
    expect(h.calls).toEqual(["undo", "redo"]);
    expect(e.defaultPrevented).toBe(true);
    press(view, "r"); // bare r (replace) is vim's
    press(view, "z", { ctrlKey: true }); // other ctrl chords pass
    expect(h.calls).toEqual(["undo", "redo"]);
  });

  it("composition keydowns and modifier chords pass through", () => {
    const view = makeView(3);
    const h = hooks();
    attachVimBoundary(view, fakeCM(idle()), h.hooks);
    press(view, "j", { metaKey: true });
    press(view, "j", { altKey: true });
    // Shift+Arrow is a selection gesture, not a boundary motion.
    const shifted = press(view, "ArrowDown", { shiftKey: true });
    expect(shifted.defaultPrevented).toBe(false);
    const up = makeView(1);
    const h3 = hooks();
    attachVimBoundary(up, fakeCM(idle()), h3.hooks);
    press(up, "ArrowUp", { shiftKey: true });
    expect(h3.calls).toEqual([]);
    const composing = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      isComposing: true,
      key: "j",
    });
    view.contentDOM.dispatchEvent(composing);
    expect(h.calls).toEqual([]);
  });

  it("survives a consuming at-target listener — the DEVICE failure", () => {
    // On the real surface CodeMirror registered on contentDOM first and
    // stops propagation for handled keys; a same-target listener starves.
    // The boundary must fire from ancestor capture BEFORE that.
    const view = makeView(3);
    view.contentDOM.addEventListener("keydown", (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    });
    const h = hooks();
    attachVimBoundary(view, fakeCM(idle()), h.hooks);
    press(view, "j");
    expect(h.calls).toEqual(["escape1"]);
  });

  it("idle-normal Escape leaves the block; pending/visual Esc stays vim's", () => {
    const view = makeView(3);
    const h = hooks();
    const off = attachVimBoundary(view, fakeCM(idle()), h.hooks);
    const e = press(view, "Escape");
    expect(h.calls).toEqual(["escape-1"]);
    expect(e.defaultPrevented).toBe(true);
    off();
    const pending = idle();
    pending.inputState.keyBuffer = ["d"];
    const h2 = hooks();
    attachVimBoundary(view, fakeCM(pending), h2.hooks);
    press(view, "Escape"); // vim owns the abort
    const h3 = hooks();
    attachVimBoundary(view, fakeCM({ ...idle(), visualMode: true }), h3.hooks);
    press(view, "Escape"); // vim collapses visual first
    expect(h2.calls).toEqual([]);
    expect(h3.calls).toEqual([]);
  });

  it("detaching stops all interception", () => {
    const view = makeView(3);
    const h = hooks();
    const off = attachVimBoundary(view, fakeCM(idle()), h.hooks);
    off();
    press(view, "j");
    press(view, "u");
    expect(h.calls).toEqual([]);
  });
});
