import { afterEach, describe, expect, it } from "vitest";

// §30 Graph View — graph colour token resolution
import { resolveGraphColors, sameGraphColors } from "../graph-colors";

/** One distinct value per token, so reading the wrong variable cannot pass. */
const TOKEN_VALUES: [string, keyof ReturnType<typeof resolveGraphColors>][] = [
  ["--color-graph-active", "active"],
  ["--color-graph-active-border", "activeBorder"],
  ["--color-graph-cross-vault", "crossVault"],
  ["--color-graph-edge", "edge"],
  ["--color-graph-label", "label"],
  ["--color-graph-neighbor", "neighbor"],
  ["--color-graph-node", "node"],
  ["--color-graph-orphan", "orphan"],
  ["--color-graph-pinned", "pinned"],
  ["--color-graph-tag", "tag"],
];

/** `#010101`, `#020202`, … — unique per token and trivial to read back. */
function testValue(index: number): string {
  const pair = (index + 1).toString(16).padStart(2, "0");
  return `#${pair}${pair}${pair}`;
}

describe("resolveGraphColors", () => {
  afterEach(() => {
    for (const [name] of TOKEN_VALUES) {
      document.documentElement.style.removeProperty(name);
    }
    document.head.querySelectorAll("style[data-test]").forEach((el) => {
      el.remove();
    });
  });

  it("reads each colour from its own token", () => {
    const expected: Record<string, string> = {};
    TOKEN_VALUES.forEach(([name, key], index) => {
      document.documentElement.style.setProperty(name, testValue(index));
      expected[key] = testValue(index);
    });

    expect(resolveGraphColors()).toEqual(expected);
  });

  it("never returns a value that is still a var() reference", () => {
    const style = document.createElement("style");
    style.dataset.test = "chain";
    style.textContent =
      ":root { --color-gray-300: #d1d5db; --color-graph-label: var(--color-gray-300); }";
    document.head.append(style);

    // A browser substitutes the chain before this reads it; jsdom does not, which is what
    // makes this assertion possible at all. Either way the one thing cytoscape must never
    // receive is the unsubstituted reference — it answers that with black.
    const label = resolveGraphColors().label;
    expect(label).not.toContain("var(");
    expect(label).toBe("#374151");
  });

  it("falls back to the light palette when no token is defined", () => {
    expect(resolveGraphColors()).toEqual({
      active: "#3b82f6",
      activeBorder: "#60a5fa",
      crossVault: "#8b5cf6",
      edge: "#9ca3af",
      label: "#374151",
      neighbor: "#8b5cf6",
      node: "#6b7280",
      orphan: "#d1d5db",
      pinned: "#f59e0b",
      tag: "#10b981",
    });
  });

  it("reads the element it is given rather than always the root", () => {
    const panel = document.createElement("div");
    panel.style.setProperty("--color-graph-label", "#abcdef");
    document.body.append(panel);

    expect(resolveGraphColors(panel).label).toBe("#abcdef");
    panel.remove();
  });
});

describe("sameGraphColors", () => {
  it("is true for equal resolutions", () => {
    expect(resolveGraphColors()).toEqual(resolveGraphColors());
    expect(sameGraphColors(resolveGraphColors(), resolveGraphColors())).toBe(
      true,
    );
  });

  it("is false when any single colour differs", () => {
    const base = resolveGraphColors();
    for (const key of Object.keys(base) as (keyof typeof base)[]) {
      expect(sameGraphColors(base, { ...base, [key]: "#123456" })).toBe(false);
    }
  });
});
