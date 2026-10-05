// §388 spec 0067 §6.2 · §7.3 · §8 · §10 — the editor core's gates: the surface gate, the
// selection kinds a write refuses, when the tiers' hooks run, that implicit anchors are
// released, and the whole-document replace.
import type { Editor } from "@tiptap/core";

import { GapCursor } from "@tiptap/pm/gapcursor";
import { AllSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import { afterEach, describe, expect, it, vi } from "vitest";

const { openUrl } = vi.hoisted(() => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

import type { PluginEditorHandle } from "../plugin-host-registry";

import {
  anchorCount,
  anchorMappingPasses,
  dropAnchors,
} from "../../extensions/plugins/selection-anchors";
import { getSyntaxRevealExpanded } from "../../extensions/plugins/syntax-reveal";
import { serializeLiveDoc } from "../../utils/editor/serialize-live-doc";
import {
  insertMarkdownAt,
  insertTextAt,
  liveEditor,
  readSelectionForPlugin,
  replaceDocument,
} from "../editor-ops";
import { codeOf, realEditor, select } from "./real-editor";

const OWNER = "acme.notes";
const ctxOf = (editor: Editor) => ({
  live: () => editor as unknown as PluginEditorHandle,
  owner: OWNER,
});

afterEach(() => dropAnchors(OWNER));

/**
 * How many transactions did anchor mapping work for one document change. `track` in
 * selection-anchors.ts returns before any mapping while the registry is empty (spec §11-9),
 * so 0 means no anchor — implicit ones included — is left. `anchorCount` cannot show this:
 * it counts recorded refs.
 */
function mappingPassesOn(editor: Editor, at: number): number {
  const before = anchorMappingPasses();
  editor.view.dispatch(editor.state.tr.insertText("z", at));
  return anchorMappingPasses() - before;
}

describe("editor-ops gates (spec 0067)", () => {
  it("the surface gate refuses with a code before asking for the editor (spec §10)", () => {
    const editor = vi.fn(() => null);
    expect(
      codeOf(() => liveEditor("insertText", () => "source mode", editor)),
    ).toBe("surface-blocked");
    expect(editor).not.toHaveBeenCalled();
    expect(codeOf(() => liveEditor("insertText", () => null, editor))).toBe(
      "no-editor",
    );
    const { editor: real } = realEditor("a\n");
    const handle = real as unknown as PluginEditorHandle;
    expect(
      liveEditor(
        "insertText",
        () => null,
        () => handle,
      ),
    ).toBe(handle);
    real.destroy();
  });

  it("an all-selection ref replaces the whole document — but not after the user added to it (Ruling 6)", async () => {
    const { editor } = realEditor("alpha\n\nbeta\n");
    const all = () =>
      editor.view.dispatch(
        editor.state.tr.setSelection(new AllSelection(editor.state.doc)),
      );
    all();
    const first = readSelectionForPlugin(ctxOf(editor), "getSelection", {
      record: true,
    });
    await insertMarkdownAt(ctxOf(editor), {
      markdown: "# New\n\nbody",
      ref: first.ref,
    });
    expect(serializeLiveDoc(editor)).toBe("# New\n\nbody\n");
    all();
    const { ref } = readSelectionForPlugin(ctxOf(editor), "getSelection", {
      record: true,
    });
    const end = editor.state.doc.content.size;
    const { paragraph } = editor.schema.nodes;
    editor.view.dispatch(
      editor.state.tr.insert(
        end,
        paragraph!.create(null, editor.schema.text("more")),
      ),
    );
    const doc = editor.state.doc;
    const dispatch = vi.spyOn(editor.view, "dispatch");
    await expect(
      insertMarkdownAt(ctxOf(editor), { markdown: "x", ref }),
    ).rejects.toMatchObject({
      code: "ref-range-changed",
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(editor.state.doc).toBe(doc);
    editor.destroy();
  });

  it("refuses a gap cursor directly and through its ref; a text caret in the same document passes (Ruling 7)", async () => {
    const { editor } = realEditor("![a](x.png)\n\nafter\n"); // a top-level image at 0
    editor.view.dispatch(
      editor.state.tr.setSelection(new GapCursor(editor.state.doc.resolve(0))),
    );
    expect(editor.state.selection).toBeInstanceOf(GapCursor);
    const count = anchorCount(OWNER);
    const dispatch = vi.spyOn(editor.view, "dispatch");
    await expect(
      insertMarkdownAt(ctxOf(editor), { markdown: "x" }),
    ).rejects.toMatchObject({
      code: "cannot-insert-here",
    });
    expect(dispatch).not.toHaveBeenCalled();
    // No recorded ref was added. This cannot see a leaked IMPLICIT anchor (it counts recorded
    // refs only); the mapping-pass probe on the next line is the guard for that.
    expect(anchorCount(OWNER)).toBe(count);
    expect(mappingPassesOn(editor, 2)).toBe(0); // the implicit anchor was released
    const { ref } = readSelectionForPlugin(ctxOf(editor), "getSelection", {
      record: true,
    });
    await expect(
      insertMarkdownAt(ctxOf(editor), { markdown: "x", ref }),
    ).rejects.toMatchObject({
      code: "cannot-insert-here",
    });
    // The probe sees a live anchor: the recorded gap ref is still held.
    expect(mappingPassesOn(editor, 2)).toBe(1);
    select(editor, 2);
    await insertMarkdownAt(ctxOf(editor), { markdown: "**x**" });
    expect(serializeLiveDoc(editor)).toBe("![a](x.png)\n\n**x**zzafter\n");
    editor.destroy();
  });

  it("refuses a CellSelection directly and through its ref", async () => {
    const { editor } = realEditor("| a | b |\n| --- | --- |\n| c | d |\n");
    const cells: number[] = [];
    editor.state.doc.descendants((n, pos) => {
      if (n.type.name === "tableCell" || n.type.name === "tableHeader")
        cells.push(pos);
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(
        CellSelection.create(editor.state.doc, cells[0], cells[1]),
      ),
    );
    await expect(
      insertMarkdownAt(ctxOf(editor), { markdown: "x" }),
    ).rejects.toMatchObject({
      code: "cannot-insert-here",
    });
    expect(mappingPassesOn(editor, cells[2] + 2)).toBe(0); // into "c": the implicit anchor is gone
    const { ref } = readSelectionForPlugin(ctxOf(editor), "getSelection", {
      record: true,
    });
    await expect(
      insertMarkdownAt(ctxOf(editor), { markdown: "x", ref }),
    ).rejects.toMatchObject({
      code: "cannot-insert-here",
    });
    editor.destroy();
  });

  it("charges nothing for a write refused after the parse; a passing one is charged before anything is sent (spec §7.3-6)", async () => {
    const { editor } = realEditor("# He**ad**ing\n");
    editor.commands.setTextSelection(5); // the end of the bold "ad" → expands
    const dispatch = vi.spyOn(editor.view, "dispatch");
    const calls: string[] = [];
    const hooks = {
      beforeDispatch: () => {
        const expanded = getSyntaxRevealExpanded(editor.state) !== null;
        calls.push(
          `dispatch after ${dispatch.mock.calls.length}, expanded ${expanded}`,
        );
      },
      beforeParse: () => calls.push("parse"),
    };
    await expect(
      insertMarkdownAt(ctxOf(editor), { ...hooks, markdown: "p1\n\np2" }),
    ).rejects.toMatchObject({
      code: "cannot-insert-here",
    });
    expect(calls).toEqual(["parse"]);
    expect(dispatch).not.toHaveBeenCalled();
    await insertMarkdownAt(ctxOf(editor), { ...hooks, markdown: "X" });
    expect(calls).toEqual([
      "parse",
      "parse",
      "dispatch after 0, expanded true",
    ]);
    expect(dispatch).toHaveBeenCalledTimes(3); // the collapse, the insert, the closing step
    expect(editor.state.doc.textContent).toBe("HeadXing");
    editor.destroy();
  });

  it("beforeCheck runs before the collapse and the shadow check (plan 0117 Ruling 24)", async () => {
    const { editor } = realEditor("# He**ad**ing\n");
    editor.commands.setTextSelection(5); // the end of the bold "ad" → expands
    const dispatch = vi.spyOn(editor.view, "dispatch");
    const shadow = vi.spyOn(editor.state, "apply"); // the collapse is applied on this state
    const refusing = () => {
      throw new Error("budget"); // a refusing check, as the sandboxed tier's meter throws
    };
    // Blocks in a heading: the shadow check would answer cannot-insert-here.
    await expect(
      insertMarkdownAt(ctxOf(editor), {
        beforeCheck: refusing,
        markdown: "p1\n\np2",
      }),
    ).rejects.toThrow("budget");
    expect(shadow).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    const calls: string[] = [];
    await insertMarkdownAt(ctxOf(editor), {
      beforeCheck: () =>
        calls.push(`check, applied ${shadow.mock.calls.length}`),
      beforeDispatch: () =>
        calls.push(`dispatch, applied ${shadow.mock.calls.length}`),
      markdown: "X",
    });
    expect(calls).toEqual(["check, applied 0", "dispatch, applied 1"]);
    expect(editor.state.doc.textContent).toBe("HeadXing");
    editor.destroy();
  });

  it("an implicit anchor is released whether the write lands or is refused (spec §7.3)", async () => {
    const { editor } = realEditor("# He@@ading\n");
    const doc = editor.state.doc;
    const budget = () => {
      throw new Error("budget"); // a refusing charge, as the sandboxed tier's budget throws
    };
    expect(() =>
      insertTextAt(ctxOf(editor), { beforeDispatch: budget, text: "T" }),
    ).toThrow("budget");
    await expect(
      insertMarkdownAt(ctxOf(editor), {
        beforeDispatch: budget,
        markdown: "M",
      }),
    ).rejects.toThrow("budget");
    await expect(
      insertMarkdownAt(ctxOf(editor), { markdown: "p1\n\np2" }), // refused after the parse
    ).rejects.toMatchObject({ code: "cannot-insert-here" });
    expect(editor.state.doc).toBe(doc);
    expect(mappingPassesOn(editor, 1)).toBe(0);
    insertTextAt(ctxOf(editor), { text: "T" });
    await insertMarkdownAt(ctxOf(editor), { markdown: "M" });
    expect(serializeLiveDoc(editor)).toBe("# zHeTMading\n");
    expect(mappingPassesOn(editor, 1)).toBe(0);
    readSelectionForPlugin(ctxOf(editor), "getSelection", { record: true });
    expect(mappingPassesOn(editor, 1)).toBe(1); // the probe sees a held anchor
    editor.destroy();
  });

  it("replaceDocument replaces the document; a change during the parse refuses with document-changed", async () => {
    const { editor } = realEditor("alpha\n");
    const targets: PluginEditorHandle[] = [];
    const beforeDispatch = (t: PluginEditorHandle) => void targets.push(t);
    await replaceDocument(ctxOf(editor), {
      beforeDispatch,
      markdown: "# T\n\nbody",
    });
    expect(serializeLiveDoc(editor)).toBe("# T\n\nbody\n");
    expect(targets).toEqual([editor]);
    const pending = replaceDocument(ctxOf(editor), {
      beforeDispatch,
      markdown: "gone",
    });
    editor.view.dispatch(editor.state.tr.insertText("Z", 1)); // the user types during the parse
    const doc = editor.state.doc;
    await expect(pending).rejects.toMatchObject({ code: "document-changed" });
    expect(editor.state.doc).toBe(doc);
    expect(targets).toHaveLength(1);
    // A keep-alive swap across the parse: the editor now live holds another document node, so
    // the same identity check refuses it — no editor comparison is needed here (Ruling 12).
    const other = realEditor("other\n").editor;
    let live = other;
    const swap = {
      live: () => live as unknown as PluginEditorHandle,
      owner: OWNER,
    };
    const dispatch = vi.spyOn(editor.view, "dispatch");
    const swapped = replaceDocument(swap, { beforeDispatch, markdown: "gone" });
    live = editor;
    await expect(swapped).rejects.toMatchObject({ code: "document-changed" });
    expect(editor.state.doc).toBe(doc);
    expect(dispatch).not.toHaveBeenCalled();
    expect(targets).toHaveLength(1);
    other.destroy();
    editor.destroy();
  });

  it("an unknown ref is refused before the parse — beforeParse is not called (spec §7.3)", async () => {
    const { editor } = realEditor("a@@b\n");
    const beforeParse = vi.fn();
    await expect(
      insertMarkdownAt(ctxOf(editor), {
        beforeParse,
        markdown: "x",
        ref: "0".repeat(32),
      }),
    ).rejects.toMatchObject({ code: "ref-unknown" });
    expect(beforeParse).not.toHaveBeenCalled();
    const { ref } = readSelectionForPlugin(ctxOf(editor), "getSelection", {
      record: true,
    });
    await insertMarkdownAt(ctxOf(editor), { beforeParse, markdown: "x", ref });
    expect(beforeParse).toHaveBeenCalledTimes(1);
    expect(serializeLiveDoc(editor)).toBe("axb\n");
    editor.destroy();
  });
});
