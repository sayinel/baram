// §5.12 export — KaTeX's fonts have to travel with the document.
//
// The failure this guards against is silent and easy to miss: KaTeX renders,
// the formula appears, and it is simply typeset in the wrong fonts — big
// operators stay at text size because KaTeX_Size2 never loaded. Nothing errors
// and nothing is blank, so only a side-by-side comparison shows it. A single
// surviving `url(fonts/…)` is enough to cause it, which is why the assertion
// below is "none remain" rather than "some were replaced".
import katexCSS from "katex/dist/katex.min.css?raw";
import { describe, expect, it } from "vitest";

import { generateStandaloneHTML } from "../export-html";
import { inlineKatexFonts } from "../export-katex-fonts";

const RELATIVE_FONT_URL = /url\(\s*["']?fonts\//g;

describe("the KaTeX stylesheet the export ships", () => {
  it("starts from a real stylesheet — the checks below are not vacuous", () => {
    // vitest stubs CSS imports with "" unless `test.css` is on (vitest.config.ts).
    // Without this guard every assertion here would pass against nothing.
    expect(katexCSS.length).toBeGreaterThan(10_000);
    expect(katexCSS.match(RELATIVE_FONT_URL)?.length ?? 0).toBeGreaterThan(0);
  });

  it("leaves no reference to a fonts/ directory that will not exist", () => {
    const css = inlineKatexFonts(katexCSS);
    expect(css.match(RELATIVE_FONT_URL)).toBeNull();
  });

  it("embeds every face rather than dropping the ones it cannot rewrite", () => {
    const css = inlineKatexFonts(katexCSS);
    const faces = css.match(/@font-face/g)?.length ?? 0;
    const embedded = css.match(/url\("data:font\/woff2;base64,/g)?.length ?? 0;
    expect(faces).toBeGreaterThan(0);
    expect(embedded).toBe(faces);
  });

  it("carries only woff2, not the woff and TrueType alternates too", () => {
    const css = inlineKatexFonts(katexCSS);
    expect(css).not.toContain('format("woff")');
    expect(css).not.toContain('format("truetype")');
  });

  it("reaches a document that HAS math", () => {
    // End to end, because the two halves have been wired up wrong before: the
    // fonts were correct and the page still linked the relative URLs.
    const html = generateStandaloneHTML(
      '<p><span class="katex">E</span></p>',
      "t",
    );
    expect(html).not.toMatch(RELATIVE_FONT_URL);
    expect(html).toContain("data:font/woff2;base64,");
  });

  it("is omitted entirely from a document with no math", () => {
    // ‼️ Omitted, not "included without the fonts". Shipping the stylesheet on
    // its own would leave twenty `url(fonts/…)` references to a directory the
    // exported file does not have — 23KB of dead rules and twenty 404s, which
    // is worse than either alternative.
    const html = generateStandaloneHTML("<p>no math here</p>", "t");
    expect(html).not.toContain("@font-face");
    expect(html).not.toMatch(RELATIVE_FONT_URL);
    // The document's own stylesheet still ships, so this is not "no styles".
    expect(html).toContain("article.baram-export");
  });
});
