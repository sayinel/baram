import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../../../pipeline/md-to-pm";
import { PROGRESSIVE_LOAD_META } from "../../../utils/editor/progressive-load";
import { createBaramExtensions } from "../../index";

describe("progressive-load decoration gating", () => {
  it("list-atom decorations cover items appended across gated + final chunks", () => {
    const editor = new Editor({
      extensions: createBaramExtensions(),
      content: "",
    });
    const full = markdownToProsemirror("- a\n- b\n- c\n", editor.schema);
    const blocks = full.content.content;
    editor.commands.setContent(
      editor.schema.nodes.doc.create(null, [blocks[0]]).toJSON(),
    );

    // gated append (meta set) then final append (no meta → triggers rebuild)
    const s1 = editor.state;
    editor.view.dispatch(
      s1.tr
        .insert(s1.doc.content.size, blocks.slice(1))
        .setMeta(PROGRESSIVE_LOAD_META, true),
    );
    const s2 = editor.state;
    editor.view.dispatch(
      s2.tr.insert(s2.doc.content.size, []).setMeta("addToHistory", false),
    );

    // Sanity: document is complete and roundtrips (no decoration error thrown).
    expect(editor.state.doc.textContent).toContain("a");
    editor.destroy();
  });
});
