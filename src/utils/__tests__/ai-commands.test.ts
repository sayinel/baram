// §6.2 Shared AI command utilities — unit tests
import { describe, expect, test } from "vitest";

import { getSelectedText, getSelectionOrParagraph } from "../ai-commands";

// Minimal mock editor factory
function createMockEditor(opts: {
  from: number;
  parentTextContent?: string;
  textBetween?: string;
  to: number;
}) {
  return {
    state: {
      selection: {
        from: opts.from,
        to: opts.to,
        $from: {
          parent: {
            textContent: opts.parentTextContent ?? "",
          },
        },
      },
      doc: {
        textBetween: () => opts.textBetween ?? "",
        textContent: "",
      },
    },
  } as never;
}

describe("getSelectedText", () => {
  test("returns selected text when there is a selection", () => {
    const editor = createMockEditor({ from: 0, to: 5, textBetween: "hello" });
    expect(getSelectedText(editor)).toBe("hello");
  });

  test("returns empty string when no selection (collapsed cursor)", () => {
    const editor = createMockEditor({ from: 3, to: 3 });
    expect(getSelectedText(editor)).toBe("");
  });
});

describe("getSelectionOrParagraph", () => {
  test("returns selected text when there is a selection", () => {
    const editor = createMockEditor({ from: 0, to: 5, textBetween: "hello" });
    expect(getSelectionOrParagraph(editor)).toBe("hello");
  });

  test("falls back to paragraph text when no selection", () => {
    const editor = createMockEditor({
      from: 3,
      to: 3,
      parentTextContent: "paragraph content",
    });
    expect(getSelectionOrParagraph(editor)).toBe("paragraph content");
  });

  test("returns empty string when no selection and empty paragraph", () => {
    const editor = createMockEditor({ from: 0, to: 0, parentTextContent: "" });
    expect(getSelectionOrParagraph(editor)).toBe("");
  });
});
