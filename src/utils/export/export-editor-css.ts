// §5.12 export — the exported stylesheet, derived from the editor's own CSS.
//
// Why this exists (user-reported export defects, 2026-08-23): export-html-styles.ts
// used to carry a HAND-COPIED subset of the editor's appearance — one `.callout`
// rule for all fourteen callout types, `list-style-type: disc` for a list system
// that draws its markers with `::before`, and nothing at all for `.toggle`,
// `.definition-list` or `.callout-header`. Every visual change to the editor
// since it was written silently failed to reach exports, and the drift only
// ever grew: a copy has no way to notice that its original moved.
//
// So the copy is gone. The editor's own stylesheets are read at build time and
// rescoped onto the export wrapper, which makes `src/styles/editor/*.css` the
// single source of truth for how a document LOOKS in every destination.
//
// Three transforms are applied, and each one is a claim about the difference
// between an editor and a printed page:
//
//   1. `.tiptap` → `article.baram-export`. The export wrapper is not the editor
//      root, so without this every `.tiptap`-scoped rule — which is nearly all
//      of them — matches nothing.
//   2. Interaction/performance declarations are dropped. `contain` and
//      `content-visibility` exist to make a long EDITABLE document cheap to
//      relayout; in a static page they clip overflowing markers and can leave
//      content unrendered at print time. `transition`/`cursor` describe things
//      a reader of a PDF cannot do.
//   3. Comments are stripped. lists.css is more prose than CSS by volume, and
//      none of it helps a reader of the exported file.
//
// The design tokens come along too, so the rules keep their `var()` references
// instead of being flattened to literals that would then drift on their own.

import blocksCSS from "../../styles/editor/blocks.css?raw";
import htmlBlockCSS from "../../styles/editor/html-block.css?raw";
import listsCSS from "../../styles/editor/lists.css?raw";
import mathCSS from "../../styles/editor/math.css?raw";
import mediaBlockCSS from "../../styles/editor/media-block.css?raw";
import mediaCSS from "../../styles/editor/media.css?raw";
import mermaidCSS from "../../styles/editor/mermaid.css?raw";
import svgBlockCSS from "../../styles/editor/svg-block.css?raw";
import tablesCSS from "../../styles/editor/tables.css?raw";
import taskCheckboxCSS from "../../styles/editor/task-checkbox.css?raw";
import videoCSS from "../../styles/editor/video.css?raw";
import primitivesCSS from "../../styles/generated/primitives.css?raw";
import semanticLightCSS from "../../styles/generated/semantic-light.css?raw";
import linksCSS from "../../styles/links.css?raw";

/** The selector the export wraps its content in. */
export const EXPORT_SCOPE = "article.baram-export";

/**
 * Declarations dropped on the way out.
 *
 * ‼️ `contain` and `content-visibility` are not cosmetic. `.tiptap > * { contain:
 * layout paint }` (editor/tables.css, §perf-large-file C3.1c) clips anything
 * that overflows a top-level block's padding box — which in this codebase is
 * every list marker, every fold arrow and the "paper" code block's language
 * tab. The editor exempts those cases one by one because it needs the
 * containment; an export needs none of it and can simply not have the problem.
 * `content-visibility: auto` is worse: content it decides is off-screen may not
 * be laid out at all when Chrome prints. `will-change` is here for the same
 * family of reasons — it forces compositing layers that can change what paints.
 *
 * ‼️ Kept SHORT on purpose. `cursor` and `transition` were on this list to save
 * bytes; both are simply inert in a printed page, and `cursor` is the one
 * property here that realistically carries a `url()`. The value pattern below
 * is `[^;{}]*`, which knows nothing about quotes, so a `cursor: url("a;b.png")`
 * would be cut at the semicolon INSIDE the string and orphan the rest of the
 * declaration. Dropping a property that costs nothing to keep is not worth
 * that, so the list holds only what would actually misrender.
 */
export const DROPPED_PROPERTIES = [
  "contain",
  "contain-intrinsic-width",
  "contain-intrinsic-height",
  "contain-intrinsic-size",
  "content-visibility",
  "will-change",
];

const COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const DROPPED_RE = new RegExp(
  String.raw`(^|[;{])\s*(?:${DROPPED_PROPERTIES.join("|")})\s*:[^;{}]*;?`,
  "gi",
);
const BLANK_LINES_RE = /\n{3,}/g;

