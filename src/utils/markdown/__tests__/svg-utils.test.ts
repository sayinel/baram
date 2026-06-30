// §5.1 SVG sanitizer + detection tests. Run in jsdom, which parses SVG/
// foreignObject namespaces the same way WebKit does, so the namespace decisions
// here are faithful to the runtime.
import { describe, expect, it } from "vitest";

import {
  ensureRootSvgNamespace,
  getSvgRootWidthPercent,
  isSvgContent,
  sanitizeSvg,
  setSvgRootWidth,
  svgDimensions,
} from "../svg-utils";

function parseSvg(markup: string): SVGSVGElement {
  const el = new DOMParser()
    .parseFromString(markup, "image/svg+xml")
    .querySelector("svg");
  if (!el) throw new Error("test SVG did not parse");
  return el as unknown as SVGSVGElement;
}

describe("sanitizeSvg", () => {
  it("preserves shape elements and presentation attributes", () => {
    const svg = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40" fill="tomato" stroke="black"/><rect x="10" y="10" width="20" height="20"/></svg>`;
    const out = sanitizeSvg(svg);
    expect(out).toMatch(/<svg/i);
    expect(out).toMatch(/viewBox="0 0 100 100"/);
    expect(out).toMatch(/<circle/i);
    expect(out).toMatch(/fill="tomato"/);
    expect(out).toMatch(/<rect/i);
  });

  it("preserves inline style, <style>, gradients and filters", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><style>.a{fill:blue}</style><defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient><filter id="f"><feGaussianBlur stdDeviation="2"/></filter></defs><rect class="a" style="opacity:0.5" filter="url(#f)" width="10" height="10"/></svg>`;
    const out = sanitizeSvg(svg);
    expect(out).toMatch(/<style/i);
    expect(out).toMatch(/linearGradient/i);
    expect(out).toMatch(/feGaussianBlur/i);
    expect(out).toMatch(/style="opacity:\s*0?\.5"/i);
  });

  it("preserves HTML labels inside <foreignObject>", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject width="80" height="40"><div><span>Hi<br><b>there</b></span></div></foreignObject></svg>`;
    const out = sanitizeSvg(svg);
    expect(out).toMatch(/<foreignObject/i);
    expect(out).toMatch(/there/);
    expect(out).toMatch(/<br/i);
  });

  it("strips scripts, event handlers and javascript: URLs", () => {
    const evil = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10" onload="alert(2)" onclick="bad()"/><image href="javascript:alert(3)"/><a href="javascript:alert(4)">x</a></svg>`;
    const out = sanitizeSvg(evil);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/onload/i);
    expect(out).not.toMatch(/onclick/i);
    expect(out).not.toMatch(/javascript:/i);
    // benign geometry survives
    expect(out).toMatch(/<rect/i);
  });

  it("returns empty string for non-SVG / empty input", () => {
    expect(sanitizeSvg("")).toBe("");
  });
});

describe("svgDimensions", () => {
  it("falls back to viewBox when width is a percentage (no squashing)", () => {
    // Regression: parseFloat("100%") === 100 used to override the viewBox width.
    const el = parseSvg('<svg width="100%" viewBox="0 0 680 300"></svg>');
    expect(svgDimensions(el)).toEqual({ width: 680, height: 300 });
  });

  it("uses the viewBox when no width/height attrs are present", () => {
    const el = parseSvg('<svg viewBox="0 0 100 100"></svg>');
    expect(svgDimensions(el)).toEqual({ width: 100, height: 100 });
  });

  it("uses explicit pixel width/height", () => {
    const el = parseSvg(
      '<svg width="120" height="60" viewBox="0 0 10 10"></svg>',
    );
    expect(svgDimensions(el)).toEqual({ width: 120, height: 60 });
  });

  it("treats px-suffixed lengths as pixels", () => {
    const el = parseSvg('<svg width="120px" height="60px"></svg>');
    expect(svgDimensions(el)).toEqual({ width: 120, height: 60 });
  });

  it("defaults to 800×600 when nothing usable is present", () => {
    const el = parseSvg("<svg></svg>");
    expect(svgDimensions(el)).toEqual({ width: 800, height: 600 });
  });
});

