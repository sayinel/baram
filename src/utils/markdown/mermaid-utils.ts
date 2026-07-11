// §50 Mermaid diagram utilities — copy, templates, type detection
import { copySvgAsPng, downloadSvgAsPng } from "./svg-export";
import { copySvgSource, sanitizeSvg } from "./svg-utils";

/**
 * Give a Mermaid-rendered SVG an intrinsic pixel size so the `.media-resize-frame`
 * can size it freely (§5.5 resize).
 *
 * Mermaid's `useMaxWidth: true` default emits the root as
 * `<svg width="100%" style="max-width: <natural>px" viewBox="minX minY W H">`.
 * That inline `max-width` is a hard ceiling — the diagram can never render wider
 * than its natural width — and the `width="100%"` collapses to nothing inside the
 * shrink-to-fit (inline-block) frame, so an unsized diagram renders tiny and a
 * frame dragged past ~natural width stops growing and left-aligns.
 *
 * Rewrite the root to a plain, intrinsically-sized SVG (explicit `width`/`height`
 * in px from the viewBox; no `width="100%"`, no inline `max-width`) so it behaves
 * exactly like an image or authored SVG block: the shared frame CSS caps it to
 * the container when unsized (centered at natural size) and stretches it to any
 * percent when sized (`.media-resize-frame.is-sized … svg { width: 100% }`),
 * preserving aspect ratio via `height: auto`. Only the root opening tag is
 * touched — the diagram body (incl. `<foreignObject>` labels) is left untouched.
 * A viewBox-less SVG is returned unchanged (no intrinsic size to derive).
 */
export function normalizeMermaidSvgSize(svg: string): string {
  return svg.replace(/<svg\b([^>]*)>/i, (full, attrs: string) => {
    const vb = /\bviewBox\s*=\s*("[^"]*"|'[^']*')/i.exec(attrs);
    if (!vb) return full;
    const nums = vb[1]
      .slice(1, -1)
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (nums.length !== 4 || !(nums[2] > 0) || !(nums[3] > 0)) return full;
    const [, , width, height] = nums;
    let a = attrs;
    // Drop responsive width/height attributes (e.g. width="100%").
    a = a.replace(/\s(?:width|height)\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/gi, "");
    // Drop width/height/max-width declarations from the inline style (keeps the
    // rest, e.g. background); remove the attribute entirely if nothing is left.
    a = a.replace(/\sstyle\s*=\s*("[^"]*"|'[^']*')/i, (_m, quoted: string) => {
      const cleaned = quoted
        .slice(1, -1)
        .split(";")
        .map((d) => d.trim())
        .filter((d) => d && !/^(?:max-width|width|height)\s*:/i.test(d))
        .join("; ");
      return cleaned ? ` style="${cleaned}"` : "";
    });
    return `<svg${a} width="${width}" height="${height}">`;
  });
}

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
export async function renderMermaidRasterSvg(code: string): Promise<string> {
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
