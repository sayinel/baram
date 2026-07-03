import { describe, expect, it } from "vitest";

import {
  type MarkdownSegment,
  segmentMarkdownByMermaid,
} from "../mermaid-fence";

function reconstruct(segments: MarkdownSegment[]): string {
  const lines: string[] = [];
  for (const seg of segments) {
    if (seg.kind === "text") {
      lines.push(...seg.lines);
    } else {
      lines.push(seg.open, ...seg.body);
      if (seg.close !== null) lines.push(seg.close);
    }
  }
  return lines.join("\n");
}

describe("segmentMarkdownByMermaid", () => {
  it("isolates a top-level mermaid block into its own segment", () => {
    const md = [
      "# Title",
      "```mermaid",
      "graph TD",
      "  A --> B",
      "```",
      "text",
    ].join("\n");
    const segments = segmentMarkdownByMermaid(md);

    expect(segments).toEqual([
      { kind: "text", lines: ["# Title"] },
      {
        body: ["graph TD", "  A --> B"],
        close: "```",
        kind: "mermaid",
        open: "```mermaid",
      },
      { kind: "text", lines: ["text"] },
    ]);
  });

  it("does not treat a ```mermaid fence nested inside a ````markdown wrapper as a mermaid block", () => {
    const md = ["````markdown", "```mermaid", "graph TD", "```", "````"].join(
      "\n",
    );
    const segments = segmentMarkdownByMermaid(md);

    expect(segments).toEqual([
      {
        kind: "text",
        lines: ["````markdown", "```mermaid", "graph TD", "```", "````"],
      },
    ]);
  });

  it("treats a non-mermaid fence (e.g. ```js) as plain text", () => {
    const md = ["para", "```js", "code", "```"].join("\n");
    const segments = segmentMarkdownByMermaid(md);

    expect(segments).toEqual([
      { kind: "text", lines: ["para", "```js", "code", "```"] },
    ]);
  });

  it("handles an unterminated ```mermaid fence at EOF with close === null", () => {
    const md = ["```mermaid", "graph TD", "  A --> B"].join("\n");
    const segments = segmentMarkdownByMermaid(md);

    expect(segments).toEqual([
      {
        body: ["graph TD", "  A --> B"],
        close: null,
        kind: "mermaid",
        open: "```mermaid",
      },
    ]);
  });

  it("round-trips arbitrary input by reconstructing every segment's lines", () => {
    const inputs = [
      ["# Title", "```mermaid", "graph TD", "  A --> B", "```", "text"].join(
        "\n",
      ),
      ["````markdown", "```mermaid", "graph TD", "```", "````"].join("\n"),
      ["para", "```js", "code", "```"].join("\n"),
      ["```mermaid", "graph TD", "  A --> B"].join("\n"),
      [
        "```mermaid",
        "graph TD",
        "```",
        "middle",
        "```mermaid",
        "sequenceDiagram",
        "```",
      ].join("\n"),
    ];

    for (const md of inputs) {
      const segments = segmentMarkdownByMermaid(md);
      expect(reconstruct(segments)).toBe(md);
    }
  });
});
