// §394 spec 0073 D9 · D12 · §7 — plugin output CSS: the theme pipeline without the layer wrap, plus
// every resource reference refused (`data:` and relative too), an at-rule allowlist of four, the
// `:host` family refused by decoded name, and no `</` in what it generates. What reaches a block's
// shadow root and nowhere else.
import { describe, expect, it } from "vitest";

import { PluginCssError, sanitizePluginCss } from "../sanitize-css";

function code(css: string): string {
  try {
    sanitizePluginCss(css);
    return "(passed)";
  } catch (e) {
    return e instanceof PluginCssError ? e.code : "(other error)";
  }
}

describe("sanitizePluginCss — resources", () => {
  /** What fails this: a policy that judges `isRemoteUrl` like the theme (data: and relative
   *  would pass), or a pipeline that skips the function-token scan (the escaped four pass). */
  it.each([
    "a{background:url(https://e.com/x.png)}",
    "a{background:url(data:image/png;base64,AAAA)}",
    "a{background:url(x.png)}",
    "a{background:url(\\68 ttps://e.com/x.png)}",
    "a{background:u\\72l(//evil/x)}",
    "a{background:u\\72l(https\\3a //evil/x)}",
    ":root{--x:u\\72l(//evil/x)}a{background:var(--x)}",
    "a{background:image-set(u\\72l(//evil/x) 1x)}",
    'a{background:image-set("x.png" 1x)}',
  ])("%s → resourceNotAllowed", (css) => {
    expect(code(css)).toBe("resourceNotAllowed");
  });

  /** The pair: CSS with no resource reference passes, custom properties and functions included. */
  it("passes CSS that names no resource", () => {
    expect(
      code(
        ":root{--gap:4px}a{color:var(--color-text-primary);margin:var(--gap);background:linear-gradient(red,blue)}",
      ),
    ).toBe("(passed)");
  });
});

describe("sanitizePluginCss — at-rules", () => {
  /** What fails this: an at-rule allowlist that compares the raw name or lists more than four. */
  it.each([
    "@import url(x.css);",
    "@\\69 mport 'x';",
    "@font-face{font-family:x}",
    "@property --x{syntax:'*';inherits:false}",
    "@layer x{a{color:red}}",
    "@namespace svg url(x);",
    "@page{margin:0}",
  ])("%s → atRuleNotAllowed", (css) => {
    expect(code(css)).toBe("atRuleNotAllowed");
  });

  it.each([
    "@media (min-width:1px){a{color:red}}",
    "@MEDIA print{a{color:red}}",
    "@supports (display:grid){a{color:red}}",
    "@keyframes k{from{opacity:0}to{opacity:1}}",
    "@container (min-width:1px){a{color:red}}",
  ])("%s passes", (css) => {
    expect(code(css)).toBe("(passed)");
  });

  /** The shared pipeline's structural refusals reach plugin CSS too (spec D9 "1차 파스의 거부"). */
  it.each(["a{color:red", "a { b { color: red !important } }"])(
    "%s → parseFailed",
    (css) => {
      expect(code(css)).toBe("parseFailed");
    },
  );
});

describe("sanitizePluginCss — selectors", () => {
  /** What fails this: comparing pseudo names undecoded (`:\68 ost` · `:HOST`), or letting a
   *  selector-side `Raw` through (`:unknownfn(:host)` reaches the walk as `Raw(":host")`). */
  it.each([
    ":host{color:red}",
    ":host(.x){color:red}",
    ":host-context(a){color:red}",
    "::slotted(p){color:red}",
    "::part(x){color:red}",
    ":\\68 ost{color:red}",
    ":HOST{color:red}",
    ":is(:host){color:red}",
    ":unknownfn(:host){color:red}",
  ])("%s → selectorNotAllowed", (css) => {
    expect(code(css)).toBe("selectorNotAllowed");
  });

  it.each([
    "a:hover{color:red}",
    "p::before{content:'x'}",
    "a{&:hover{color:red}}",
  ])("%s passes", (css) => {
    expect(code(css)).toBe("(passed)");
  });
});

describe("sanitizePluginCss — output", () => {
  /** What fails this: the shared `Declaration` branch not reaching plugin CSS. */
  it("removes !important and keeps the declaration", () => {
    const out = sanitizePluginCss("a{color:red !important}");
    expect(out).toContain("color:red");
    expect(out).not.toMatch(/important/i);
  });

  /** The theme wraps its output in `@layer baram-theme`; plugin output is not wrapped. */
  it("is not wrapped in a cascade layer", () => {
    expect(sanitizePluginCss("a{color:red}")).not.toContain("@layer");
  });
});

describe("sanitizePluginCss — markup in the output (D12, plan 0125 P27)", () => {
  /** An export writes this CSS into a `<style>` as raw text, where `</style` closes the element.
   *  What fails this: no check (all four pass), or a check on the INPUT — the two escaped spellings
   *  hold no `</` until css-tree 3.2.1 decodes the string and writes it back as `"</style>"`
   *  (measured), so only the generated output shows it. The case row fails a check for a lower-case
   *  `</style` (the HTML tokenizer ends the element case-blind); the rule is `</`, which has no case. */
  it.each([
    'p::after{content:"</style>"}',
    'p::after{content:"<\\/style>"}',
    'p::after{content:"\\3c /style>"}',
    'p::after{content:"</STYLE>"}',
  ])("%s → markupNotAllowed", (css) => {
    expect(code(css)).toBe("markupNotAllowed");
  });

  /** The pair: a `<` that closes nothing stays — the generated output is `content:"<b>"`. */
  it("passes a string holding a tag that closes nothing", () => {
    expect(sanitizePluginCss('p::after{content:"<b>"}')).toBe(
      'p::after{content:"<b>"}',
    );
  });
});
