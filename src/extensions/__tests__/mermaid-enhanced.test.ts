// §50 Mermaid Enhanced — utility function tests
import { describe, it, expect } from "vitest";
import { MERMAID_TEMPLATES, detectMermaidType } from "../../utils/mermaid-utils";

describe("Mermaid Templates", () => {
  it("has 7 Phase 2 diagram types", () => {
    const keys = Object.keys(MERMAID_TEMPLATES);
    expect(keys).toEqual([
      "flowchart",
      "sequence",
      "class",
      "state",
      "er",
      "gantt",
      "pie",
    ]);
  });

  it("each template has label and non-empty code", () => {
    for (const [key, value] of Object.entries(MERMAID_TEMPLATES)) {
      expect(value.label).toBeTruthy();
      expect(value.code.length).toBeGreaterThan(0);
      // Template code should start with a valid mermaid keyword
      expect(detectMermaidType(value.code)).toBe(key);
    }
  });
});

describe("detectMermaidType", () => {
  it("detects flowchart", () => {
    expect(detectMermaidType("flowchart LR\n  A --> B")).toBe("flowchart");
  });

  it("detects graph (alias for flowchart)", () => {
    expect(detectMermaidType("graph TD\n  A --> B")).toBe("flowchart");
  });

  it("detects sequenceDiagram", () => {
    expect(detectMermaidType("sequenceDiagram\n  A->>B: Hello")).toBe(
      "sequence",
    );
  });

  it("detects classDiagram", () => {
    expect(detectMermaidType("classDiagram\n  class Foo")).toBe("class");
  });

  it("detects stateDiagram-v2", () => {
    expect(detectMermaidType("stateDiagram-v2\n  [*] --> S1")).toBe("state");
  });

  it("detects erDiagram", () => {
    expect(detectMermaidType("erDiagram\n  A ||--o{ B : has")).toBe("er");
  });

  it("detects gantt", () => {
    expect(detectMermaidType("gantt\n  title Plan")).toBe("gantt");
  });

  it("detects pie", () => {
    expect(detectMermaidType('pie title Stats\n  "A" : 50')).toBe("pie");
  });

  it("detects mindmap", () => {
    expect(detectMermaidType("mindmap\n  root")).toBe("mindmap");
  });

  it("detects timeline", () => {
    expect(detectMermaidType("timeline\n  title My Day")).toBe("timeline");
  });

  it("returns null for unknown", () => {
    expect(detectMermaidType("something else")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(detectMermaidType("")).toBeNull();
  });

  it("handles leading whitespace", () => {
    expect(detectMermaidType("  flowchart LR\n  A --> B")).toBe("flowchart");
  });
});
