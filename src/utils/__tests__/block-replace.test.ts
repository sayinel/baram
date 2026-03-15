// §30d block-replace utility tests
import { describe, expect, test } from "vitest";

import { replaceBlockInContent } from "../editor/block-replace";

describe("replaceBlockInContent", () => {
  test("replaces paragraph text", () => {
    const content = "Some intro\n\nHello world ^abc123\n\nAfter";
    const result = replaceBlockInContent(content, "abc123", "Updated text");
    expect(result).toBe("Some intro\n\nUpdated text ^abc123\n\nAfter");
  });

  test("preserves heading prefix", () => {
    const content = "# My Heading ^h1\n\nBody text";
    const result = replaceBlockInContent(content, "h1", "New Heading");
    expect(result).toBe("# New Heading ^h1\n\nBody text");
  });

  test("preserves h3 prefix", () => {
    const content = "### Sub Section ^s3\n\nContent";
    const result = replaceBlockInContent(content, "s3", "Updated Section");
    expect(result).toBe("### Updated Section ^s3\n\nContent");
  });

  test("returns null if blockId not found", () => {
    const content = "No blocks here\n\nJust text";
    const result = replaceBlockInContent(content, "missing", "new");
    expect(result).toBeNull();
  });

  test("replaces with empty text", () => {
    const content = "Text ^bid\n\nMore";
    const result = replaceBlockInContent(content, "bid", "");
    expect(result).toBe(" ^bid\n\nMore");
  });

  test("replaces only the correct block among multiple", () => {
    const content = "First block ^a1\n\nSecond block ^b2\n\nThird block ^c3";
    const result = replaceBlockInContent(content, "b2", "Changed");
    expect(result).toBe("First block ^a1\n\nChanged ^b2\n\nThird block ^c3");
  });

  test("handles special characters in text", () => {
    const content = "Normal text ^sp1\n\nOther";
    const result = replaceBlockInContent(
      content,
      "sp1",
      "Text with $pecial & <chars>",
    );
    expect(result).toBe("Text with $pecial & <chars> ^sp1\n\nOther");
  });

  test("handles blockId at first line", () => {
    const content = "First line ^first\nSecond line";
    const result = replaceBlockInContent(content, "first", "Replaced");
    expect(result).toBe("Replaced ^first\nSecond line");
  });

  test("handles blockId at last line", () => {
    const content = "First line\nLast line ^last";
    const result = replaceBlockInContent(content, "last", "New last");
    expect(result).toBe("First line\nNew last ^last");
  });
});
