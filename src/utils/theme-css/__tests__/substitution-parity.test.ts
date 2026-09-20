// §358 / 0090 final review (M4) — sanitize and verify must agree about CSS substitution.
//
// The gap this closes, measured by the review against the shipped modules: five shapes
// passed `verifyStoredThemeCss` while `sanitizeThemeCss` refused their direct forms. They
// carry no URL *token* at all — the address sits in a custom property and reaches the
// resource slot only at computed-value time — so verify's `data:`-only token scan saw
// nothing to object to.
//
// ‼️ THE INSTALL PATH WAS NEVER OPEN. Everything here is refused at install by sanitize,
// and was before this change. What the rule buys is the case verify exists for at all: bytes
// that reach it WITHOUT sanitize, i.e. a `.stored/*.css` edited after installation. That is
// the threat `verify.ts`'s own header names as its reason to exist, and
// `ThemeConsentDialog` states to the user in token terms ("no URL other than `data:`") —
// which is exactly what this shape sidestepped.
import { describe, expect, it } from "vitest";

import { substitutionInsideResourceName } from "../css-refs";
import { ThemeCssError } from "../errors";
import { sanitizeThemeCss } from "../sanitize";
import { verifyStoredThemeCss } from "../verify";

/** Wrapped the way stored CSS is, so contract 1 is satisfied and the only thing that can
 *  refuse these is the rule under test. */
const stored = (body: string) => `@layer baram-theme {\n${body}\n}\n`;

/**
 * The five shapes the review measured as passing verify, plus the escaped spelling and two
 * depth cases. Each is a declaration body; the two helpers below wrap it for each layer.
 */
const SUBSTITUTION_CORPUS: Array<[string, string]> = [
  ["image-set + var", `a{background:image-set(var(--x) 1x)}`],
  ["-webkit-image-set + var", `a{background:-webkit-image-set(var(--x) 1x)}`],
  ["image + var", `a{background:image(var(--x))}`],
  ["src + var", `@font-face{src:src(var(--x))}`],
  ["image-set + env", `a{background:image-set(env(--x) 1x)}`],
  ["image-set + attr", `a{background:image-set(attr(data-x) 1x)}`],
  // The escaped spelling, which is why the predicate compares through `cssName` rather
  // than raw text — the same trap `\\75 rl(` was.
  ["escaped var", `a{background:image-set(\\76 ar(--x) 1x)}`],
  // ‼️ NESTED, and the reason the rule is any-depth. The review found sanitize's walk saw
  // only the immediate parent, so this passed while the literal string in the same slot
  // (`image-set(cross-fade("https://…") 1x)`) was refused — two depths for one concept. It
  // did not measure a browser, so this is closed rather than argued inert.
  ["nested one deep", `a{background:image-set(cross-fade(var(--x)) 1x)}`],
  [
    "nested two deep",
    `a{background:image-set(cross-fade(color-mix(in srgb, var(--x), red)) 1x)}`,
  ],
];

describe("substitution inside a resource-naming function", () => {
  it.each(SUBSTITUTION_CORPUS)("sanitize refuses: %s", (_name, body) => {
    let code: string | undefined;
    try {
      sanitizeThemeCss(body);
    } catch (err) {
      code = err instanceof ThemeCssError ? err.code : `not-a-theme-error`;
    }
    expect(code).toBe("substitutionNotAllowed");
  });

  it.each(SUBSTITUTION_CORPUS)("verify refuses: %s", (_name, body) => {
    // The parity half. Before M4 every one of these returned true.
    expect(verifyStoredThemeCss(stored(body))).toBe(false);
  });

  it("names the pair it found, for the author's error", () => {
    expect(
      substitutionInsideResourceName(`a{background:image-set(var(--x))}`),
    ).toBe("image-set(var())");
    // The OUTERMOST bearing function is named, not the innermost frame — that is the one
    // whose argument is a resource name.
    expect(
      substitutionInsideResourceName(
        `a{background:image-set(cross-fade(var(--x)))}`,
      ),
    ).toBe("image-set(var())");
  });
});

describe("what the rule must NOT refuse", () => {
  // Without these the rule could be "refuse every var()" and every case above would pass.
  const ALLOWED: Array<[string, string]> = [
    ["a plain custom property read", `a{color:var(--x)}`],
    [
      "var inside a non-resource function",
      `a{color:color-mix(in srgb, var(--x), red)}`,
    ],
    [
      "a resource function with a data URI",
      `a{background:image-set("data:image/gif;base64,R0lGOD" 1x)}`,
    ],
    [
      "var in a declaration beside a resource function",
      `a{--y:var(--x);background:image-set("data:image/gif;base64,R0lGOD" 1x)}`,
    ],
    // ‼️ The frame really closes: a `var()` AFTER a resource function has ended is not
    // inside it. Without the pop in the frame walk this would be refused.
    [
      "var after a closed resource function",
      `a{background:image-set("data:image/gif;base64,R0lGOD" 1x);color:var(--x)}`,
    ],
  ];

  it.each(ALLOWED)("the predicate finds nothing: %s", (_name, body) => {
    expect(substitutionInsideResourceName(body)).toBeNull();
  });

  it.each(ALLOWED)("verify accepts: %s", (_name, body) => {
    expect(verifyStoredThemeCss(stored(body))).toBe(true);
  });
});
