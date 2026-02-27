// §50 Mermaid Enhanced — utility function tests
import { describe, it, expect } from "vitest";
import { MERMAID_TEMPLATES, detectMermaidType } from "../../utils/mermaid-utils";

describe("Mermaid Templates", () => {
  it("has 7 Phase 2 diagram types (original)", () => {
    const keys = Object.keys(MERMAID_TEMPLATES);
    expect(keys).toContain("flowchart");
    expect(keys).toContain("sequence");
    expect(keys).toContain("class");
    expect(keys).toContain("state");
    expect(keys).toContain("er");
    expect(keys).toContain("gantt");
    expect(keys).toContain("pie");
  });

  it("has 11 templates (7 original + 4 new)", () => {
    expect(Object.keys(MERMAID_TEMPLATES)).toHaveLength(11);
  });

  it("each template has label and non-empty code", () => {
    for (const [key, value] of Object.entries(MERMAID_TEMPLATES)) {
      expect(value.label).toBeTruthy();
      expect(value.code.length).toBeGreaterThan(0);
      // Template code should start with a valid mermaid keyword
      expect(detectMermaidType(value.code)).toBe(key);
    }
  });

  it("mindmap template exists", () => {
    expect(MERMAID_TEMPLATES.mindmap).toBeDefined();
    expect(MERMAID_TEMPLATES.mindmap.label).toBe("Mind Map");
  });

  it("timeline template exists", () => {
    expect(MERMAID_TEMPLATES.timeline).toBeDefined();
  });

  it("journey template exists", () => {
    expect(MERMAID_TEMPLATES.journey).toBeDefined();
  });

  it("gitgraph template exists", () => {
    expect(MERMAID_TEMPLATES.gitgraph).toBeDefined();
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

  it("detects journey type", () => {
    expect(detectMermaidType("journey\n  title User Journey")).toBe("journey");
  });

  it("detects gitgraph type", () => {
    expect(detectMermaidType("gitGraph\n  commit")).toBe("gitgraph");
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