/**
 * Remove every dropped declaration, repeating until the text stops changing.
 *
 * ‼️ One `/g` pass is NOT enough, and the case it misses is in this repo. The
 * pattern anchors on the `;` or `{` that precedes a declaration and CONSUMES
 * the `;` that ends it — so for two dropped declarations in a row, the first
 * match eats the separator the second one needs, and the second survives:
 *
 *     .tiptap table tr.baram-vscroll {   // editor/tables.css
 *       contain-intrinsic-height: 40px;
 *       content-visibility: auto;        // ← shipped, before this loop existed
 *     }
 *
 * `content-visibility: auto` is the worst possible survivor: content Chrome
 * decides is off-screen may not be laid out when it prints, so a long table
 * loses rows. Re-running to a fixpoint is a couple of extra passes over a
 * string built once per export, and it needs no regex feature (lookbehind)
 * that a webview might not have.
 */
function dropDeclarations(css: string): string {
  let out = css;
  for (;;) {
    const next = out.replace(DROPPED_RE, (_m, lead: string) => lead);
    if (next === out) return out;
    out = next;
  }
}

/** Editor stylesheets, in the cascade order src/styles/editor.css imports them.
 *
 * What is deliberately NOT here:
 *   - editor/base.css — the windowing spacers (`.tiptap::before`) and the empty
 *     document placeholder, whose `content` is a Korean instruction to start
 *     typing. Neither belongs in a document someone reads. The two rules an
 *     export DOES need from it are restated in `EXPORT_ONLY_CSS` below.
 *   - editor/code-blocks.css — the export replaces every code block with its own
 *     markup (export-html-code-block.ts), whose inline styles carry the palette.
 *   - editor/pdf*.css, editor/html-preview.css — viewer chrome for file types
 *     that are not part of a markdown document.
 */
const EDITOR_STYLESHEETS = [
  blocksCSS,
  listsCSS,
  // ‼️ Unscoped on purpose — the control is drawn in the agenda too, so its
  // rules carry no `.tiptap`. `rescopeEditorCSS` only rewrites that prefix, so
  // they pass through and keep painting the exported boxes.
  taskCheckboxCSS,
  mediaCSS,
  mathCSS,
  tablesCSS,
  mermaidCSS,
  mediaBlockCSS,
  videoCSS,
  svgBlockCSS,
  htmlBlockCSS,
  linksCSS,
];

/**
 * The two rules the export needs from editor/base.css, which is otherwise
 * excluded (see above).
 *
 * `position: relative` on list items is load-bearing, not decorative: every
 * list marker in lists.css is `position: absolute; right: 100%`, so without a
 * positioned ancestor on the `li` the markers all pile up against the page
 * instead of sitting in their own gutters.
 */
const EXPORT_ONLY_CSS = `
${EXPORT_SCOPE} li,
${EXPORT_SCOPE} h1,
${EXPORT_SCOPE} h2,
${EXPORT_SCOPE} h3,
${EXPORT_SCOPE} h4,
${EXPORT_SCOPE} h5,
${EXPORT_SCOPE} h6 { position: relative; }
`;

/** The editor's appearance, rescoped for the exported document. */
export function editorContentCSS(): string {
  return [...EDITOR_STYLESHEETS.map(rescopeEditorCSS), EXPORT_ONLY_CSS.trim()]
    .join("\n\n")
    .trim();
}

/**
 * Design tokens for the export.
 *
 * Light only, matching `exportAsPDF`'s `{ theme: "light" }`: a document printed
 * on paper, or read in a PDF viewer's own white frame, has no theme of its own
 * to follow. `@theme` is Tailwind 4's token-registration at-rule and means
 * nothing to a standalone page, so it becomes a plain `:root`.
 *
 * ‼️ Both files are needed, in this order. semantic-light.css is entirely
 * `var()` references into primitives.css — on its own every token in it
 * resolves to nothing, and a `var()` that resolves to nothing takes its whole
 * declaration with it (colour, border and background alike).
 */
export function exportTokensCSS(): string {
  const primitives = primitivesCSS.replace(COMMENT_RE, "");
  // ‼️ Regex with /g, not the string "@theme". A string pattern replaces only
  // the FIRST occurrence, so a second `@theme` block from Style Dictionary
  // would survive as an at-rule no standalone page understands — taking every
  // primitive token with it, and then every semantic token's `var()`, and then
  // every colour on the page. The failure is total and silent.
  return [
    primitives.replace(/@theme\b/g, ":root"),
    semanticLightCSS.replace(COMMENT_RE, ""),
  ]
    .join("\n")
    .replace(BLANK_LINES_RE, "\n\n")
    .trim();
}

/** Rewrite one editor stylesheet for the export wrapper. */
export function rescopeEditorCSS(css: string): string {
  return dropDeclarations(css.replace(COMMENT_RE, ""))
    .replaceAll(".tiptap", EXPORT_SCOPE)
    .replace(BLANK_LINES_RE, "\n\n")
    .trim();
}
