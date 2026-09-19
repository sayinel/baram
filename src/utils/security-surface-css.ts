// §359 — the stylesheet injected into a security surface's shadow root, BUILT by
// reading the stylesheets that already own each rule rather than by copying them.
//
// Why read instead of move. The obvious shape is to cut these rules out of
// `plugins.css`/`vault.css`/`modal.css` into one file and inject that. Four of the
// classes forbid it. Counted over `src/components` outside tests:
// `className="settings-section"` appears in 15 files (this surface is one of them, so
// 14 others); `settings-section-desc` and `vault-tab-empty` in 3 each (this surface,
// `VaultTab.tsx`, `PluginDeveloperSection.tsx`); and `btn-unstyled`/`flex-header`/
// `text-truncate` are the shared utilities CLAUDE.md pins to `base.css`. Cutting those
// out breaks the screens left behind; copying them is the drift `export-editor-css.ts`
// was written to end ("a copy has no way to notice that its original moved"). So
// nothing moves: the light DOM is untouched, and a change to any rule below reaches the
// shadow on the next build.
//
// What the extractor keeps, and why those two shapes:
//
//  - CLASS mode: a selector every one of whose classes is a surface class, and which
//    has at least one. `.plugin-consent__cap + .plugin-consent__cap` and
//    `.approved-roots-item span` qualify; `.zettel-hub-list-row > .text-truncate` does
//    not (its ancestor cannot exist inside this shadow root), and neither does
//    `:root {…}` or `html:not([data-theme]) {…}`, which have no surface class at all.
//    Token declarations on the document root are supposed to stay outside: custom
//    properties are inherited, so they reach the shadow content on their own.
//  - UNIVERSAL mode, applied to `a11y.css` only: a selector built on `*` with no class
//    or id. That file holds two app-wide rules these surfaces silently depend on — the
//    `*:focus-visible` outline and the `prefers-reduced-motion` reset — and neither has
//    a class for CLASS mode to match. `plugins.css:36` names the second one by hand
//    ("covered by the app-wide `prefers-reduced-motion` reset"), which is exactly the
//    dependency that would have been lost at the boundary.
//
// The parse is `css-tree`, the same parser the theme pipeline uses, not a regex: a
// selector list has to be split and filtered per selector, and `css-rules.ts` in
// `src/styles/__tests__` records three ways a hand-rolled matcher got that wrong.
//
// `security-surface-css.test.ts` keeps this honest from both ends: the class lists are
// checked against the class tokens scanned out of the three component sources, and every
// listed class that has a rule anywhere in `src/styles` must appear in the output — so
// an extraction that silently matched nothing goes red instead of rendering unstyled.
import * as csstree from "css-tree";

import a11yCss from "../styles/a11y.css?raw";
import baseCss from "../styles/base.css?raw";
import pluginsCss from "../styles/plugins.css?raw";
import boundaryCss from "../styles/security-surfaces.css?raw";
import modalCss from "../styles/settings/modal.css?raw";
import vaultCss from "../styles/settings/vault.css?raw";

/** The three screens `SECURITY_SURFACE_FILES` names, keyed for the lookup below. */
export type SecuritySurface =
  "approvedRoots" | "consentDialog" | "revokedNotice";

/**
 * Every class each surface puts in the DOM, including the shared utilities it borrows.
 * Hand-written, and held to the component sources by `security-surface-css.test.ts` —
 * a class added to the JSX without being added here would render unstyled inside the
 * shadow, which no type error and no other test would catch.
 */
export const SECURITY_SURFACE_CLASSES: Record<
  SecuritySurface,
  readonly string[]
> = {
  approvedRoots: [
    "approved-roots-item",
    "approved-roots-list",
    "approved-roots-revoke",
    "btn-unstyled",
    "flex-header",
    "settings-section",
    "settings-section-desc",
    "settings-section-title",
    "text-truncate",
    "vault-tab-empty",
  ],
  consentDialog: [
    "btn-unstyled",
    "plugin-consent",
    "plugin-consent-overlay",
    "plugin-consent__ack",
    "plugin-consent__actions",
    "plugin-consent__body",
    "plugin-consent__cancel",
    "plugin-consent__cap",
    "plugin-consent__cap-text",
    "plugin-consent__caps",
    "plugin-consent__confirm",
    "plugin-consent__danger",
    "plugin-consent__danger-title",
    "plugin-consent__lead",
    "plugin-consent__new",
    "plugin-consent__title",
  ],
  revokedNotice: [
    "plugin-revoked",
    "plugin-revoked--warn",
    "plugin-revoked__note",
    "plugin-revoked__reason",
    "plugin-revoked__remove",
    "plugin-revoked__title",
  ],
};

/**
 * The stylesheets read for class rules, in cascade order. `base.css` is last because
 * its three utilities are the weakest thing a surface applies; the others never define
 * the same class, so their order between themselves does not decide anything today.
 */
