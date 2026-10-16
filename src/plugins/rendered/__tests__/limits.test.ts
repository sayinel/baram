// §394 spec 0073 D13 · §6 — the byte caps are UTF-8 and the refusal is a fixed sentence that
// names the cap, both tiers' host check and the sandbox's pre-send check alike.
import { describe, expect, it } from "vitest";

import {
  MAX_RENDERED_CSS_BYTES,
  MAX_RENDERED_HTML_BYTES,
  renderedContentProblem,
  utf8Bytes,
} from "../limits";

describe("renderedContentProblem", () => {
  /** What fails this: measuring `.length` (UTF-16) — 한 is one unit and three bytes. */
  it("counts UTF-8 bytes", () => {
    expect(utf8Bytes("한")).toBe(3);
    const atCap = "한".repeat(Math.floor(MAX_RENDERED_HTML_BYTES / 3));
    expect(renderedContentProblem({ html: atCap })).toBeNull();
    expect(renderedContentProblem({ html: `${atCap}한한` })).toBe(
      `rendered output exceeds ${MAX_RENDERED_HTML_BYTES} bytes of HTML`,
    );
  });

  it("caps CSS separately and refuses a lone surrogate and a wrong shape", () => {
    expect(
      renderedContentProblem({
        css: "a".repeat(MAX_RENDERED_CSS_BYTES + 1),
        html: "",
      }),
    ).toBe(`rendered output exceeds ${MAX_RENDERED_CSS_BYTES} bytes of CSS`);
    expect(renderedContentProblem({ html: "\ud800" })).toBe(
      "rendered output holds a lone surrogate, which Baram's IPC cannot carry",
    );
    expect(renderedContentProblem({ html: 3 })).toBe(
      "a renderer must return { html: string, css?: string }",
    );
    expect(renderedContentProblem({ css: "a{}", html: "<p>x</p>" })).toBeNull();
  });
});
