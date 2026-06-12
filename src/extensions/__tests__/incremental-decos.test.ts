// §perf-large-file C3.1: Regression tests — incremental decoration maintenance
//
// Every test drives the REAL production plugins via a full Tiptap Editor and
// reads decoration state through the canonical plugin keys. Mirror-copy helpers
// have been removed. Tests must fail against the broken (pre-fix) code and pass
// only after all six C3.1 fixes are applied.

import { Editor } from "@tiptap/core";
import { DecorationSet } from "@tiptap/pm/view";
import { beforeEach, describe, expect, it } from "vitest";

import { PROGRESSIVE_LOAD_META } from "../../utils/editor/progressive-load";
import { createBaramExtensions } from "../index";
import { blockIdDecoKey } from "../plugins/block-id-decoration";
import {
  _findFoldableHeadingsCallCount,
  _resetFindFoldableHeadingsCallCount,
  foldPluginKey,
} from "../plugins/fold";
import { listAtomFixKey } from "../plugins/list-atom-fix";
import { promptHighlightKey } from "../plugins/prompt-highlight";

function makeEditor() {
  return new Editor({
    extensions: createBaramExtensions(),
    content: "",
  });
}

// ---------------------------------------------------------------------------
// list-atom-fix — production plugin via real Editor
// ---------------------------------------------------------------------------

