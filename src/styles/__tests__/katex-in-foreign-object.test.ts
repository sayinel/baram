// §5.5 — KaTeX's stylesheet gives `.katex` position: relative. WebKit paints a
// positioned element inside an SVG <foreignObject> without the transforms of
// the SVG ancestors that place it, so a Mermaid `$$…$$` label (KaTeX MathML in
// the node's <foreignObject>, moved there by a <g transform>) painted at the
// diagram's top-left in WKWebView while its layout box stayed in the node.
// jsdom does not paint, so this pins the cascade instead: inside a
// <foreignObject> the app's override wins over KaTeX's rule, and outside one
// KaTeX's rule still applies.
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

describe("KaTeX inside an SVG <foreignObject>", () => {
  beforeAll(() => {
    const style = document.createElement("style");
    style.textContent = [
      readFileSync("node_modules/katex/dist/katex.min.css", "utf8"),
      readFileSync("src/styles/editor/math.css", "utf8"),
    ].join("\n");
    document.head.append(style);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("is not positioned there, while KaTeX outside SVG keeps its own rule", () => {
    document.body.innerHTML = `<span class="katex" id="outside"></span><svg xmlns="http://www.w3.org/2000/svg"><g transform="translate(200,40)"><foreignObject width="120" height="50"><div xmlns="http://www.w3.org/1999/xhtml"><span class="katex" id="inside"><math><mi>x</mi></math></span></div></foreignObject></g></svg>`;
    expect(getComputedStyle(document.getElementById("outside")!).position).toBe(
      "relative",
    );
    expect(getComputedStyle(document.getElementById("inside")!).position).toBe(
      "static",
    );
  });
});
