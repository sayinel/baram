// §50 Mermaid diagram utilities — copy, templates, type detection

/** Diagram type templates for Phase 2 supported types */
export const MERMAID_TEMPLATES: Record<
  string,
  { label: string; code: string }
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

/** Detect diagram type from mermaid source code */
export function detectMermaidType(code: string): string | null {
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

/** Copy mermaid source code to clipboard */
export async function copyMermaidSource(code: string): Promise<void> {
  await navigator.clipboard.writeText(code);
}

/** Copy rendered SVG markup to clipboard as text */
export async function copyMermaidSvg(svgHtml: string): Promise<void> {
  await navigator.clipboard.writeText(svgHtml);
}

/** Copy rendered SVG as PNG to clipboard */
export async function copyMermaidPng(svgHtml: string): Promise<void> {
  // Parse SVG to extract dimensions
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svgHtml, "image/svg+xml");
  const svgEl = svgDoc.querySelector("svg");
  if (!svgEl) throw new Error("No SVG element found");

  // Get dimensions from SVG attributes or viewBox
  const viewBox = svgEl.getAttribute("viewBox");
  let width = parseFloat(svgEl.getAttribute("width") || "0");
  let height = parseFloat(svgEl.getAttribute("height") || "0");
  if ((!width || !height) && viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    if (parts.length === 4) {
      width = parts[2];
      height = parts[3];
    }
  }
  if (!width) width = 800;
  if (!height) height = 600;

  const dpr = window.devicePixelRatio || 1;
  const canvasW = Math.ceil(width * dpr);
  const canvasH = Math.ceil(height * dpr);

  // Ensure SVG has explicit dimensions for rendering
  svgEl.setAttribute("width", String(width));
  svgEl.setAttribute("height", String(height));
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(svgEl);

  const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  try {
    const img = new Image();
    img.width = canvasW;
    img.height = canvasH;

    await new Promise<void>((resolve, reject) => {
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = canvasW;
        canvas.height = canvasH;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Could not get canvas context"));
          return;
        }
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvasW, canvasH);
        ctx.drawImage(img, 0, 0, canvasW, canvasH);

        canvas.toBlob(async (pngBlob) => {
          if (!pngBlob) {
            reject(new Error("Could not create PNG blob"));
            return;
          }
          try {
            await navigator.clipboard.write([
              new ClipboardItem({ "image/png": pngBlob }),
            ]);
            resolve();
          } catch (err) {
            reject(err);
          }
        }, "image/png");
      };
      img.onerror = () => reject(new Error("SVG rendering failed"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
