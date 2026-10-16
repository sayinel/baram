// §394 spec 0073 D10 · §11 — the containment a rendered block relies on lives in the SHIPPED
// stylesheet, on elements outside the shadow root. jsdom does no layout, so whether a
// `position: fixed` result actually stays in the box is a manual check (plan 0125 P4, ledger 0095);
// this pins the rules that make it so.
import { describe, expect, it } from "vitest";

import { cssDeclarations, cssRules } from "./css-rules";

const RULES = cssRules().filter((r) =>
  r.file.endsWith("styles/editor/plugin-blocks.css"),
);

function declared(selector: string): Record<string, string> {
  const rule = RULES.find((r) => r.selector === selector);
  if (!rule) throw new Error(`no rule for ${selector} in plugin-blocks.css`);
  return Object.fromEntries(
    cssDeclarations(rule.body).map((d) => [d.prop, d.value]),
  );
}

describe("plugin-blocks.css", () => {
  it("reads the stylesheet (an empty corpus would make the rows below vacuous)", () => {
    expect(RULES.length).toBeGreaterThanOrEqual(4);
  });

  /** What fails this: dropping `paint` from the root (a fixed-position result would cover the
   *  app), or `overflow: hidden`. */
  it("contains paint on the root and on the host", () => {
    expect(declared("[data-plugin-block]")).toMatchObject({
      contain: "layout paint",
      overflow: "hidden",
    });
    expect(declared(".plugin-block-host").contain).toBe("paint");
  });

  /** P16 — source mode lowers the root to layout containment (the host is hidden then), so the
   *  floating language tab of the "paper" style is not clipped. The pair of the row above. */
  it("lowers the root to layout containment in source mode only", () => {
    expect(declared('[data-plugin-block][data-mode="source"]')).toMatchObject({
      contain: "layout",
      overflow: "visible",
    });
  });

  /** No rule here names the code block wrapper: the tables stylesheet's top-level
   *  `.code-block-wrapper` rule would otherwise lower a rendered root to layout containment. */
  it("never styles a rendered root as a code block wrapper", () => {
    expect(RULES.some((r) => r.selector.includes(".code-block-wrapper"))).toBe(
      false,
    );
  });
});
