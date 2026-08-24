// §298 Vim Phase 1 — cursor-follow scrolling routes through the vim
// adapter. This is where the device finding "the view does not follow hjkl"
// is pinned: the transaction no longer carries PM's scrollIntoView flag
// (that ran the geometry pass twice — review P4), so the ADAPTER call at the
// right target is the contract. PM's own pipeline cannot serve it (ops-R8): PM's default scrollIntoView measures hidden (windowed)
// blocks, adds VISUAL deltas to content-space scrollTop, and follows the
// normalized PM head — the wrong end of an inverted visual selection.

import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBaramExtensions } from "../../../index";
import { scrollCursorIntoView } from "../adapters/scroll";
import { vimPluginKey } from "../vim-keys";
import { type VimPluginState } from "../vim-plugin";

vi.mock("../adapters/scroll", async (importOriginal) => {
  const actual = await importOriginal<object>();
  return {
    ...actual,
    scrollCursorIntoView: vi.fn(),
    scrollCursorToCenter: vi.fn(),
  };
});

const editors: Editor[] = [];

function makeEditor(content: string): Editor {
  const editor = new Editor({ content, extensions: createBaramExtensions() });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  vi.clearAllMocks();
  for (const e of editors.splice(0)) e.destroy();
});

function enable(editor: Editor): void {
  editor.view.dispatch(
    editor.state.tr.setMeta(vimPluginKey, {
      enabled: true,
      type: "setEnabled",
    }),
  );
}

function key(editor: Editor, k: string): void {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: k }),
  );
}

function lastScrolledPos(): number {
  const calls = vi.mocked(scrollCursorIntoView).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][1];
}

function vim(editor: Editor): VimPluginState {
  return vimPluginKey.getState(editor.state) as unknown as VimPluginState;
}

describe("vim cursor-follow scrolling (ops-R8)", () => {
  it("a motion scrolls through the vim adapter at the motion target", () => {
    const editor = makeEditor("<p>one</p><p>two</p>");
    editor.commands.setTextSelection(1);
    enable(editor);
    key(editor, "j");
    expect(lastScrolledPos()).toBe(editor.state.selection.head);
  });

  it("an INVERTED visual motion follows the vim head, not PM's", () => {
    const editor = makeEditor("<p>one</p><p>two</p><p>tri</p>");
    editor.commands.setTextSelection(6); // middle line "two"
    enable(editor);
    key(editor, "v");
    key(editor, "k"); // head moves UP — selection inverts
    const head = vim(editor).core.visual?.headCursor;
    expect(head).toBeDefined();
    expect(lastScrolledPos()).toBe(head);
    // PM's normalized head is the HIGH end — must not be the target
    expect(editor.state.selection.head).not.toBe(head);
  });

  it("u with NO history to undo does not move the viewport", () => {
    // ops-R9: at undo-depth zero the selection cannot change — snapping
    // the wheel-scrolled viewport back to the cursor is a surprise.
    const editor = makeEditor("<p>one</p>");
    editor.commands.setTextSelection(1);
    enable(editor);
    vi.mocked(scrollCursorIntoView).mockClear();
    key(editor, "u");
    expect(scrollCursorIntoView).not.toHaveBeenCalled();
  });

  it("u WITH history follows the restored cursor", () => {
    const editor = makeEditor("<p>abc</p>");
    editor.commands.setTextSelection(1);
    enable(editor);
    key(editor, "x"); // creates an undoable step
    vi.mocked(scrollCursorIntoView).mockClear();
    key(editor, "u");
    expect(editor.state.doc.textContent).toBe("abc");
    expect(scrollCursorIntoView).toHaveBeenCalled();
  });

  it("an edit landing scrolls through the vim adapter too", () => {
    const editor = makeEditor("<p>one</p><p>two</p>");
    editor.commands.setTextSelection(1);
    enable(editor);
    key(editor, "d");
    key(editor, "d");
    expect(lastScrolledPos()).toBe(editor.state.selection.head);
  });
});
