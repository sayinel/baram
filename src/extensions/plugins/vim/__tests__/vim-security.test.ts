// §298 vim — security pins (dedicated security review).
//
// Two trust/resource boundaries the functional pins do not cover:
//  1. island markers are an app CAPABILITY, not document content — a shared
//     markdown file must not be able to grant itself vim suspension (or,
//     worse, deny it inside a real island and let vim read the user's
//     keystrokes as commands);
//  2. counted operations are user-typed but their COST is document-driven —
//     a big register times a big count must be refused, not attempted.

import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { useUIStore } from "../../../../stores/ui/ui";
import { sanitizeHtmlBlock } from "../../../../utils/markdown/html-sanitize";
import { sanitizeSvg } from "../../../../utils/markdown/svg-utils";
import { createBaramExtensions } from "../../../index";
import { budgetRefusal, pasteRegister } from "../adapters/paste";
import { resetVimRegister, writeVimRegister } from "../adapters/register";
import { vimPluginKey } from "../vim-keys";

const MARKERS = ["data-vim-suspend", "data-node-view-content"];

const editors: Editor[] = [];

function makeEditor(content: string): Editor {
  const editor = new Editor({ content, extensions: createBaramExtensions() });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  resetVimRegister();
  for (const e of editors.splice(0)) e.destroy();
});

describe("island markers are not document-grantable", () => {
  it("sanitized HTML cannot carry vim island markers", () => {
    for (const marker of MARKERS) {
      const out = sanitizeHtmlBlock(
        `<div ${marker} tabindex="0"><input ${marker}></div>`,
      );
      expect(out).not.toContain(marker);
    }
    // DOMPurify keeps data-* and tabindex by default, so the markers must be
    // forbidden explicitly — the rest of the element may survive.
    expect(sanitizeHtmlBlock('<div data-other="1">x</div>')).toContain(
      "data-other",
    );
  });

  it("sanitized SVG cannot carry vim island markers", () => {
    for (const marker of MARKERS) {
      const out = sanitizeSvg(
        `<svg xmlns="http://www.w3.org/2000/svg"><rect ${marker} /></svg>`,
      );
      expect(out).not.toContain(marker);
    }
  });
});

