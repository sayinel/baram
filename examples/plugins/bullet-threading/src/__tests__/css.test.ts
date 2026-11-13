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
      ".tiptap ol > li.bt-thread::before{z-index:2;background:var(--color-editor-bg);padding-left:",
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
      ".tiptap ul > li.bt-thread::before{z-index:2;background:var(--color-editor-bg)",
    );
  });

  describe("the stretch from a parent's marker down to its first child", () => {
    // The rule whose selector list contains `fragment`, through its closing brace.
    const ruleWith = (fragment: string) => {
      const from = css.indexOf(fragment);
      expect(from, fragment).toBeGreaterThan(-1);
      return css.slice(from, css.indexOf("}", from) + 1);
    };
    // Which paragraphs these match against a real editor's DOM is pinned on the host side
    // (`bullet-threading-example.test.ts`), where the editor exists.
    const above = ":has(~ :is(ul, ol) > li.bt-thread)";
    const parent = "li.bt-thread:not(.bt-thread-cursor) > ";
    const taskParent = `li[data-type="taskItem"].bt-thread:not(.bt-thread-cursor) > div > `;
    const blocks = ":is(p, .node-image)";
    const plain = `${parent}${blocks}${above}`;
    const task = `${taskParent}${blocks}${above}`;

    it("is drawn by the parent's own paragraphs, so it is as long as they wrap", () => {
      // That length is the paragraphs' height, which CSS gives to the paragraphs and to
      // nobody else. It used to be the first child climbing a constant half line-box —
      // right for a parent of one line only; under one that wrapped, the thread started a
      // whole line-box short of the marker per extra line. `top:0;bottom:0` on a box the
      // paragraph contains (the next test) is what makes the stroke its height.
      for (const shape of [plain, task]) {
        const rule = ruleWith(`${shape}::after`);
        expect(rule).toContain("position:absolute;");
        expect(rule).toContain("top:0;bottom:0;");
        expect(rule).toContain("border-left:var(--bt-width) solid var(--bt-color)");
        expect(rule).toContain("margin-left:calc(var(--bt-width) / -2)");
        // Without `content` the pseudo-element does not exist and nothing is drawn; without
        // `pointer-events` the stroke takes the clicks aimed at the gutter beside the text.
        expect(rule).toContain('content:""');
        expect(rule).toContain("pointer-events:none;");
      }
    });

    it("makes the paragraph the stroke's containing block", () => {
      // Without it the containing block is the ITEM, and `bottom:0` runs the stroke to the
      // end of the sub-list — past the caret, through every sibling below it.
      expect(ruleWith(`${plain},`)).toContain("{position:relative}");
    });

    it("paints above the host's guide and below the markers", () => {
      // The host hangs an item's own guide beside its text and images, as the sub-list's
      // `::before` — later in the tree than these blocks, so at the same z-index its
      // narrower opaque line covered the middle of the stroke (seen in the app). The
      // stroke starts under the parent's marker, so the marker has to stay above it.
      // The child items' strokes too: an item's SECOND sub-list hangs its guide from the
      // item as well, after them in the tree. The task checkbox is a marker like the ring.
      const zOf = (fragment: string) =>
        /z-index:(\d+)/u.exec(ruleWith(fragment))?.[1];
      expect(zOf(`${plain}::after`)).toBe("1");
      expect(zOf(".tiptap li li.bt-thread::after{")).toBe("1");
      expect(
        zOf(`${parent}:is(ul, ol) > li:not(.bt-thread)::after`),
      ).toBe("1");
      expect(zOf(".tiptap ul > li.bt-thread::before")).toBe("2");
      expect(zOf(".tiptap ol > li.bt-thread::before")).toBe("2");
      expect(
        zOf('.tiptap li[data-type="taskItem"].bt-thread > .task-checkbox'),
      ).toBe("2");
    });

    it("starts the first block's stroke at the marker's centre", () => {
      // Half a line-box down — the expression the markers centre themselves with. `top:0`
      // would start it at the item's top edge, above the bullet. The first BLOCK, not the
      // first paragraph: in `- ![](a.png)` the image is first, and `p:first-of-type` would
      // start a paragraph below it half a line down, leaving a gap above.
      const first = ":is(:first-child, .fold-arrow:first-child + *)";
      for (const shape of [parent, taskParent]) {
        expect(
          ruleWith(`${shape}${blocks}${first}${above}::after`),
        ).toContain("{top:calc(var(--editor-line-height, 1.75) * 0.5em)}");
      }
      expect(css).not.toContain(":first-of-type");
    });

    it("stretches an image's stroke across the margins nothing else draws", () => {
      // The image's margin is outside the box its stroke spans, so with `top:0;bottom:0`
      // the thread broke above and below every image between the text and the sub-list.
      // Above, the block is a paragraph (no margin) or an image (whose margin collapses
      // into this one), so the image climbs all of it. Below, what follows decides: a
      // paragraph climbs nothing, the first child climbs `--bt-gap`, another image climbs
      // its own margin — so the image reaches down all of it, the rest of it, or none.
      for (const shape of [parent, taskParent]) {
        expect(ruleWith(`${shape}.node-image${above}::after`)).toContain(
          "{top:calc(-1 * var(--bt-image-gap))}",
        );
        expect(
          ruleWith(`${shape}.node-image:has(+ p)${above}::after`),
        ).toContain("{bottom:calc(-1 * var(--bt-image-gap))}");
        expect(
          ruleWith(
            `${shape}.node-image:has(+ :is(ul, ol) > li.bt-thread)${above}::after`,
          ),
        ).toContain("{bottom:calc(var(--bt-gap) - var(--bt-image-gap))}");
      }
      // ...and nothing reaches down into a following image, which climbs on its own.
      expect(css).not.toContain(".node-image:has(+ .node-image)");
      expect(css).toContain("--bt-image-gap:0.5em;");
    });

    // An item whose last (first) block is an image, directly or in a task item's div.
    const imageAt = (position: string) =>
      `:is(:has(> .node-image${position}), [data-type="taskItem"]:has(> div > .node-image${position}))`;
    const firstBlock = ":is(:first-child, .fold-arrow:first-child + *)";

    it("closes the seam below a sibling whose last block is an image", () => {
      // That image's margin collapses through the sibling's bottom edge, so the next item
      // starts `--bt-image-gap` below it, not `--bt-gap`. The sibling reaches down the
      // difference — to exactly where the next item's climb begins.
      expect(
        ruleWith(
          `${parent}:is(ul, ol) > li:not(.bt-thread)${imageAt(":last-child")}::after`,
        ),
      ).toContain("{bottom:calc(var(--bt-gap) - var(--bt-image-gap))}");
    });

    it("climbs the image's margin above an item whose first block is an image", () => {
      // The mirror seam: the image's top margin collapses through the item's top edge. The
      // elbow is one box from there to the marker, so its height grows with its top.
      expect(
        ruleWith(
          `${parent}:is(ul, ol) > li:not(.bt-thread)${imageAt(firstBlock)}::after`,
        ),
      ).toContain("{top:calc(-1 * var(--bt-image-gap))}");
      expect(
        ruleWith(`.tiptap li li.bt-thread${imageAt(firstBlock)}::after`),
      ).toContain(
        "{top:calc(-1 * var(--bt-image-gap));height:calc(var(--bt-image-gap) + var(--editor-line-height, 1.75) * 0.5em + var(--bt-width) / 2)}",
      );
    });

    it("leaves no child reaching up further than the gap above it", () => {
      // The defect's own shape: an offset on the first child, which cannot see how tall the
      // parent's text is. Every child's stroke climbs exactly the collapsed margin to the
      // item above, and no further — the paragraph above draws the rest. That margin is
      // `--bt-gap`, or `--bt-image-gap` above an item whose first block is an image.
      //
      // Selectors are split on the separator `buildCss` joins them with, not on every
      // comma: `:is(…, …)` carries commas inside one selector, and a scan that refused to
      // cross a comma silently skipped exactly the image rules.
      const childRules = [...css.matchAll(/([^{}]*)\{([^}]*)\}/gu)]
        .map(([, group, body]) => ({
          body,
          selectors: group.trim().split(",\n"),
        }))
        .filter(({ selectors }) =>
          selectors.every((s) => /\bli\b.*::after$/u.test(s)),
        )
        // ...minus the parent's own blocks, which are not children: the block follows
        // the threaded item (or its task div) directly.
        .filter(
          ({ selectors }) =>
            !selectors.some((s) =>
              /\.bt-thread:not\(\.bt-thread-cursor\) > (?:div > )?(?:p:|\.node-image|:is\(p, \.node-image\))/u.test(
                s,
              ),
            ),
        );
      const tops = childRules.flatMap(({ body, selectors }) =>
        [...body.matchAll(/(?:^|[{;])top:([^;}]+)/gu)].map((m) => ({
          firstImage: selectors.every((s) => s.includes(imageAt(firstBlock))),
          top: m[1],
        })),
      );
      // Not vacuous: the elbow and the sibling segment, each plain and image-first.
      expect(tops).toHaveLength(4);
      for (const { firstImage, top } of tops) {
        expect(top).toBe(
          firstImage
            ? "calc(-1 * var(--bt-image-gap))"
            : "calc(-1 * var(--bt-gap))",
        );
      }
      expect(tops.filter((t) => t.firstImage)).toHaveLength(2);
      expect(css).not.toContain(":first-child::after");
    });

    it("names the task item's content div, and no other div", () => {
      // A plain item can hold a block that is a `div` with paragraphs directly inside it (a
      // toggle, indented 1.4em), so a rail placed from those would miss the marker.
      expect(css).toContain(`${task}::after`);
      expect(css).not.toContain(
        "li.bt-thread:not(.bt-thread-cursor) > div > p",
      );
    });
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

  it("traces the rail the host hangs, falling back to where older hosts hang it", () => {
    // The host's guide used to sit at a constant 1em left of a nested list, which is the
    // centre of a bullet's column but not of a number's — so the host now derives it from
    // the parent's marker and publishes the result as `--list-guide-left`. A thread that
    // restates the old constant runs beside the guide under a numbered parent whenever
    // numbers line up on their first digit, which is the host's default alignment.
    //
    // The -1em fallback is what a host without the variable draws, so the thread still
    // traces the guide there. The elbow's far end stays on the child's marker column
    // (0.5em in from the item), so its width has to grow by whatever the rail moved.
    const railX = "calc(var(--list-guide-left, -1em) - var(--list-gutter, 1.4em))";
    expect(css.split("\n").filter((rule) => rule.includes(`left:${railX}`))).toHaveLength(2);
    expect(css).not.toContain("+ 1em))");
    expect(css).toContain(
      "width:calc(var(--list-gutter, 1.4em) - 0.5em - var(--list-guide-left, -1em))",
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
      "li.bt-thread::before{z-index:2;background:var(--color-editor-bg)",
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
