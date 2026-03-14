// §11.3.1 WritingModeDetector — 7 writing modes with priority chain detection
import { describe, expect, it } from "vitest";

import { detectWritingMode } from "../writing-mode-detector";

describe("detectWritingMode", () => {
  it("returns technical for docs/ path", () => {
    const result = detectWritingMode({
      filePath: "docs/api.md",
      frontmatter: {},
      nodeTypes: {},
    });
    expect(result.mode).toBe("technical");
  });

  it("returns skills for skills/ path", () => {
    const result = detectWritingMode({
      filePath: "skills/summarizer.md",
      frontmatter: {},
      nodeTypes: {},
    });
    expect(result.mode).toBe("skills");
  });

  it("returns journal for journal/ path", () => {
    const result = detectWritingMode({
      filePath: "journal/2026-03-14.md",
      frontmatter: {},
      nodeTypes: {},
    });
    expect(result.mode).toBe("journal");
  });

  it("returns academic when mathBlock count >= 2", () => {
    const result = detectWritingMode({
      filePath: "paper.md",
      frontmatter: {},
      nodeTypes: { mathBlock: 3, paragraph: 10 },
    });
    expect(result.mode).toBe("academic");
  });

  it("returns academic for frontmatter type: paper", () => {
    const result = detectWritingMode({
      filePath: "thesis.md",
      frontmatter: { type: "paper" },
      nodeTypes: { paragraph: 5 },
    });
    expect(result.mode).toBe("academic");
  });

  it("returns creative for short paragraphs with high inline marks", () => {
    const result = detectWritingMode({
      avgParagraphLength: 30,
      filePath: "essay.md",
      frontmatter: {},
      inlineMarkRatio: 0.15,
      nodeTypes: { paragraph: 20 },
    });
    expect(result.mode).toBe("creative");
  });

  it("returns notes for many list items and wikilinks", () => {
    const result = detectWritingMode({
      filePath: "brainstorm.md",
      frontmatter: {},
      nodeTypes: { listItem: 15, paragraph: 5, wikiLink: 3 },
    });
    expect(result.mode).toBe("notes");
  });

  it("returns general as fallback", () => {
    const result = detectWritingMode({
      filePath: "readme.md",
      frontmatter: {},
      nodeTypes: { paragraph: 3 },
    });
    expect(result.mode).toBe("general");
  });

  it("includes confidence score", () => {
    const result = detectWritingMode({
      filePath: "docs/api.md",
      frontmatter: {},
      nodeTypes: {},
    });
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});
