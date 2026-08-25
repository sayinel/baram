// §298 — vim cursor entry into a code block must hand off to the CM island
// EXPLICITLY.
//
// prosemirror-view's selectionToDOM() is gated by editorOwnsSelection(view):
// on a NON-editable view (vim normal mode) the gate requires a DOM selection
// fully inside view.dom plus an activeElement containing view.dom. Vim modal
// routinely breaks those preconditions (ranged selections are wiped by the
// phantom-highlight defense; a source-mode roundtrip relocates the DOM
// selection), so PM cannot be relied on to descend into
// NodeView.setSelection — the one hook that focuses CodeMirror and carries
// the cursor in. Device signature:
// `dispatchCursor parent=codeBlock` with NO setSelection, invisible landing,
// next j skips past the block (reviewer: "들어갈 때도 있고 안 들어가질 때도
// 있음" — the flake is whether a STALE DOM range happens to sit inside
// view.dom at dispatch time).

import type { VimPluginState } from "../vim-plugin";

import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it, vi } from "vitest";

// The cold-island protocol needs to observe the callers' focus FALLBACK:
// a spy stands in for focusEditorView (a focus nicety that is a no-op on
// jsdom's detached DOM anyway).
const focusEditorViewSpy = vi.hoisted(() => vi.fn());
vi.mock("../../../../utils/editor/focus-editor-view", () => ({
  focusEditorView: focusEditorViewSpy,
}));

import { markdownToProsemirror } from "../../../../pipeline/md-to-pm";
import { createBaramExtensions } from "../../../index";
import {
  enterCodeBlockAt,
  registerCodeBlockEntry,
} from "../../../nodes/views/code-block-cm-registry";
import { CodeBlockNodeView } from "../../../nodes/views/code-block-node-view";
import { vimPluginKey } from "../vim-keys";
import { submitSearchLine } from "../vim-search-line";

if (typeof window.matchMedia !== "function") {
  window.matchMedia = () =>
    ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList;
}

// jsdom lacks Range measurement — an attached CodeMirror schedules a rAF
// measure pass that would otherwise throw asynchronously (same polyfill as
// code-block-vim-wiring.test.ts).
const zeroRect = {
  bottom: 0,
  height: 0,
  left: 0,
  right: 0,
  top: 0,
  width: 0,
  x: 0,
  y: 0,
};
Range.prototype.getBoundingClientRect ??= () => zeroRect as DOMRect;
Range.prototype.getClientRects ??= () =>
  ({
    item: () => null,
    length: 0,
    [Symbol.iterator]: [][Symbol.iterator],
  }) as unknown as DOMRectList;
HTMLElement.prototype.getClientRects ??= Range.prototype.getClientRects;

const editors: Editor[] = [];

function createEditor(md: string): Editor {
  const editor = new Editor({
    content: "",
    extensions: createBaramExtensions(),
  });
  const doc = markdownToProsemirror(md, editor.schema);
  editor.commands.setContent(doc.toJSON());
  editors.push(editor);
  return editor;
}

function press(editor: Editor, key: string): void {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }),
  );
}

function setVim(editor: Editor, enabled: boolean): void {
  editor.view.dispatch(
    editor.state.tr.setMeta(vimPluginKey, { enabled, type: "setEnabled" }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const e of editors.splice(0)) e.destroy();
});

