// §5.5 Regression: Mermaid flowchart node labels (HTML inside <foreignObject>)
// disappeared after securityLevel switched "strict" → "antiscript" (commit
// 51044cd), because DOMPurify's default HTML_INTEGRATION_POINTS excludes
// `foreignobject`, so HTML-namespaced label content failed the namespace check
// and was stripped. sanitizeMermaidSvg registers foreignObject as an integration
// point. These tests run in jsdom, which parses <foreignObject> children into the
// HTML namespace exactly as WebKit does, so the namespace decision is faithful.
import { describe, expect, it } from "vitest";

import { sanitizeMermaidSvg } from "../../utils/markdown/mermaid-utils";

// A representative slice of Mermaid 11 output: injected <style>, an htmlLabel in
// <foreignObject> with inline formatting, and a raw <text> (sequence/class type).
const MERMAID_SVG = `<svg id="m" xmlns="http://www.w3.org/2000/svg"><style>#m .nodeLabel{fill:#333}</style><g class="node"><foreignObject width="80" height="40"><div class="label"><span class="nodeLabel">Start<br><b>Now</b></span></div></foreignObject></g><text class="messageText">SeqMsg</text></svg>`;

describe("sanitizeMermaidSvg", () => {
  const out = sanitizeMermaidSvg(MERMAID_SVG);

  it("preserves HTML label text inside <foreignObject>", () => {
    expect(out).toMatch(/Start/);
    expect(out).toMatch(/<foreignObject/i);
    expect(out).toMatch(/nodeLabel/);
  });

  it("preserves inline formatting tags in labels (<br>, <b>)", () => {
    expect(out).toMatch(/<br/i);
    expect(out).toMatch(/Now/);
  });

  it("preserves raw <text> labels and the injected <style>", () => {
    expect(out).toMatch(/SeqMsg/);
    expect(out).toMatch(/<style/i);
  });

  it("still strips scripts, event handlers, and javascript: URLs", () => {
    const evil = `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div><img src=x onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">x</a><span onclick="bad()">ok</span></div></foreignObject></svg>`;
    const safe = sanitizeMermaidSvg(evil);
    expect(safe).not.toMatch(/<script/i);
    expect(safe).not.toMatch(/onerror/i);
    expect(safe).not.toMatch(/onclick/i);
    expect(safe).not.toMatch(/javascript:/i);
    // benign label content is retained
    expect(safe).toMatch(/ok/);
  });
});
