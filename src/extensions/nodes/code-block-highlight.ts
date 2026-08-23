// §5.4 Syntax highlight styles for code blocks (light + dark)
import { HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";

/** Light mode — CodeMirror's defaultHighlightStyle equivalent */
export const lightHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#708" },
  {
    tag: [tags.name, tags.deleted, tags.character, tags.macroName],
    color: "#30a",
  },
  { tag: [tags.propertyName], color: "#00c" },
  {
    tag: [
      tags.processingInstruction,
      tags.string,
      tags.inserted,
      tags.special(tags.string),
    ],
    color: "#a11",
  },
  { tag: [tags.function(tags.variableName), tags.labelName], color: "#30a" },
  {
    tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)],
    color: "#219",
  },
  { tag: [tags.definition(tags.name), tags.separator], color: "#00c" },
  { tag: [tags.className], color: "#167" },
  {
    tag: [
      tags.number,
      tags.changed,
      tags.annotation,
      tags.modifier,
      tags.self,
      tags.namespace,
    ],
    color: "#256",
  },
  { tag: [tags.typeName], color: "#085" },
  { tag: [tags.operator, tags.operatorKeyword], color: "#9a6e3a" },
  { tag: [tags.url, tags.escape, tags.regexp, tags.link], color: "#a11" },
  { tag: [tags.meta, tags.comment], color: "#940" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.link, textDecoration: "underline" },
  { tag: tags.heading, fontWeight: "bold", color: "#30a" },
  { tag: tags.atom, color: "#219" },
  { tag: tags.bool, color: "#219" },
  { tag: tags.special(tags.variableName), color: "#256" },
  { tag: tags.invalid, color: "#f00" },
]);

/** Dark mode highlight style */
export const darkHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#c678dd" },
  {
    tag: [tags.name, tags.deleted, tags.character, tags.macroName],
    color: "#e06c75",
  },
  { tag: [tags.propertyName], color: "#e06c75" },
  {
    tag: [
      tags.processingInstruction,
      tags.string,
      tags.inserted,
      tags.special(tags.string),
    ],
    color: "#98c379",
  },
  { tag: [tags.function(tags.variableName), tags.labelName], color: "#61afef" },
  {
    tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)],
    color: "#d19a66",
  },
  { tag: [tags.definition(tags.name), tags.separator], color: "#61afef" },
  { tag: [tags.className], color: "#e5c07b" },
  {
    tag: [
      tags.number,
      tags.changed,
      tags.annotation,
      tags.modifier,
      tags.self,
      tags.namespace,
    ],
    color: "#d19a66",
  },
  { tag: [tags.typeName], color: "#e5c07b" },
  { tag: [tags.operator, tags.operatorKeyword], color: "#56b6c2" },
  { tag: [tags.url, tags.escape, tags.regexp, tags.link], color: "#98c379" },
  { tag: [tags.meta, tags.comment], color: "#5c6370" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.link, textDecoration: "underline" },
  { tag: tags.heading, fontWeight: "bold", color: "#61afef" },
  { tag: tags.atom, color: "#d19a66" },
  { tag: tags.bool, color: "#d19a66" },
  { tag: tags.special(tags.variableName), color: "#e06c75" },
  { tag: tags.invalid, color: "#f44747" },
]);

/**
 * The LIGHT style's declarations for a highlight class, whichever style
 * produced that class.
 *
 * §5.12 export: `extractHighlightedLineHTML` used to read each token's colour
 * with `getComputedStyle`, i.e. from the style the EDITOR is wearing. Under a
 * dark theme that put light-grey code onto the export's white page, where it is
 * very nearly invisible — the same defect as Mermaid's baked-in palette, and
 * reported together with it.
 *
 * ‼️ A colour→colour translation cannot work: measured across these two
 * definitions, the dark style reuses 9 colours where the light style uses many,
 * so `#e06c75` alone stands for three different light colours (#30a, #00c,
 * #256) depending on the tag. The mapping has to be by SPEC POSITION, which is
 * what this does — `HighlightStyle.define` emits exactly one CSS rule per spec,
 * in spec order (verified against @codemirror/language 6.12.4, and guarded by
 * code-block-highlight.test.ts).
 *
 * Light classes map to themselves, so a light-theme export takes the same path
 * and there is no second code path that only dark users exercise.
 *
 * Returns null for anything unrecognised (CodeMirror also puts non-highlight
 * classes on spans), which the caller renders unstyled.
 */
export function lightHighlightDeclarations(
  classes: Iterable<string>,
): null | string {
  const out: string[] = [];
  for (const cls of classes) {
    const decl = CLASS_TO_LIGHT_DECLARATIONS.get(cls);
    if (decl) out.push(decl);
  }
  return out.length > 0 ? out.join("") : null;
}

/** `.ͼp {color: #708;}` → ["ͼp", "color: #708;"], in spec order. */
function styleRules(style: HighlightStyle): Array<[string, string]> {
  const css = style.module?.getRules() ?? "";
  return [...css.matchAll(/\.([^\s{]+)\s*\{([^}]*)\}/g)].map((m) => [
    m[1],
    m[2].trim(),
  ]);
}

/**
 * class → light declarations, built once. Both styles contribute their own
 * class names as keys; both point at the LIGHT declarations for the same spec
 * index. Sizes are asserted equal by the guard test rather than here, so a
 * mismatch is a loud test failure rather than a silently short map.
 */
const CLASS_TO_LIGHT_DECLARATIONS: Map<string, string> = (() => {
  const light = styleRules(lightHighlightStyle);
  const dark = styleRules(darkHighlightStyle);
  const map = new Map<string, string>();
  light.forEach(([cls, decl], i) => {
    map.set(cls, decl);
    const darkClass = dark[i]?.[0];
    if (darkClass) map.set(darkClass, decl);
  });
  return map;
})();

/** Returns the appropriate highlight style based on current theme */
export function getHighlightStyle(): HighlightStyle {
  const isDark =
    document.documentElement.dataset.theme === "dark" ||
    (document.documentElement.dataset.theme == null &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  return isDark ? darkHighlightStyle : lightHighlightStyle;
}
