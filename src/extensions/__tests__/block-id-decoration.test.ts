import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
// §30a Block ID Decoration — utility function tests
import { describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";
import {
  BLOCK_ID_PATTERN,
  isDuplicateBlockId,
  isValidBlockId,
} from "../plugins/block-id-decoration";

// ── Minimal schema for unit tests ────────────────────────────────────

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      marks: "_",
      attrs: { blockId: { default: null } },
    },
    heading: {
      content: "inline*",
      group: "block",
      attrs: {
        level: { default: 1 },
        blockId: { default: null },
      },
    },
    blockReference: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: {
        target: { default: "" },
        blockId: { default: "" },
        display: { default: null },
      },
    },
    blockEmbed: {
      group: "block",
      atom: true,
      attrs: {
        target: { default: "" },
        blockId: { default: "" },
      },
    },
    text: { group: "inline" },
  },
  marks: {},
});

// ── isValidBlockId ───────────────────────────────────────────────────

describe("isValidBlockId", () => {
  it("accepts simple alphanumeric ID", () => {
    expect(isValidBlockId("abc123")).toBe(true);
  });

  it("accepts ID with hyphens", () => {
    expect(isValidBlockId("my-block-id")).toBe(true);
  });

  it("accepts ID with underscores", () => {
    expect(isValidBlockId("my_block_42")).toBe(true);
  });

  it("accepts single character", () => {
    expect(isValidBlockId("a")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isValidBlockId("")).toBe(false);
  });

  it("rejects ID starting with hyphen", () => {
    expect(isValidBlockId("-invalid")).toBe(false);
  });

  it("rejects ID starting with underscore", () => {
    expect(isValidBlockId("_invalid")).toBe(false);
  });

  it("rejects ID with spaces", () => {
    expect(isValidBlockId("has space")).toBe(false);
  });

  it("rejects ID with special characters", () => {
    expect(isValidBlockId("has@char")).toBe(false);
    expect(isValidBlockId("has!char")).toBe(false);
  });
});

// ── BLOCK_ID_PATTERN ─────────────────────────────────────────────────

describe("BLOCK_ID_PATTERN", () => {
  it("matches valid patterns", () => {
    expect(BLOCK_ID_PATTERN.test("abc")).toBe(true);
    expect(BLOCK_ID_PATTERN.test("a1b2c3")).toBe(true);
    expect(BLOCK_ID_PATTERN.test("hello-world")).toBe(true);
    expect(BLOCK_ID_PATTERN.test("x")).toBe(true);
  });

  it("rejects invalid patterns", () => {
    expect(BLOCK_ID_PATTERN.test("")).toBe(false);
    expect(BLOCK_ID_PATTERN.test("-start")).toBe(false);
    expect(BLOCK_ID_PATTERN.test("_start")).toBe(false);
  });
});

// ── isDuplicateBlockId ───────────────────────────────────────────────

describe("isDuplicateBlockId", () => {
  it("detects duplicate block ID in another paragraph", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", { blockId: "abc123" }, [schema.text("first")]),
      schema.node("paragraph", { blockId: "def456" }, [schema.text("second")]),
    ]);

    // "abc123" exists at pos 0, checking from pos of second paragraph
    const secondPos = doc.child(0).nodeSize;
    expect(isDuplicateBlockId(doc, "abc123", secondPos)).toBe(true);
  });

  it("does not flag same node position as duplicate", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", { blockId: "abc123" }, [schema.text("first")]),
      schema.node("paragraph", { blockId: "def456" }, [schema.text("second")]),
    ]);

    // "abc123" exists at pos 0, checking from pos 0 (same node)
    expect(isDuplicateBlockId(doc, "abc123", 0)).toBe(false);
  });

  it("returns false for unique ID", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", { blockId: "abc123" }, [schema.text("first")]),
      schema.node("paragraph", { blockId: "def456" }, [schema.text("second")]),
    ]);

    const secondPos = doc.child(0).nodeSize;
    expect(isDuplicateBlockId(doc, "xyz789", secondPos)).toBe(false);
  });

  it("detects duplicate across paragraph and heading", () => {
    const doc = schema.node("doc", null, [
      schema.node("heading", { level: 1, blockId: "shared" }, [
        schema.text("Title"),
      ]),
      schema.node("paragraph", { blockId: null }, [schema.text("text")]),
    ]);

    const secondPos = doc.child(0).nodeSize;
    expect(isDuplicateBlockId(doc, "shared", secondPos)).toBe(true);
  });
});

// ── Roundtrip: block ID preserved in MD serialization ────────────────

describe("Block ID roundtrip (MD → PM → MD)", () => {
  it("preserves block ID on paragraph", () => {
    const md = "some text ^abc123";
    const doc = markdownToProsemirror(md, schema);
    const output = prosemirrorToMarkdown(doc);
    expect(output.trimEnd()).toBe(md);
  });

  it("preserves block ID on heading", () => {
    const md = "## Title ^heading1";
    const doc = markdownToProsemirror(md, schema);
    const output = prosemirrorToMarkdown(doc);
    expect(output.trimEnd()).toBe(md);
  });

  it("preserves multiple blocks with IDs", () => {
    const md = "# Header ^h1\n\nParagraph ^p1\n\nAnother ^p2";
    const doc = markdownToProsemirror(md, schema);
    const output = prosemirrorToMarkdown(doc);
    expect(output.trimEnd()).toBe(md);
  });

  it("preserves paragraph without block ID", () => {
    const md = "just plain text";
    const doc = markdownToProsemirror(md, schema);
    const output = prosemirrorToMarkdown(doc);
    expect(output.trimEnd()).toBe(md);
  });
});

