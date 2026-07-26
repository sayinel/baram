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