const CLASS_SHEETS = [pluginsCss, modalCss, vaultCss, baseCss];

/** At-rules whose block holds ordinary rules that must be carried across with it. */
const NESTING_ATRULES = new Set(["media", "supports"]);

const cache = new Map<SecuritySurface, string>();

/**
 * The CSS for one surface's shadow root. Memoised because the parse is per-sheet work
 * that cannot change at runtime, and a dialog that opens twice must not pay for it
 * twice.
 */
export function securitySurfaceCss(surface: SecuritySurface): string {
  const hit = cache.get(surface);
  if (hit !== undefined) return hit;
  const wanted = new Set(SECURITY_SURFACE_CLASSES[surface]);
  const parts = [
    boundaryCss,
    ...extractRules(a11yCss, isUniversalSelector),
    ...CLASS_SHEETS.flatMap((sheet) =>
      extractRules(sheet, (selector) => hasOnlyWantedClasses(selector, wanted)),
    ),
  ];
  const css = parts.join("\n");
  // Keyframes come last and by NAME: they are top-level at-rules with no selector, so
  // neither predicate can see them, and `.plugin-consent-overlay`/`.plugin-consent`
  // both name one in `animation`. Matching on the generated text over-includes at
  // worst (an unrelated keyframes whose name is a substring of a kept declaration),
  // which costs bytes rather than correctness.
  const frames = CLASS_SHEETS.flatMap((sheet) => keyframesNamedIn(sheet, css));
  const sheet = [css, ...frames].join("\n");
  cache.set(surface, sheet);
  return sheet;
}

/** The class names a selector constrains on, ignoring everything else about it. */
function classesOf(selector: csstree.CssNode): string[] {
  const found: string[] = [];
  csstree.walk(selector, (node) => {
    if (node.type === "ClassSelector") found.push(node.name);
  });
  return found;
}

/**
 * Rules from one stylesheet whose selectors `keep` accepts, with each selector list
 * narrowed to the accepted selectors. A rule inside `@media`/`@supports` is re-emitted
 * inside its own copy of that wrapper — repeating the condition rather than grouping
 * costs a few bytes and keeps this a flat map instead of a tree rebuild.
 */
function extractRules(
  css: string,
  keep: (selector: csstree.CssNode) => boolean,
): string[] {
  const ast = csstree.parse(css);
  if (ast.type !== "StyleSheet") return [];
  const out: string[] = [];
  for (const node of ast.children) {
    if (node.type === "Rule") {
      const rule = filterRule(node, keep);
      if (rule !== null) out.push(rule);
      continue;
    }
    if (
      node.type !== "Atrule" ||
      node.block === null ||
      !NESTING_ATRULES.has(node.name.toLowerCase())
    ) {
      continue;
    }
    const condition =
      node.prelude === null ? "" : csstree.generate(node.prelude);
    for (const inner of node.block.children) {
      if (inner.type !== "Rule") continue;
      const rule = filterRule(inner, keep);
      if (rule !== null) out.push(`@${node.name} ${condition}{${rule}}`);
    }
  }
  return out;
}

/** One rule, or null when `keep` accepted none of its selectors. */
function filterRule(
  rule: csstree.Rule,
  keep: (selector: csstree.CssNode) => boolean,
): null | string {
  if (rule.prelude.type !== "SelectorList") return null;
  const kept = rule.prelude.children.toArray().filter(keep);
  if (kept.length === 0) return null;
  const selectors = kept.map((s) => csstree.generate(s)).join(",");
  return `${selectors}${csstree.generate(rule.block)}`;
}

/** CLASS mode — see the file header. */
function hasOnlyWantedClasses(
  selector: csstree.CssNode,
  wanted: ReadonlySet<string>,
): boolean {
  const classes = classesOf(selector);
  return classes.length > 0 && classes.every((c) => wanted.has(c));
}

/** UNIVERSAL mode — see the file header. */
function isUniversalSelector(selector: csstree.CssNode): boolean {
  if (classesOf(selector).length > 0) return false;
  let universal = false;
  let disqualified = false;
  csstree.walk(selector, (node) => {
    if (node.type === "IdSelector") disqualified = true;
    if (node.type === "TypeSelector") {
      if (node.name === "*") universal = true;
      else disqualified = true;
    }
  });
  return universal && !disqualified;
}

/** `@keyframes` blocks from one sheet whose name occurs in `css`. */
function keyframesNamedIn(sheet: string, css: string): string[] {
  const ast = csstree.parse(sheet);
  if (ast.type !== "StyleSheet") return [];
  const out: string[] = [];
  for (const node of ast.children) {
    if (
      node.type !== "Atrule" ||
      node.name.toLowerCase() !== "keyframes" ||
      node.prelude === null
    ) {
      continue;
    }
    if (css.includes(csstree.generate(node.prelude))) {
      out.push(csstree.generate(node));
    }
  }
  return out;
}
