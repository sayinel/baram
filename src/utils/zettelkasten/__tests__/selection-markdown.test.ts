// §95 Zettelkasten new-from-selection — block-separated selection text + title derivation
import { describe, expect, test } from "vitest";

import { firstNonEmptyLine, getSelectionMarkdown } from "../selection-markdown";

// Minimal mock editor factory (mirrors the pattern in utils/__tests__/ai-commands.test.ts)
function createMockEditor(opts: {
  from: number;
  textBetween?: (from: number, to: number, sep?: string) => string;
  to: number;
}) {
  return {
    state: {
      selection: { from: opts.from, to: opts.to },
      doc: {
        textBetween: opts.textBetween ?? (() => ""),
      },
    },
  } as never;
}

describe("getSelectionMarkdown", () => {
  test("returns empty string when there is no selection (collapsed cursor)", () => {
    const editor = createMockEditor({ from: 3, to: 3 });
    expect(getSelectionMarkdown(editor)).toBe("");
  });

  test("reads the selection using the block separator so paragraph breaks are preserved", () => {
    let capturedSeparator: string | undefined;
    const editor = createMockEditor({
      from: 0,
      to: 40,
      textBetween: (_from, _to, sep) => {
        capturedSeparator = sep;
        return "Paragraph one.\n\nParagraph two.";
      },
    });

    expect(getSelectionMarkdown(editor)).toBe(
      "Paragraph one.\n\nParagraph two.",
    );
    // The "\n\n" separator is what makes doc.textBetween emit a paragraph
    // break between blocks instead of concatenating them with no separator
    // (which is what the shared getSelectedText does).
    expect(capturedSeparator).toBe("\n\n");
  });
});

describe("firstNonEmptyLine", () => {
  test("returns the line itself for single-line text", () => {
    expect(firstNonEmptyLine("hello world")).toBe("hello world");
  });

  test("titles a multi-paragraph selection from the first paragraph's first line only", () => {
    const body = "Paragraph one line one\nline two\n\nParagraph two";
    expect(firstNonEmptyLine(body)).toBe("Paragraph one line one");
  });

  test("skips leading blank lines to find the first non-empty line", () => {
    expect(firstNonEmptyLine("\n\n  first real line\nsecond line")).toBe(
      "first real line",
    );
  });

  test("returns empty string for all-blank input", () => {
    expect(firstNonEmptyLine("   \n  \n")).toBe("");
  });
});
