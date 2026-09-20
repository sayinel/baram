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

// §0054 — the two settings added when the host gained enum fields and a live rebuild.
describe("caretMarker", () => {
  const cursorRules = (value: string) => {
    const built = buildCss({
      ...DEFAULT_SETTINGS,
      caretMarker: value as never,
    });
    // ‼️ `bt-thread-cursor::before`, not `bt-thread-cursor`. The sibling-segment rules name
    // the class too — as `:not(.bt-thread-cursor)`, which is how the thread stops AT the
    // caret rather than running past it. Matching the looser string collected those as well
    // and made `emits no caret rule` unfailable.
    return built
      .split("\n")
      .filter((rule) => rule.includes("bt-thread-cursor::before"))
      .join("\n");
  };

  it("fills the bullet and haloes it by default", () => {
    // The positive case: `none` asserting an absence proves nothing unless the presence
    // is pinned too.
    const rules = cursorRules("halo");
    expect(rules).toContain("background:var(--bt-color)");
    expect(rules).toContain("color-mix(in srgb, var(--bt-color) 25%, transparent)");
  });

  it('keeps the fill but drops the glow at "filled"', () => {
    // ‼️ Not a degraded halo — the fill is what marks the item, the glow is what makes it
    // loud, and this is the state that separates them. Losing the fill here would make
    // `filled` indistinguishable from `none`.
    const rules = cursorRules("filled");
    expect(rules).toContain("background:var(--bt-color)");
    expect(rules).toContain("box-shadow:0 0 0 var(--bt-width) var(--bt-color)");
    expect(rules).not.toContain("color-mix");
    expect(rules).not.toContain("text-shadow");
  });

  it('emits no caret rule at all at "none"', () => {
    // The caret's item then keeps the hollow ring its ancestors have — the thread still
    // ends there, it just is not announced.
    expect(cursorRules("none")).toBe("");
    // …and the ancestors' ring is untouched, so this is a removal and not a breakage.
    expect(buildCss({ ...DEFAULT_SETTINGS, caretMarker: "none" })).toContain(
      "li.bt-thread::before{z-index:1;background:var(--color-editor-bg)",
    );
  });
});

describe("onlyWhenFocused", () => {
  it("scopes every DRAWING rule to the focused editor, and nothing else", () => {
    // ‼️ `ProseMirror-focused` is added by prosemirror-view to `view.dom`, and
    // `@tiptap/core` prepends `tiptap` to that same element — the two classes land
    // together, which is why one prefix is the whole feature. If either library moved its
    // class to a different element this test would still pass and the plugin would break,
    // so the pairing is verified in the host suite against the real editor.
    const scoped = buildCss({ ...DEFAULT_SETTINGS, onlyWhenFocused: true });
    const drawing = scoped
      .split("\n")
      .filter((rule) => rule.includes("bt-thread"));
    expect(drawing.length).toBeGreaterThan(0);
    for (const rule of drawing) {
      expect(rule, rule).toContain(".tiptap.ProseMirror-focused");
    }
  });

  it("leaves the variable block unscoped, so --bt-build stays readable", () => {
    // That property is how a running app says WHICH build it is showing. Gating it on
    // focus would make "the plugin did not reload" and "the editor is not focused"
    // indistinguishable from a console read — the exact confusion it exists to end.
    const scoped = buildCss({ ...DEFAULT_SETTINGS, onlyWhenFocused: true });
    expect(scoped).toContain('.tiptap{--bt-build:');
  });

  it("draws unscoped by default", () => {
    expect(buildCss(DEFAULT_SETTINGS)).not.toContain("ProseMirror-focused");
  });
});

describe("resolveSettings — the fields added in §0054", () => {
  it("refuses a caretMarker outside the declared options", () => {
    // The host resolves against the CURRENT manifest's options, but a plugin is run by
    // whatever Baram the user has — including one that predates the enum type.
    expect(resolveSettings({ caretMarker: "glow" }).caretMarker).toBe("halo");
    expect(resolveSettings({ caretMarker: 3 }).caretMarker).toBe("halo");
    expect(resolveSettings({ caretMarker: "none" }).caretMarker).toBe("none");
  });

  it("refuses a non-boolean onlyWhenFocused", () => {
    expect(resolveSettings({ onlyWhenFocused: "yes" }).onlyWhenFocused).toBe(false);
    expect(resolveSettings({ onlyWhenFocused: true }).onlyWhenFocused).toBe(true);
  });
});
