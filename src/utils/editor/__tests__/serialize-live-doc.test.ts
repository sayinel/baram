// §384 canonical serialization — the fix's engine layer.
//
// The headline bug: SyntaxReveal (§5.1) turns a mark/link/image/wikilink into literal
// delimiter text while the cursor sits inside it. A raw `prosemirrorToMarkdown(state.doc)`
// read during that window serializes the literal text and the serializer escapes it a
// second time — `**bold**` round-trips to `\*\*bold\*\*`. `serializeLiveDoc` (and the
// state/detached-doc variants) fix this by collapsing the expansion — without dispatching
// — before handing the doc to the serializer.
import { Editor } from "@tiptap/core";
import { undoDepth } from "@tiptap/pm/history";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

import { createBaramExtensions } from "../../../extensions";
import { getSyntaxRevealExpanded } from "../../../extensions/plugins/syntax-reveal";
import { expandMediaAtom } from "../../../extensions/plugins/syntax-reveal-expand";
import { MARK_DELIMITERS } from "../../../extensions/plugins/syntax-reveal-state";
import { markdownToProsemirror } from "../../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../../pipeline/pm-to-md";
import {
  canonicalDoc,
  canonicalNodeAt,
  serializeDetachedDoc,
  serializeEditorState,
  serializeLiveDoc,
} from "../serialize-live-doc";

function createEditor(): Editor {
  return new Editor({ extensions: createBaramExtensions(), content: "" });
}

function loadMarkdown(editor: Editor, md: string): void {
  const doc = markdownToProsemirror(md, editor.schema);
  editor.commands.setContent(doc.toJSON());
}

/** Same two-step cursor move `syntax-reveal.test.ts` uses — the guard-position hop is
 *  required for the plugin's `cursorAtDocChange` gate to let expansion run at all. */
function moveCursorTo(
  editor: Editor,
  guardPos: number,
  targetPos: number,
): void {
  editor.commands.setTextSelection(guardPos);
  editor.commands.setTextSelection(targetPos);
}

/** Position of the middle character of the first text node satisfying `match`. */
function midpointOf(editor: Editor, match: (text: string) => boolean): number {
  const hits: { from: number; text: string }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (hits.length > 0) return false;
    if (node.isText && node.text && match(node.text)) {
      hits.push({ from: pos, text: node.text });
    }
    return true;
  });
  const found = hits[0];
  if (!found) throw new Error("midpointOf: no matching text node");
  return found.from + Math.floor(found.text.length / 2);
}

describe("§384 canonicalDoc / serializeEditorState / serializeLiveDoc", () => {
  it("no active expansion: mapping is null, doc is state.doc", () => {
    const editor = createEditor();
    loadMarkdown(editor, "Hello world\n");
    const { doc, mapping } = canonicalDoc(editor.state);
    expect(doc).toBe(editor.state.doc);
    expect(mapping).toBeNull();
    editor.destroy();
  });

  it("headline repro: caret inside a link — raw serialization corrupts, canonical does not", () => {
    const editor = createEditor();
    const original = "Hello [world](https://example.com) end\n";
    loadMarkdown(editor, original);
    moveCursorTo(editor, 2, 9); // caret lands inside "world"

    // Expansion actually happened — otherwise the rest of this test is vacuous.
    expect(getSyntaxRevealExpanded(editor.state)).not.toBeNull();

    // RED: the naive read every pre-§384 call site used.
    expect(prosemirrorToMarkdown(editor.state.doc)).not.toBe(original);

    // GREEN: canonicalization fixes it.
    expect(serializeLiveDoc(editor)).toBe(original);
    expect(serializeEditorState(editor.state)).toBe(original);
    editor.destroy();
  });

  it("caret parked outside any expansion: serializeLiveDoc matches the raw read", () => {
    const editor = createEditor();
    const original = "Hello **world** end\n";
    loadMarkdown(editor, original);
    moveCursorTo(editor, 2, 3); // stays in "Hello", nothing expands

    expect(getSyntaxRevealExpanded(editor.state)).toBeNull();
    expect(serializeLiveDoc(editor)).toBe(
      prosemirrorToMarkdown(editor.state.doc),
    );
    expect(serializeLiveDoc(editor)).toBe(original);
    editor.destroy();
  });
});