describe("vim code block entry handoff (§298)", () => {
  it("j into a code block calls NodeView.setSelection even with an empty DOM selection", () => {
    const editor = createEditor(
      "start\n\n```ts\nconst x = 1;\nconst y = 2;\n```\n\nend\n",
    );
    setVim(editor, true);

    // Cursor on the paragraph line above the block.
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)),
    );

    // An empty DOM selection — one of the gate-closing states vim modal
    // routinely produces (production wipes RANGED selections; a roundtrip
    // relocates the selection entirely).
    window.getSelection()?.removeAllRanges();

    const handoff = vi.spyOn(CodeBlockNodeView.prototype, "setSelection");
    press(editor, "j");

    // Sanity: the vim line-model DID land inside the code block…
    const $head = editor.state.selection.$head;
    expect($head.parent.type.name).toBe("codeBlock");

    // …and the island handoff must fire regardless of PM's DOM-selection
    // gate (node-LOCAL offsets, same contract PM's docView descent uses).
    expect(handoff).toHaveBeenCalled();
    const local = $head.parentOffset;
    expect(handoff).toHaveBeenCalledWith(local, local);
  });

  it("search submit into a COLD code block: handoff memos AND the focus fallback stays alive", () => {
    const editor = createEditor(
      "start\n\n```ts\nconst x = 1;\nconst y = 2;\n```\n\nend\n",
    );
    setVim(editor, true);
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)),
    );

    // Open the search line the way the StatusBar input path leaves it.
    const vim = vimPluginKey.getState(
      editor.state,
    ) as unknown as VimPluginState;
    editor.view.dispatch(
      editor.state.tr.setMeta(vimPluginKey, {
        core: {
          ...vim.core,
          searchLine: { direction: "forward" as const, text: "y = 2" },
        },
        type: "core",
      }),
    );

    window.getSelection()?.removeAllRanges();
    const handoff = vi.spyOn(CodeBlockNodeView.prototype, "setSelection");
    focusEditorViewSpy.mockClear();
    submitSearchLine(editor);

    const $head = editor.state.selection.$head;
    expect($head.parent.type.name).toBe("codeBlock");
    expect(handoff).toHaveBeenCalledWith(
      $head.parentOffset,
      $head.parentOffset,
    );
    // The island is COLD here (lazy CM never mounted in jsdom): the enter
    // must report false so the caller keeps PM focused until the island
    // claims focus on mount — a true from a cold island would strand the
    // keyboard (review round 2, major).
    expect(focusEditorViewSpy).toHaveBeenCalled();
  });

  it("entry registry: per-view isolation, detached getPos, unregister", () => {
    const viewA = {} as never;
    const viewB = {} as never;
    const calls: string[] = [];
    const offA = registerCodeBlockEntry(
      viewA,
      () => 5,
      (a, h) => {
        calls.push(`A:${a},${h}`);
        return true;
      },
    );
    registerCodeBlockEntry(
      viewB,
      () => 5,
      () => {
        calls.push("B");
        return true;
      },
    );
    // A DETACHED NodeView's getPos() returns undefined (PM contract) — it
    // must never answer, even at a matching Set slot.
    registerCodeBlockEntry(
      viewA,
      () => undefined,
      () => {
        calls.push("detached");
        return true;
      },
    );
    expect(enterCodeBlockAt(viewA, 5, 1, 1)).toBe(true);
    expect(calls).toEqual(["A:1,1"]); // other view + detached: silent
    offA();
    expect(enterCodeBlockAt(viewA, 5, 1, 1)).toBe(false);
  });

  it("entry registry: recreation at the same position — only the live registrant answers", () => {
    const view = {} as never;
    const calls: string[] = [];
    const offOld = registerCodeBlockEntry(
      view,
      () => 5,
      () => {
        calls.push("old");
        return true;
      },
    );
    offOld(); // NodeView.destroy() of the replaced instance
    registerCodeBlockEntry(
      view,
      () => 5,
      () => {
        calls.push("new");
        return true;
      },
    );
    expect(enterCodeBlockAt(view, 5, 0, 0)).toBe(true);
    expect(calls).toEqual(["new"]);
  });

  it("entry registry: a COLD registrant's false propagates to the caller", () => {
    const view = {} as never;
    registerCodeBlockEntry(
      view,
      () => 7,
      () => false,
    );
    expect(enterCodeBlockAt(view, 7, 0, 0)).toBe(false);
  });

  it("CONTROL: the same j with a DOM selection parked inside view.dom still lands in the block", () => {
    // Guards the sanity precondition of the pin above: the landing itself
    // never depended on the DOM-selection gate — only the handoff did.
    const editor = createEditor("start\n\n```ts\nconst x = 1;\n```\n\nend\n");
    setVim(editor, true);
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)),
    );
    press(editor, "j");
    expect(editor.state.selection.$head.parent.type.name).toBe("codeBlock");
  });
});
