// The stylesheet cannot be judged for looks here, so these pin the things that would
// break it SILENTLY — an order dependency and two derived lengths. Each says what
// production change reddens it.
import { describe, expect, it } from "vitest";

import { buildCss, DEFAULT_SETTINGS, resolveSettings } from "../css";

const css = buildCss(DEFAULT_SETTINGS);

describe("buildCss", () => {
  it("puts the caret rule after the thread rule, which is what makes it win", () => {
    // Both are `.tiptap ul > li.<class>::before` — equal specificity, so the cascade
    // decides on source order alone. Swap the two and the caret's bullet silently
    // renders as an ordinary ring: nothing errors and nothing else changes.
    const thread = css.indexOf(".tiptap ul > li.bt-thread::before");
    const cursor = css.indexOf(".tiptap ul > li.bt-thread-cursor::before");
    expect(thread).toBeGreaterThan(-1);
    expect(cursor).toBeGreaterThan(thread);
  });

  it("clears an ordered marker by masking, never by a computed length", () => {
    // The gap behind a number has to be the same for `a.` and for `iii.`, and CSS
    // cannot measure a glyph — any `width` on the elbow leaves a gap of "gutter minus
    // glyph", which varies because lists.css floors the gutter at 1.4em. Painting the
    // marker over the stroke is what makes the distance constant, so a reappearance of
    // a length here is the regression to catch.
    expect(css).toContain(
      ".tiptap ol > li.bt-thread::before{z-index:1;background:var(--color-editor-bg);padding-left:",
    );
    expect(css).not.toMatch(/ol > li\.bt-thread::after\{width:/);
  });

  it("gives the caret's number a glow rather than a box", () => {
    // `box-shadow` on a text marker outlines its rectangular box, which reads as a form
    // field; the bullet's halo is round because the bullet is. `text-shadow` follows the
    // glyph, so the two markers get the same gesture.
    const ordered = css.slice(css.indexOf(".tiptap ol > li.bt-thread-cursor::before"));
    const rule = ordered.slice(0, ordered.indexOf("}") + 1);
    expect(rule).toContain("text-shadow");
    expect(rule).toContain("font-weight:700");
    expect(rule).not.toContain("outline");
    expect(rule).not.toContain("box-shadow");
  });

  it("fills the ring's centre with the editor background, not a colour of its own", () => {
    // This is what masks the stroke running underneath, so the line reads as ending in
    // the ring rather than crossing it. A literal colour here would be right in one
    // theme and a visible blob in the other.
    expect(css).toContain(
      ".tiptap ul > li.bt-thread::before{z-index:1;background:var(--color-editor-bg)",
    );
  });

  it("climbs exactly half a line-box to reach the parent's marker", () => {
    // Derived, not tuned: `li p` has no margin in lists.css, so a child list's top edge
    // IS the parent's first line-box bottom, and the marker is centred half a line-box
    // above it. If lists.css ever gives `li p` a margin, this is the line to revisit —
    // the thread would start below the bullet again.
    expect(css).toContain(
      "top:calc(-1 * (var(--bt-gap) + var(--editor-line-height, 1.75) * 0.5em))",
    );
    // ...and the threaded first child's elbow grows by what it moved up, so its bottom
    // stays on the item's first line rather than sliding above it.
    expect(css).toContain(
      "height:calc(var(--bt-gap) + var(--editor-line-height, 1.75) * 1em + var(--bt-width) / 2)",
    );
  });

  it("centres both strokes on the axis they share with the editor's own guide", () => {
    // A border grows INWARD from the box edge, so a box sized to the guide's axis puts
    // the stroke half a width off it — vertically the guide peeked out alongside the
    // thread, horizontally the elbow met the bullet above its centre. Same error, both
    // directions, and neither is visible in a screenshot until someone looks closely.
    expect(css).toContain("margin-left:calc(var(--bt-width) / -2)");
    expect(css).toContain(
      "height:calc(var(--bt-gap) + var(--editor-line-height, 1.75) * 0.5em + var(--bt-width) / 2)",
    );
  });

  it("drops the curve but keeps the drop when showElbow is off", () => {
    const straight = buildCss({ ...DEFAULT_SETTINGS, showElbow: false });
    expect(straight).not.toContain("border-bottom-left-radius");
    expect(straight).toContain("border-left:var(--bt-width)");
  });
});

describe("resolveSettings", () => {
  it("passes a token through — pointing the thread at a theme colour is the point", () => {
    expect(resolveSettings({ color: "var(--color-accent-emphasis)" }).color).toBe(
      "var(--color-accent-emphasis)",
    );
  });

  it("refuses a colour that could close the declaration and open a rule", () => {
    for (const hostile of [
      "red;}.tiptap{display:none",
      "red/**/;x:y",
      "@import url(x)",
      "rgb(0,0,0):hover",
    ]) {
      expect(resolveSettings({ color: hostile }).color).toBe(DEFAULT_SETTINGS.color);
    }
  });

  it("clamps a width outside the usable range instead of trusting the type", () => {
    expect(resolveSettings({ lineWidth: 0 }).lineWidth).toBe(DEFAULT_SETTINGS.lineWidth);
    expect(resolveSettings({ lineWidth: 99 }).lineWidth).toBe(DEFAULT_SETTINGS.lineWidth);
    expect(resolveSettings({ lineWidth: 3 }).lineWidth).toBe(3);
  });
});
