// §388 spec 0067 §6.2 rules 3 · 4 — a one-paragraph result that holds an image (final review
// F1): rule 3 opens only an all-inline paragraph into the target; this one takes rule 4.
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