describe("§384 kind coverage — every SyntaxReveal mark delimiter (data-driven)", () => {
  // One fixture per mark kind: markdown source with that mark applied mid-sentence,
  // and a predicate to find the marked run's text node so the caret can target its
  // midpoint regardless of delimiter length.
  //
  // `corruptsRawRead` records an empirical fact, not an assumption: remark-stringify
  // escapes `*`/`~`/`` ` `` (and `<` inside the underline HTML tag) when they appear as
  // literal text, because they are ordinary CommonMark/GFM syntax characters — so a raw
  // `prosemirrorToMarkdown(state.doc)` read while expanded really does double-escape
  // those. `=` (highlight) and `^` (superscript) are this app's own inline syntax and
  // remark's serializer has no reason to escape them as plain text, so the naive read
  // happens to come out byte-identical for THOSE two specifically — asserting corruption
  // there would be asserting something false, not a stronger pin. The invariant that
  // must hold for all eight regardless is the one below it: canonical serialization
  // always reproduces the original.
  const fixtures: Record<
    string,
    { corruptsRawRead: boolean; input: string; markText: string }
  > = {
    bold: {
      input: "Hello **world** end\n",
      markText: "world",
      corruptsRawRead: true,
    },
    italic: {
      input: "Hello *world* end\n",
      markText: "world",
      corruptsRawRead: true,
    },
    strike: {
      input: "Hello ~~world~~ end\n",
      markText: "world",
      corruptsRawRead: true,
    },
    code: {
      input: "Hello `world` end\n",
      markText: "world",
      corruptsRawRead: true,
    },
    underline: {
      input: "Hello <u>world</u> end\n",
      markText: "world",
      corruptsRawRead: true,
    },
    highlight: {
      input: "Hello ==world== end\n",
      markText: "world",
      corruptsRawRead: false,
    },
    subscript: {
      input: "Hello H~2~O end\n",
      markText: "2",
      corruptsRawRead: true,
    },
    superscript: {
      input: "Hello H^2^O end\n",
      markText: "2",
      corruptsRawRead: false,
    },
  };

  it("fixture table covers exactly the kinds SyntaxReveal knows about", () => {
    expect(Object.keys(fixtures).sort()).toEqual(
      Object.keys(MARK_DELIMITERS).sort(),
    );
  });

  it.each(Object.entries(MARK_DELIMITERS))(
    "%s: caret inside the mark — canonical serialization always reproduces the original",
    (kind) => {
      const fixture = fixtures[kind];
      if (!fixture) throw new Error(`no fixture registered for kind ${kind}`);
      const editor = createEditor();
      loadMarkdown(editor, fixture.input);

      const target = midpointOf(editor, (t) => t.includes(fixture.markText));
      moveCursorTo(editor, 1, target);

      // Expansion actually happened — otherwise this whole case is vacuous.
      expect(getSyntaxRevealExpanded(editor.state)).not.toBeNull();

      if (fixture.corruptsRawRead) {
        expect(prosemirrorToMarkdown(editor.state.doc)).not.toBe(fixture.input);
      }
      expect(serializeLiveDoc(editor)).toBe(fixture.input);
      editor.destroy();
    },
  );
});

describe("§384 link caret positions (start / inside text / inside URL / trailing boundary)", () => {
  const original = "Hello [world](https://example.com) end\n";
  // Positions are in the doc's POST-expansion coordinate space — expansion must
  // happen first (moveCursorTo into "world" at the pre-expansion position 9), then
  // the caret is moved again within the now-literal "[world](https://example.com)"
  // text, which spans PM positions [7, 35).
  const positions: Record<string, number> = {
    "at opening bracket (left boundary, inclusive)": 7,
    "inside link text": 9,
    "inside the URL": 21,
    "at trailing boundary, right after the closing paren (inclusive)": 35,
  };

  it.each(Object.entries(positions))("%s", (_label, pos) => {
    const editor = createEditor();
    loadMarkdown(editor, original);
    moveCursorTo(editor, 2, 9); // expand first
    expect(getSyntaxRevealExpanded(editor.state)).not.toBeNull();

    editor.commands.setTextSelection(pos);
    expect(getSyntaxRevealExpanded(editor.state)).not.toBeNull();
    expect(serializeLiveDoc(editor)).toBe(original);
    editor.destroy();
  });
});

