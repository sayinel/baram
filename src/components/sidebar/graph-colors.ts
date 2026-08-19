// §30 Graph View — resolve the graph colour tokens into values cytoscape can parse.
//
// ‼️ Cytoscape draws to a canvas and parses colours itself, with no CSS cascade involved:
// a `var()` string is rejected WHOLE — the CSS fallback written inside it never
// applies either — and the property keeps cytoscape's own built-in default. Every colour
// in graph-style.ts used to be such a string, so the graph rendered cytoscape's defaults
// instead of the design tokens: labels at rgb(0,0,0) (invisible on a dark theme), nodes
// and edges at rgb(153,153,153), and the three user-editable Graph colours in the theme
// editor had no effect at all. Tokens must therefore be resolved to literals here, in JS,
// before they ever reach the stylesheet.

/** Every colour the graph stylesheet needs, as a literal cytoscape can parse. */
export interface GraphColors {
  active: string;
  activeBorder: string;
  crossVault: string;
  edge: string;
  label: string;
  neighbor: string;
  node: string;
  orphan: string;
  pinned: string;
  tag: string;
}

/** The CSS custom property each colour is read from. */
const COLOR_VARS: Record<keyof GraphColors, string> = {
  active: "--color-graph-active",
  activeBorder: "--color-graph-active-border",
  crossVault: "--color-graph-cross-vault",
  edge: "--color-graph-edge",
  label: "--color-graph-label",
  neighbor: "--color-graph-neighbor",
  node: "--color-graph-node",
  orphan: "--color-graph-orphan",
  pinned: "--color-graph-pinned",
  tag: "--color-graph-tag",
};

/**
 * Values used when a token resolves to nothing, i.e. an environment with no stylesheet
 * such as jsdom.
 *
 * Deliberately the light palette in full (`tokens/semantic/color-light.json` is the
 * canonical set) rather than the mix of light and dark literals the old `var()` fallbacks
 * carried: an unstyled graph then falls back to one coherent theme — readable dark text
 * on the light default background — instead of a pale label that only worked on dark.
 */
const FALLBACK_COLORS: GraphColors = {
  active: "#3b82f6",
  activeBorder: "#60a5fa",
  crossVault: "#8b5cf6",
  edge: "#9ca3af",
  label: "#374151",
  neighbor: "#8b5cf6",
  node: "#6b7280",
  orphan: "#d1d5db",
  pinned: "#f59e0b",
  tag: "#10b981",
};

/**
 * Read the graph colour tokens off `root` as literal colours.
 *
 * `getPropertyValue` returns the COMPUTED value of a custom property, so a chain such as
 * `--color-graph-label → --color-gray-300 → #d1d5db` — which is how every graph token is
 * written — arrives already substituted, and a theme's inline overrides (the theme editor
 * writes those to the root element) win here exactly as they do for the rest of the UI.
 *
 * ‼️ A value that still contains `var(` is DISCARDED for the fallback rather than passed
 * along: substitution is the browser's job, and an environment that skips it exists —
 * jsdom returns the unsubstituted reference verbatim. Handing that to cytoscape reproduces
 * the original defect exactly, since cytoscape answers an unparseable colour with its own
 * default of black.
 */
export function resolveGraphColors(
  root: HTMLElement = document.documentElement,
): GraphColors {
  const computed = getComputedStyle(root);
  const resolved = { ...FALLBACK_COLORS };
  for (const key of Object.keys(FALLBACK_COLORS) as (keyof GraphColors)[]) {
    const value = computed.getPropertyValue(COLOR_VARS[key]).trim();
    if (value && !value.includes("var(")) resolved[key] = value;
  }
  return resolved;
}

/** Do two resolutions carry the same colours? Keeps a re-resolve from restyling for nothing. */
export function sameGraphColors(a: GraphColors, b: GraphColors): boolean {
  return (Object.keys(a) as (keyof GraphColors)[]).every(
    (key) => a[key] === b[key],
  );
}
