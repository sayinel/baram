// §388 spec 0067 §7 · §11-5 · §11-9 — refs that follow the document by position mapping.
import { Editor } from "@tiptap/core";
import { EditorState, NodeSelection, TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it, vi } from "vitest";

const { openUrl } = vi.hoisted(() => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

import { createBaramExtensions } from "../../extensions";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import {
  anchorCount,
  anchorMappingPasses,
  canonicalRangeText,
  dropAnchors,
  issueAnchor,
  MAX_ANCHORS_PER_OWNER,
  verifyAnchor,
} from "../plugins/selection-anchors";
import { getSyntaxRevealExpanded } from "../plugins/syntax-reveal";
import { collapseExpanded } from "../plugins/syntax-reveal-collapse";
import { expandMediaAtom } from "../plugins/syntax-reveal-expand";

const OWNER = "acme.notes";

function editorWith(md: string): Editor {
  const editor = new Editor({
    extensions: createBaramExtensions(),
    content: "",
  });
  editor.commands.setContent(markdownToProsemirror(md, editor.schema).toJSON());
  return editor;
}

function select(editor: Editor, from: number, to = from): void {
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, from, to),
    ),
  );
}

afterEach(() => dropAnchors(OWNER));

describe("selection anchors (spec 0067 §7)", () => {
  it("follows an edit before the range", () => {
    const editor = editorWith("alpha beta gamma\n"); // "alpha " 1-7, "beta" 7-11
    select(editor, 7, 11);
    const ref = issueAnchor(OWNER, editor.state);
    editor.view.dispatch(editor.state.tr.insertText("XX", 1));
    expect(verifyAnchor(OWNER, ref, editor.state.doc)).toEqual({
      from: 9,
      kind: "text",
      ok: true,
      to: 13,
    });
    editor.destroy();
  });

  it("refuses when the text inside the range changed", () => {
    const editor = editorWith("alpha beta gamma\n");
    select(editor, 7, 11);
    const ref = issueAnchor(OWNER, editor.state);
    editor.view.dispatch(editor.state.tr.insertText("Z", 8));
    expect(verifyAnchor(OWNER, ref, editor.state.doc)).toEqual({
      ok: false,
      reason: "range-changed",
    });
    editor.destroy();
  });

  it("refuses another document installed without a transaction, and accepts its own again", () => {
    const editor = editorWith("alpha beta\n");
    select(editor, 7, 11);
    const ref = issueAnchor(OWNER, editor.state);
    const own = editor.state;
    const other = EditorState.create({
      doc: markdownToProsemirror("other text here\n", editor.schema),
      plugins: own.plugins,
    });
    editor.view.updateState(other); // what a tab switch does
    expect(verifyAnchor(OWNER, ref, editor.state.doc)).toMatchObject({
      ok: false,
      reason: "other-document",
    });
    editor.view.updateState(own); // switching back restores the cached state
    expect(verifyAnchor(OWNER, ref, editor.state.doc)).toMatchObject({
      ok: true,
    });
    editor.destroy();
  });

  it("an empty range stays before text typed at the caret (assoc -1)", () => {
    const editor = editorWith("abcd\n"); // "abcd" 1-5
    select(editor, 3);
    const ref = issueAnchor(OWNER, editor.state);
    editor.view.dispatch(editor.state.tr.insertText("XYZ", 3));
    expect(verifyAnchor(OWNER, ref, editor.state.doc)).toMatchObject({
      from: 3,
      to: 3,
    });
    editor.destroy();
  });

  it("an empty range stays at the end of the first paragraph when Enter splits at it", () => {
    const editor = editorWith("abcd\n");
    select(editor, 3); // "ab|cd"
    const ref = issueAnchor(OWNER, editor.state);
    editor.view.dispatch(editor.state.tr.split(3));
    const at = verifyAnchor(OWNER, ref, editor.state.doc);
    expect(at).toMatchObject({ from: 3, ok: true, to: 3 });
    expect(editor.state.doc.resolve(3).parent.textContent).toBe("ab");
    editor.destroy();
  });

  it("an empty range inside a deleted span is lost", () => {
    const editor = editorWith("abcd\n");
    select(editor, 3);
    const ref = issueAnchor(OWNER, editor.state);
    editor.view.dispatch(editor.state.tr.delete(2, 4));
    expect(verifyAnchor(OWNER, ref, editor.state.doc)).toEqual({
      ok: false,
      reason: "range-changed",
    });
    editor.destroy();
  });

  it("a mark collapse does not lose a caret between delimiter characters (spec §7.2)", () => {
    const editor = editorWith("a **bold** b\n");
    editor.commands.setTextSelection(5); // expands: `**` 3-5
    select(editor, 4); // "*|*"
    const ref = issueAnchor(OWNER, editor.state);
    collapseExpanded(editor.view, getSyntaxRevealExpanded(editor.state)!);
    expect(verifyAnchor(OWNER, ref, editor.state.doc)).toMatchObject({
      from: 3,
      ok: true,
      to: 3,
    });
    editor.destroy();
  });

  it("an atom collapse does lose a position inside the wikilink source (spec §7.2, 4th review MAJOR-3)", () => {
    const editor = editorWith("see [[note]] here\n"); // wikilink atom at 5
    editor.commands.setTextSelection(5); // caret before the atom → expands to "[[note]]"
    const expanded = getSyntaxRevealExpanded(editor.state);
    expect(expanded?.kind).toBe("wikilink");
    select(editor, expanded!.from + 4); // inside "[[no|te]]"
    const ref = issueAnchor(OWNER, editor.state);
    collapseExpanded(editor.view, getSyntaxRevealExpanded(editor.state)!);
    expect(verifyAnchor(OWNER, ref, editor.state.doc)).toEqual({
      ok: false,
      reason: "range-changed",
    });
    editor.destroy();
  });

  // Spec §11-6 (2nd review probes C · D · E — the scenario D8 exists for): a NON-empty range
  // survives the caret entering the bold (expansion) and leaving it (the appended collapse).
  it.each([
    ["inside the word", 4, 6, "ol"],
    ["the whole word", 3, 7, "bold"],
    ["across the word's end", 5, 9, "ld b"],
  ])(
    "a range %s survives an expand and an auto-collapse",
    (_name, from, to, text) => {
      const editor = editorWith("a **bold** b\n"); // "a " 1-3, "bold" 3-7, " b" 7-9
      // Issue on a state that holds the range WITHOUT dispatching it: a range selection inside
      // the bold would make the reveal expand and fold it to a caret first.
      const withRange = editor.state.apply(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, from, to),
        ),
      );
      const ref = issueAnchor(OWNER, withRange);
      editor.commands.setTextSelection(5); // the caret enters → expands
      expect(getSyntaxRevealExpanded(editor.state)).not.toBeNull();
      editor.commands.setTextSelection(1); // the caret leaves → appendTransaction collapses
      expect(getSyntaxRevealExpanded(editor.state)).toBeNull();
      const at = verifyAnchor(OWNER, ref, editor.state.doc);
      expect(at).toMatchObject({ ok: true });
      if (at.ok)
        expect(editor.state.doc.textBetween(at.from, at.to, "\n")).toBe(text);
      editor.destroy();
    },
  );

  // Spec §11-5 — node-selection refs (`kind: "node"`, `Node.eq`).
  it("an image node-selection ref is refused once the image is deleted", () => {
    const editor = editorWith("before\n\n![a](x.png)\n\nafter\n"); // a top-level image
    let img = -1;
    editor.state.doc.forEach((n, pos) => {
      if (n.type.name === "image") img = pos;
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, img)),
    );
    const ref = issueAnchor(OWNER, editor.state);
    editor.view.dispatch(editor.state.tr.delete(img, img + 1));
    expect(verifyAnchor(OWNER, ref, editor.state.doc)).toEqual({
      ok: false,
      reason: "range-changed",
    });
    editor.destroy();
  });

  it("an image node-selection ref passes after the image is expanded and collapsed (Node.eq)", () => {
    const editor = editorWith("before\n\n![a](x.png)\n\nafter\n");
    let img = -1;
    editor.state.doc.forEach((n, pos) => {
      if (n.type.name === "image") img = pos;
    });
    const withNode = editor.state.apply(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, img)),
    );
    const ref = issueAnchor(OWNER, withNode);
    // Expand directly — the click path waits a frame (`checkNodeSelection` uses rAF).
    expect(
      expandMediaAtom(editor.view, editor.state.doc.nodeAt(img)!, img),
    ).toBe(true);
    collapseExpanded(editor.view, getSyntaxRevealExpanded(editor.state)!);
    expect(verifyAnchor(OWNER, ref, editor.state.doc)).toMatchObject({
      kind: "node",
      ok: true,
    });
    editor.destroy();
  });

  it("keeps at most 16 recorded anchors per owner; implicit ones do not count", () => {
    const editor = editorWith("alpha\n");
    const first = issueAnchor(OWNER, editor.state);
    for (let i = 0; i < MAX_ANCHORS_PER_OWNER; i++)
      issueAnchor(OWNER, editor.state);
    expect(anchorCount(OWNER)).toBe(MAX_ANCHORS_PER_OWNER);
    expect(verifyAnchor(OWNER, first, editor.state.doc)).toEqual({
      ok: false,
      reason: "unknown",
    });
    const before = anchorCount(OWNER);
    issueAnchor(OWNER, editor.state, { implicit: true });
    expect(anchorCount(OWNER)).toBe(before);
    editor.destroy();
  });

  it("an unrecorded ref leaves the registry empty; another owner's ref is unknown", () => {
    const editor = editorWith("alpha\n");
    const ref = issueAnchor(OWNER, editor.state, { record: false });
    expect(ref).toMatch(/^[0-9a-f]{32}$/u);
    expect(anchorCount(OWNER)).toBe(0);
    const theirs = issueAnchor("other.plugin", editor.state);
    expect(verifyAnchor(OWNER, theirs, editor.state.doc)).toMatchObject({
      reason: "unknown",
    });
    dropAnchors("other.plugin");
    expect(anchorCount("other.plugin")).toBe(0);
    editor.destroy();
  });

  it("does no mapping work while no anchor is recorded (spec §11-9)", () => {
    const editor = editorWith("alpha\n");
    const before = anchorMappingPasses();
    for (let i = 0; i < 50; i++) {
      editor.view.dispatch(editor.state.tr.insertText("x", 2));
    }
    expect(anchorMappingPasses()).toBe(before);
    issueAnchor(OWNER, editor.state);
    editor.view.dispatch(editor.state.tr.insertText("x", 2));
    expect(anchorMappingPasses()).toBe(before + 1);
    editor.destroy();
  });

  it("canonical text leaves expanded delimiters out (spec §5)", () => {
    const editor = editorWith("a **bold** b\n");
    editor.commands.setTextSelection(5); // expands: `**` 3-5, bold 5-9
    expect(canonicalRangeText(editor.state, 3, 7).text).toBe("bo");
    editor.destroy();
  });
});
