// §30d Block Embed Bidirectional Editing tests
import { describe, test, expect } from "vitest";
import { replaceBlockInContent } from "../../utils/block-replace";
import { findBlockContent, findBlockLine } from "../../utils/block-nav";

describe("§30d Block Embed Edit — replaceBlockInContent integration", () => {
  const sampleDoc = [
    "# Introduction ^intro",
    "",
    "Some paragraph text ^p1",
    "",
    "## Section Two ^s2",
    "",
    "Another paragraph ^p2",
  ].join("\n");

  test("replace paragraph and verify with findBlockContent", () => {
    const replaced = replaceBlockInContent(
      sampleDoc,
      "p1",
      "Updated paragraph",
    );
    expect(replaced).not.toBeNull();
    const content = findBlockContent(replaced!, "p1");
    expect(content).toBe("Updated paragraph");
  });

  test("replace heading and verify prefix preserved", () => {
    const replaced = replaceBlockInContent(sampleDoc, "intro", "New Title");
    expect(replaced).not.toBeNull();
    // findBlockContent strips heading prefix
    const content = findBlockContent(replaced!, "intro");
    expect(content).toBe("New Title");
    // But the raw line should have the # prefix
    const line = findBlockLine(replaced!, "intro");
    expect(line).toBe(1);
    const lines = replaced!.split("\n");
    expect(lines[0]).toBe("# New Title ^intro");
  });

  test("replace h2 heading preserves ## prefix", () => {
    const replaced = replaceBlockInContent(sampleDoc, "s2", "Updated Section");
    expect(replaced).not.toBeNull();
    const lines = replaced!.split("\n");
    const lineNum = findBlockLine(replaced!, "s2");
    expect(lines[lineNum! - 1]).toBe("## Updated Section ^s2");
  });

  test("other blocks remain unchanged after replace", () => {
    const replaced = replaceBlockInContent(sampleDoc, "p1", "Changed");
    expect(replaced).not.toBeNull();
    expect(findBlockContent(replaced!, "intro")).toBe("Introduction");
    expect(findBlockContent(replaced!, "s2")).toBe("Section Two");
    expect(findBlockContent(replaced!, "p2")).toBe("Another paragraph");
  });

  test("empty text replacement preserves blockId suffix", () => {
    const replaced = replaceBlockInContent(sampleDoc, "p2", "");
    expect(replaced).not.toBeNull();
    const line = findBlockLine(replaced!, "p2");
    expect(line).not.toBeNull();
    const lines = replaced!.split("\n");
    expect(lines[line! - 1]).toBe(" ^p2");
  });

  test("nonexistent blockId returns null", () => {
    const result = replaceBlockInContent(sampleDoc, "nonexistent", "text");
    expect(result).toBeNull();
  });
});
