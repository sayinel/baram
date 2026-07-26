// §298 Phase 0a S2 — IME guard unit tests.
//
// These verify the guard's wiring and mode matrix with synthetic events.
// They do NOT prove platform IME behavior — that was established by the
// human-in-the-loop probe (spike, 2026-07-26); jsdom cannot drive a real IME.

import type { EditorView } from "@codemirror/view";
import type { CodeMirror } from "@replit/codemirror-vim";

import { describe, expect, it } from "vitest";

import {
  attachVimImeGuard,
  initialVimMode,
  shouldBlockImeInput,
  type VimModeName,
} from "../vim-ime-guard";

interface FakeCm {
  emit(mode: string): void;
  handlers: Map<string, ((ev: { mode: string }) => void)[]>;
  off(type: string, f: (ev: { mode: string }) => void): void;
  offCalls: number;
  on(type: string, f: (ev: { mode: string }) => void): void;
  state: {
    overwrite?: boolean;
    vim?: { insertMode?: boolean; visualMode?: boolean };
  };
}

function fireBeforeInput(el: HTMLElement, inputType: string): InputEvent {
  const e = new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    inputType,
  });
  el.dispatchEvent(e);
  return e;
}

function makeCm(
  vim: undefined | { insertMode?: boolean; visualMode?: boolean } = {},
  overwrite = false,
): FakeCm {
  const handlers = new Map<string, ((ev: { mode: string }) => void)[]>();
  return {
    handlers,
    offCalls: 0,
    state: { overwrite, vim },
    on(type, f) {
      handlers.set(type, [...(handlers.get(type) ?? []), f]);
    },
    off(type, f) {
      this.offCalls++;
      handlers.set(
        type,
        (handlers.get(type) ?? []).filter((g) => g !== f),
      );
    },
    emit(mode: string) {
      for (const f of handlers.get("vim-mode-change") ?? []) f({ mode });
    },
  };
}

function makeView(): { contentDOM: HTMLElement } {
  return { contentDOM: document.createElement("div") };
}

const asView = (v: { contentDOM: HTMLElement }) => v as unknown as EditorView;
const asCm = (c: FakeCm) => c as unknown as CodeMirror;

describe("shouldBlockImeInput — mode matrix", () => {
  it.each([
    ["normal", true],
    ["visual", true],
    ["insert", false],
    ["replace", false], // R needs real text input
  ] as [VimModeName, boolean][])("%s → block=%s", (mode, expected) => {
    expect(shouldBlockImeInput(mode)).toBe(expected);
  });
});

describe("initialVimMode — seed from state booleans", () => {
  it("derives insert/visual/normal, and defaults to normal without vim state", () => {
    expect(initialVimMode(asCm(makeCm({ insertMode: true })))).toBe("insert");
    expect(initialVimMode(asCm(makeCm({ visualMode: true })))).toBe("visual");
    expect(initialVimMode(asCm(makeCm({})))).toBe("normal");
    expect(initialVimMode(asCm(makeCm(undefined)))).toBe("normal");
  });

  it("reports replace (not insert) when overwrite is set — R is insertMode+overwrite", () => {
    // Codex S2 gate: without the overwrite check a seeded R editor would
    // misreport "insert", feeding S3's StatusBar the wrong mode.
    expect(initialVimMode(asCm(makeCm({ insertMode: true }, true)))).toBe(
      "replace",
    );
  });
});