// ── addBlockId utility (via setNodeMarkup pattern) ───────────────────

describe("addBlockId integration", () => {
  it("generates 8-char hex ID via generateBlockId", async () => {
    // Import dynamically to test the utility
    const { generateBlockId } = await import("../../pipeline/block-id");
    const id = generateBlockId();
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(isValidBlockId(id)).toBe(true);
  });

  it("setNodeMarkup correctly sets blockId attr", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", { blockId: null }, [schema.text("hello")]),
    ]);

    const state = EditorState.create({ doc, schema });
    const tr = state.tr;
    const node = doc.nodeAt(0)!;
    tr.setNodeMarkup(0, undefined, { ...node.attrs, blockId: "test123" });

    const newDoc = tr.doc;
    const updatedNode = newDoc.nodeAt(0)!;
    expect(updatedNode.attrs.blockId).toBe("test123");
  });

  it("setNodeMarkup can remove blockId by setting null", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", { blockId: "existing" }, [schema.text("hello")]),
    ]);

    const state = EditorState.create({ doc, schema });
    const tr = state.tr;
    const node = doc.nodeAt(0)!;
    tr.setNodeMarkup(0, undefined, { ...node.attrs, blockId: null });

    const newDoc = tr.doc;
    const updatedNode = newDoc.nodeAt(0)!;
    expect(updatedNode.attrs.blockId).toBeNull();
  });
});

// ── §30a-2 Same-document reference update ─────────────────────────────

describe("Same-document blockReference/blockEmbed update on ID rename", () => {
  it("updates blockReference blockId when source block ID changes", () => {
    // paragraph with ^abc123, then paragraph containing a blockReference to ^abc123
    const doc = schema.node("doc", null, [
      schema.node("paragraph", { blockId: "abc123" }, [
        schema.text("source block"),
      ]),
      schema.node("paragraph", { blockId: null }, [
        schema.text("see "),
        schema.node("blockReference", {
          target: "notes",
          blockId: "abc123",
          display: null,
        }),
      ]),
    ]);

    const state = EditorState.create({ doc, schema });
    const tr = state.tr;

    // Simulate commitBlockIdEdit: change blockId of first paragraph
    const oldId = "abc123";
    const newId = "xyz789";
    const node = doc.nodeAt(0)!;
    tr.setNodeMarkup(0, undefined, { ...node.attrs, blockId: newId });

    // Update blockReference nodes that reference oldId
    doc.descendants((child, pos) => {
      if (
        child.type.name === "blockReference" &&
        child.attrs.blockId === oldId
      ) {
        tr.setNodeMarkup(pos, undefined, { ...child.attrs, blockId: newId });
      }
      return true;
    });

    const newDoc = tr.doc;

    // Source block has new ID
    expect(newDoc.nodeAt(0)!.attrs.blockId).toBe("xyz789");

    // blockReference also updated
    let refNode: import("@tiptap/pm/model").Node | null = null;
    newDoc.descendants((child) => {
      if (child.type.name === "blockReference") {
        refNode = child;
      }
      return true;
    });
    expect(refNode).not.toBeNull();
    expect(refNode!.attrs.blockId).toBe("xyz789");
  });

  it("updates blockEmbed blockId when source block ID changes", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", { blockId: "embed1" }, [
        schema.text("embedded content"),
      ]),
      schema.node("blockEmbed", {
        target: "notes",
        blockId: "embed1",
      }),
    ]);

    const state = EditorState.create({ doc, schema });
    const tr = state.tr;

    const oldId = "embed1";
    const newId = "embed2";
    const node = doc.nodeAt(0)!;
    tr.setNodeMarkup(0, undefined, { ...node.attrs, blockId: newId });

    doc.descendants((child, pos) => {
      if (child.type.name === "blockEmbed" && child.attrs.blockId === oldId) {
        tr.setNodeMarkup(pos, undefined, { ...child.attrs, blockId: newId });
      }
      return true;
    });

    const newDoc = tr.doc;

    let embedNode: import("@tiptap/pm/model").Node | null = null;
    newDoc.descendants((child) => {
      if (child.type.name === "blockEmbed") {
        embedNode = child;
      }
      return true;
    });
    expect(embedNode).not.toBeNull();
    expect(embedNode!.attrs.blockId).toBe("embed2");
  });

  it("does not update references with different blockId", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", { blockId: "abc" }, [schema.text("source")]),
      schema.node("paragraph", { blockId: null }, [
        schema.node("blockReference", {
          target: "notes",
          blockId: "other",
          display: null,
        }),
      ]),
    ]);

    const state = EditorState.create({ doc, schema });
    const tr = state.tr;

    const oldId = "abc";
    const newId = "xyz";
    const node = doc.nodeAt(0)!;
    tr.setNodeMarkup(0, undefined, { ...node.attrs, blockId: newId });

    doc.descendants((child, pos) => {
      if (
        child.type.name === "blockReference" &&
        child.attrs.blockId === oldId
      ) {
        tr.setNodeMarkup(pos, undefined, { ...child.attrs, blockId: newId });
      }
      return true;
    });

    const newDoc = tr.doc;

    let refNode: import("@tiptap/pm/model").Node | null = null;
    newDoc.descendants((child) => {
      if (child.type.name === "blockReference") {
        refNode = child;
      }
      return true;
    });
    expect(refNode).not.toBeNull();
    // "other" should remain unchanged since we only renamed "abc"
    expect(refNode!.attrs.blockId).toBe("other");
  });
});
