// §5.5 Mermaid PNG export: WKWebView won't rasterize <foreignObject> HTML labels
// via <img>→canvas, so the raster path re-renders with SVG <text> labels
// (htmlLabels:false). A per-diagram `%%{init}%%` directive can re-enable
// htmlLabels and override mermaid.initialize, so `forceSvgLabels` neutralizes an
// explicit `htmlLabels: true` opt-in *inside directives only* before that render.
import { describe, expect, it } from "vitest";

import { forceSvgLabels } from "../mermaid-utils";

describe("forceSvgLabels", () => {
  it("flips nested flowchart.htmlLabels:true to false in an init directive", () => {
    const code = `%%{init: {"flowchart": {"htmlLabels": true}} }%%\nflowchart TB\n  A --> B`;
    const out = forceSvgLabels(code);
    expect(out).toContain(`"htmlLabels": false`);
    expect(out).not.toMatch(/"htmlLabels"\s*:\s*true/);
    // rest of the diagram untouched
    expect(out).toContain("flowchart TB");
    expect(out).toContain("A --> B");
  });

  it("flips the top-level global htmlLabels:true form", () => {
    const code = `%%{init: {"htmlLabels": true}}%%\nflowchart LR\n  A --> B`;
    expect(forceSvgLabels(code)).toContain(`"htmlLabels": false`);
  });

  it("handles an unquoted directive key", () => {
    const code = `%%{init: {htmlLabels: true}}%%\ngraph TD\n  A-->B`;
    expect(forceSvgLabels(code)).toMatch(/htmlLabels:\s*false/);
  });

  it("leaves a diagram with no directive unchanged", () => {
    const code = `flowchart LR\n  A --> B`;
    expect(forceSvgLabels(code)).toBe(code);
  });

  it("leaves an already-false directive unchanged", () => {
    const code = `%%{init: {"flowchart": {"htmlLabels": false}} }%%\nflowchart TB\n  A --> B`;
    expect(forceSvgLabels(code)).toBe(code);
  });

  it("preserves other directive settings (e.g. theme) while flipping htmlLabels", () => {
    const code = `%%{init: {"theme": "forest", "flowchart": {"htmlLabels": true}} }%%\nflowchart TB\n  A --> B`;
    const out = forceSvgLabels(code);
    expect(out).toContain(`"theme": "forest"`);
    expect(out).toContain(`"htmlLabels": false`);
  });

  it("does not touch the literal text outside a directive (node label body)", () => {
    const code = `flowchart LR\n  A["config htmlLabels: true here"] --> B`;
    expect(forceSvgLabels(code)).toBe(code);
  });
});
