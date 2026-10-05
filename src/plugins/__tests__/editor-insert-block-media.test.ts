// §388 spec 0067 §6.2 rules 3 · 4 — a result whose paragraph holds an image, the loader's
// issue-509 shape. One such paragraph takes rule 4, not rule 3 (final review F1); a paragraph
// the slice opens is refused where `tr.replace` cannot place it (plan 0117 Ruling 25).
import type { PluginEditorHandle } from "../plugin-host-registry";
import type { Editor } from "@tiptap/core";

import { afterEach, describe, expect, it, vi } from "vitest";

const { openUrl } = vi.hoisted(() => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

import { dropAnchors } from "../../extensions/plugins/selection-anchors";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { serializeLiveDoc } from "../../utils/editor/serialize-live-doc";
import { insertMarkdownAt } from "../editor-ops";
import { at, insert, nodeTarget, refused, topTypes } from "./insert-fixtures";
import { realEditor } from "./real-editor";

const MEDIA = "x ![a](y.png) z";
const OWNER = "acme.media";
const ctxOf = (editor: Editor) => ({
  live: () => editor as unknown as PluginEditorHandle,
  owner: OWNER,
});

afterEach(() => dropAnchors(OWNER));

describe("a one-paragraph result holding an image (spec 0067 §6.2, final review F1)", () => {
  it("the loader keeps the image inside the paragraph — the shape these rows are about", () => {
    // If the loader ever lifted the image out, the result would be three blocks and every
    // row below would pass through plain rule 4 without exercising the predicate.
    const { editor } = realEditor("x\n");
    const fragment = markdownToProsemirror(MEDIA, editor.schema).content;
    expect(fragment.childCount).toBe(1);
    expect(fragment.firstChild!.type.name).toBe("paragraph");
    expect(fragment.firstChild!.child(1).type.name).toBe("image");
    expect(fragment.firstChild!.child(1).isInline).toBe(false);
    editor.destroy();
  });

  it("a heading refuses it and is left as it was (rule 4 — D4)", () => {
    // Rule 3 opened it into the heading: `# Hex` / image / `&#x20;zading`, the tail in a body paragraph.
    refused("# He@@ading\n", MEDIA);
    refused("# @@\n", MEDIA);
  });

  it("a table cell refuses it with a code and dispatches nothing (rule 5a)", async () => {
    // Rule 3 made `tr.replace` throw a TypeError there, so the refusal carried no code.
    const { editor } = realEditor("| a | b |\n| --- | --- |\n| c@@ | d |\n");
    const before = editor.state.doc;
    const dispatch = vi.spyOn(editor.view, "dispatch");
    await expect(
      insertMarkdownAt(ctxOf(editor), { markdown: MEDIA }),
    ).rejects.toMatchObject({ code: "cannot-insert-here" });
    expect(dispatch).not.toHaveBeenCalled();
    expect(editor.state.doc).toBe(before);
    editor.destroy();
  });

  it("a paragraph takes it, split around the image (positive sibling)", async () => {
    const { editor } = realEditor("para @@ here\n");
    const dispatch = vi.spyOn(editor.view, "dispatch");
    await insertMarkdownAt(ctxOf(editor), { markdown: MEDIA });
    expect(serializeLiveDoc(editor)).toBe(
      "para x\n\n![a](y.png)\n\n&#x20;z here\n",
    );
    expect(dispatch).toHaveBeenCalled(); // the spy sees the send the cell row says is absent
    editor.destroy();
  });

  it("over an empty paragraph or a paragraph's whole content it is not widened (rule 4)", () => {
    // Widened, the replace threw a TypeError for both; unwidened, it is the same replace the
    // paragraph row gets.
    const placed = "alpha\n\nx\n\n![a](y.png)\n\n&#x20;z\n\nomega\n";
    expect(at("alpha\n\n@@\n\nomega\n", MEDIA)).toBe(placed);
    expect(at("alpha\n\n@@mid@@\n\nomega\n", MEDIA)).toBe(placed);
  });

  it("an empty result and a hard break are still inline — a heading takes both (rule 3)", () => {
    expect(at("# He@@ll@@o\n", "")).toBe("# Heo\n");
    const { editor, from, to } = realEditor("# Hea@@ding\n");
    insert(editor, { from, kind: "text", to }, "a  \nb");
    expect(topTypes(editor)).toEqual(["heading"]);
    let breaks = 0;
    editor.state.doc.descendants((n) => {
      if (n.type.name === "hardBreak") breaks += 1;
    });
    expect(breaks).toBe(1);
    expect(editor.state.doc.textContent).toBe("Heaabding");
    editor.destroy();
  });

  it("a node selection of a cell paragraph takes it whole, image and all (rule 5a asks for one paragraph)", () => {
    const { editor } = realEditor("| a | b |\n| --- | --- |\n| c | d |\n");
    insert(editor, nodeTarget(editor, "paragraph", "c"), MEDIA);
    expect(serializeLiveDoc(editor)).toBe(
      "| a | b |\n| - | - |\n| x ![a](y.png) z | d |\n",
    );
    editor.destroy();
  });
});

describe("a paragraph the slice opens, holding an image (spec 0067 §6.2 rule 4, plan 0117 Ruling 25)", () => {
  it("the last block may not: a paragraph target refuses it with a code and sends nothing", async () => {
    // Without the check, `tr.replace` threw "Called contentMatchAt on a node with invalid content".
    const { editor } = realEditor("para @@ here\n");
    const before = editor.state.doc;
    const dispatch = vi.spyOn(editor.view, "dispatch");
    await expect(
      insertMarkdownAt(ctxOf(editor), { markdown: "## H\n\n![a](y.png) z" }),
    ).rejects.toMatchObject({ code: "cannot-insert-here" });
    expect(dispatch).not.toHaveBeenCalled();
    expect(editor.state.doc).toBe(before);
    await insertMarkdownAt(ctxOf(editor), { markdown: "## H\n\nz" }); // the same blocks, no image
    expect(serializeLiveDoc(editor)).toBe("para\n\n## H\n\nz here\n");
    editor.destroy();
  });

  it("the first block may not over a widened range — but may at a caret in a paragraph", () => {
    // Widened, `tr.replace` threw a TypeError ("reading 'append'"); without the image it goes in.
    refused("alpha\n\n@@\n\nomega\n", "x ![a](y.png) z\n\np2");
    expect(at("alpha\n\n@@\n\nomega\n", "x z\n\np2")).toBe(
      "alpha\n\nx z\n\np2\n\nomega\n",
    );
    // At a caret its inline run joins the text and the image goes between the blocks.
    expect(at("para @@ here\n", "x ![a](y.png) z\n\np2")).toBe(
      "para x\n\n![a](y.png)\n\n&#x20;z\n\np2 here\n",
    );
  });

  it("a first block that starts with its image goes in over a widened range too", () => {
    expect(at("alpha\n\n@@\n\nomega\n", "![a](y.png) z\n\n## H")).toBe(
      "alpha\n\n![a](y.png)\n\n&#x20;z\n\n## H\n\nomega\n",
    );
  });

  it("one paragraph with two images apart is refused; side by side they go in", () => {
    refused("para @@ here\n", "x ![a](y.png) z ![b](w.png) q");
    expect(at("para @@ here\n", "x ![a](y.png)![b](w.png) z")).toBe(
      "para x\n\n![a](y.png)\n\n![b](w.png)\n\n&#x20;z here\n",
    );
  });
});
