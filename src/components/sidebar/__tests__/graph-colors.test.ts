import { afterEach, describe, expect, it, vi } from "vitest";

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
    vi.restoreAllMocks();
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

  it("reads a token chain as the colour it substitutes to", () => {
    const style = document.createElement("style");
    style.dataset.test = "chain";
    style.textContent =
      ":root { --color-gray-300: #d1d5db; --color-graph-label: var(--color-gray-300); }";
    document.head.append(style);

    // The computed value of a custom property arrives with the chain substituted — in a
    // browser, and in jsdom 31.0.0 (30.1.3 returned `var(--color-gray-300)` as written).
    // What fails this: reading the root's inline style instead of its computed style — the
    // chain lives in a stylesheet, so the fallback `#374151` would come back.
    expect(resolveGraphColors().label).toBe("#d1d5db");
  });

  it("never returns a value that is still a var() reference", () => {
    // An environment that hands the reference back unsubstituted — jsdom 30.1.3 did — must
    // get the fallback: cytoscape answers an unparseable colour with black. jsdom 31
    // substitutes, so such an environment is stood in for here. `edge` is the pair: it shows
    // the stand-in is the one being read, so the fallback on `label` is the guard's doing.
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (name: string) =>
        ({
          "--color-graph-edge": "#0a0b0c",
          "--color-graph-label": "var(--color-gray-300)",
        })[name] ?? "",
    } as unknown as CSSStyleDeclaration);

    const colors = resolveGraphColors();
    expect(colors.edge).toBe("#0a0b0c");
    expect(colors.label).toBe("#374151");
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
