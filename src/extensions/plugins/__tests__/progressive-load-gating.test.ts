import { Editor } from "@tiptap/core";
import { DecorationSet } from "@tiptap/pm/view";
import { describe, expect, it } from "vitest";

import { PROGRESSIVE_LOAD_META } from "../../../utils/editor/progressive-load";
import { createBaramExtensions } from "../../index";
import { blockIdDecoKey } from "../block-id-decoration";
import { listAtomFixKey } from "../list-atom-fix";

// Build a paragraph node with an explicit blockId so blockIdDecoKey can track it.
function makePara(editor: Editor, text: string, blockId: string) {
  return editor.schema.nodes.paragraph.create(
    { blockId },
    editor.schema.text(text),
  );
}

describe("progressive-load decoration gating", () => {
  it("gated transaction skips rebuild; final transaction rebuilds over full doc", () => {
    const editor = new Editor({
      extensions: createBaramExtensions(),
      content: "",
    });

    // Build two chunks of paragraphs, each with distinct blockIds.
    const chunk1 = [
      makePara(editor, "alpha", "id-alpha"),
      makePara(editor, "beta", "id-beta"),
    ];
    const chunk2 = [
      makePara(editor, "gamma", "id-gamma"),
      makePara(editor, "delta", "id-delta"),
    ];

    // Set initial content to chunk1.
    editor.commands.setContent(
      editor.schema.nodes.doc.create(null, chunk1).toJSON(),
    );

    // ── Gated append (PROGRESSIVE_LOAD_META set → docChanged=true but rebuild skipped) ──
    const s1 = editor.state;
    const insertPos1 = s1.doc.content.size;
    editor.view.dispatch(
      s1.tr.insert(insertPos1, chunk2).setMeta(PROGRESSIVE_LOAD_META, true),
    );

    // After gated append: docChanged=true but blockId rebuild was skipped.
    // entries still reflect only the pre-gated state (chunk1 only, or empty
    // from deferred-init path) — NOT chunk2 yet.
    const entriesAfterGated =
      blockIdDecoKey.getState(editor.state)?.entries ?? [];
    // chunk2 blocks should NOT be in entries yet (rebuild was suppressed).
    const gammaPresentAfterGated = entriesAfterGated.some(
      (e) => e.blockId === "id-gamma",
    );
    expect(gammaPresentAfterGated).toBe(false);

    // ── Final append (no meta → docChanged=true → full rebuild) ──
    const s2 = editor.state;
    const insertPos2 = s2.doc.content.size;
    editor.view.dispatch(
      s2.tr
        .insert(insertPos2, [makePara(editor, "epsilon", "id-epsilon")])
        .setMeta("addToHistory", false),
    );

    // After final rebuild: all blocks (chunk1 + gated chunk2 + epsilon) must appear in entries.
    const entriesFinal = blockIdDecoKey.getState(editor.state)?.entries ?? [];
    const ids = entriesFinal.map((e) => e.blockId);
    expect(ids).toContain("id-alpha");
    expect(ids).toContain("id-beta");
    expect(ids).toContain("id-gamma");
    expect(ids).toContain("id-delta");
    expect(ids).toContain("id-epsilon");

    // Verify listAtomFixKey state is a valid DecorationSet (no crash from mapping).
    const lafState = listAtomFixKey.getState(editor.state);
    expect(lafState).toBeInstanceOf(DecorationSet);

    editor.destroy();
  });
});
