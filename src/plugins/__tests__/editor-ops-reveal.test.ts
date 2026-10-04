// §388 spec 0067 §5 · §7.3 · §11-5 · §11-6 — the editor core against syntax reveal: what a
// read returns over an expansion, which expansions a write collapses, and the undo step (D9).
import type { Editor } from "@tiptap/core";

import { closeHistory, undo, undoDepth } from "@tiptap/pm/history";
import { afterEach, describe, expect, it, vi } from "vitest";

const { openUrl } = vi.hoisted(() => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

import type { PluginEditorHandle } from "../plugin-host-registry";

import { dropAnchors } from "../../extensions/plugins/selection-anchors";
import { getSyntaxRevealExpanded } from "../../extensions/plugins/syntax-reveal";
import {
  buildCollapseTr,
  collapseExpanded,
} from "../../extensions/plugins/syntax-reveal-collapse";
import { expandMediaAtom } from "../../extensions/plugins/syntax-reveal-expand";
import { SYNTAX_REVEAL_EPHEMERAL_META } from "../../extensions/plugins/syntax-reveal-state";
import { serializeLiveDoc } from "../../utils/editor/serialize-live-doc";
import {
  insertMarkdownAt,
  insertTextAt,
  readSelectionForPlugin,
} from "../editor-ops";
import { realEditor, select } from "./real-editor";

const OWNER = "acme.notes";
const ctxOf = (editor: Editor) => ({
  live: () => editor as unknown as PluginEditorHandle,
  owner: OWNER,
});

afterEach(() => dropAnchors(OWNER));

describe("editor-ops and syntax reveal (spec 0067 §11-6)", () => {
  it("a caret inside an expanded bold: insertText lands at the caret and inherits the mark (P2)", async () => {
    const { editor } = realEditor("a **bold** b\n");
    editor.commands.setTextSelection(5); // "bo|ld" → expands; caret 7
    insertTextAt(ctxOf(editor), { text: "X" });
    expect(serializeLiveDoc(editor)).toBe("a **boXld** b\n");
    expect(getSyntaxRevealExpanded(editor.state)).toBeNull();
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.from).toBe(6); // after X: "a " 1-3, "bo" 3-5, "X" 5-6 (§11-6)
    editor.destroy();
  });

  it("a caret inside an expanded bold: insertMarkdown lands at the caret, marks from the markdown only (P2)", async () => {
    const { editor } = realEditor("a **bold** b\n");
    editor.commands.setTextSelection(5);
    await insertMarkdownAt(ctxOf(editor), { markdown: "X" });
    expect(editor.state.doc.textContent).toBe("a boXld b");
    expect(serializeLiveDoc(editor)).toBe("a **bo**X**ld** b\n"); // X is not bold
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.from).toBe(6); // after X (§11-6)
    editor.destroy();
  });

  it("a caret between the expanded delimiter characters lands at the mark's start (spec §7.2 exemption)", async () => {
    const { editor } = realEditor("a **bold** b\n");
    editor.commands.setTextSelection(5); // expands: `**` 3-5
    select(editor, 4); // `*|*`
    expect(getSyntaxRevealExpanded(editor.state)).not.toBeNull();
    await insertMarkdownAt(ctxOf(editor), { markdown: "X" });
    expect(serializeLiveDoc(editor)).toBe("a X**bold** b\n");
    editor.destroy();
  });

  it("one undo takes the insert back to the canonical document (D9) — sibling: one transaction breaks bold", async () => {
    // prosemirror-history groups by `tr.time`, which a Transaction takes from `Date.now()`.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const { editor } = realEditor("a **bold** b\n");
      editor.commands.setTextSelection(5);
      const depth = undoDepth(editor.state);
      // The user clicked into the bold a while before the plugin writes — past history's
      // 500 ms `newGroupDelay` — so a collapse kept in history would be an undo group of its
      // own whatever its steps' positions, not merged into the expansion's group.
      vi.setSystemTime(Date.now() + 1000);
      await insertMarkdownAt(ctxOf(editor), { markdown: "X" });
      expect(undoDepth(editor.state)).toBe(depth + 1); // the insert; the collapse is not a step
      undo(editor.state, editor.view.dispatch);
      expect(serializeLiveDoc(editor)).toBe("a **bold** b\n");
      // The first undo cannot tell: the insert's closeHistory keeps a collapse step apart from
      // it. The second would undo such a step — its own group, given the delay above — and
      // save the delimiters as text (spec §2.2).
      undo(editor.state, editor.view.dispatch);
      expect(serializeLiveDoc(editor)).toBe("a **bold** b\n");
      editor.destroy();
    } finally {
      vi.useRealTimers();
    }
    // Sibling (spec §2.2): collapse and insert in ONE transaction → undo saves `\*\*`.
    const { editor: e2 } = realEditor("a **bold** b\n");
    e2.commands.setTextSelection(5);
    const tr = buildCollapseTr(e2.state, getSyntaxRevealExpanded(e2.state)!)!;
    tr.setMeta(SYNTAX_REVEAL_EPHEMERAL_META, false);
    tr.insertText("X", tr.mapping.map(7, -1));
    closeHistory(tr);
    e2.view.dispatch(tr);
    undo(e2.state, e2.view.dispatch);
    expect(serializeLiveDoc(e2)).toBe("a \\*\\*bold\\*\\* b\n");
    e2.destroy();
  });

  it("a refused insert leaves the expansion, the document and the undo depth alone (2nd review MAJOR-D)", async () => {
    const { editor } = realEditor("# He**ad**ing\n");
    editor.commands.setTextSelection(5); // at the end of the bold in the heading → expands
    expect(getSyntaxRevealExpanded(editor.state)).not.toBeNull();
    const doc = editor.state.doc;
    const depth = undoDepth(editor.state);
    await expect(
      insertMarkdownAt(ctxOf(editor), { markdown: "p1\n\np2" }),
    ).rejects.toMatchObject({
      code: "cannot-insert-here",
    });
    expect(editor.state.doc).toBe(doc);
    expect(getSyntaxRevealExpanded(editor.state)).not.toBeNull();
    expect(undoDepth(editor.state)).toBe(depth);
    editor.destroy();
  });

  it("an insert does not re-expand what it collapsed (3rd review BLOCKING-1)", async () => {
    const { editor } = realEditor("a **bold** b\n");
    editor.commands.setTextSelection(5);
    await insertMarkdownAt(ctxOf(editor), { markdown: "X" });
    expect(getSyntaxRevealExpanded(editor.state)).toBeNull();
    editor.destroy();
  });

  it("refuses an endpoint strictly inside an expanded atom; one at its end, or a range holding all of it, passes", async () => {
    const inner = realEditor("see [[note]] here\n");
    inner.editor.commands.setTextSelection(5); // expands the wikilink
    const exp = getSyntaxRevealExpanded(inner.editor.state)!;
    select(inner.editor, exp.from + 4);
    await expect(
      insertMarkdownAt(ctxOf(inner.editor), { markdown: "x" }),
    ).rejects.toMatchObject({
      code: "cannot-insert-here",
    });
    select(inner.editor, exp.to); // touching the end is not inside
    expect(getSyntaxRevealExpanded(inner.editor.state)).not.toBeNull();
    await insertMarkdownAt(ctxOf(inner.editor), { markdown: "x" });
    expect(serializeLiveDoc(inner.editor)).toBe("see [[note]]x here\n");
    inner.editor.destroy();
    const whole = realEditor("@@see [[note]] here@@\n");
    const { ref } = readSelectionForPlugin(
      ctxOf(whole.editor),
      "getSelection",
      { record: true },
    );
    whole.editor.commands.setTextSelection(6); // the user clicks into the wikilink → expands
    expect(getSyntaxRevealExpanded(whole.editor.state)).not.toBeNull();
    await insertMarkdownAt(ctxOf(whole.editor), { markdown: "done", ref });
    expect(serializeLiveDoc(whole.editor)).toBe("done\n");
    whole.editor.destroy();
  });

  it("an endpoint at a block image expansion's edge is inside; a range holding all of it collapses and proceeds (Ruling 13)", async () => {
    const { editor } = realEditor("before\n\n![a](x.png)\n\nafter\n");
    let img = -1;
    editor.state.doc.forEach((n, pos) => {
      if (n.type.name === "image") img = pos;
    });
    select(editor, 1, editor.state.doc.content.size - 1); // "before" … "after", image between
    const whole = readSelectionForPlugin(ctxOf(editor), "getSelection", {
      record: true,
    });
    expect(
      expandMediaAtom(editor.view, editor.state.doc.nodeAt(img)!, img),
    ).toBe(true);
    const exp = getSyntaxRevealExpanded(editor.state)!;
    const doc = editor.state.doc;
    const dispatch = vi.spyOn(editor.view, "dispatch");
    for (const edge of [exp.from, exp.to]) {
      select(editor, edge);
      const sent = dispatch.mock.calls.length;
      await expect(
        insertMarkdownAt(ctxOf(editor), { markdown: "x" }),
      ).rejects.toMatchObject({ code: "cannot-insert-here" });
      expect(dispatch.mock.calls.length).toBe(sent);
      expect(getSyntaxRevealExpanded(editor.state)).toEqual(exp);
    }
    expect(editor.state.doc).toBe(doc);
    // A range holding the whole expansion has its endpoints outside the temporary paragraph.
    await insertMarkdownAt(ctxOf(editor), { markdown: "done", ref: whole.ref });
    expect(getSyntaxRevealExpanded(editor.state)).toBeNull();
    expect(serializeLiveDoc(editor)).toBe("done\n");
    editor.destroy();
  });

  it("a ref read inside a wikilink source and collapsed by the user is refused (4th review MAJOR-3)", async () => {
    const { editor } = realEditor("see [[note]] here\n");
    editor.commands.setTextSelection(5);
    const exp = getSyntaxRevealExpanded(editor.state)!;
    select(editor, exp.from + 4);
    const { ref } = readSelectionForPlugin(ctxOf(editor), "getSelection", {
      record: true,
    });
    select(editor, 1); // the caret leaves → the reveal collapses the wikilink
    await expect(
      insertMarkdownAt(ctxOf(editor), { markdown: "x", ref }),
    ).rejects.toMatchObject({
      code: "ref-range-changed",
    });
    editor.destroy();
  });

  it("a ref read inside a top-level image's source is refused after the user collapses it (spec §11-5)", async () => {
    const { editor } = realEditor("before\n\n![a](x.png)\n\nafter\n");
    let img = -1;
    editor.state.doc.forEach((n, pos) => {
      if (n.type.name === "image") img = pos;
    });
    expect(
      expandMediaAtom(editor.view, editor.state.doc.nodeAt(img)!, img),
    ).toBe(true);
    const exp = getSyntaxRevealExpanded(editor.state)!;
    select(editor, exp.from + 3); // inside "![a](x.png)"
    const { ref } = readSelectionForPlugin(ctxOf(editor), "getSelection", {
      record: true,
    });
    collapseExpanded(editor.view, exp);
    await expect(
      insertMarkdownAt(ctxOf(editor), { markdown: "x", ref }),
    ).rejects.toMatchObject({
      code: "ref-range-changed",
    });
    editor.destroy();
  });

  it("reading a selection that spans expanded delimiters returns canonical text (spec §5)", () => {
    const { editor } = realEditor("a **bold** b\n");
    editor.commands.setTextSelection(5); // expands: `**` 3-5
    select(editor, 3, 7); // "**bo" live
    expect(editor.state.doc.textBetween(3, 7, "\n")).toBe("**bo"); // what a live read gives
    expect(
      readSelectionForPlugin(ctxOf(editor), "getSelection", { record: true })
        .text,
    ).toBe("bo");
    editor.destroy();
  });

  it("read = replace: a ref read over expanded delimiters replaces the canonical range (spec §5)", async () => {
    const { editor } = realEditor("a **bold** b\n");
    editor.commands.setTextSelection(5); // expands: `**` 3-5, "bold" 5-9
    select(editor, 3, 7); // "**bo" live, "bo" canonical
    const sel = readSelectionForPlugin(ctxOf(editor), "getSelection", {
      record: true,
    });
    expect(sel.text).toBe("bo");
    await insertMarkdownAt(ctxOf(editor), { markdown: "XY", ref: sel.ref });
    expect(editor.state.doc.textContent).toBe("a XYld b");
    editor.destroy();
  });

  it("an expansion that does not touch the target stays expanded (spec §11-6)", async () => {
    const { editor } = realEditor("a **bold** b and @@c@@ end\n");
    const { ref } = readSelectionForPlugin(ctxOf(editor), "getSelection", {
      record: true,
    });
    editor.commands.setTextSelection(5); // the user's caret goes into the bold
    expect(getSyntaxRevealExpanded(editor.state)).not.toBeNull();
    await insertMarkdownAt(ctxOf(editor), { markdown: "C", ref });
    expect(getSyntaxRevealExpanded(editor.state)).not.toBeNull();
    expect(editor.state.doc.textContent).toContain("and C end");
    editor.destroy();
  });
});
