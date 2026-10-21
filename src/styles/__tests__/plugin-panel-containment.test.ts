// §394 spec 0073 D10 · D14 · plan 0126 P6 — a sandboxed panel's containment lives in the SHIPPED
// stylesheets, on two elements outside the shadow root: the shadow host first, the panel's root second
// (the header of plugin-panels.css). jsdom does no layout, so whether a `position: fixed` result stays
// inside the panel is a manual check (plan 0126 Task 9); this pins the rules that make it so. The last
// rule is the activity-bar icon's clip (panels.css): the icon is the author's text, drawn outside the
// panel.
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
  /** The second barrier: the root holds the host-drawn header and error line, and would hold the
   *  plugin's output only if the host's rule were lost. What fails this: dropping `paint` or
   *  `overflow: hidden` from the root's rule. */
  it("contains paint on the panel's root", () => {
    expect(
      declared("styles/plugin-panels.css", "[data-plugin-panel]"),
    ).toMatchObject({ contain: "paint", overflow: "hidden" });
  });

  /** The first barrier: the shadow host is a code block's `.plugin-block-host` (`createRenderedHost`),
   *  the first element above the plugin's output in the flat tree, so its own rule's paint
   *  containment clips everything that output paints, fixed and absolutely positioned elements
   *  included. What fails this: dropping `paint` from that rule. */
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

describe("panels.css", () => {
  /** An icon is one grapheme of up to `MAX_PANEL_ICON_CHARS` UTF-16 units, and a base letter under
   *  fifteen combining marks is one. The button does not clip (its active marker sits outside it), so
   *  the icon's span fills the button and clips there. What fails this: dropping `overflow: hidden`
   *  (the stacked ink would paint over the neighbouring buttons), or a span sized to its glyph (the
   *  clip box would be the glyph's line, not the button). */
  it("clips a panel's activity-bar icon at its button", () => {
    expect(
      declared("styles/panels.css", ".activity-bar-plugin-icon"),
    ).toMatchObject({ height: "100%", overflow: "hidden", width: "100%" });
  });
});
