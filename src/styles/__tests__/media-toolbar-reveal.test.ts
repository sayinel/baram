// §5.1 / §3.3 / §5.5 / §296 — media-block.css's `.media-toolbar` reveal rule is
// an ENUMERATED selector list (`.svg-block-preview:hover`, `.image-node-view:hover`,
// …). Video (§296) shipped a NodeView that renders `<MediaToolbar>` without adding
// its wrapper class to that list — the toolbar existed in the DOM, `opacity: 0` and
// `pointer-events: none` forever, and no gate saw it (I1 in the whole-branch review).
//
// This scans real TSX source for every `<NodeViewWrapper className="…">` block that
// renders `<MediaToolbar`, and real CSS for the class tokens the reveal rule actually
// names — rather than hand-listing "the four media node views" here, which is exactly
// the enumeration that let video slip through the first time.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { cssRules, selectorParts, walk } from "./css-rules";

const NODE_VIEWS_DIR = "src/extensions/nodes";

interface ToolbarWrapper {
  classes: string[];
  file: string;
}

/** Class tokens in every CSS selector that reveals `.media-toolbar` (`opacity: 1`). */
function revealedClassTokens(): Set<string> {
  const tokens = new Set<string>();
  for (const rule of cssRules()) {
    if (!rule.selector.includes(".media-toolbar")) continue;
    if (!/opacity\s*:\s*1\b/.test(rule.body)) continue;
    for (const part of selectorParts(rule.selector)) {
      for (const cls of part.match(/\.[\w-]+/g) ?? []) {
        tokens.add(cls.slice(1));
      }
    }
  }
  return tokens;
}

/**
 * Every `<NodeViewWrapper className="…">` open tag in the NodeView sources, paired
 * with whether a `<MediaToolbar` call appears before the NEXT such open tag (or EOF).
 * None of these components nest a second `NodeViewWrapper` inside the first, so that
 * boundary is a safe stand-in for "this wrapper's own render branch" without a full
 * JSX parser.
 */
function toolbarWrapperClassSets(): ToolbarWrapper[] {
  const found: ToolbarWrapper[] = [];
  for (const file of walk(NODE_VIEWS_DIR, ".tsx")) {
    const source = readFileSync(file, "utf8");
    const opens: { classes: string[]; index: number }[] = [];
    for (const match of source.matchAll(
      /<NodeViewWrapper\s+className="([^"]+)"/g,
    )) {
      opens.push({ classes: match[1].split(/\s+/), index: match.index });
    }
    opens.forEach((open, i) => {
      const end = opens[i + 1]?.index ?? source.length;
      if (source.slice(open.index, end).includes("<MediaToolbar")) {
        found.push({ file, classes: open.classes });
      }
    });
  }
  return found;
}

describe("media-toolbar reveal selectors cover every NodeView that renders it (§5.1 I1)", () => {
  const wrappers = toolbarWrapperClassSets();
  const revealed = revealedClassTokens();

  it("scanned more than one NodeView, so the check is not vacuous", () => {
    // image, video, svg (preview branch), mermaid (preview branch) — at least 4.
    expect(wrappers.length).toBeGreaterThanOrEqual(4);
    expect(revealed.size).toBeGreaterThan(0);
  });

  it("every wrapper that renders MediaToolbar has a class in the reveal rule", () => {
    const offenders = wrappers
      .filter((w) => !w.classes.some((cls) => revealed.has(cls)))
      .map((w) => `${w.file}: .${w.classes.join(".")}`);
    expect(offenders).toEqual([]);
  });
});
