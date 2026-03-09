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

/** Returns the appropriate highlight style based on current theme */
export function getHighlightStyle(): HighlightStyle {
  const isDark =
    document.documentElement.dataset.theme === "dark" ||
    (document.documentElement.dataset.theme == null &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  return isDark ? darkHighlightStyle : lightHighlightStyle;
}