describe("counted paste is budgeted", () => {
  it("refuses a projected insertion beyond the work budget", () => {
    const editor = makeEditor(`<p>${"x".repeat(4000)}</p>`);
    const slice = editor.state.doc.slice(1, 4000);
    writeVimRegister({ kind: "char", slice: slice.toJSON() });
    const before = editor.state.doc.content.size;
    const outcome = pasteRegister(
      editor.state,
      1,
      { kind: "char", slice: slice.toJSON() },
      false,
      9999,
    );
    expect(outcome.tr).toBeNull();
    expect(outcome.reason).toBeTruthy();
    expect(editor.state.doc.content.size).toBe(before); // nothing attempted
  });

  it("exempts count 1 at ANY size — amplification is the vulnerability", () => {
    // A register over the budget still pastes once: it holds what the user
    // just yanked from the open document, so there is nothing to amplify.
    expect(budgetRefusal(5_000_000, 1, 500)).toBeNull(); // count 1: exempt
    expect(budgetRefusal(5_000_000, 2)).not.toBeNull(); // weight ceiling
    expect(budgetRefusal(1000, 9999)).not.toBeNull(); // weight ceiling
    expect(budgetRefusal(100, 400, 1)).toBeNull(); // ordinary counted paste
  });

  it("never refuses an UNAMPLIFIED paste — count 1 is what the user yanked", () => {
    // The vulnerability is count AMPLIFICATION, not size: moving 3000 lines
    // with dd then p must keep working however big the register is.
    const editor = makeEditor(`<p>${"x".repeat(4000)}</p>`);
    const slice = editor.state.doc.slice(1, 4000);
    const outcome = pasteRegister(
      editor.state,
      1,
      { kind: "char", slice: slice.toJSON() },
      false,
      1,
    );
    expect(outcome.reason).toBeUndefined();
    expect(outcome.tr).not.toBeNull();
  });

  it("budgets the ADAPTED shape — list wrapping cannot double the cap", () => {
    // Wrapping top-level blocks as list items grows each one (an empty
    // paragraph becomes a 4-position item), so budgeting the raw register
    // let ~2x through: 100 paragraphs x 9999 measured under the cap but
    // inserted ~4M positions and a million list items.
    const editor = makeEditor("<ul><li><p>anchor</p></li></ul>");
    const paragraph = editor.state.schema.nodes.paragraph.create();
    const register = {
      content: Array.from({ length: 100 }, () => paragraph.toJSON()),
      context: "top" as const,
      kind: "line" as const,
    };
    let itemPos = -1;
    editor.state.doc.descendants((n, p) => {
      if (itemPos < 0 && n.type.name === "paragraph") itemPos = p;
      return itemPos < 0;
    });
    const outcome = pasteRegister(
      editor.state,
      itemPos + 1,
      register,
      true,
      9999,
    );
    expect(outcome.tr).toBeNull();
    expect(outcome.reason).toBeTruthy();
  });

  it("budgets ATTRIBUTE payload — an atom's nodeSize hides 200KB of HTML", () => {
    // htmlBlock/svgBlock/image keep their payload in attrs, so positions
    // alone measured 1 per node: 9999p of a 200KB html block passed the cap
    // and would have mounted 9999 sanitizing NodeViews (final review).
    const editor = makeEditor("<p>anchor</p>");
    const html = editor.state.schema.nodes.htmlBlock.create({
      content: "<div>" + "x".repeat(200_000) + "</div>",
    });
    const outcome = pasteRegister(
      editor.state,
      1,
      { content: [html.toJSON()], context: "top", kind: "line" },
      true,
      9999,
    );
    expect(outcome.tr).toBeNull();
    expect(outcome.reason).toBeTruthy();
  });

  it("budgets NODE COUNT — 9999 cheap atoms still mount 9999 views", () => {
    expect(budgetRefusal(1, 9999, 1)).not.toBeNull();
    expect(budgetRefusal(1, 9999, 1)?.tr).toBeNull();
    expect(budgetRefusal(10, 500, 2)).toBeNull(); // 1000 nodes — fine
  });

  it("a refused operation TELLS the user (toast, not a silent no-op)", () => {
    const editor = makeEditor(`<p>${"x".repeat(4000)}</p>`);
    editor.commands.setTextSelection(1);
    editor.view.dispatch(
      editor.state.tr.setMeta(vimPluginKey, {
        enabled: true,
        type: "setEnabled",
      }),
    );
    writeVimRegister({
      kind: "char",
      slice: editor.state.doc.slice(1, 4000).toJSON(),
    });
    useUIStore.getState().dismissToast();
    for (const key of ["9", "9", "9", "9", "p"]) {
      editor.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }),
      );
    }
    expect(editor.state.doc.textContent).toHaveLength(4000); // untouched
    expect(useUIStore.getState().toast?.message).toContain("too large");
  });

  it("routine no-ops stay OUT of the single toast slot", () => {
    const editor = makeEditor("<p>abc</p>");
    editor.commands.setTextSelection(1);
    editor.view.dispatch(
      editor.state.tr.setMeta(vimPluginKey, {
        enabled: true,
        type: "setEnabled",
      }),
    );
    resetVimRegister();
    useUIStore.getState().showToast("a save just happened", "info");
    const press = (key: string) =>
      editor.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }),
      );
    press("p"); // empty register
    press("$");
    press("x"); // may find nothing to delete at the boundary
    press("f");
    press("z"); // char not found
    // the app's own toast survives — vim's no-ops never took the slot
    expect(useUIStore.getState().toast?.message).toBe("a save just happened");
  });

  it("still allows ordinary counted pastes", () => {
    const editor = makeEditor("<p>abcdef</p>");
    const slice = editor.state.doc.slice(1, 4);
    const outcome = pasteRegister(
      editor.state,
      1,
      { kind: "char", slice: slice.toJSON() },
      false,
      50,
    );
    expect(outcome.reason).toBeUndefined();
    expect(outcome.tr).not.toBeNull();
  });
});
