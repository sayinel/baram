import { describe, expect, it } from "vitest";

import { extractEntities } from "../entity-extractor";

describe("extractEntities", () => {
  const dictionary = new Set([
    "editor engine",
    "ProseMirror",
    "Rust",
    "Tiptap",
  ]);

  it("finds exact matches from dictionary", () => {
    const result = extractEntities(
      "Baram uses ProseMirror for editing.",
      dictionary,
    );
    expect(result).toContain("ProseMirror");
  });

  it("finds case-insensitive matches", () => {
    const result = extractEntities("Built with tiptap framework.", dictionary);
    expect(result).toContain("Tiptap");
  });

  it("excludes already-linked entities", () => {
    const result = extractEntities(
      "Uses [[ProseMirror]] and Tiptap.",
      dictionary,
    );
    expect(result).not.toContain("ProseMirror");
    expect(result).toContain("Tiptap");
  });

  it("returns empty for text with no dictionary matches", () => {
    const result = extractEntities("Hello world.", dictionary);
    expect(result).toHaveLength(0);
  });

  it("finds multi-word entities", () => {
    const result = extractEntities("The editor engine is fast.", dictionary);
    expect(result).toContain("editor engine");
  });

  it("does not duplicate matches", () => {
    const result = extractEntities(
      "ProseMirror and ProseMirror again.",
      dictionary,
    );
    const proseMirrorCount = result.filter((e) => e === "ProseMirror").length;
    expect(proseMirrorCount).toBe(1);
  });

  it("finds multiple different entities", () => {
    const result = extractEntities(
      "ProseMirror and Tiptap and Rust are great.",
      dictionary,
    );
    expect(result).toContain("ProseMirror");
    expect(result).toContain("Tiptap");
    expect(result).toContain("Rust");
  });

  it("handles empty text", () => {
    const result = extractEntities("", dictionary);
    expect(result).toHaveLength(0);
  });

  it("handles empty dictionary", () => {
    const result = extractEntities("ProseMirror is great.", new Set());
    expect(result).toHaveLength(0);
  });

  it("excludes entities inside wikilink with display text", () => {
    const result = extractEntities(
      "Uses [[ProseMirror|PM]] and Tiptap.",
      dictionary,
    );
    expect(result).not.toContain("ProseMirror");
    expect(result).toContain("Tiptap");
  });
});
