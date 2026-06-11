import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../../extensions";
import { mdastBlocksToPmNodes, parseMdast } from "../../../pipeline/md-to-pm";
import { appendChunksProgressively, chunkBlocks } from "../progressive-load";

// chunkBlocks works on opaque items; use plain objects as stand-ins for PMNodes.
const items = (n: number) => Array.from({ length: n }, (_, i) => ({ i }));

describe("chunkBlocks", () => {
  it("returns a single chunk when blocks fit in the first chunk", () => {
    expect(chunkBlocks(items(50), 80, 150)).toHaveLength(1);
    expect(chunkBlocks(items(50), 80, 150)[0]).toHaveLength(50);
  });

  it("splits first chunk then rest chunks", () => {
    const chunks = chunkBlocks(items(400), 80, 150);
    expect(chunks.map((c) => c.length)).toEqual([80, 150, 150, 20]);
  });

  it("handles empty input", () => {
    expect(chunkBlocks([], 80, 150)).toEqual([]);
  });
});

const syncSchedule = (cb: () => void) => {
  cb();
  return () => {};
};

describe("appendChunksProgressively", () => {
  it("appends all chunks to the end and calls onComplete with the full doc", () => {
    const editor = new Editor({
      extensions: createBaramExtensions(),
      content: "",
    });
    // Build a 5-paragraph doc via mdastBlocksToPmNodes, load only the first block,
    // then progressively append the rest.
    const mdast = parseMdast("A\n\nB\n\nC\n\nD\n\nE\n");
    const blocks = mdastBlocksToPmNodes(mdast, editor.schema);
    expect(blocks).toHaveLength(5);

    editor.commands.setContent(
      editor.schema.nodes.doc.create(null, [blocks[0]]).toJSON(),
    );
    expect(editor.state.doc.childCount).toBe(1);

    let completed = false;
    appendChunksProgressively(
      editor,
      [
        [blocks[1], blocks[2]],
        [blocks[3], blocks[4]],
      ],
      {
        schedule: syncSchedule,
        onComplete: () => {
          completed = true;
        },
      },
    );

    expect(completed).toBe(true);
    expect(editor.state.doc.childCount).toBe(5);
    expect(editor.state.doc.textContent).toBe("ABCDE");
    editor.destroy();
  });

  it("stops appending after cancel()", () => {
    const editor = new Editor({
      extensions: createBaramExtensions(),
      content: "",
    });
    const mdast = parseMdast("A\n\nB\n\nC\n");
    const blocks = mdastBlocksToPmNodes(mdast, editor.schema);
    editor.commands.setContent(
      editor.schema.nodes.doc.create(null, [blocks[0]]).toJSON(),
    );
    // Manual scheduler we never advance → nothing appends; cancel must be safe.
    const pending: (() => void)[] = [];
    const handle = appendChunksProgressively(
      editor,
      [[blocks[1]], [blocks[2]]],
      {
        schedule: (cb) => {
          pending.push(cb);
          return () => {};
        },
        onComplete: () => {},
      },
    );
    handle.cancel();
    pending.forEach((cb) => cb()); // even if a tick fires, cancelled short-circuits
    expect(editor.state.doc.childCount).toBe(1);
    editor.destroy();
  });

  it("does not throw and appends nothing after editor.destroy()", () => {
    const editor = new Editor({
      extensions: createBaramExtensions(),
      content: "",
    });
    const mdast = parseMdast("A\n\nB\n\nC\n");
    const blocks = mdastBlocksToPmNodes(mdast, editor.schema);
    editor.commands.setContent(
      editor.schema.nodes.doc.create(null, [blocks[0]]).toJSON(),
    );
    // Collect pending ticks without executing them.
    const pending: (() => void)[] = [];
    appendChunksProgressively(editor, [[blocks[1]], [blocks[2]]], {
      schedule: (cb) => {
        pending.push(cb);
        return () => {};
      },
      onComplete: () => {},
    });
    editor.destroy();
    // Firing pending callbacks after destroy must not throw.
    expect(() => pending.forEach((cb) => cb())).not.toThrow();
  });
});
