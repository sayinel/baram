// §394 spec 0073 D10 · D14 · plan 0126 P6 — a sandboxed panel's containment lives in the SHIPPED
// stylesheet, on the root outside the shadow root. jsdom does no layout, so whether a `position: fixed`
// result stays inside the panel is a manual check (plan 0126 Task 9); this pins the rules that make it
// so.
import { describe, expect, it } from "vitest";

import { cssDeclarations, cssRules } from "./css-rules";

/** The declarations of `selector`'s rule in the stylesheet whose path ends with `file`. */
function declared(file: string, selector: string): Record<string, string> {
  const rule = cssRules().find(
    (r) => r.file.endsWith(file) && r.selector === selector,
  );
  if (!rule) throw new Error(`no rule for ${selector} in ${file}`);
  return Object.fromEntries(
    cssDeclarations(rule.body).map((d) => [d.prop, d.value]),
  );
}

describe("plugin-panels.css", () => {
  /** What fails this: dropping `paint` or `overflow: hidden` from the root — a fixed-position result
   *  would cover the app. */
  it("contains paint on the panel's root", () => {
    expect(
      declared("styles/plugin-panels.css", "[data-plugin-panel]"),
    ).toMatchObject({ contain: "paint", overflow: "hidden" });
  });

  /** The shadow host inside is a code block's `.plugin-block-host` (`createRenderedHost`), contained
   *  again by its own rule — the defence behind the root's. */
  it("keeps the shadow host's own containment", () => {
    expect(
      declared("styles/editor/plugin-blocks.css", ".plugin-block-host").contain,
    ).toBe("paint");
  });

  /** P6 · review I2 — the body scrolls inside the sidebar, vertically only: a panel does not scroll
   *  sideways, and wide content goes in an element of the plugin's own (the rule's comment). What
   *  fails this: `overflow: auto` (the body would scroll sideways). */
  it("scrolls the body vertically only", () => {
    expect(
      declared("styles/plugin-panels.css", ".plugin-panel-body").overflow,
    ).toBe("hidden auto");
  });
});