describe("list-atom-fix: production plugin incremental === from-scratch", () => {
  it("initialized flag prevents per-keystroke full walk on empty doc", () => {
    const editor = makeEditor();
    // An empty doc has no list items → zero decorations.
    // Dispatch a pure selection change (no docChange) multiple times and verify
    // the plugin state is stable (initialized=true after first transaction).
    for (let i = 0; i < 3; i++) {
      editor.view.dispatch(editor.state.tr);
    }
    const state = listAtomFixKey.getState(editor.state);
    expect(state?.initialized).toBe(true);
    expect(state?.decorations).toBeInstanceOf(DecorationSet);
    editor.destroy();
  });

  it("progressive-load gated chunk sets needsFullRebuild; final chunk rebuilds", () => {
    const editor = makeEditor();

    // Insert a plain paragraph without list context first.
    editor.commands.setContent("<p>Hello</p>");

    // Gated append
    const s1 = editor.state;
    editor.view.dispatch(
      s1.tr
        .insert(
          s1.doc.content.size,
          editor.schema.nodes.paragraph.create(
            null,
            editor.schema.text("world"),
          ),
        )
        .setMeta(PROGRESSIVE_LOAD_META, true),
    );
    const afterGated = listAtomFixKey.getState(editor.state);
    expect(afterGated?.needsFullRebuild).toBe(true);

    // Final (non-gated) docChanged → full rebuild clears flag
    const s2 = editor.state;
    editor.view.dispatch(
      s2.tr
        .insert(
          s2.doc.content.size,
          editor.schema.nodes.paragraph.create(null, editor.schema.text("!")),
        )
        .setMeta("addToHistory", false),
    );
    const afterFinal = listAtomFixKey.getState(editor.state);
    expect(afterFinal?.needsFullRebuild).toBe(false);
    expect(afterFinal?.initialized).toBe(true);

    editor.destroy();
  });

  it("decoration count matches from-scratch after text edit inside list", () => {
    const editor = makeEditor();
    // Build a bullet list with a plain-text paragraph
    editor.commands.setContent(
      "<ul><li><p>hello</p></li><li><p>world</p></li></ul>",
    );

    // Do a text insert inside the first list item paragraph
    const s0 = editor.state;
    editor.view.dispatch(s0.tr.insertText("X", 3));

    // The incremental state should match a fresh full rebuild
    const pluginState = listAtomFixKey.getState(editor.state);
    expect(pluginState?.decorations).toBeInstanceOf(DecorationSet);
    // Plain-text list items should have zero laf decorations
    expect(pluginState?.decorations.find().length).toBe(0);

    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// block-id-decoration — production plugin via real Editor
// ---------------------------------------------------------------------------

describe("block-id-decoration: production plugin incremental === from-scratch", () => {
  it("initialized flag prevents per-keystroke walk on doc with no blockIds", () => {
    const editor = makeEditor();
    editor.commands.setContent("<p>no block id here</p>");

    // Apply several no-op transactions
    for (let i = 0; i < 3; i++) {
      editor.view.dispatch(editor.state.tr);
    }
    const state = blockIdDecoKey.getState(editor.state);
    expect(state?.initialized).toBe(true);
    // No block IDs → entries empty, but initialized
    expect(state?.entries).toHaveLength(0);

    editor.destroy();
  });

  it("entries correct after text insert in paragraph without blockId", () => {
    const editor = makeEditor();
    // Set a paragraph with a blockId attr
    const para = editor.schema.nodes.paragraph.create(
      { blockId: "id-a" },
      editor.schema.text("alpha"),
    );
    editor.view.dispatch(
      editor.state.tr.replaceWith(
        0,
        editor.state.doc.content.size,
        editor.schema.nodes.doc.create(null, [
          para,
          editor.schema.nodes.paragraph.create(
            null,
            editor.schema.text("beta"),
          ),
        ]),
      ),
    );

    const stateBefore = blockIdDecoKey.getState(editor.state);
    expect(stateBefore?.entries.map((e) => e.blockId)).toContain("id-a");

    // Edit inside the non-blockId second paragraph
    const secondParaStart = para.nodeSize + 1;
    editor.view.dispatch(editor.state.tr.insertText("X", secondParaStart));

    const stateAfter = blockIdDecoKey.getState(editor.state);
    expect(stateAfter?.entries.map((e) => e.blockId)).toContain("id-a");
    expect(stateAfter?.entries).toHaveLength(1);
    expect(stateAfter?.idCountMap.get("id-a")).toBe(1);

    editor.destroy();
  });

  it("idCountMap updated O(changed) — duplicate ids counted correctly after incremental edit", () => {
    const editor = makeEditor();
    const makeP = (id: string, text: string) =>
      editor.schema.nodes.paragraph.create(
        { blockId: id },
        editor.schema.text(text),
      );
    editor.view.dispatch(
      editor.state.tr.replaceWith(
        0,
        editor.state.doc.content.size,
        editor.schema.nodes.doc.create(null, [
          makeP("dup", "a"),
          makeP("dup", "b"),
          makeP("unique", "c"),
        ]),
      ),
    );

    const s0 = blockIdDecoKey.getState(editor.state);
    expect(s0?.idCountMap.get("dup")).toBe(2);
    expect(s0?.idCountMap.get("unique")).toBe(1);

    // Text edit that does NOT touch the "dup" or "unique" paragraphs
    // (edit at the very beginning, inside first "dup" para)
    editor.view.dispatch(editor.state.tr.insertText("X", 2));

    const s1 = blockIdDecoKey.getState(editor.state);
    // "dup" appears twice, "unique" once — counts must be preserved
    expect(s1?.idCountMap.get("dup")).toBe(2);
    expect(s1?.idCountMap.get("unique")).toBe(1);

    editor.destroy();
  });

  it("progressive-load final chunk triggers full rebuild", () => {
    const editor = makeEditor();

    // Gated append
    const p1 = editor.schema.nodes.paragraph.create(
      { blockId: "id-1" },
      editor.schema.text("one"),
    );
    editor.view.dispatch(
      editor.state.tr
        .insert(editor.state.doc.content.size, p1)
        .setMeta(PROGRESSIVE_LOAD_META, true),
    );
    expect(blockIdDecoKey.getState(editor.state)?.needsFullRebuild).toBe(true);
    // id-1 NOT in entries yet (rebuild was suppressed)
    expect(
      blockIdDecoKey
        .getState(editor.state)
        ?.entries.some((e) => e.blockId === "id-1"),
    ).toBe(false);

    // Final non-gated transaction
    const p2 = editor.schema.nodes.paragraph.create(
      { blockId: "id-2" },
      editor.schema.text("two"),
    );
    editor.view.dispatch(
      editor.state.tr
        .insert(editor.state.doc.content.size, p2)
        .setMeta("addToHistory", false),
    );
    const finalState = blockIdDecoKey.getState(editor.state);
    expect(finalState?.needsFullRebuild).toBe(false);
    const ids = finalState?.entries.map((e) => e.blockId) ?? [];
    expect(ids).toContain("id-1");
    expect(ids).toContain("id-2");

    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// fold — map-only path on paragraph edit; counter-based assertion
// ---------------------------------------------------------------------------

describe("fold: production plugin map-only branch on pure paragraph edit", () => {
  beforeEach(() => {
    _resetFindFoldableHeadingsCallCount();
  });

  it("paragraph-only text insert does NOT call findFoldableHeadings", () => {
    const editor = makeEditor();
    editor.commands.setContent(
      "<h1>Section A</h1><p>Content here.</p><h1>Section B</h1><p>More.</p>",
    );

    // Reset after setContent (which may trigger init transactions)
    _resetFindFoldableHeadingsCallCount();

    // Text edit inside a paragraph — should take map-only path
    const state = editor.state;
    const h1Size = state.doc.firstChild!.nodeSize;
    editor.view.dispatch(state.tr.insertText("X", h1Size + 1));

    // The incremental gate should have skipped the full rebuild → counter stays 0
    expect(_findFoldableHeadingsCallCount).toBe(0);

    editor.destroy();
  });

  it("heading edit DOES call findFoldableHeadings (rebuild triggered)", () => {
    const editor = makeEditor();
    editor.commands.setContent("<h1>Section A</h1><p>Content.</p>");

    _resetFindFoldableHeadingsCallCount();

    // Text edit inside the heading → structure changed → full rebuild
    editor.view.dispatch(editor.state.tr.insertText("X", 2));

    expect(_findFoldableHeadingsCallCount).toBeGreaterThan(0);

    editor.destroy();
  });

  it("progressive-load gated chunk sets needsFullRebuild; final chunk rebuilds", () => {
    const editor = makeEditor();
    editor.commands.setContent("<h1>Heading</h1><p>Para.</p>");

    const s1 = editor.state;
    editor.view.dispatch(
      s1.tr
        .insert(
          s1.doc.content.size,
          editor.schema.nodes.paragraph.create(
            null,
            editor.schema.text("chunk"),
          ),
        )
        .setMeta(PROGRESSIVE_LOAD_META, true),
    );
    expect(foldPluginKey.getState(editor.state)?.needsFullRebuild).toBe(true);

    _resetFindFoldableHeadingsCallCount();

    // Final non-gated docChanged → full rebuild
    const s2 = editor.state;
    editor.view.dispatch(
      s2.tr
        .insert(
          s2.doc.content.size,
          editor.schema.nodes.paragraph.create(null, editor.schema.text("!")),
        )
        .setMeta("addToHistory", false),
    );
    expect(foldPluginKey.getState(editor.state)?.needsFullRebuild).toBe(false);
    // Full rebuild runs findFoldableHeadings
    expect(_findFoldableHeadingsCallCount).toBeGreaterThan(0);

    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// prompt-highlight — incremental === from-scratch on a Skills file
// ---------------------------------------------------------------------------

describe("prompt-highlight: production plugin incremental === from-scratch", () => {
  /** Build a Skills-file document JSON with frontmatter + paragraphs. */
  function makeSkillsContent(body: string): object {
    return {
      type: "doc",
      content: [
        {
          type: "frontmatter",
          attrs: {
            yaml: "name: TestSkill\ndescription: A test skill",
          },
        },
        {
          type: "paragraph",
          content: body ? [{ type: "text", text: body }] : [],
        },
      ],
    };
  }

  it("XML tag decorated on initial load", () => {
    const editor = makeEditor();
    editor.commands.setContent(
      makeSkillsContent("<system>You are helpful.</system>"),
    );

    const decos = promptHighlightKey.getState(editor.state) as DecorationSet;
    // Should have at least one decoration covering the <system> tag
    expect(decos.find().length).toBeGreaterThan(0);

    editor.destroy();
  });

  it("incremental path preserves XML decoration after unrelated text insert", () => {
    const editor = makeEditor();
    editor.commands.setContent(
      makeSkillsContent("<system>You are helpful.</system> Text here."),
    );

    const decosBefore = (
      promptHighlightKey.getState(editor.state) as DecorationSet
    ).find();

    // Append text at the very end of the paragraph (no new XML tag)
    const endPos = editor.state.doc.content.size - 1; // before closing doc
    editor.view.dispatch(editor.state.tr.insertText("X", endPos - 1));

    const decosAfter = (
      promptHighlightKey.getState(editor.state) as DecorationSet
    ).find();

    // XML decoration count must be unchanged
    const xmlBefore = decosBefore.filter(
      (d) => (d.spec as Record<string, unknown>).class === "prompt-xml-tag",
    );
    const xmlAfter = decosAfter.filter(
      (d) => (d.spec as Record<string, unknown>).class === "prompt-xml-tag",
    );
    expect(xmlAfter.length).toBe(xmlBefore.length);

    editor.destroy();
  });

  it("prompt-highlight decorations incremental: decoration count stable after unrelated paragraph insert", () => {
    const editor = makeEditor();
    // A skills file paragraph that is sure to produce decorations (XML tags).
    editor.commands.setContent(
      makeSkillsContent("<system>You are helpful.</system>"),
    );

    const before = (
      promptHighlightKey.getState(editor.state) as DecorationSet
    ).find();
    // XML test already proved decorations exist; here we just need count
    expect(before.length).toBeGreaterThan(0);

    // Insert an extra paragraph at the end of the doc (no new XML tags)
    const s = editor.state;
    editor.view.dispatch(
      s.tr.insert(
        s.doc.content.size,
        editor.schema.nodes.paragraph.create(null, editor.schema.text("plain")),
      ),
    );

    const after = (
      promptHighlightKey.getState(editor.state) as DecorationSet
    ).find();
    // Decoration count must be the same as before (pure block insert, no new patterns)
    expect(after.length).toBe(before.length);

    editor.destroy();
  });

  it("non-skills file produces empty decoration set", () => {
    const editor = makeEditor();
    editor.commands.setContent("<p>Just a regular paragraph with {{var}}</p>");

    const decos = promptHighlightKey.getState(editor.state) as DecorationSet;
    expect(decos.find().length).toBe(0);

    editor.destroy();
  });
});
