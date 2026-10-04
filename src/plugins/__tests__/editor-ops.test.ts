// §388 spec 0067 §5 · §7.3 · §11-2 · §11-5 · §11-7 · §11-8 · §11-13 — the core both tiers
// share: refs, where an insert lands, a write's undo step. Reveal interactions:
// editor-ops-reveal.test.ts.
import type { Editor } from "@tiptap/core";

import { undo } from "@tiptap/pm/history";
import { NodeSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it, vi } from "vitest";

const { openUrl } = vi.hoisted(() => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

import type { PluginEditorHandle } from "../plugin-host-registry";

import {
  dropAnchors,
  verifyAnchor,
} from "../../extensions/plugins/selection-anchors";
import { serializeLiveDoc } from "../../utils/editor/serialize-live-doc";
import {
  insertMarkdownAt,
  insertTextAt,
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

describe("editor-ops (spec 0067)", () => {
  it("a ref replaces exactly what was read after an edit before it", async () => {
    const { editor } = realEditor("alpha @@beta@@ gamma\n");
    const sel = readSelectionForPlugin(ctxOf(editor), "getSelection", {
      record: true,
    });
    expect(sel.text).toBe("beta");
    editor.view.dispatch(editor.state.tr.insertText("XX", 1));
    await insertMarkdownAt(ctxOf(editor), { markdown: "**B**", ref: sel.ref });
    expect(serializeLiveDoc(editor)).toBe("XXalpha **B** gamma\n");
    editor.destroy();
  });

  it("a ref is single-use", async () => {
    const { editor } = realEditor("alpha @@beta@@ gamma\n");
    const { ref } = readSelectionForPlugin(ctxOf(editor), "getSelection", {
      record: true,
    });
    await insertMarkdownAt(ctxOf(editor), { markdown: "B", ref });
    await expect(
      insertMarkdownAt(ctxOf(editor), { markdown: "C", ref }),
    ).rejects.toMatchObject({
      code: "ref-unknown",
    });
    editor.destroy();
  });

  it("typing elsewhere during the parse is followed, not refused (D5)", async () => {
    const { editor } = realEditor("alpha @@ omega\n");
    const pending = insertMarkdownAt(ctxOf(editor), { markdown: "**x**" });
    editor.view.dispatch(editor.state.tr.insertText("Z", 1)); // before the target
    await pending;
    expect(serializeLiveDoc(editor)).toBe("Zalpha **x** omega\n");
    editor.destroy();
  });

  it("a tab switch during the parse refuses with ref-other-document", async () => {
    const { editor } = realEditor("alpha @@ omega\n");
    const pending = insertMarkdownAt(ctxOf(editor), { markdown: "x" });
    const { editor: other } = realEditor("different\n");
    editor.view.updateState(other.state); // another document, installed without a transaction
    await expect(pending).rejects.toMatchObject({ code: "ref-other-document" });
    other.destroy();
    editor.destroy();
  });

  it("a keep-alive swap across the parse refuses with ref-other-document and keeps the ref (Ruling 12)", async () => {
    // Spec §7.3 step 2: a keep-alive editor is another `Editor`, built with another schema.
    const a = realEditor("alpha @@ omega\n").editor;
    const b = realEditor("beta @@mid@@ end\n").editor;
    let live = b;
    const ctx = {
      live: () => live as unknown as PluginEditorHandle,
      owner: OWNER,
    };
    const { ref } = readSelectionForPlugin(ctx, "getSelection", {
      record: true,
    });
    const [docA, docB] = [a.state.doc, b.state.doc];
    const dispatchA = vi.spyOn(a.view, "dispatch");
    const dispatchB = vi.spyOn(b.view, "dispatch");
    live = a; // the write is asked for while another tab's editor is live …
    const pending = insertMarkdownAt(ctx, { markdown: "**X** y", ref });
    live = b; // … and the ref's editor is back before the parse ends
    await expect(pending).rejects.toMatchObject({ code: "ref-other-document" });
    live = a; // A → B with no ref: the implicit anchor's editor is gone
    const implicit = insertMarkdownAt(ctx, { markdown: "x" });
    live = b;
    await expect(implicit).rejects.toMatchObject({
      code: "ref-other-document",
    });
    expect(a.state.doc).toBe(docA);
    expect(b.state.doc).toBe(docB);
    expect(dispatchA).not.toHaveBeenCalled();
    expect(dispatchB).not.toHaveBeenCalled();
    expect(verifyAnchor(OWNER, ref, b.state.doc)).toMatchObject({ ok: true }); // not consumed
    // Sibling: the same editor throughout — the ref replaces "mid".
    await insertMarkdownAt(ctx, { markdown: "**X** y", ref });
    expect(serializeLiveDoc(b)).toBe("beta **X** y end\n");
    a.destroy();
    b.destroy();
  });

  it("does not move a caret the user placed elsewhere (rule 6, 1st review M3)", async () => {
    const { editor } = realEditor("alpha @@beta@@ gamma\n");
    const { ref } = readSelectionForPlugin(ctxOf(editor), "getSelection", {
      record: true,
    });
    select(editor, 2); // the user moved on
    await insertMarkdownAt(ctxOf(editor), { markdown: "B", ref });
    expect(editor.state.selection.from).toBe(2);
    editor.destroy();
  });

  it("moves the caret to the end of what went in when the user is on the target (rule 6)", async () => {
    const { editor } = realEditor("alpha @@ omega\n");
    await insertMarkdownAt(ctxOf(editor), { markdown: "xyz" });
    expect(editor.state.selection.from).toBe(10); // "alpha " 1-7, "xyz" 7-10
    editor.destroy();
    // An empty caret ends up there by plain position mapping too; a range the user holds does
    // not, so this is the half that needs rule 6.
    const range = realEditor("alpha @@beta@@ gamma\n").editor;
    await insertMarkdownAt(ctxOf(range), { markdown: "xyz" });
    expect(range.state.selection.empty).toBe(true);
    expect(range.state.selection.from).toBe(10);
    range.destroy();
  });

  it("moves the caret to the end of what went in when a node selection is the target (rule 6, spec §11-7)", async () => {
    const { editor } = realEditor("a\n\n---\n\nb\n");
    let rule = -1;
    editor.state.doc.forEach((n, pos) => {
      if (n.type.name === "horizontalRule") rule = pos;
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(
        NodeSelection.create(editor.state.doc, rule),
      ),
    );
    await insertMarkdownAt(ctxOf(editor), { markdown: "xyz" });
    expect(serializeLiveDoc(editor)).toBe("a\n\nxyz\n\nb\n");
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.from).toBe(rule + 4); // "xyz" at rule+1 .. rule+4
    editor.destroy();
  });

  it("an insert is its own undo step on both sides (P1) — sibling: without closeHistory it is not", async () => {
    const { editor } = realEditor("alpha @@ omega\n");
    editor.view.dispatch(editor.state.tr.insertText("c", 7));
    await insertMarkdownAt(ctxOf(editor), { markdown: "X" });
    undo(editor.state, editor.view.dispatch);
    expect(editor.state.doc.textContent).toBe("alpha c omega");
    editor.destroy();
    // Sibling: the same two writes without closeHistory undo together.
    const { editor: e2 } = realEditor("alpha @@ omega\n");
    e2.view.dispatch(e2.state.tr.insertText("c", 7));
    e2.view.dispatch(e2.state.tr.insertText("X", 8));
    undo(e2.state, e2.view.dispatch);
    expect(e2.state.doc.textContent).toBe("alpha  omega");
    e2.destroy();
  });

  it("text typed right after an insert is its own undo step (P1, spec §11-8)", async () => {
    const { editor } = realEditor("alpha @@ omega\n");
    await insertMarkdownAt(ctxOf(editor), { markdown: "X" });
    editor.view.dispatch(
      editor.state.tr.insertText("c", editor.state.selection.from),
    );
    undo(editor.state, editor.view.dispatch);
    expect(editor.state.doc.textContent).toBe("alpha X omega");
    editor.destroy();
  });

  // Spec §5 · §12 (plan 0117 Ruling 22) — setMarkdown too. prosemirror-history groups by
  // `tr.time`, which a Transaction takes from `Date.now()`; the frozen clock keeps every write
  // in these rows inside the 500 ms `newGroupDelay`, so only `closeHistory` parts them, and a
  // whole-document replace is adjacent to any range the user types in.
  it("setMarkdown right after the user's typing is its own undo step", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const { editor } = realEditor("alpha@@\n");
      editor.view.dispatch(editor.state.tr.insertText("c", 6));
      await replaceDocument(ctxOf(editor), { markdown: "# New\n" });
      expect(serializeLiveDoc(editor)).toBe("# New\n");
      undo(editor.state, editor.view.dispatch);
      expect(serializeLiveDoc(editor)).toBe("alphac\n"); // the typing stays
      undo(editor.state, editor.view.dispatch);
      expect(serializeLiveDoc(editor)).toBe("alpha\n");
      editor.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("text typed right after setMarkdown is its own undo step", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const { editor } = realEditor("alpha\n");
      await replaceDocument(ctxOf(editor), { markdown: "new\n" });
      editor.view.dispatch(editor.state.tr.insertText("c", 4)); // "new" is 1-4
      expect(serializeLiveDoc(editor)).toBe("newc\n");
      undo(editor.state, editor.view.dispatch);
      expect(serializeLiveDoc(editor)).toBe("new\n"); // setMarkdown stays
      editor.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("setMarkdown sends the write and one step-less transaction; only the write emits update", async () => {
    // Spec §14 — the step-less transaction must not look like an edit to autosave, which
    // listens to Tiptap's `update` (`use-auto-save.ts`).
    const { editor } = realEditor("alpha\n");
    const dispatch = vi.spyOn(editor.view, "dispatch");
    let updates = 0;
    editor.on("update", () => void (updates += 1));
    await replaceDocument(ctxOf(editor), { markdown: "new\n" });
    expect(dispatch).toHaveBeenCalledTimes(2);
    const [write, close] = dispatch.mock.calls.map(([tr]) => tr);
    expect(write.docChanged).toBe(true);
    expect(close.steps).toHaveLength(0);
    expect(updates).toBe(1); // the write's own update: the listener is live
    editor.destroy();
  });

  it("insertMarkdown('') deletes the selection", async () => {
    const { editor } = realEditor("alpha @@beta@@ gamma\n");
    await insertMarkdownAt(ctxOf(editor), { markdown: "" });
    expect(editor.state.doc.textContent).toBe("alpha  gamma");
    editor.destroy();
  });

  it("insertText honours a ref the same way (spec §11-13)", () => {
    const { editor } = realEditor("alpha @@beta@@ gamma\n");
    const { ref } = readSelectionForPlugin(ctxOf(editor), "getSelection", {
      record: true,
    });
    editor.view.dispatch(editor.state.tr.insertText("XX", 1));
    insertTextAt(ctxOf(editor), { ref, text: "B" });
    expect(editor.state.doc.textContent).toBe("XXalpha B gamma");
    expect(codeOf(() => insertTextAt(ctxOf(editor), { ref, text: "C" }))).toBe(
      "ref-unknown", // single-use here too
    );
    // A non-empty range whose text changes is refused — an empty one would follow the edit.
    select(editor, 1, 3); // "XX"
    const second = readSelectionForPlugin(ctxOf(editor), "getSelection", {
      record: true,
    });
    editor.view.dispatch(editor.state.tr.insertText("Q", 2)); // inside the range
    expect(
      codeOf(() => insertTextAt(ctxOf(editor), { ref: second.ref, text: "C" })),
    ).toBe("ref-range-changed");
    // A tab switch: another document installed without a transaction.
    const third = readSelectionForPlugin(ctxOf(editor), "getSelection", {
      record: true,
    });
    expect(third.text).toBe("XQX"); // the user's range followed the Q
    const { editor: other } = realEditor("different\n");
    const own = editor.state;
    editor.view.updateState(other.state);
    expect(
      codeOf(() => insertTextAt(ctxOf(editor), { ref: third.ref, text: "C" })),
    ).toBe("ref-other-document");
    // Switching back finds the ref again (spec §7.3 step 2).
    editor.view.updateState(own);
    insertTextAt(ctxOf(editor), { ref: third.ref, text: "C" });
    expect(editor.state.doc.textContent).toBe("Calpha B gamma");
    other.destroy();
    editor.destroy();
  });

  // Spec §11-2 — round trip: into an empty paragraph and back, byte for byte.
  it.each([
    "[T](https://e.x)",
    "**b**",
    "[[Note]]",
    "((n#^abc123))",
    "- a\n- b",
    "## H",
    "$$\nx^2\n$$",
    "> [!note]\n> body",
  ])("round trip %j", async (md) => {
    const { editor } = realEditor("@@\n");
    await insertMarkdownAt(ctxOf(editor), { markdown: md });
    expect(serializeLiveDoc(editor)).toBe(`${md}\n`);
    editor.destroy();
  });
});
