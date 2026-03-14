// Tests for §11.2.3 Block AI Utils — BlockHandle AI submenu helpers
import { describe, expect, it } from "vitest";

import {
  getBlockContentMode,
  getBlockTextContent,
} from "../../utils/block-ai-utils";

// Minimal PmNode-like mocks
interface MockCell {
  textContent: string;
}
interface MockNode {
  attrs: Record<string, unknown>;
  forEach?: (
    cb: (child: {
      forEach: (cellCb: (cell: MockCell) => void) => void;
      textContent: string;
    }) => void,
  ) => void;
  textContent: string;
  type: { name: string };
}
interface MockRow {
  children?: MockCell[];
  textContent: string;
}

function mockNode(
  typeName: string,
  textContent: string,
  attrs: Record<string, unknown> = {},
  children?: MockRow[],
): MockNode {
  const node: MockNode = {
    type: { name: typeName },
    textContent,
    attrs,
  };
  // Add forEach for table-like nodes
  if (children) {
    node.forEach = (cb) => {
      for (const child of children) {
        const row = {
          textContent: child.textContent,
          forEach: (cellCb: (cell: MockCell) => void) => {
            if (child.children) {
              for (const cell of child.children) {
                cellCb({ textContent: cell.textContent });
              }
            }
          },
        };
        cb(row);
      }
    };
  }
  return node;
}

describe("getBlockContentMode", () => {
  it("returns 'code' for codeBlock", () => {
    expect(getBlockContentMode(mockNode("codeBlock", ""))).toBe("code");
  });

  it("returns 'math' for mathBlock", () => {
    expect(getBlockContentMode(mockNode("mathBlock", ""))).toBe("math");
  });

  it("returns 'math' for mathInline", () => {
    expect(getBlockContentMode(mockNode("mathInline", ""))).toBe("math");
  });

  it("returns 'table' for table", () => {
    expect(getBlockContentMode(mockNode("table", ""))).toBe("table");
  });

  it("returns 'structure' for heading", () => {
    expect(getBlockContentMode(mockNode("heading", ""))).toBe("structure");
  });

  it("returns 'text' for paragraph", () => {
    expect(getBlockContentMode(mockNode("paragraph", ""))).toBe("text");
  });

  it("returns 'text' for blockquote", () => {
    expect(getBlockContentMode(mockNode("blockquote", ""))).toBe("text");
  });

  it("returns 'text' for callout", () => {
    expect(getBlockContentMode(mockNode("callout", ""))).toBe("text");
  });

  it("returns 'text' for bulletList", () => {
    expect(getBlockContentMode(mockNode("bulletList", ""))).toBe("text");
  });

  it("returns 'text' for unknown types", () => {
    expect(getBlockContentMode(mockNode("someCustomBlock", ""))).toBe("text");
  });
});

describe("getBlockTextContent", () => {
  it("extracts code block content with language fence", () => {
    const node = mockNode("codeBlock", "const x = 1;", {
      language: "javascript",
    });
    expect(getBlockTextContent(node)).toBe("```javascript\nconst x = 1;\n```");
  });

  it("extracts code block content without language", () => {
    const node = mockNode("codeBlock", "echo hello", { language: "" });
    expect(getBlockTextContent(node)).toBe("echo hello");
  });

  it("extracts math block LaTeX content", () => {
    const node = mockNode("mathBlock", "E = mc^2");
    expect(getBlockTextContent(node)).toBe("E = mc^2");
  });

  it("serializes table node to markdown", () => {
    const node = mockNode("table", "", {}, [
      {
        textContent: "NameAge",
        children: [{ textContent: "Name" }, { textContent: "Age" }],
      },
      {
        textContent: "Alice30",
        children: [{ textContent: "Alice" }, { textContent: "30" }],
      },
      {
        textContent: "Bob25",
        children: [{ textContent: "Bob" }, { textContent: "25" }],
      },
    ]);
    const result = getBlockTextContent(node);
    expect(result).toContain("| Name | Age |");
    expect(result).toContain("| --- | --- |");
    expect(result).toContain("| Alice | 30 |");
    expect(result).toContain("| Bob | 25 |");
  });

  it("returns empty string for empty table", () => {
    const node = mockNode("table", "", {}, []);
    expect(getBlockTextContent(node)).toBe("");
  });

  it("extracts paragraph text content", () => {
    const node = mockNode("paragraph", "Hello world");
    expect(getBlockTextContent(node)).toBe("Hello world");
  });

  it("returns empty string for empty paragraph", () => {
    const node = mockNode("paragraph", "");
    expect(getBlockTextContent(node)).toBe("");
  });

  it("extracts heading text content", () => {
    const node = mockNode("heading", "My Title");
    expect(getBlockTextContent(node)).toBe("My Title");
  });

  it("extracts blockquote text content", () => {
    const node = mockNode("blockquote", "A wise quote");
    expect(getBlockTextContent(node)).toBe("A wise quote");
  });
});
