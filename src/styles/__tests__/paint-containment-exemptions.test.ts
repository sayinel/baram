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
// that moves `.media-toolbar` to `bottom: 100%` (the same "leave the frame,
// go above it" technique video uses) names a node view that needs the same
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

/** Every CSS rule that moves `.media-toolbar` to `bottom: 100%` — i.e. fully
 * outside its frame's own box, above it. */
function externalToolbarRules() {
  return cssRules().filter(
    (rule) =>
      rule.selector.includes(".media-toolbar") &&
      cssDeclarations(rule.body).some(
        (d) => d.prop === "bottom" && d.value.trim() === "100%",
      ),
  );
}

/** The node type `name` an extension declares (`name: "video"`), read from
 * source rather than guessed from a class name or file path. */
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
