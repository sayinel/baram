// §50 Mermaid diagram utilities — copy, templates, type detection
import { onSolidForeground } from "../color-contrast";
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

/** Rasterize Mermaid source to PNG and copy to the OS clipboard (SVG labels).
 *  Rejects when the source does not render or the clipboard refuses — the
 *  caller reports it (runBlockAction), like the svg helpers. */
export async function copyMermaidPng(code: string): Promise<void> {
  await copySvgAsPng(await renderMermaidRasterSvg(code));
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
 * Returns true if a file was written, false if the user cancelled; rejects on
 * error — the same contract as downloadSvgAsPng, so a caller can tell a
 * cancel from a failure and report only the latter.
 */
export async function downloadMermaidPng(
  code: string,
  defaultName = "diagram.png",
): Promise<boolean> {
  return downloadSvgAsPng(await renderMermaidRasterSvg(code), defaultName);
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
 * Mermaid's theme, and the palette fed to it — one fixed set, for every render
 * path (NodeView · PNG copy · PNG download · Pandoc assets).
 *
 * ‼️ Deliberately NOT a function of the app theme. Mermaid bakes its colours
 * into the SVG it returns, as an inline `<style>` block, so nothing downstream
 * can restyle them — a theme-dependent choice here decides how the diagram
 * looks in a PDF, a DOCX and a copied PNG, destinations that have no theme of
 * their own. A dark-theme user was getting near-black nodes and light-grey
 * labels printed onto white paper (measured, mermaid 11.16.1: theme "dark"
 * gives #ccc text on #1f2020, "default" gives #333 on #ECECFF).
 *
 * Following the theme was also never coherent, which is why the answer is to
 * stop rather than to do it properly:
 *   - The NodeView's render effect does not depend on the theme, so switching
 *     theme re-rendered nothing. One document could hold a light diagram and a
 *     dark one at once, depending on when each last rendered.
 *   - `activeThemeId === "system"` REMOVES `data-theme`
 *     (hooks/use-settings-effects.ts), so system-dark rendered LIGHT while
 *     explicit-dark rendered dark — two dark editors, two palettes.
 *
 * A diagram is content. It should not change colour because the chrome did.
 */
export const MERMAID_THEME = "base";

// Baram's LIGHT semantic tokens, resolved to literals. Literals rather than
// `var()` because these values are read by JavaScript and handed to a library
// that knows nothing about our stylesheet — and because reading them from the
// live document at render time is exactly the theme-following this removes.
// `mermaid-theme.test.ts` re-resolves each one from src/styles/generated/ and
// fails if a token moves, so the copies cannot drift silently.
const BG_SUBTLE = "#f8f9fa"; // --color-bg-subtle
const BG_ELEVATED = "#f0f0f3"; // --color-bg-elevated
const BORDER = "#e5e7eb"; // --color-border-default
const ACCENT = "#3b82f6"; // --color-accent-default
const TEXT = "#1a1a1a"; // --color-text-primary
const TEXT_2 = "#6b7280"; // --color-text-secondary
const SURFACE = "#ffffff"; // --color-bg-default

/**
 * Mermaid's own `default` pie and git colours, converted from the `hsl()` it
 * reports to the hex our contrast helpers can read. Categorical: see the note
 * at their use site for why these are pinned rather than brand-derived.
 */
const PIE_SERIES = [
  "#ececff",
  "#ffffde",
  "#b5ff20",
  "#b9b9ff",
  "#ffff45",
  "#d7ff86",
  "#ff86ff",
  "#20ffff",
  "#ff2020",
  "#ff20ff",
  "#20ff8f",
  "#ff5353",
];

const GIT_SERIES = [
  "#0000ec",
  "#dede00",
  "#9dec00",
  "#0076ec",
  "#00ecec",
  "#00ec76",
  "#ec00ec",
  "#ec0000",
];

/**
 * The palette. Mermaid's `base` theme derives everything it is not given from
 * these, so the set below is "everything that decides a colour a reader sees".
 *
 * ‼️ One fixed palette has to be legible on TWO backgrounds — the white page an
 * export always is, and whatever the editor is wearing. No single colour can do
 * that for text: 4.5:1 against #fff needs luminance ≤ 0.10, 4.5:1 against the
 * dark theme's #1a1a2e needs ≥ 0.25. The best any single value achieves is
 * 4.0:1 on both. So the design puts text on an OPAQUE fill wherever mermaid
 * allows one — node fills, note fills, `edgeLabelBackground` — and reserves the
 * balanced mid-tone (`TEXT_2`, measured 4.83:1 on white and 3.53:1 on the dark
 * theme) for lines and for the few labels that have no fill behind them.
 *
 * ‼️ `background: transparent` and `clusterBkg: transparent` are load-bearing,
 * not tidiness. An opaque surround paints a white slab in a dark editor, which
 * is the specific thing that read as "awkward" when the palette was mermaid's
 * own light theme.
 */
export const MERMAID_THEME_VARIABLES: Record<string, string> = {
  background: "transparent",
  fontFamily: "Pretendard, Inter, -apple-system, system-ui, sans-serif",
  fontSize: "14px",

  // Core — everything mermaid does not name explicitly derives from these.
  primaryColor: BG_SUBTLE,
  primaryBorderColor: ACCENT,
  primaryTextColor: TEXT,
  secondaryColor: BG_ELEVATED,
  secondaryBorderColor: BORDER,
  secondaryTextColor: TEXT,
  tertiaryColor: SURFACE,
  tertiaryBorderColor: BORDER,
  tertiaryTextColor: TEXT,
  lineColor: TEXT_2,
  textColor: TEXT_2,
  titleColor: TEXT_2,

  // Flowchart
  mainBkg: BG_SUBTLE,
  nodeBorder: ACCENT,
  nodeTextColor: TEXT,
  edgeLabelBackground: BG_SUBTLE,
  clusterBkg: "transparent",
  clusterBorder: BORDER,

  // Notes (mermaid's own default here is a saturated yellow)
  noteBkgColor: BG_ELEVATED,
  noteTextColor: TEXT,
  noteBorderColor: BORDER,

  // Sequence
  actorBkg: BG_SUBTLE,
  actorBorder: ACCENT,
  actorTextColor: TEXT,
  actorLineColor: BORDER,
  signalColor: TEXT_2,
  signalTextColor: TEXT_2,
  labelBoxBkgColor: BG_SUBTLE,
  labelBoxBorderColor: BORDER,
  labelTextColor: TEXT,
  loopTextColor: TEXT_2,
  activationBkgColor: BG_ELEVATED,
  activationBorderColor: BORDER,
  sequenceNumberColor: SURFACE,
  altBackground: BG_ELEVATED,

  // Class / state
  classText: TEXT,
  labelColor: TEXT,

  // Git graph label chips (mermaid's defaults are cream/lavender)
  commitLabelColor: TEXT,
  commitLabelBackground: BG_ELEVATED,
  tagLabelColor: TEXT,
  tagLabelBackground: BG_SUBTLE,
  tagLabelBorder: BORDER,

  // Pie chrome. The section label sits ON a slice, so it stays dark; the title,
  // the legend and the strokes sit on the page, so they take the mid-tone that
  // works on both backgrounds. (Mermaid's own default for the strokes is
  // `black`, which is invisible in a dark editor.)
  pieSectionTextColor: TEXT,
  pieTitleTextColor: TEXT_2,
  pieLegendTextColor: TEXT_2,
  pieStrokeColor: TEXT_2,
  pieOuterStrokeColor: TEXT_2,

  // ── Qualitative series ────────────────────────────────────────────────
  //
  // ‼️ Pinned to mermaid's own `default` values rather than derived from the
  // brand palette, and that is the whole point: these are CATEGORICAL. Their
  // job is to be told apart from each other, which a set of near-neutral brand
  // tints cannot do. Measured: with the brand primaries above and no pins,
  // mermaid derives every one of them at 16.7% saturation — twelve pie slices
  // that are all the same pale grey, i.e. a chart that no longer conveys
  // anything. Pinning also makes them theme-independent, which is what was
  // asked for; the values are exactly what a light-theme user already saw.
  //
  // ‼️ Written as hex, though mermaid reports them as `hsl()`. The conversion is
  // exact, and hex is what `color-contrast.ts` can parse — which is what lets
  // the branch labels below be DERIVED and the tests check them for real. Left
  // as `hsl()` they would silently fall back to white and the check would pass
  // on a colour nobody had verified.
  ...Object.fromEntries(PIE_SERIES.map((c, i) => [`pie${i + 1}`, c])),
  ...Object.fromEntries(GIT_SERIES.map((c, i) => [`git${i}`, c])),

  // Branch label text, paired to each chip instead of left at mermaid's single
  // white. Six of the eight chips fail AA against white — the yellow one at
  // 1.44:1 — and `onSolidForeground` is the project's existing answer to
  // exactly this question (utils/color-contrast.ts), with a guarantee verified
  // over the whole sRGB cube: whichever of white and black it returns clears
  // AA. Derived rather than pinned so it cannot drift from the chips above.
  ...Object.fromEntries(
    GIT_SERIES.map((c, i) => [`gitBranchLabel${i}`, onSolidForeground(c)]),
  ),
};

/** The tokens `MERMAID_THEME_VARIABLES` copies, for the guard test to re-resolve. */
export const MERMAID_PALETTE_TOKENS: Record<string, string> = {
  "--color-accent-default": ACCENT,
  "--color-bg-default": SURFACE,
  "--color-bg-elevated": BG_ELEVATED,
  "--color-bg-subtle": BG_SUBTLE,
  "--color-border-default": BORDER,
  "--color-text-primary": TEXT,
  "--color-text-secondary": TEXT_2,
};

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
    theme: MERMAID_THEME,
    themeVariables: MERMAID_THEME_VARIABLES,
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
