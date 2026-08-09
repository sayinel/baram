// §69 — the two content policies `MarkdownRenderer` serves.
//
// ‼️ Both directions are asserted here on purpose. The untrusted assertions live with their
// caller too (`plugin-readme-untrusted-html.test.tsx`), but those are all ABSENCES: applying
// the restriction unconditionally would satisfy every one of them and silently strip raw HTML
// and SVG out of AI chat and the Help panel, where it is a deliberate feature. When I made
// this change the full chat + help suites (22 tests) stayed green under exactly that mutation,
// so nothing was pinning the trusted side.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import MarkdownRenderer from "../MarkdownRenderer";

function html(content: string, trust?: "trusted" | "untrusted") {
  const { container } = render(
    <MarkdownRenderer content={content} trust={trust} />,
  );
  return container.querySelector(".markdown-rendered")!;
}

const SVG_WITH_STYLE = [
  '<svg xmlns="http://www.w3.org/2000/svg">',
  "  <style>.x { display: none }</style>",
  '  <rect width="4" height="4" />',
  "</svg>",
].join("\n");

describe("MarkdownRenderer trust policy (§69)", () => {
  it("defaults to the restricted policy", () => {
    // The default is what protects a caller that does not know this prop exists.
    expect(html(SVG_WITH_STYLE).querySelector("style")).toBeNull();
    expect(html("![](https://a.test/x.png)").querySelector("img")).toBeNull();
  });

  it("keeps raw HTML and SVG for a trusted caller", () => {
    const el = html(SVG_WITH_STYLE, "trusted");

    expect(el.querySelector("svg")).toBeTruthy();
    expect(el.querySelector("style")).toBeTruthy();
  });

  it("keeps remote images for a trusted caller", () => {
    const el = html("![](https://a.test/x.png)", "trusted");

    expect(el.querySelector("img")?.getAttribute("src")).toBe(
      "https://a.test/x.png",
    );
  });

  it("drops raw HTML for an untrusted caller, inline as well as block", () => {
    // A one-line `<svg>…</svg>` parses as INLINE html nodes rather than one block node, so a
    // restriction applied only to block children would leave this reachable.
    const el = html('text <b onclick="x">bold</b> more', "untrusted");

    expect(el.querySelector("b")).toBeNull();
    expect(el.textContent).toContain("text");
    expect(el.textContent).toContain("more");
  });

  it("keeps inline data images for an untrusted caller", () => {
    const src = "data:image/png;base64,iVBORw0KGgo=";
    const el = html(`![](${src})`, "untrusted");

    expect(el.querySelector("img")?.getAttribute("src")).toBe(src);
  });

  it("renders ordinary markdown identically under both policies", () => {
    // ‼️ Non-vacuity for the whole restriction: it must remove markup, not content.
    const md =
      "# H\n\nA **b** and [l](https://e.test) and `c`.\n\n- one\n- two\n";

    expect(html(md, "untrusted").textContent).toBe(
      html(md, "trusted").textContent,
    );
    expect(html(md, "untrusted").querySelector("h1")).toBeTruthy();
    expect(html(md, "untrusted").querySelector("strong")).toBeTruthy();
    expect(html(md, "untrusted").querySelectorAll("li")).toHaveLength(2);
  });
});