describe("ensureRootSvgNamespace", () => {
  it("injects xmlns into an xmlns-less root <svg> (prevents blank-PNG bug)", () => {
    const out = ensureRootSvgNamespace(
      '<svg viewBox="0 0 120 120" width="120"><rect width="120" height="120"/></svg>',
    );
    expect(out).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    // Critically: children must NOT pick up xmlns="" after a round-trip parse.
    const serialized = new XMLSerializer().serializeToString(
      new DOMParser()
        .parseFromString(out, "image/svg+xml")
        .querySelector("svg") as Element,
    );
    expect(serialized).not.toMatch(/xmlns=""/);
  });

  it("leaves an already-namespaced SVG unchanged", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect/></svg>';
    expect(ensureRootSvgNamespace(svg)).toBe(svg);
  });

  it("does not duplicate when xmlns has odd spacing", () => {
    const svg =
      '<svg  xmlns = "http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>';
    expect(ensureRootSvgNamespace(svg)).toBe(svg);
  });
});

describe("setSvgRootWidth", () => {
  it("replaces an existing width on the root <svg>", () => {
    const out = setSvgRootWidth(
      '<svg width="120" height="120" viewBox="0 0 120 120"><rect/></svg>',
      50,
    );
    expect(out).toBe(
      '<svg width="50%" height="120" viewBox="0 0 120 120"><rect/></svg>',
    );
  });

  it("inserts width when the root has none", () => {
    const out = setSvgRootWidth('<svg viewBox="0 0 10 10"><rect/></svg>', 60);
    expect(out).toBe('<svg width="60%" viewBox="0 0 10 10"><rect/></svg>');
  });

  it("only touches the root tag, not child width/height", () => {
    const out = setSvgRootWidth(
      '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
      40,
    );
    expect(out).toBe(
      '<svg width="40%" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
    );
  });

  it("clamps and rounds the percentage to 1–100", () => {
    expect(setSvgRootWidth("<svg><rect/></svg>", 150)).toContain(
      'width="100%"',
    );
    expect(setSvgRootWidth("<svg><rect/></svg>", 0)).toContain('width="1%"');
    expect(setSvgRootWidth("<svg><rect/></svg>", 33.6)).toContain(
      'width="34%"',
    );
  });

  it("round-trips with getSvgRootWidthPercent", () => {
    expect(getSvgRootWidthPercent(setSvgRootWidth("<svg/>", 60))).toBe(60);
  });
});

describe("getSvgRootWidthPercent", () => {
  it("reads a percentage width from the root", () => {
    expect(
      getSvgRootWidthPercent(
        '<svg width="50%" viewBox="0 0 1 1"><rect/></svg>',
      ),
    ).toBe(50);
  });

  it("returns null for px or absent width (= natural size)", () => {
    expect(getSvgRootWidthPercent('<svg width="120" viewBox="0 0 1 1"/>')).toBe(
      null,
    );
    expect(getSvgRootWidthPercent('<svg viewBox="0 0 1 1"/>')).toBe(null);
  });

  it("ignores a percentage width on a child element", () => {
    expect(
      getSvgRootWidthPercent(
        '<svg viewBox="0 0 1 1"><rect width="50%"/></svg>',
      ),
    ).toBe(null);
  });
});

describe("isSvgContent", () => {
  it("detects a bare SVG document", () => {
    expect(isSvgContent(`<svg viewBox="0 0 1 1"></svg>`)).toBe(true);
  });

  it("detects an SVG with leading whitespace, xml decl and comments", () => {
    const s = `\n  <?xml version="1.0"?>\n<!-- a comment -->\n<svg><rect/></svg>`;
    expect(isSvgContent(s)).toBe(true);
  });

  it("rejects ordinary HTML", () => {
    expect(isSvgContent(`<div><svg></svg></div>`)).toBe(false);
    expect(isSvgContent(`<p>hello</p>`)).toBe(false);
  });

  it("rejects an unclosed svg tag", () => {
    expect(isSvgContent(`<svg viewBox="0 0 1 1">`)).toBe(false);
  });
});
