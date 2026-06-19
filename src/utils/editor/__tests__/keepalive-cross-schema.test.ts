// §perf-large-file C3: regression for the large-file truncation bug.
//
// The keep-alive editor (used for large docs) is a SEPARATE Editor instance
// with its OWN Schema. ProseMirror compares NodeTypes by identity, so a node
// built with editor A's schema is "foreign" to editor B: B's
// `doc.contentMatchAt` rejects it and throws "Called contentMatchAt on a node
// with invalid content". The progressive first chunk is installed via
// `doc.create()` / `updateState()` (which do NOT validate, so it renders), but
// the appender's `tr.insert()` DOES validate against the existing doc and
// throws — aborting the fill and truncating the document to the first chunk.
//
// The fix (use-tab-switching.ts) re-converts the mdast with the TARGET editor's
// schema before chunking, so every node belongs to the editor it is inserted
// into. These tests lock in both the hazard and the correct same-schema flow.
import { Editor } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../../extensions";
import { mdastBlocksToPmNodes, parseMdast } from "../../../pipeline/md-to-pm";
import { appendChunksProgressively } from "../progressive-load";

const syncSchedule = (cb: () => void) => {
  cb();
  return () => {};
};

const MD = "alpha\n\nbeta\n\ngamma\n";

function loadFirstChunk(editor: Editor, node: Editor["state"]["doc"]) {
  editor.view.updateState(
    EditorState.create({
      doc: editor.schema.nodes.doc.create(null, [node]),
      plugins: editor.state.plugins,
    }),
  );
}

describe("keep-alive cross-schema node insertion (§perf-large-file C3)", () => {
  it("two editors from the same extensions have DISTINCT schema instances", () => {
    const a = new Editor({ extensions: createBaramExtensions(), content: "" });
    const b = new Editor({ extensions: createBaramExtensions(), content: "" });
    // This identity gap is the root cause: nodes are NOT interchangeable.
    expect(a.schema).not.toBe(b.schema);
    expect(a.schema.nodes.paragraph).not.toBe(b.schema.nodes.paragraph);
    a.destroy();
    b.destroy();
  });

  it("HAZARD: appending nodes built with another editor's schema throws contentMatchAt", () => {
    const shared = new Editor({
      extensions: createBaramExtensions(),
      content: "",
    });
    const keepalive = new Editor({
      extensions: createBaramExtensions(),
      content: "",
    });
    // Nodes built with the SHARED editor's schema (the pre-fix mistake).
    const foreign = mdastBlocksToPmNodes(parseMdast(MD), shared.schema);
    loadFirstChunk(keepalive, foreign[0]);

    expect(() =>
      appendChunksProgressively(keepalive, [[foreign[1], foreign[2]]], {
        schedule: syncSchedule,
        now: () => 999999,
        onComplete: () => {},
      }),
    ).toThrow(/contentMatchAt/);

    shared.destroy();
    keepalive.destroy();
  });

  it("FIX: nodes built with the target editor's own schema append cleanly (full load)", () => {
    const keepalive = new Editor({
      extensions: createBaramExtensions(),
      content: "",
    });
    // The fix converts mdast with the TARGET editor's schema.
    const nodes = mdastBlocksToPmNodes(parseMdast(MD), keepalive.schema);
    loadFirstChunk(keepalive, nodes[0]);

    let completed = false;
    expect(() =>
      appendChunksProgressively(keepalive, [[nodes[1], nodes[2]]], {
        schedule: syncSchedule,
        now: () => 999999,
        onComplete: () => {
          completed = true;
        },
      }),
    ).not.toThrow();

    expect(completed).toBe(true);
    expect(keepalive.state.doc.childCount).toBe(3);
    const texts: string[] = [];
    keepalive.state.doc.forEach((n) => texts.push(n.textContent));
    expect(texts).toEqual(["alpha", "beta", "gamma"]);
    keepalive.destroy();
  });
});
