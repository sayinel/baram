// §5.6 HTML block sanitizer — URI policy (issue 499).
//
// The sanitizer already refused script schemes through DOMPurify's defaults;
// what this pins is the one place those defaults were LOOSER than the link
// policy markdown links are held to: a protocol-relative destination
// (`//host`, `\\host`) counted as "relative" and survived into the editor DOM
// as a live anchor. Both sanitizers now take their URI pattern from
// utils/link-href.ts, so one exported document has one rule.
//
// Reading guide: only the three protocol-relative rows and the `<img src>`
// case would fail with the shared pattern removed — the script/file/custom
// scheme rows were already refused by DOMPurify's default and sit here as
// policy pins, so the whole rule is visible in one place.
import { describe, expect, it } from "vitest";

import { sanitizeHtmlBlock } from "../html-sanitize";

function anchorHref(html: string): null | string {
  const doc = new DOMParser().parseFromString(
    sanitizeHtmlBlock(html),
    "text/html",
  );
  const a = doc.querySelector("a");
  if (!a) throw new Error("sanitizer dropped the anchor element itself");
  return a.getAttribute("href");
}

describe("sanitizeHtmlBlock — anchor destinations follow the link policy", () => {
  it.each([
    "//attacker.example/collect",
    "\\\\attacker.example\\collect",
    "/\\attacker.example/collect",
    "javascript:alert(1)",
    "java\tscript:alert(1)",
    "vbscript:msgbox(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "obsidian://open?vault=v",
  ])("strips href=%j but keeps the anchor text", (href) => {
    expect(anchorHref(`<div><a href="${href}">click</a></div>`)).toBeNull();
  });

  it.each([
    "https://example.com/a?b=c#d",
    "mailto:a@b.c",
    "#section",
    "./notes/a.md",
    "notes/a.md",
    "/notes/a.md",
  ])("keeps href=%j", (href) => {
    expect(anchorHref(`<div><a href="${href}">click</a></div>`)).toBe(href);
  });

  it("applies the same rule to other URI attributes — a protocol-relative image src is dropped", () => {
    const out = sanitizeHtmlBlock(
      '<img src="//tracker.example/p.gif" alt="x">',
    );
    expect(out).toContain("<img");
    expect(out).not.toContain("tracker.example");
  });
});

// In the HTML block, MathML follows the route isSvgContent picks: content it
// reads as SVG goes through sanitizeSvg and keeps MathML, and content it routes
// to the html profile still drops it.
describe("sanitizeHtmlBlock — MathML follows the SVG route", () => {
  const MATH = `<math><mi>x</mi></math>`;

  function parse(html: string): Document {
    return new DOMParser().parseFromString(
      sanitizeHtmlBlock(html),
      "text/html",
    );
  }

  it("keeps MathML inside an svg block's <foreignObject>", () => {
    const doc = parse(
      `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject width="40" height="20"><div>${MATH}</div></foreignObject></svg>`,
    );
    expect(doc.querySelector("foreignObject math mi")?.textContent).toBe("x");
  });

  it("still drops MathML from HTML that takes the html-profile route", () => {
    const doc = parse(`<div><p>kept</p>${MATH}</div>`);
    expect(doc.querySelector("p")?.textContent).toBe("kept");
    expect(doc.querySelector("math")).toBeNull();
  });
});
