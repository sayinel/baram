// §298 Phase 0a smoke follow-up — markdown list continuation under vim.
//
// User-reported: with vim on, breaking a (nested) list line does not keep the
// bullet. markdown() binds Enter → insertNewlineContinueMarkup at Prec.high,
// but vim's ViewPlugin keydown handler (Prec.highest) sees the key first.
// These tests pin who wins the Enter keydown in each mode, with a vim-off
// baseline to prove the jsdom routing harness itself is valid.

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import * as vimModule from "@replit/codemirror-vim";
import { getCM, Vim, vim } from "@replit/codemirror-vim";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { registerListContinuation } from "../vim-mode";

// CM6 measures text with Range client rects, which jsdom does not implement.
beforeAll(() => {
  const rect = {
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    toJSON: () => ({}),
    top: 0,
    width: 0,
    x: 0,
    y: 0,
  };
  Range.prototype.getBoundingClientRect ??= () => rect as DOMRect;
  Range.prototype.getClientRects ??= () =>
    ({
      item: () => null,
      length: 0,
      [Symbol.iterator]: [][Symbol.iterator],
    }) as unknown as DOMRectList;
  HTMLElement.prototype.getClientRects ??= Range.prototype.getClientRects;
  // Production wires this inside loadVimModule(); tests import the module
  // statically, so register the global slot explicitly.
  registerListContinuation(vimModule);
});

const views: EditorView[] = [];

afterEach(() => {
  for (const v of views.splice(0)) v.destroy();
});

function makeEditor(doc: string, cursor: number, withVim: boolean) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        withVim ? Prec.highest(vim()) : [],
        keymap.of([...defaultKeymap, ...historyKeymap]),
        history(),
        markdown(),
      ],
      selection: EditorSelection.cursor(cursor),
    }),
  });
  views.push(view);
  return view;
}

function pressEnter(view: EditorView) {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "Enter",
      key: "Enter",
    }),
  );
}

const NESTED = "- item one\n  - nested item";
const END = NESTED.length;

