// §50 Mermaid diagram utilities — copy, templates, type detection
import { copySvgAsPng, downloadSvgAsPng } from "./svg-export";
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

/** Rasterize Mermaid source to PNG and copy to the OS clipboard (SVG labels). */
export async function copyMermaidPng(code: string): Promise<void> {
  try {
    await copySvgAsPng(await renderMermaidRasterSvg(code));
  } catch (err) {
    console.error("Mermaid: copy as PNG failed", err);
  }
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

/**
 * Rasterize Mermaid source to PNG and save it via the native dialog (SVG labels).
 * Returns true if a file was written, false on cancel or error.
 */
export async function downloadMermaidPng(
  code: string,
  defaultName = "diagram.png",
): Promise<boolean> {
  try {
    return await downloadSvgAsPng(
      await renderMermaidRasterSvg(code),
      defaultName,
    );
  } catch (err) {
    console.error("Mermaid: download PNG failed", err);
    return false;
  }
}

/**
 * Neutralize an explicit `htmlLabels: true` opt-in inside `%%{init}%%` directives
 * so PNG raster export renders SVG `<text>` labels instead of HTML in
 * `<foreignObject>`. WKWebView does not rasterize foreignObject HTML through the
 * `<img>`→canvas path, so the on-screen render (HTML labels) and the raster
 * render (SVG labels) diverge deliberately. Scoped to directive blocks so the
 * same text in a node label body is left untouched; diagrams without a directive
 * rely on the global `htmlLabels:false` in {@link renderMermaidRasterSvg}. A
 * per-diagram directive would otherwise override `mermaid.initialize`.
 */
export function forceSvgLabels(code: string): string {
  return code.replace(/%%\{[\s\S]*?\}%%/g, (block) =>
    block.replace(/(["']?htmlLabels["']?\s*:\s*)true\b/gi, "$1false"),
  );
}

/**
 * Render Mermaid source to an SVG string that uses SVG `<text>` labels (not HTML
 * `<foreignObject>`) so it survives PNG rasterization in WKWebView. `<br>` still
 * becomes multi-line text; inline `<b>`/`<i>` label formatting is not reproduced
 * in SVG-label mode. Shared by the copy-as-PNG and download-PNG paths.
 */
async function renderMermaidRasterSvg(code: string): Promise<string> {
  const mermaid = (await import("mermaid")).default;
  mermaid.initialize({
    startOnLoad: false,
    theme:
      document.documentElement.dataset.theme === "dark" ? "dark" : "default",
    securityLevel: "antiscript",
    // Global htmlLabels (flowchart.htmlLabels deprecated since v11.12.3) → SVG
    // text labels. forceSvgLabels strips any per-diagram directive that would
    // re-enable HTML labels and override this initialize() config.
    htmlLabels: false,
    flowchart: { htmlLabels: false },
  });
  const id = `mermaid-png-${crypto.randomUUID()}`;
  const { svg } = await mermaid.render(id, forceSvgLabels(code));
  return sanitizeMermaidSvg(svg);
}
