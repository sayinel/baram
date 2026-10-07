// src/__tests__/unit/block-link.test.ts
import { describe, expect, it } from "vitest";

import { blockBasename, buildBlockLink } from "../../utils/toolbar/block-link";

describe("block-link", () => {
  it("derives basename without .md", () => {
    expect(blockBasename("notes/ai/prompt.md")).toBe("prompt");
    expect(blockBasename("readme.md")).toBe("readme");
    expect(blockBasename("Untitled")).toBe("Untitled");
  });

  it("builds both link forms", () => {
    expect(buildBlockLink("prompt", "abc123", "wikilink")).toBe(
      "[[prompt#^abc123]]",
    );
    expect(buildBlockLink("prompt", "abc123", "ref")).toBe(
      "((prompt#^abc123))",
    );
  });

  it("§390 writes a file name stored decomposed composed (D7)", () => {
    // What fails this: blockBasename keeping the stored spelling.
    const stored = "노트".normalize("NFD");
    expect(stored).not.toBe("노트");
    expect(blockBasename(`/v/${stored}.md`)).toBe("노트");
  });
});
