import { describe, expect, it } from "vitest";

import { normalizeMermaidSvgSize } from "../mermaid-utils";

// §5.5 — Mermaid emits the root as
// `<svg width="100%" style="max-width: <natural>px" viewBox="minX minY W H">`
// (its `useMaxWidth: true` default). normalizeMermaidSvgSize must turn that into
// a plain, intrinsically-sized SVG so the `.media-resize-frame` can size it.
describe("normalizeMermaidSvgSize", () => {
  // Exactly what mermaid@11.16 + DOMPurify produce for a flowchart (verified by
  // rendering headlessly), minus the body.
  const REAL_ROOT =
    '<svg id="m1" width="100%" xmlns="http://www.w3.org/2000/svg" class="flowchart" style="max-width: 616px;" viewBox="-8 -8 616 216" aria-roledescription="flowchart-v2"><g></g></svg>';

  it("removes width=100% and derives an intrinsic px width from the viewBox", () => {
    const out = normalizeMermaidSvgSize(REAL_ROOT);
    expect(out).not.toMatch(/width\s*=\s*"100%"/i);
    expect(out).toMatch(/width="616"/);
    expect(out).toMatch(/height="216"/);
  });

  it("strips the inline max-width cap", () => {
    const out = normalizeMermaidSvgSize(REAL_ROOT);
    expect(out).not.toMatch(/max-width/i);
  });

  it("drops the style attribute entirely when only sizing declarations remain", () => {
    const out = normalizeMermaidSvgSize(REAL_ROOT);
    expect(out).not.toMatch(/\sstyle\s*=/i);
  });

  it("preserves the viewBox and other root attributes", () => {
    const out = normalizeMermaidSvgSize(REAL_ROOT);
    expect(out).toMatch(/viewBox="-8 -8 616 216"/);
    expect(out).toMatch(/class="flowchart"/);
    expect(out).toMatch(/aria-roledescription="flowchart-v2"/);
  });

  it("leaves the diagram body untouched", () => {
    const body =
      '<foreignObject><div class="label"><span>Decision?</span></div></foreignObject>';
    const svg =
      '<svg width="100%" style="max-width: 300px;" viewBox="0 0 300 100">' +
      body +
      "</svg>";
    expect(normalizeMermaidSvgSize(svg)).toContain(body);
  });

  it("keeps non-sizing style declarations while dropping the sizing ones", () => {
    const svg =
      '<svg width="100%" style="max-width: 300px; background: white;" viewBox="0 0 300 100"></svg>';
    const out = normalizeMermaidSvgSize(svg);
    expect(out).toMatch(/style="background: white;?"/);
    expect(out).not.toMatch(/max-width/i);
  });

  it("uses the viewBox W/H, not its min-x/min-y offset", () => {
    const svg = '<svg width="100%" viewBox="-8 -8 616 216"></svg>';
    const out = normalizeMermaidSvgSize(svg);
    expect(out).toMatch(/width="616"/);
    expect(out).toMatch(/height="216"/);
  });

  it("returns a viewBox-less SVG unchanged (no intrinsic size to derive)", () => {
    const svg = '<svg width="100%" style="max-width: 300px;"></svg>';
    expect(normalizeMermaidSvgSize(svg)).toBe(svg);
  });

  it("returns an SVG with a degenerate viewBox unchanged", () => {
    const svg = '<svg width="100%" viewBox="0 0 0 0"></svg>';
    expect(normalizeMermaidSvgSize(svg)).toBe(svg);
  });

  it("preserves fractional viewBox dimensions", () => {
    const svg = '<svg width="100%" viewBox="0 0 402.5 150.25"></svg>';
    const out = normalizeMermaidSvgSize(svg);
    expect(out).toMatch(/width="402.5"/);
    expect(out).toMatch(/height="150.25"/);
  });
});
