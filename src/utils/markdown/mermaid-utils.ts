// §50 Mermaid diagram utilities — copy, templates, type detection
import { copySvgAsPng } from "./svg-export";
import { copySvgSource, sanitizeSvg } from "./svg-utils";

/**
 * Sanitize a Mermaid-rendered SVG for safe `dangerouslySetInnerHTML`.
 *
 * Delegates to the canonical {@link sanitizeSvg} so the SVG sanitize policy lives
 * in one place. With `securityLevel: "antiscript"/"loose"`, Mermaid renders
 * flowchart/graph node labels as HTML (`<div>`/`<span>`, plus inline
 * `<br>`/`<b>`/`<i>`) inside `<foreignObject>`; `sanitizeSvg` registers
 * `foreignobject` as an HTML integration point so those labels survive the
 * namespace check (regressed when §5.5 switched securityLevel "strict" →
 * "antiscript", commit 51044cd), while `<script>`, event handlers, and
 * `javascript:` URLs stay forbidden.
 */
export function sanitizeMermaidSvg(svg: string): string {
  return sanitizeSvg(svg);
}

/** Diagram type templates for Phase 2 supported types */
export const MERMAID_TEMPLATES: Record<
  string,
  { code: string; label: string }
> = {
  flowchart: {
    label: "Flowchart",
    code: "flowchart LR\n  A[Start] --> B{Decision}\n  B -->|Yes| C[OK]\n  B -->|No| D[End]",
  },
  sequence: {
    label: "Sequence Diagram",
    code: "sequenceDiagram\n  Alice->>Bob: Hello Bob\n  Bob-->>Alice: Hi Alice",
  },
  class: {
    label: "Class Diagram",
    code: "classDiagram\n  class Animal {\n    +String name\n    +makeSound()\n  }\n  class Dog {\n    +fetch()\n  }\n  Animal <|-- Dog",
  },
  state: {
    label: "State Diagram",
    code: "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running : start\n  Running --> Idle : stop\n  Running --> [*] : finish",
  },
  er: {
    label: "ER Diagram",
    code: "erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE_ITEM : contains\n  CUSTOMER {\n    string name\n    string email\n  }",
  },
  gantt: {
    label: "Gantt Chart",
    code: "gantt\n  title Project Plan\n  dateFormat YYYY-MM-DD\n  section Phase 1\n    Task A :a1, 2024-01-01, 30d\n    Task B :after a1, 20d",
  },
  pie: {
    label: "Pie Chart",
    code: 'pie title Distribution\n  "Category A" : 40\n  "Category B" : 30\n  "Category C" : 20\n  "Category D" : 10',
  },
  mindmap: {
    label: "Mind Map",
    code: "mindmap\n  root((Topic))\n    Branch A\n      Leaf 1\n      Leaf 2\n    Branch B\n      Leaf 3",
  },
  timeline: {
    label: "Timeline",
    code: "timeline\n  title History\n  2024 : Event A\n  2025 : Event B\n  2026 : Event C",
  },
  journey: {
    label: "User Journey",
    code: "journey\n  title User Journey\n  section Sign Up\n    Visit page: 5: User\n    Fill form: 3: User\n    Submit: 5: User",
  },
  gitgraph: {
    label: "Git Graph",
    code: "gitGraph\n  commit\n  branch develop\n  commit\n  checkout main\n  merge develop\n  commit",
  },
};

/** Copy rendered SVG as PNG to clipboard (delegates to the shared SVG rasterizer). */
export async function copyMermaidPng(svgHtml: string): Promise<void> {
  await copySvgAsPng(svgHtml);
}

/** Copy mermaid source code to clipboard */
export async function copyMermaidSource(code: string): Promise<void> {
  await copySvgSource(code);
}

/** Copy rendered SVG markup to clipboard as text */
export async function copyMermaidSvg(svgHtml: string): Promise<void> {
  await copySvgSource(svgHtml);
}

/** Detect diagram type from mermaid source code */
export function detectMermaidType(code: string): null | string {
  const trimmed = code.trim();
  if (/^flowchart\b/i.test(trimmed) || /^graph\b/i.test(trimmed))
    return "flowchart";
  if (/^sequenceDiagram\b/i.test(trimmed)) return "sequence";
  if (/^classDiagram\b/i.test(trimmed)) return "class";
  if (/^stateDiagram/i.test(trimmed)) return "state";
  if (/^erDiagram\b/i.test(trimmed)) return "er";
  if (/^gantt\b/i.test(trimmed)) return "gantt";
  if (/^pie\b/i.test(trimmed)) return "pie";
  if (/^mindmap\b/i.test(trimmed)) return "mindmap";
  if (/^timeline\b/i.test(trimmed)) return "timeline";
  if (/^journey\b/i.test(trimmed)) return "journey";
  if (/^gitGraph\b/i.test(trimmed) || /^gitgraph\b/i.test(trimmed))
    return "gitgraph";
  return null;
}
