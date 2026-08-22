// §296 / §perf-large-file C3.1c — `tables.css`'s `.tiptap > * { contain: layout
// paint }` clips anything a top-level block paints outside its own box. Five
// entries there already downgrade specific blocks to `contain: layout` because
// something of theirs overflows: headings' left-overflowing fold arrow,
// code-block-wrapper's above-floating lang tab, mermaid-block's
// below-overflowing dropdown, lists' left-overflowing fold arrow/marker, and
// toggle's left-overflowing fold arrow. Video's hover toolbar
// (`bottom: 100%` in video.css, moved OUTSIDE the frame's top edge on
// purpose — §296 UX2) was the next member of that set and was never added,
// which silently clipped it — the toolbar's own outline stayed visible
// because paint containment clips the OVERFLOW, not the block's own painted
// area, but ~12px of the toolbar's 28px height sat outside that area.
//
// This scans for the general shape rather than hardcoding "video": any rule
// that sets `bottom` on `.media-toolbar` at all (the shared base rule never
// does — see `externalToolbarRules()`) names a node view that needs the same
// exemption, so the next media kind that does this doesn't repeat the bug.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { cssDeclarations, cssRules, selectorParts } from "./css-rules";

const NODES_DIR = "src/extensions/nodes";

/** `contain` value of every `.tiptap > .node-<X>` rule, keyed by `node-<X>`. */
function containByNodeClass(): Map<string, string> {
  const map = new Map<string, string>();
  for (const rule of cssRules()) {
    for (const part of selectorParts(rule.selector)) {
      const match = part.match(/^\.tiptap\s*>\s*\.(node-[\w-]+)$/u);
      if (!match) continue;
      const contain = cssDeclarations(rule.body).find(
        (d) => d.prop === "contain",
      );
      if (contain) map.set(match[1], contain.value.trim());
    }
  }
  return map;
}

/** Every CSS rule that sets `bottom` on `.media-toolbar` at all. The shared
 * base rule (media-block.css) positions with `top: 8px` — it never sets
 * `bottom` — so ANY rule that does is, by construction, moving the toolbar
 * out of its normal top-right corner. Membership is deliberately broad
 * (not narrowed to `=== "100%"`): a narrower filter can be evaded by
 * changing the VALUE (e.g. to `calc(100% + 8px)`) without ever leaving the
 * set, which would make the evasion invisible rather than merely
 * unflagged. The exact value each member sets is asserted separately, by
 * name, in `every out-of-frame toolbar rule sets bottom to exactly 100%`
 * below — that is what catches a `calc()` rewrite, at any set size, rather
 * than relying on a vacuity check that only works while there is exactly
 * one member. */
function externalToolbarRules() {
  return cssRules().filter(
    (rule) =>
      rule.selector.includes(".media-toolbar") &&
      cssDeclarations(rule.body).some((d) => d.prop === "bottom"),
  );
}

/** The node type `name` an extension declares (`name: "video"`), read from
 * source rather than guessed from a class name or file path.
 *
 * The CSS-basename ↔ extension-basename pairing this assumes
 * (`video.css` ↔ `extensions/nodes/video.ts`) is a CONVENTION this file
 * happens to follow, not a repo-wide invariant — it disagrees elsewhere
 * (`mermaid.css` ↔ `mermaid-block.ts`, `code-blocks.css` ↔ `code-block.ts`,
 * and `tables.css` itself covers several node types at once). When the
 * pairing doesn't hold, this returns `null` and the caller reports "could
 * not resolve a node type name" as an offender — failing loudly, which is
 * the right mode for a convention that isn't enforced anywhere else. */