describe("markdown list continuation under vim (§298 smoke bug)", () => {
  it("baseline: vim OFF, Enter at end of nested item continues the bullet", () => {
    const view = makeEditor(NESTED, END, false);
    pressEnter(view);
    // Harness validity gate: if this fails, keydown routing does not work in
    // jsdom and the vim assertions below prove nothing.
    expect(view.state.doc.toString()).toBe(`${NESTED}\n  - `);
  });

  it("vim ON, insert mode: Enter continues the bullet", () => {
    const view = makeEditor(NESTED, END, true);
    const cm = getCM(view);
    expect(cm).not.toBeNull();
    Vim.handleKey(cm!, "i", "user");
    expect(cm!.state.vim?.insertMode).toBe(true);
    pressEnter(view);
    expect(view.state.doc.toString()).toBe(`${NESTED}\n  - `);
  });

  it("vim ON, normal mode: o keeps the nested bullet", () => {
    const view = makeEditor(NESTED, END - 1, true);
    const cm = getCM(view);
    Vim.handleKey(cm!, "o", "user");
    expect(cm!.state.vim?.insertMode).toBe(true);
    expect(view.state.doc.toString()).toBe(`${NESTED}\n  - `);
  });

  it("vim ON: O continues from the line ABOVE (vim opens via its end)", () => {
    // Cursor on the nested line; O moves to the end of "- item one" first,
    // so the continuation context is the top-level bullet.
    const view = makeEditor(NESTED, END - 1, true);
    const cm = getCM(view);
    Vim.handleKey(cm!, "O", "user");
    expect(view.state.doc.toString()).toBe("- item one\n- \n  - nested item");
  });

  it("vim ON: u after o undoes the opened line in one step", () => {
    const view = makeEditor(NESTED, END - 1, true);
    const cm = getCM(view);
    Vim.handleKey(cm!, "o", "user");
    Vim.handleKey(cm!, "<Esc>", "user");
    Vim.handleKey(cm!, "u", "user");
    expect(view.state.doc.toString()).toBe(NESTED);
  });

  it("undo parity: o + typed text takes the SAME two steps as stock vim", () => {
    // Codex finding 2 claimed the markdown path breaks single-u atomicity.
    // Probe against the STOCK adapter path (non-markdown doc, pure
    // newlineAndIndent) showed upstream is ALSO two-step: u #1 removes the
    // typed text, u #2 removes the opened line. Single-u atomicity does not
    // exist upstream; the contract here is parity, pinned in both steps.
    const view = makeEditor(NESTED, END - 1, true);
    const cm = getCM(view);
    Vim.handleKey(cm!, "o", "user");
    const head = view.state.selection.main.head;
    // Simulate insert-mode typing via the native input userEvent.
    view.dispatch({
      changes: { from: head, insert: "typed" },
      selection: EditorSelection.cursor(head + 5),
      userEvent: "input.type",
    });
    Vim.handleKey(cm!, "<Esc>", "user");
    Vim.handleKey(cm!, "u", "user");
    expect(view.state.doc.toString()).toBe(`${NESTED}\n  - `);
    Vim.handleKey(cm!, "u", "user");
    expect(view.state.doc.toString()).toBe(NESTED);
  });

  it("vim ON: r<CR> stays a plain line break (Codex BLOCK finding 1)", () => {
    // replace-with-newline must NOT run markdown Enter semantics — vim's
    // `replace` action never sets insertMode before hitting the slot.
    const view = makeEditor("- item", 2, true); // cursor on "i"
    const cm = getCM(view);
    Vim.handleKey(cm!, "r", "user");
    Vim.handleKey(cm!, "<CR>", "user");
    expect(view.state.doc.toString()).toBe("- \ntem");
    Vim.handleKey(cm!, "u", "user");
    expect(view.state.doc.toString()).toBe("- item");
  });

  it("vim ON: o on an EMPTY list item never deletes the marker (finding 3)", () => {
    // The Enter command's empty-item branch deletes/dedents markup — for
    // `o` that would eat the current line. The destructive-change detector
    // must reroute to a plain newline instead.
    const view = makeEditor("- ", 2, true);
    const cm = getCM(view);
    Vim.handleKey(cm!, "o", "user");
    expect(view.state.doc.toString()).toBe("- \n");
    expect(cm!.state.vim?.insertMode).toBe(true);
  });

  it("vim ON: o inside an ordered list still renumbers following items", () => {
    // Renumbering rewrites start AFTER the cursor — the destructive
    // detector must not misfire on them.
    const doc = "1. a\n2. b";
    const view = makeEditor(doc, 3, true); // cursor inside "1. a"
    const cm = getCM(view);
    Vim.handleKey(cm!, "o", "user");
    expect(view.state.doc.toString()).toBe("1. a\n2. \n3. b");
  });

  it("insert-mode <C-o>r<CR> stays a plain break (re-review finding 1)", () => {
    // Probe-verified: at slot time <C-o>r<CR> and plain `o` carry IDENTICAL
    // vim state flags (insertMode=true, insertModeReturn=false). The real
    // discriminator is curOp.lastChange — replace deletes the character
    // through the adapter BEFORE the slot runs, o/O never touch the doc
    // first. This test pins the only state-flag-invisible call site.
    const view = makeEditor("- item", 2, true); // cursor on "i"
    const cm = getCM(view);
    Vim.handleKey(cm!, "i", "user");
    Vim.handleKey(cm!, "<C-o>", "user");
    Vim.handleKey(cm!, "r", "user");
    Vim.handleKey(cm!, "<CR>", "user");
    expect(view.state.doc.toString()).toBe("- \ntem");
  });

  it("o on a tight list's empty second item opens BELOW (finding 3a)", () => {
    // The Enter command's branch here INSERTS a blank line before the empty
    // item (insertion-only, before the cursor) — the safety check must catch
    // changes that start before the cursor even when nothing is deleted.
    const doc = "- first\n- ";
    const view = makeEditor(doc, doc.length, true);
    const cm = getCM(view);
    Vim.handleKey(cm!, "o", "user");
    expect(view.state.doc.toString()).toBe("- first\n- \n");
  });

  it("o on a bullet with trailing spaces still continues (finding 3b)", () => {
    // The Enter command trims trailing whitespace by replacing a range that
    // ends at the cursor — whitespace-only replacement is the one benign
    // before-cursor change and must not trigger the fallback.
    const doc = "- item  ";
    const view = makeEditor(doc, doc.length, true);
    const cm = getCM(view);
    Vim.handleKey(cm!, "o", "user");
    expect(view.state.doc.toString()).toBe("- item\n- ");
  });

  it("macro replay keeps continuation: @a replays x,o identically (round 3)", () => {
    // curOp.lastChange is operation-scoped and macro replay shares ONE op
    // across all recorded keys — the discriminator must not be poisoned by
    // the replayed `x` that precedes `o`.
    const view = makeEditor("- item", 2, true);
    const cm = getCM(view);
    Vim.handleKey(cm!, "q", "user");
    Vim.handleKey(cm!, "a", "user");
    Vim.handleKey(cm!, "x", "user");
    Vim.handleKey(cm!, "o", "user");
    Vim.handleKey(cm!, "<Esc>", "user");
    Vim.handleKey(cm!, "q", "user");
    const recorded = view.state.doc.toString();
    expect(recorded).toBe("- tem\n- ");

    const view2 = makeEditor("- item", 2, true);
    const cm2 = getCM(view2);
    Vim.handleKey(cm2!, "@", "user");
    Vim.handleKey(cm2!, "a", "user");
    expect(view2.state.doc.toString()).toBe(recorded);
  });

  it("counted 3o keeps stock undo grouping (round 3, finding 2)", () => {
    // Esc-time repetitions run with NO curOp and must tag plain .compose —
    // a constant .start would give each repeated line its own undo group
    // (four undos instead of stock's two).
    const view = makeEditor("- item", 2, true);
    const cm = getCM(view);
    Vim.handleKey(cm!, "3", "user");
    Vim.handleKey(cm!, "o", "user");
    const head = view.state.selection.main.head;
    view.dispatch({
      changes: { from: head, insert: "x" },
      selection: EditorSelection.cursor(head + 1),
      userEvent: "input.type",
    });
    Vim.handleKey(cm!, "<Esc>", "user");
    expect(view.state.doc.toString()).toBe("- item\n- x\n- x\n- x");
    Vim.handleKey(cm!, "u", "user");
    Vim.handleKey(cm!, "u", "user");
    expect(view.state.doc.toString()).toBe("- item");
  });

  it("accepted deviation: <C-o>r<CR> on a line's LAST char gains a bullet", () => {
    // The EOL discriminator cannot see this one case (the pre-delete puts
    // the cursor exactly at the new line end). It behaves like Enter at
    // EOL — benign, pinned so a future fix surfaces here.
    const view = makeEditor("- item", 5, true); // cursor on "m"
    const cm = getCM(view);
    Vim.handleKey(cm!, "i", "user");
    Vim.handleKey(cm!, "<C-o>", "user");
    Vim.handleKey(cm!, "r", "user");
    Vim.handleKey(cm!, "<CR>", "user");
    expect(view.state.doc.toString()).toBe("- ite\n- ");
  });

  it("known limitation: O on the FIRST document line opens without a bullet", () => {
    // The adapter special-cases first-line O with a raw replaceRange and
    // never consults the continuation slot — pinned so an upstream change
    // surfaces here.
    const view = makeEditor("- item", 3, true);
    const cm = getCM(view);
    Vim.handleKey(cm!, "O", "user");
    expect(view.state.doc.toString()).toBe("\n- item");
  });

  it("readOnly state: o writes nothing (parity with the adapter's guard)", () => {
    // The adapter's dispatchChange refuses writes under state.readOnly; the
    // markdown branch must not differ (insertNewlineContinueMarkup itself
    // has no readOnly guard).
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: NESTED,
        extensions: [
          Prec.highest(vim()),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          history(),
          markdown(),
          EditorState.readOnly.of(true),
        ],
        selection: EditorSelection.cursor(END - 1),
      }),
    });
    views.push(view);
    const cm = getCM(view);
    Vim.handleKey(cm!, "o", "user");
    expect(view.state.doc.toString()).toBe(NESTED);
  });

  it("non-markdown doc: o falls back to plain newline+indent, no crash", () => {
    // Code-file tabs share the vim path but have no markdown context;
    // insertNewlineContinueMarkup must return false and delegate.
    const doc = "const x = 1;";
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          Prec.highest(vim()),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          history(),
        ],
        selection: EditorSelection.cursor(doc.length - 1),
      }),
    });
    views.push(view);
    const cm = getCM(view);
    Vim.handleKey(cm!, "o", "user");
    expect(view.state.doc.toString()).toBe(`${doc}\n`);
  });
});
