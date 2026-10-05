// §384 / spec 0067 §4 · §11-1 — the position-preserving collapse.
//
// Each `it` names what makes it fail. The siblings that run the LEGACY collapse
// (`legacyCollapseTr`, the pre-§4 `replaceWith`) are the proof that the assertion can fail.
import type { DecorationSet } from "@tiptap/pm/view";

import { Editor } from "@tiptap/core";
import { closeHistory, undo } from "@tiptap/pm/history";
import { TextSelection } from "@tiptap/pm/state";
import { describe, expect, it, vi } from "vitest";

const { openUrl } = vi.hoisted(() => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

import { createBaramExtensions } from "../../extensions";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { serializeLiveDoc } from "../../utils/editor/serialize-live-doc";
import { blockIdDecoKey } from "../plugins/block-id-widgets";
import { foldPluginKey } from "../plugins/fold-state";
import { listAtomFixKey } from "../plugins/list-atom-fix";
import { promptHighlightKey } from "../plugins/prompt-highlight";
import {
  forceCollapseSyntaxReveal,
  getSyntaxRevealExpanded,
} from "../plugins/syntax-reveal";
import {
  buildCollapseTr,
  collapseExpanded,
} from "../plugins/syntax-reveal-collapse";
import {
  INACTIVE,
  MARK_DELIMITERS,
  syntaxRevealKey,
} from "../plugins/syntax-reveal-state";
import { legacyCollapseTr } from "./legacy-collapse";

function editorWith(md: string): Editor {
  const editor = new Editor({
    extensions: createBaramExtensions(),
    content: "",
  });
  editor.commands.setContent(markdownToProsemirror(md, editor.schema).toJSON());
  return editor;
}

/** "a " is 1-3, so the 4-letter word under the mark is 3-7 and 5 is "wo|rd". */
const MARK_SOURCES: Record<string, string> = {
  bold: "a **word** b\n",
  code: "a `word` b\n",
  highlight: "a ==word== b\n",
  italic: "a *word* b\n",
  strike: "a ~~word~~ b\n",
  subscript: "a ~word~ b\n",
  superscript: "a ^word^ b\n",
  underline: "a <u>word</u> b\n",
};

describe("position-preserving collapse (§384, spec 0067 §4)", () => {
  it("covers every mark the reveal knows", () => {
    expect(Object.keys(MARK_SOURCES).sort()).toEqual(
      Object.keys(MARK_DELIMITERS).sort(),
    );
  });

  it.each(Object.keys(MARK_SOURCES))(
    "%s: the new collapse yields the same document as the old one",
    (name) => {
      const editor = editorWith(MARK_SOURCES[name]);
      editor.commands.setTextSelection(5);
      const expanded = getSyntaxRevealExpanded(editor.state);
      expect(expanded?.kind).toBe("mark");
      const next = buildCollapseTr(editor.state, expanded!);
      const old = legacyCollapseTr(editor.state, expanded!);
      expect(next?.doc.eq(old!.doc)).toBe(true);
      editor.destroy();
    },
  );

  it.each([
    "a [word](https://e.x) b\n",
    'a [word](https://e.x "title") b\n',
    "a [**wo**rd](https://e.x) b\n",
  ])("link %j: the same document as the old collapse", (md) => {
    const editor = editorWith(md);
    editor.commands.setTextSelection(5);
    const expanded = getSyntaxRevealExpanded(editor.state);
    expect(expanded?.kind).toBe("link");
    expect(
      buildCollapseTr(editor.state, expanded!)?.doc.eq(
        legacyCollapseTr(editor.state, expanded!)!.doc,
      ),
    ).toBe(true);
    editor.destroy();
  });

  it("keeps inner positions at the same offset — the old collapse pushes them to the end", () => {
    const editor = editorWith(MARK_SOURCES.bold);
    editor.commands.setTextSelection(5);
    const expanded = getSyntaxRevealExpanded(editor.state)!;
    // Expanded "a **word** b": `**` 3-5, "word" 5-9, `**` 9-11.
    const next = buildCollapseTr(editor.state, expanded)!;
    for (let p = 5; p <= 9; p++) expect(next.mapping.map(p)).toBe(p - 2);
    // Sibling: what the spec §2.1 drift looks like.
    const old = legacyCollapseTr(editor.state, expanded)!;
    expect(old.mapping.map(7)).not.toBe(5);
    editor.destroy();
  });

  it.each(["Escape", "Enter"])(
    "%s collapse leaves the caret in place and stays collapsed (D10 · D11)",
    (keyName) => {
      const editor = editorWith(MARK_SOURCES.bold);
      editor.commands.setTextSelection(5); // expands; the caret is now 7 ("**wo|rd**")
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: keyName,
      });
      editor.view.dom.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(getSyntaxRevealExpanded(editor.state)).toBeNull();
      expect(editor.state.selection.from).toBe(5);
      expect(syntaxRevealKey.getState(editor.state)?.suppressed).toEqual({
        from: 3,
        to: 7,
      });
      editor.destroy();
    },
  );

  it("sibling: without the `collapsed` meta the same collapse re-expands at once (spec §2.3)", () => {
    const editor = editorWith(MARK_SOURCES.bold);
    editor.commands.setTextSelection(5);
    const tr = buildCollapseTr(
      editor.state,
      getSyntaxRevealExpanded(editor.state)!,
    )!;
    tr.setMeta(syntaxRevealKey, INACTIVE); // what a "no collapsed key" collapse would send
    editor.view.dispatch(tr);
    expect(getSyntaxRevealExpanded(editor.state)).not.toBeNull();
    editor.destroy();
  });

  it("a caret on the collapsed range's start edge stays collapsed (inclusive bounds)", () => {
    const editor = editorWith(MARK_SOURCES.bold);
    editor.commands.setTextSelection(5);
    const expanded = getSyntaxRevealExpanded(editor.state)!;
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, expanded.from),
      ),
    );
    collapseExpanded(editor.view, getSyntaxRevealExpanded(editor.state)!);
    expect(editor.state.selection.from).toBe(3);
    expect(getSyntaxRevealExpanded(editor.state)).toBeNull();
    editor.destroy();
  });

  it("a negative contentLen collapses to an empty range at `from`", () => {
    const editor = editorWith("a **x** b\n");
    editor.commands.setTextSelection(4); // inside "x" → expands: `**` 3-5, x 5-6, `**` 6-8
    // Delete "x" and the first `*` of the closing delimiter → "a *** b", still a valid expansion.
    editor.view.dispatch(editor.state.tr.delete(5, 7));
    const expanded = getSyntaxRevealExpanded(editor.state);
    expect(expanded).not.toBeNull();
    collapseExpanded(editor.view, expanded!);
    expect(syntaxRevealKey.getState(editor.state)).toEqual({
      expanded: null,
      suppressed: { from: 3, to: 3 },
    });
    editor.destroy();
  });

  it("Backspace that deletes a whole expanded mark does not open the wikilink beside it", () => {
    const editor = editorWith("x **ab**[[B]] y\n");
    editor.commands.setTextSelection(4); // expands "**ab**" 3-9; the wikilink sits at 9
    const expanded = getSyntaxRevealExpanded(editor.state)!;
    editor.commands.setTextSelection(expanded.from + 2);
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Backspace",
      }),
    );
    expect(editor.state.doc.textContent).not.toContain("ab");
    expect(getSyntaxRevealExpanded(editor.state)).toBeNull();
    editor.destroy();
  });

  it("D9 flow: typed-while-expanded text is undone after a history-free collapse", () => {
    const run = (collapse: typeof buildCollapseTr) => {
      const editor = editorWith(MARK_SOURCES.bold.replace("word", "bold"));
      editor.commands.setTextSelection(5); // "**bo|ld**" → caret 7
      editor.view.dispatch(editor.state.tr.insertText("Y", 7));
      const c = collapse(editor.state, getSyntaxRevealExpanded(editor.state)!)!;
      c.setMeta("addToHistory", false);
      editor.view.dispatch(c);
      const insert = editor.state.tr.insertText("X", 3);
      closeHistory(insert);
      editor.view.dispatch(insert);
      undo(editor.state, editor.view.dispatch);
      undo(editor.state, editor.view.dispatch);
      const text = editor.state.doc.textContent;
      editor.destroy();
      return text;
    };
    expect(run(buildCollapseTr)).toBe("a bold b");
    // Sibling (spec §2.2, second row): the old collapse's map drops the earlier step.
    expect(run(legacyCollapseTr)).toContain("boYld");
  });

  it("force-collapse keeps a caret inside a link label (spec §2.1)", () => {
    const editor = editorWith("Hello [world](https://example.com) end\n");
    editor.commands.setTextSelection(9); // "wo|rld" → expands; caret becomes 10
    const expanded = getSyntaxRevealExpanded(editor.state)!;
    const caret = editor.state.selection.from;
    // Sibling first: the old collapse pushes it to the label end.
    expect(
      legacyCollapseTr(editor.state, expanded)!.mapping.map(caret),
    ).not.toBe(9);
    forceCollapseSyntaxReveal(editor.view);
    expect(editor.state.selection.from).toBe(9);
    expect(serializeLiveDoc(editor)).toBe(
      "Hello [world](https://example.com) end\n",
    );
    editor.destroy();
  });

  // A fact pin, not a spec claim: D11 speaks of carets only. Before this change
  // force-collapse passed a `cursorTarget` and so reduced a selection to a caret.
  it("force-collapse keeps a non-empty selection, mapped through the steps", () => {
    const editor = editorWith(MARK_SOURCES.bold);
    editor.commands.setTextSelection(5); // expands "a **word** b": `**` 3-5, word 5-9
    editor.commands.setTextSelection({ from: 6, to: 8 }); // "w[or]d" inside the content
    expect(getSyntaxRevealExpanded(editor.state)).not.toBeNull();
    forceCollapseSyntaxReveal(editor.view);
    expect(getSyntaxRevealExpanded(editor.state)).toBeNull();
    expect(editor.state.selection.from).toBe(4);
    expect(editor.state.selection.to).toBe(6);
    editor.destroy();
  });
});