function nodeTypeName(file: string): null | string {
  let source: string;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  return source.match(/\bname:\s*["']([\w-]+)["']/u)?.[1] ?? null;
}

describe("paint containment exempts every out-of-frame media toolbar (§296)", () => {
  const rules = externalToolbarRules();

  it("found at least one out-of-frame toolbar, so the check below is not vacuous", () => {
    expect(rules.length).toBeGreaterThan(0);
  });

  it("every out-of-frame toolbar rule sets bottom to exactly 100%, not calc() or another offset", () => {
    const offenders = rules.flatMap((rule) => {
      const bottom = cssDeclarations(rule.body).find(
        (d) => d.prop === "bottom",
      );
      const value = bottom?.value.trim();
      return value === "100%"
        ? []
        : [
            `${rule.selector} { bottom: ${value ?? "MISSING"} } (${rule.file}:${rule.line})`,
          ];
    });
    expect(offenders).toEqual([]);
  });

  it("has a `.tiptap > .node-<name> { contain: layout }` exemption for each", () => {
    const contains = containByNodeClass();
    const offenders: string[] = [];
    for (const rule of rules) {
      // CSS files under editor/ are named after the extension they style
      // (video.css ↔ extensions/nodes/video.ts) — recover the node TYPE name
      // from the extension source rather than guessing it off a class name,
      // so a rename of either file surfaces as a clear failure here instead
      // of a silently-wrong exemption.
      const base = rule.file.replace(/^.*\//u, "").replace(/\.css$/u, "");
      const extFile = `${NODES_DIR}/${base}.ts`;
      const name = nodeTypeName(extFile);
      if (name === null) {
        offenders.push(
          `${rule.file}:${rule.line} — could not resolve a node type name from ${extFile}`,
        );
        continue;
      }
      const value = contains.get(`node-${name}`);
      if (value !== "layout") {
        offenders.push(
          `.tiptap > .node-${name} { contain: ${value ?? "MISSING"} } (need "layout", from ${rule.file}:${rule.line})`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });
});

// The reachability fix (video.css's `margin-bottom: 0`) depends on a fact
// separate from the containment exemption above, and just as load-bearing:
// with the exemption in place, a nonzero margin-bottom would paint the
// button fully again while leaving it just as unreachable as before — the
// gap sits above the frame's own box, outside the node view's hoverable
// area, matching nothing (and, with the dead backstop rule gone, nothing
// re-acquires it). Generalized over the SAME rule set as the containment
// check above (any `.media-toolbar` rule that sets `bottom` at all) rather
// than hardcoded to video's selector, so the next media kind that uses this
// technique is covered the same way, not just video.
//
// Known, deliberate limit of this guard (a source scan cannot do more):
// `padding` added to an intervening ancestor (`.video-figure`,
// `.video-node-view`, or the `react-renderer.node-video` wrapper
// `tables.css`'s exemption protects) can reopen the same visual/functional
// gap without touching any property on THIS rule at all. It isn't reachable
// by name-matching this rule's own declarations — telling it apart from a
// harmless ancestor change needs the element's RENDERED geometry, which a
// source scan over stylesheet text cannot compute (no different in kind
// from why `media-toolbar-reveal.test.ts` only checks selector membership,
// not paint). This guard (plus the `transform` check below and the `bottom`
// exactness check above) pins the regression vectors this bug actually
// took; it is not a general reachability oracle.
describe("media toolbar reachability: no gap from margin-bottom (§296)", () => {
  const rules = externalToolbarRules();

  // Same shape as the containment describe block's own check above — this
  // one does NOT share that block's assertion (each `it` gets a fresh
  // `describe` closure), so without its own copy this guard would go
  // silently vacuous on the exact `calc()` rewrite mentioned above, saved
  // only by living in the same file as a sibling that happens to still
  // fail. Verified: with `bottom: 100%` rewritten to `calc(100% + 8px)`,
  // this test fails alongside the containment block's identically-named one.
  it("found at least one out-of-frame toolbar, so the check below is not vacuous", () => {
    expect(rules.length).toBeGreaterThan(0);
  });

  it("no out-of-frame `.media-toolbar` rule sets a nonzero margin-bottom, via the longhand or the shorthand", () => {
    const offenders = rules.flatMap((rule) => {
      const declarations = cssDeclarations(rule.body);
      const marginBottom = declarations.find((d) => d.prop === "margin-bottom");
      if (marginBottom) {
        // A non-shorthand property that's simply absent is equivalent to
        // its initial value (0) — only a PRESENT nonzero value is a
        // regression.
        const value = marginBottom.value.trim();
        return value === "0"
          ? []
          : [
              `${rule.selector} { margin-bottom: ${value} } (${rule.file}:${rule.line})`,
            ];
      }
      // The `margin` SHORTHAND is a different declaration name entirely —
      // cssDeclarations() does not expand it, so the longhand check above
      // can't see a shorthand's bottom component at all. Rather than parse
      // the shorthand (1-, 2-, 3-, and 4-value forms all place "bottom"
      // differently, and a shorthand can itself be a var()/calc() this
      // scan can't evaluate), flag its mere PRESENCE on an out-of-frame
      // toolbar rule as an offender outright. Deliberately conservative: a
      // future `margin: 0` here is a false positive that costs one
      // maintainer a comment's worth of confusion; a missed nonzero
      // bottom component is the exact bug this file exists to prevent.
      const marginShorthand = declarations.find((d) => d.prop === "margin");
      return marginShorthand
        ? [
            `${rule.selector} { margin: ${marginShorthand.value.trim()} } — shorthand on an out-of-frame toolbar rule is flagged outright, not parsed (${rule.file}:${rule.line})`,
          ]
        : [];
    });
    expect(offenders).toEqual([]);
  });

  // `transform: translateY(-8px)` shifts the toolbar's painted position by
  // the same 8px a `margin-bottom` gap did, without setting `margin-bottom`
  // (or the shorthand) at all — recreating the identical reachability gap
  // through a property neither check above inspects. Rather than try to
  // compute whether a given transform is "safe" (a translate along any axis
  // can reopen the gap; a scale or rotate might not, depending on origin),
  // forbid `transform` entirely on an out-of-frame toolbar rule.
  it("no out-of-frame `.media-toolbar` rule sets a transform", () => {
    const offenders = rules
      .filter((rule) =>
        cssDeclarations(rule.body).some((d) => d.prop === "transform"),
      )
      .map(
        (rule) => `${rule.selector} sets transform (${rule.file}:${rule.line})`,
      );
    expect(offenders).toEqual([]);
  });
});

// A separate, narrower pin for the specific value the clip fix depends on
// right now. The general exemption-existence test above already requires
// this generically (any offending value fails it); this names the fact
// directly, so a regression to `layout paint` specifically is unambiguous
// rather than reported only as "found an offender".
describe("video toolbar: exact contain value (§296)", () => {
  it("`.tiptap > .node-video` sets contain to exactly `layout`, not `layout paint` — reopening the clip", () => {
    const rule = cssRules().find((r) => r.selector === ".tiptap > .node-video");
    expect(rule).toBeDefined();
    const contain = cssDeclarations(rule!.body).find(
      (d) => d.prop === "contain",
    );
    expect(contain?.value.trim()).toBe("layout");
  });
});
