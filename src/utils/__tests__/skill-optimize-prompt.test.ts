// §72c Skill Optimize Prompt — unit tests
import { describe, expect, it } from "vitest";

import {
  buildOptimizePrompt,
  parseOptimizeResponse,
} from "../skill-optimize-prompt";

describe("buildOptimizePrompt", () => {
  it("includes skill content in the output", () => {
    const content = "---\nname: test-skill\n---\nDo something useful.";
    const result = buildOptimizePrompt(content);
    expect(result).toContain(content);
    expect(result).toContain("prompt engineering expert");
    expect(result).toContain("JSON array");
  });
});

describe("parseOptimizeResponse", () => {
  it("parses valid JSON array", () => {
    const raw = JSON.stringify([
      {
        category: "clarity",
        title: "Be specific",
        description: "Add more detail to the instructions",
        before: "Do stuff",
        after: "Do X, Y, and Z in order",
      },
      {
        category: "efficiency",
        title: "Remove redundancy",
        description: "The second paragraph repeats the first",
        before: null,
        after: null,
      },
    ]);
    const result = parseOptimizeResponse(raw);
    expect(result).toHaveLength(2);
    expect(result[0].category).toBe("clarity");
    expect(result[0].title).toBe("Be specific");
    expect(result[1].before).toBeNull();
  });

  it("extracts JSON from surrounding text", () => {
    const raw = `Here are my suggestions:
[
  {
    "category": "missing",
    "title": "Add output format",
    "description": "Specify expected output format",
    "before": null,
    "after": "Output as markdown."
  }
]
Hope this helps!`;
    const result = parseOptimizeResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("missing");
    expect(result[0].title).toBe("Add output format");
  });

  it("returns empty array for invalid input", () => {
    expect(parseOptimizeResponse("")).toEqual([]);
    expect(parseOptimizeResponse("no json here")).toEqual([]);
    expect(parseOptimizeResponse("{not an array}")).toEqual([]);
    expect(parseOptimizeResponse("null")).toEqual([]);
  });

  it("filters items missing required fields", () => {
    const raw = JSON.stringify([
      {
        category: "clarity",
        title: "Good suggestion",
        description: "This has all fields",
        before: null,
        after: null,
      },
      {
        category: "clarity",
        // missing title
        description: "Missing title field",
        before: null,
        after: null,
      },
      {
        category: "efficiency",
        title: "No description",
        // missing description
        before: null,
        after: null,
      },
      {
        // missing category
        title: "No category",
        description: "Missing category field",
        before: null,
        after: null,
      },
    ]);
    const result = parseOptimizeResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Good suggestion");
  });

  it("handles malformed JSON gracefully", () => {
    const result = parseOptimizeResponse("[{broken json}]");
    expect(result).toEqual([]);
  });
});
