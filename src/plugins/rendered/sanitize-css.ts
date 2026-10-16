// §394 spec 0073 D9 — the CSS a plugin renderer returns in `RenderedContent.css`, on its way into
// that block's shadow root and nowhere else. The theme sanitizer's parser pipeline
// (`utils/theme-css/css-pipeline.ts`) without the cascade-layer wrap, and four rules of its own:
//   ① every resource reference is refused — `url()` tokens (`data:` and relative ones too),
//      strings inside URL-bearing functions, and the URL-bearing function tokens themselves.
//      Images travel in the HTML as `<img src="data:…">` instead.
//   ② at-rules: `@media`, `@supports`, `@keyframes`, `@container` and nothing else, by decoded
//      name.
//   ③ selectors: the `:host` family and `::slotted()` / `::part()` are refused by decoded name
//      (`:\68 ost` and `:HOST` are `:host`), and so is any `Raw` inside a selector — css-tree
//      leaves an unknown pseudo function's argument as `Raw` (`:unknownfn(:host)` →
//      `Raw(":host")`, measured), which no name check can see into.
//   ④ the generated output holds no `</` (spec D12, plan 0125 P27). An HTML · PDF export writes
//      this CSS into a `<style>` element, whose text HTML serialization does not escape: `</style`
//      would end the element there and what follows would parse as markup — a remote `<img>` the
//      export's CSP lets through. Judged on the string this function returns, which is what
//      reaches `<style>`: css-tree decodes a string's escapes and writes it back plain, so
//      `"<\/style>"` and `"\3c /style>"` come out as `"</style>"` (measured, css-tree 3.2.1). A
//      renderer that wants the text `</` on screen puts it in the HTML, where it is text.
// Why ③: CSS in a shadow tree reaches outside it only through the host element, and a `:host`
// rule with `!important` beats the outer rules. `!important` is removed by the shared walk and the
// containment sits on an element outside the shadow tree (spec D10) — both are closed.
// Why ④ sits here and not in a `CssPipelinePolicy` hook: the hooks judge what the parser saw; this
// rule is about where the output is written. A theme's CSS does not reach an export's `<style>`
// today — only its colour tokens do, each value filtered to a hex literal (`themeTokensBlock`); see
// plan 0125 Task 16, open questions.

import type { CssNode, WalkContext } from "css-tree";

import { sanitizeCssWith } from "../../utils/theme-css/css-pipeline";
import { cssName } from "../../utils/theme-css/css-refs";

type PluginCssErrorCode =
  | "atRuleNotAllowed"
  | "markupNotAllowed"
  | "parseFailed"
  | "resourceNotAllowed"
  | "selectorNotAllowed"
  | "substitutionNotAllowed";

export class PluginCssError extends Error {
  constructor(
    readonly code: PluginCssErrorCode,
    /** Where it was refused — for the developer console only. */
    readonly detail?: string,
  ) {
    super(code);
    this.name = "PluginCssError";
  }
}

/** ② — the four at-rules plugin CSS may use, decoded and lowercased. */
const ALLOWED_AT_RULES: ReadonlySet<string> = new Set([
  "container",
  "keyframes",
  "media",
  "supports",
]);

/** ③ — pseudo-classes and pseudo-elements that reach across the shadow boundary. */
const BOUNDARY_SELECTORS: ReadonlySet<string> = new Set([
  "host",
  "host-context",
  "part",
  "slotted",
]);

/** `css` as it may go into a rendered block's shadow root, or a thrown `PluginCssError`. */
export function sanitizePluginCss(css: string): string {
  const out = sanitizeCssWith(
    css,
    {
      node: refuseOutsideAllowlist,
      refuse(code, detail): never {
        throw new PluginCssError(code, detail);
      },
      resource(_value, detail) {
        throw new PluginCssError("resourceNotAllowed", detail);
      },
      urlFunction(_name, _argument, raw) {
        throw new PluginCssError(
          "resourceNotAllowed",
          `output ${raw.slice(0, 80)}`,
        );
      },
    },
    (generated) => generated,
  );
  // ④ — on the returned string, the one that reaches `<style>` (see the header).
  const closing = out.indexOf("</");
  if (closing !== -1) {
    throw new PluginCssError(
      "markupNotAllowed",
      `output ${out.slice(closing, closing + 80)}`,
    );
  }
  return out;
}

/** ② and ③ for one node of the walk. */
function refuseOutsideAllowlist(node: CssNode, context: WalkContext): void {
  switch (node.type) {
    case "Atrule":
      if (!ALLOWED_AT_RULES.has(cssName(node.name))) {
        throw new PluginCssError("atRuleNotAllowed", `@${node.name}`);
      }
      break;
    case "PseudoClassSelector":
    case "PseudoElementSelector":
      if (BOUNDARY_SELECTORS.has(cssName(node.name))) {
        throw new PluginCssError("selectorNotAllowed", `:${node.name}`);
      }
      break;
    case "Raw":
      if (context.selector !== null) {
        throw new PluginCssError(
          "selectorNotAllowed",
          `unparsed selector ${node.value.slice(0, 80)}`,
        );
      }
      break;
  }
}