describe("attachVimImeGuard", () => {
  it("blocks insertText in seeded normal mode WITHOUT any mode-change event", () => {
    // The first vim-mode-change fires before listeners attach — the seed is
    // the only thing standing between a Korean user and document pollution.
    const view = makeView();
    attachVimImeGuard(asView(view), asCm(makeCm({})));
    expect(
      fireBeforeInput(view.contentDOM, "insertText").defaultPrevented,
    ).toBe(true);
    expect(
      fireBeforeInput(view.contentDOM, "insertReplacementText")
        .defaultPrevented,
    ).toBe(true);
  });

  it("does not block unrelated inputTypes (deleteContentBackward)", () => {
    const view = makeView();
    attachVimImeGuard(asView(view), asCm(makeCm({})));
    expect(
      fireBeforeInput(view.contentDOM, "deleteContentBackward")
        .defaultPrevented,
    ).toBe(false);
  });

  it("releases in insert/replace and re-blocks in normal/visual", () => {
    const view = makeView();
    const cm = makeCm({});
    attachVimImeGuard(asView(view), asCm(cm));

    cm.emit("insert");
    expect(
      fireBeforeInput(view.contentDOM, "insertText").defaultPrevented,
    ).toBe(false);

    cm.emit("normal");
    expect(
      fireBeforeInput(view.contentDOM, "insertText").defaultPrevented,
    ).toBe(true);

    cm.emit("replace"); // R — real replace mode types text
    expect(
      fireBeforeInput(view.contentDOM, "insertText").defaultPrevented,
    ).toBe(false);

    cm.emit("visual");
    expect(
      fireBeforeInput(view.contentDOM, "insertText").defaultPrevented,
    ).toBe(true);
  });

  it("seeds an insert-mode editor with the guard OFF", () => {
    const view = makeView();
    attachVimImeGuard(asView(view), asCm(makeCm({ insertMode: true })));
    expect(
      fireBeforeInput(view.contentDOM, "insertText").defaultPrevented,
    ).toBe(false);
  });

  it("reports the seeded mode and subsequent changes via onModeChange", () => {
    const view = makeView();
    const cm = makeCm({});
    const seen: VimModeName[] = [];
    attachVimImeGuard(asView(view), asCm(cm), (m) => seen.push(m));
    cm.emit("insert");
    cm.emit("normal");
    expect(seen).toEqual(["normal", "insert", "normal"]);
  });

  it("keeps blocking through r / operator-pending — no mode event is emitted", () => {
    // lowercase r and operator-pending (d, c, y …) emit NO vim-mode-change.
    // The guard must keep blocking across consecutive inputs: the raw
    // insertion is cancelled and the keydown drives vim's literal
    // replacement / pending operator (plan constraint, Codex final gate).
    const view = makeView();
    const cm = makeCm({});
    attachVimImeGuard(asView(view), asCm(cm));
    expect(
      fireBeforeInput(view.contentDOM, "insertText").defaultPrevented,
    ).toBe(true);
    expect(
      fireBeforeInput(view.contentDOM, "insertReplacementText")
        .defaultPrevented,
    ).toBe(true);
    expect(
      fireBeforeInput(view.contentDOM, "insertText").defaultPrevented,
    ).toBe(true);
    expect(cm.handlers.get("vim-mode-change")?.length).toBe(1); // still just the guard's listener; nothing was emitted
  });

  it("cancels in the CAPTURE phase — a bubble listener already sees defaultPrevented", () => {
    // Regression: with the guard on bubble instead of capture, this bubble
    // observer (registered FIRST) would run before the guard and see false.
    const view = makeView();
    let preventedAtBubble = false;
    view.contentDOM.addEventListener("beforeinput", (e) => {
      preventedAtBubble = e.defaultPrevented;
    });
    attachVimImeGuard(asView(view), asCm(makeCm({})));
    fireBeforeInput(view.contentDOM, "insertText");
    expect(preventedAtBubble).toBe(true);
  });

  it("blocks insertCompositionText in normal mode (other-platform coverage)", () => {
    const view = makeView();
    attachVimImeGuard(asView(view), asCm(makeCm({})));
    expect(
      fireBeforeInput(view.contentDOM, "insertCompositionText")
        .defaultPrevented,
    ).toBe(true);
  });

  it("seeds a replace-mode (R) editor with the guard OFF and reports it", () => {
    const view = makeView();
    const seen: VimModeName[] = [];
    attachVimImeGuard(
      asView(view),
      asCm(makeCm({ insertMode: true }, true)),
      (m) => seen.push(m),
    );
    expect(seen).toEqual(["replace"]);
    expect(
      fireBeforeInput(view.contentDOM, "insertText").defaultPrevented,
    ).toBe(false);
  });

  it("dispose removes both the DOM listener and the vim listener", () => {
    const view = makeView();
    const cm = makeCm({});
    const dispose = attachVimImeGuard(asView(view), asCm(cm));
    dispose();
    expect(
      fireBeforeInput(view.contentDOM, "insertText").defaultPrevented,
    ).toBe(false);
    expect(cm.offCalls).toBe(1);
    expect(cm.handlers.get("vim-mode-change")).toEqual([]);
  });
});