describe("the four changedRanges consumers end where the old collapse left them (spec §4)", () => {
  // fold.ts · block-id-entries.ts · prompt-highlight.ts · list-atom-fix.ts read
  // `changedRanges(tr)`; the new collapse reports two points instead of the whole mark.
  // Each consumer is made ACTIVE by this fixture and that is asserted first — an inactive
  // consumer would compare empty with empty and the equality could not fail (plan review M8):
  //   prompt-highlight — Skills frontmatter (`name` + `description`, `isSkillsFile`)
  //   fold             — the first heading folded (`foldPluginKey` meta `toggle`)
  //   block-id-entries — a `^abc123` block id
  //   list-atom-fix    — a list item whose first child is an atom
  const SOURCE =
    "---\nname: probe\ndescription: d\n---\n\n# Folded\n\nhidden\n\n# Open\n\nbody {{var}} **bold** ^abc123\n\n- [[Note]] item\n- two\n";

  function snapshot(editor: Editor) {
    const ranges = (set: DecorationSet) =>
      set
        .find()
        .map((d) => `${d.from}-${d.to}`)
        .sort();
    const fold = foldPluginKey.getState(editor.state)!;
    const ids = blockIdDecoKey.getState(editor.state)!;
    const list = listAtomFixKey.getState(editor.state)!;
    const prompt = promptHighlightKey.getState(editor.state) as DecorationSet;
    return {
      blockIds: ids.entries.map((e) => JSON.stringify(e)).sort(),
      doc: JSON.stringify(editor.getJSON()),
      fold: [...fold.foldedPositions].sort((a, b) => a - b),
      foldDecorations: ranges(fold.decorations),
      list: ranges(list.decorations),
      prompt: ranges(prompt),
    };
  }

  function settle(collapse: typeof buildCollapseTr, source = SOURCE) {
    const editor = editorWith(source);
    let heading = -1;
    editor.state.doc.forEach((node, pos) => {
      if (heading === -1 && node.type.name === "heading") heading = pos;
    });
    if (heading !== -1) {
      editor.view.dispatch(
        editor.state.tr.setMeta(foldPluginKey, {
          pos: heading,
          type: "toggle",
        }),
      );
    }
    let at = -1;
    editor.state.doc.descendants((node, pos) => {
      if (at === -1 && node.isText && node.text === "bold") at = pos + 2;
    });
    editor.commands.setTextSelection(at);
    editor.view.dispatch(
      collapse(editor.state, getSyntaxRevealExpanded(editor.state)!)!,
    );
    const result = snapshot(editor);
    editor.destroy();
    return result;
  }

  it("every consumer is active in the fixture", () => {
    const old = settle(legacyCollapseTr);
    expect(old.fold).toHaveLength(1);
    expect(old.blockIds.length).toBeGreaterThan(0);
    expect(old.list.length).toBeGreaterThan(0);
    expect(old.prompt.length).toBeGreaterThan(0);
  });

  it("the same document and the same output from each consumer", () => {
    expect(settle(buildCollapseTr)).toEqual(settle(legacyCollapseTr));
  });

  // list-atom-fix widens a changed range to its list item; a mark collapsed INSIDE the
  // item whose first child is an atom is the case that reaches that path.
  const LIST_SOURCE = "- [[Note]] **bold**\n- two\n";

  it("a collapse inside the list item holding the atom: the consumer is active", () => {
    expect(settle(legacyCollapseTr, LIST_SOURCE).list.length).toBeGreaterThan(
      0,
    );
  });

  it("a collapse inside the list item holding the atom: the same decorations", () => {
    expect(settle(buildCollapseTr, LIST_SOURCE)).toEqual(
      settle(legacyCollapseTr, LIST_SOURCE),
    );
  });
});