describe("§384 image / video expansion carries attrs through canonical serialization", () => {
  // expandMediaAtom is called directly (bypassing the click/NodeSelection UI paths,
  // one of which is RAF-scheduled and won't fire synchronously under jsdom) — this
  // suite is about the canonicalization engine, not SyntaxReveal's own trigger paths.
  it("image: expanded markdown serializes back with attrs (alt/title/widthPercent) intact", () => {
    const editor = createEditor();
    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "image",
          attrs: {
            src: "pic.png",
            alt: "a cat",
            title: "cute",
            widthPercent: 50,
          },
        },
      ],
    });
    const node = editor.state.doc.nodeAt(0)!;
    expandMediaAtom(editor.view, node, 0);
    expect(getSyntaxRevealExpanded(editor.state)).not.toBeNull();

    const originalMd = prosemirrorToMarkdown(
      editor.schema.nodes.doc.create(null, [
        editor.schema.nodes.image.create({
          src: "pic.png",
          alt: "a cat",
          title: "cute",
          widthPercent: 50,
        }),
      ]),
    );

    expect(prosemirrorToMarkdown(editor.state.doc)).not.toBe(originalMd);
    expect(serializeLiveDoc(editor)).toBe(originalMd);
    editor.destroy();
  });

  it("video: expanded markdown serializes back as a video node, not an image", () => {
    const editor = createEditor();
    editor.commands.setContent({
      type: "doc",
      content: [
        { type: "video", attrs: { src: "clip.mp4", alt: null, title: null } },
      ],
    });
    const node = editor.state.doc.nodeAt(0)!;
    expandMediaAtom(editor.view, node, 0);
    expect(getSyntaxRevealExpanded(editor.state)).not.toBeNull();

    const originalMd = prosemirrorToMarkdown(
      editor.schema.nodes.doc.create(null, [
        editor.schema.nodes.video.create({ src: "clip.mp4" }),
      ]),
    );

    expect(prosemirrorToMarkdown(editor.state.doc)).not.toBe(originalMd);
    expect(serializeLiveDoc(editor)).toBe(originalMd);
    editor.destroy();
  });
});

describe("§384 wikilink expansion (alias / heading / blockid)", () => {
  it.each([
    ["bare target", "See [[note]] end\n"],
    ["with alias", "See [[vault::note]] end\n"],
    ["with heading", "See [[note#Heading]] end\n"],
    ["with block id", "See [[note^abc123]] end\n"],
    ["with display text", "See [[note|Display Text]] end\n"],
  ])(
    "%s: caret adjacent to the wikilink serializes back to the original",
    (_label, original) => {
      const editor = createEditor();
      loadMarkdown(editor, original);
      // Wikilinks are atoms — expand via cursor-adjacent, not "inside" (there is no
      // inside). Select the node then move the caret to just before it, mirroring
      // checkCursorAdjacentToWikilink's "front" path.
      let wikilinkPos: null | number = null;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "wikilink") wikilinkPos = pos;
        return wikilinkPos === null;
      });
      expect(wikilinkPos).not.toBeNull();
      moveCursorTo(editor, 1, wikilinkPos!);

      expect(getSyntaxRevealExpanded(editor.state)).not.toBeNull();
      expect(serializeLiveDoc(editor)).toBe(original);
      editor.destroy();
    },
  );
});

describe("§384 purity — canonicalizing for serialization never mutates the live editor", () => {
  it("no update event fires, selection/doc identity and undo depth are unchanged", () => {
    const editor = createEditor();
    loadMarkdown(editor, "Hello [world](https://example.com) end\n");
    moveCursorTo(editor, 2, 9);
    expect(getSyntaxRevealExpanded(editor.state)).not.toBeNull();

    const docBefore = editor.state.doc;
    const selectionBefore = editor.state.selection;
    const undoDepthBefore = undoDepth(editor.state);
    const updateSpy = vi.fn();
    editor.on("update", updateSpy);

    serializeLiveDoc(editor);
    serializeEditorState(editor.state);
    canonicalDoc(editor.state);

    expect(updateSpy).not.toHaveBeenCalled();
    // Node identity, not deep-equality: the strongest available proof that no
    // transaction was dispatched against the live state.
    expect(editor.state.doc).toBe(docBefore);
    expect(editor.state.selection).toBe(selectionBefore);
    // Confirms not just "no dispatch we happened to look at" but specifically
    // that nothing was pushed onto the undo stack — a stray collapse transaction
    // would show up here even if selection/doc identity checks somehow missed it.
    expect(undoDepth(editor.state)).toBe(undoDepthBefore);
    editor.destroy();
  });
});

