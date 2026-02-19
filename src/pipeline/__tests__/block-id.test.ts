// §30a Block ID utility tests + §30b Block Reference/Embed utility tests
import { describe, it, expect } from "vitest";
import {
  extractBlockId,
  appendBlockId,
  BLOCK_ID_SUFFIX_RE,
  generateBlockId,
  BLOCK_REF_RE,
  parseBlockRefMatch,
  serializeBlockRef,
  BLOCK_EMBED_RE,
  parseBlockEmbedMatch,
  serializeBlockEmbed,
} from "../block-id";

describe("extractBlockId", () => {
  it("extracts simple alphanumeric ID", () => {
    const result = extractBlockId("some text ^abc123");
    expect(result).toEqual({ blockId: "abc123", strippedText: "some text" });
  });

  it("extracts ID with hyphens", () => {
    const result = extractBlockId("text ^my-block-id");
    expect(result).toEqual({ blockId: "my-block-id", strippedText: "text" });
  });

  it("extracts ID with underscores", () => {
    const result = extractBlockId("text ^block_id_1");
    expect(result).toEqual({ blockId: "block_id_1", strippedText: "text" });
  });

  it("returns null for text without block ID", () => {
    expect(extractBlockId("just plain text")).toBeNull();
  });

  it("returns null for caret without space before it (e.g. x^2)", () => {
    expect(extractBlockId("x^2")).toBeNull();
  });

  it("returns null for caret in middle of text", () => {
    expect(extractBlockId("some ^mid text")).toBeNull();
  });

  it("returns null for empty string after caret", () => {
    expect(extractBlockId("text ^")).toBeNull();
  });

  it("returns null for ID starting with non-alphanumeric", () => {
    expect(extractBlockId("text ^-invalid")).toBeNull();
    expect(extractBlockId("text ^_invalid")).toBeNull();
  });

  it("handles single-char ID", () => {
    const result = extractBlockId("text ^a");
    expect(result).toEqual({ blockId: "a", strippedText: "text" });
  });
});

describe("appendBlockId", () => {
  it("appends block ID with space+caret", () => {
    expect(appendBlockId("text", "abc123")).toBe("text ^abc123");
  });

  it("appends to empty string", () => {
    expect(appendBlockId("", "id1")).toBe(" ^id1");
  });
});

describe("BLOCK_ID_SUFFIX_RE", () => {
  it("matches valid block ID at end of string", () => {
    expect(BLOCK_ID_SUFFIX_RE.test("text ^a3f2b1c8")).toBe(true);
  });

  it("does not match without leading space", () => {
    expect(BLOCK_ID_SUFFIX_RE.test("text^abc")).toBe(false);
  });

  it("does not match math notation like x^2", () => {
    expect(BLOCK_ID_SUFFIX_RE.test("x^2")).toBe(false);
  });
});

// --- §30b tests ---

describe("generateBlockId", () => {
  it("returns 8-character hex string", () => {
    const id = generateBlockId();
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateBlockId()));
    expect(ids.size).toBe(100);
  });
});

describe("BLOCK_REF_RE", () => {
  it("matches ((target#^id))", () => {
    const re = new RegExp(BLOCK_REF_RE.source, "g");
    const match = re.exec("((architecture#^a3f2b1c8))");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("architecture");
    expect(match![2]).toBe("a3f2b1c8");
    expect(match![3]).toBeUndefined();
  });

  it("matches ((target#^id|display))", () => {
    const re = new RegExp(BLOCK_REF_RE.source, "g");
    const match = re.exec("((architecture#^a3f2b1c8|핵심 원칙))");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("architecture");
    expect(match![2]).toBe("a3f2b1c8");
    expect(match![3]).toBe("핵심 원칙");
  });

  it("matches ((#^id)) — same file", () => {
    const re = new RegExp(BLOCK_REF_RE.source, "g");
    const match = re.exec("((#^a3f2b1c8))");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("");
    expect(match![2]).toBe("a3f2b1c8");
  });

  it("does not match ((no-hash))", () => {
    const re = new RegExp(BLOCK_REF_RE.source, "g");
    expect(re.exec("((no-hash))")).toBeNull();
  });

  it("does not match ((target#no-caret))", () => {
    const re = new RegExp(BLOCK_REF_RE.source, "g");
    expect(re.exec("((target#no-caret))")).toBeNull();
  });
});

describe("parseBlockRefMatch", () => {
  it("parses target, blockId, display", () => {
    const re = new RegExp(BLOCK_REF_RE.source, "g");
    const match = re.exec("((file#^abc123|text))")!;
    const result = parseBlockRefMatch(match);
    expect(result).toEqual({
      target: "file",
      blockId: "abc123",
      display: "text",
    });
  });

  it("parses without display", () => {
    const re = new RegExp(BLOCK_REF_RE.source, "g");
    const match = re.exec("((file#^abc123))")!;
    const result = parseBlockRefMatch(match);
    expect(result).toEqual({
      target: "file",
      blockId: "abc123",
      display: null,
    });
  });
});

describe("serializeBlockRef", () => {
  it("serializes with target and blockId", () => {
    expect(serializeBlockRef({ target: "file", blockId: "abc123" })).toBe(
      "((file#^abc123))",
    );
  });

  it("serializes with display text", () => {
    expect(
      serializeBlockRef({ target: "file", blockId: "abc123", display: "text" }),
    ).toBe("((file#^abc123|text))");
  });

  it("serializes same-file reference", () => {
    expect(serializeBlockRef({ target: "", blockId: "abc123" })).toBe(
      "((#^abc123))",
    );
  });
});

describe("BLOCK_EMBED_RE", () => {
  it("matches {{embed ((target#^id))}}", () => {
    const match = BLOCK_EMBED_RE.exec("{{embed ((architecture#^a3f2b1c8))}}");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("architecture");
    expect(match![2]).toBe("a3f2b1c8");
  });

  it("matches same-file embed", () => {
    const match = BLOCK_EMBED_RE.exec("{{embed ((#^a3f2b1c8))}}");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("");
    expect(match![2]).toBe("a3f2b1c8");
  });

  it("does not match if text before", () => {
    expect(BLOCK_EMBED_RE.exec("text {{embed ((file#^id))}}")).toBeNull();
  });

  it("does not match if text after", () => {
    expect(BLOCK_EMBED_RE.exec("{{embed ((file#^id))}} text")).toBeNull();
  });
});

describe("parseBlockEmbedMatch", () => {
  it("parses target and blockId", () => {
    const match = BLOCK_EMBED_RE.exec("{{embed ((file#^abc123))}}")!;
    const result = parseBlockEmbedMatch(match);
    expect(result).toEqual({ target: "file", blockId: "abc123" });
  });
});

describe("serializeBlockEmbed", () => {
  it("serializes embed text", () => {
    expect(serializeBlockEmbed({ target: "file", blockId: "abc123" })).toBe(
      "{{embed ((file#^abc123))}}",
    );
  });

  it("serializes same-file embed", () => {
    expect(serializeBlockEmbed({ target: "", blockId: "abc123" })).toBe(
      "{{embed ((#^abc123))}}",
    );
  });
});