describe("§384 serializeDetachedDoc — for docs that were never a live EditorState", () => {
  it("is exactly prosemirrorToMarkdown, with no canonicalization step", () => {
    const editor = createEditor();
    loadMarkdown(editor, "plain text\n");
    const doc = editor.state.doc;
    expect(serializeDetachedDoc(doc)).toBe(prosemirrorToMarkdown(doc));
    editor.destroy();
  });
});

describe("§384 canonicalNodeAt — derived-node call sites (table cell copy, task line read)", () => {
  it("returns the collapsed node when the position falls inside an active expansion", () => {
    const editor = createEditor();
    loadMarkdown(editor, "Hello **world** end\n");
    moveCursorTo(editor, 2, 9);
    expect(getSyntaxRevealExpanded(editor.state)).not.toBeNull();

    // The paragraph is the block ancestor callers like task-edit-io resolve
    // `posBefore` against — position 0, one PM position before the paragraph.
    const node = canonicalNodeAt(editor.state, 0, "paragraph");
    expect(node).not.toBeNull();
    expect(node!.textContent).toBe("Hello world end");

    // Sanity: the LIVE node at the same position still has the literal delimiters —
    // proving canonicalNodeAt did real work, not a no-op.
    const liveNode = editor.state.doc.nodeAt(0);
    expect(liveNode?.textContent).not.toBe("Hello world end");
    editor.destroy();
  });

  it("returns null when the mapped position holds a node of a different type", () => {
    const editor = createEditor();
    loadMarkdown(editor, "Hello world\n");
    const node = canonicalNodeAt(editor.state, 0, "heading");
    expect(node).toBeNull();
  });

  it("table cell: bold expanded inside a cell still copies as clean markdown", () => {
    const editor = createEditor();
    loadMarkdown(editor, "| A | B |\n| --- | --- |\n| **bold** | plain |\n");
    // Find the table node's position (posBefore, matching findTable/findTableAtCursor).
    let tablePos: null | number = null;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "table") tablePos = pos;
      return tablePos === null;
    });
    expect(tablePos).not.toBeNull();

    // Put the caret inside the cell's bold text to trigger an expansion.
    const target = midpointOf(editor, (t) => t.includes("bold"));
    moveCursorTo(editor, 1, target);
    expect(getSyntaxRevealExpanded(editor.state)).not.toBeNull();

    const canonicalTable = canonicalNodeAt(editor.state, tablePos!, "table");
    expect(canonicalTable).not.toBeNull();
    const tempDoc = editor.schema.nodes.doc.create(null, [canonicalTable!]);
    const md = serializeDetachedDoc(tempDoc).trim();
    expect(md).toContain("**bold**");
    expect(md).not.toContain("\\*\\*bold\\*\\*");
    editor.destroy();
  });
});

// §384 real-path pin (expression-level): FileEditorLayout's external-change listener
// treats a disk write as its own self-write via `diskContent === serializeLiveDoc(editor)`
// (FileEditorLayout.tsx) — if the caret is inside an expansion when that fires, the raw
// read would fail this comparison and misreport a self-write as an external change.
// This asserts the operand FileEditorLayout actually compares, not the component's
// listener wiring (no jsdom Tauri `listen()` harness here) — see the task's final report
// for why the component-level version was judged not worth its setup cost.
describe("§384 FileEditorLayout self-write comparison operand", () => {
  it("caret inside a link: serializeLiveDoc(editor) equals the just-written disk content", () => {
    const editor = createEditor();
    const original = "Hello [world](https://example.com) end\n";
    loadMarkdown(editor, original);
    moveCursorTo(editor, 2, 9);
    expect(getSyntaxRevealExpanded(editor.state)).not.toBeNull();

    const diskContent = original; // what FileEditorLayout just wrote via handleSave
    expect(diskContent === serializeLiveDoc(editor)).toBe(true);
    // The raw read FileEditorLayout used before §384 would have failed this same
    // comparison, misreporting the app's own write as an external change.
    expect(diskContent === prosemirrorToMarkdown(editor.state.doc)).toBe(false);
    editor.destroy();
  });
});
