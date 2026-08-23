import { act, render } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
// §5.5 Mermaid renders in ONE palette, whatever theme the app is wearing.
//
// User report (2026-08-23): "Mermaid의 다이어그램 색이 테마에 따라 달라지는 것
// 같아. 테마와 상관없이 일관되게 나와야 해."
//
// Mermaid bakes its colours into the SVG it returns, as an inline `<style>`
// block — measured, same flowchart source, mermaid 11.16.1:
//
//   theme "default": text #333,      node #ECECFF, stroke #9370DB
//   theme "dark":    text #ccc/#ddd, node #1f2020
//
// Nothing downstream can restyle that. So a dark-theme user's PDF printed
// near-black nodes and light-grey labels onto a white page, and the same
// diagram looked different depending on which theme happened to be active when
// it last rendered.
//
// ‼️ "Last rendered" is not a figure of speech. The render effect's deps are
// [isVisible, localCode, code, selected] — the theme is not among them — so
// switching theme did not re-render anything. One document could hold a light
// diagram and a dark one at the same time. And `activeThemeId === "system"`
// REMOVES `data-theme` (use-settings-effects.ts), so system-dark rendered
// LIGHT while explicit-dark rendered dark. Following the theme was never
// coherent, which is why the fix is to stop following it rather than to make
// the following reactive.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AA_TEXT_RATIO, contrastRatio } from "../../color-contrast";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
  invoke: vi.fn(async () => undefined),
}));

const initialize = vi.fn();
const renderSvg = vi.fn(async (id: string) => ({
  svg: `<svg id="${id}" viewBox="0 0 100 50"><g></g></svg>`,
}));
vi.mock("mermaid", () => ({
  default: {
    get initialize() {
      return initialize;
    },
    get render() {
      return renderSvg;
    },
  },
}));

import { createBaramExtensions } from "../../../extensions";
import { markdownToProsemirror } from "../../../pipeline";
import { settleHeavyBlocks } from "../../export/export-heavy-blocks";
import {
  MERMAID_PALETTE_TOKENS,
  MERMAID_THEME,
  MERMAID_THEME_VARIABLES,
  renderMermaidRasterSvg,
} from "../mermaid-utils";

const editors: Editor[] = [];

afterEach(() => {
  for (const e of editors) e.destroy();
  editors.length = 0;
  delete document.documentElement.dataset.theme;
  initialize.mockClear();
});

/** `#fff` and `#ffffff` are the same colour; compare them as one. */
function normalizeHex(value: null | string | undefined): string {
  const v = (value ?? "").trim().toLowerCase();
  const m = /^#([0-9a-f]{3})$/.exec(v);
  return m ? `#${[...m[1]].map((c) => c + c).join("")}` : v;
}

/** The theme every `mermaid.initialize` call was given, deduplicated. */
function themesUsed(): string[] {
  return [
    ...new Set(
      initialize.mock.calls.map(
        (c) => (c[0] as undefined | { theme?: string })?.theme ?? "(unset)",
      ),
    ),
  ];
}

/**
 * Resolve a design token from the generated CSS, following `var()` chains into
 * the primitives — the same two files the export inlines.
 */
function tokenResolver(): (name: string) => null | string {
  const read = (file: string) =>
    Object.fromEntries(
      [
        ...readFileSync(file, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g),
      ].map((m) => [m[1], m[2].replace(/\s+/g, " ").trim()]),
    );
  const all = {
    ...read("src/styles/generated/primitives.css"),
    ...read("src/styles/generated/semantic-light.css"),
  };
  const resolve = (name: string, depth = 0): null | string => {
    const v = all[name];
    if (v == null || depth > 8) return null;
    const ref = /^var\(\s*(--[\w-]+)\s*\)$/.exec(v);
    return ref ? resolve(ref[1], depth + 1) : v;
  };
  return resolve;
}

describe("MERMAID_THEME / MERMAID_THEME_VARIABLES", () => {
  it("names one theme and one palette, in one place", () => {
    // The whole point: four render paths (NodeView · PNG copy · PNG download ·
    // Pandoc assets) read the same two constants, so they cannot drift apart.
    expect(MERMAID_THEME).toBe("base");
    expect(Object.keys(MERMAID_THEME_VARIABLES).length).toBeGreaterThan(20);
  });

  it("keeps the surround transparent, so a dark editor gets no white slab", () => {
    // ‼️ The specific complaint that moved this off mermaid's own light theme:
    // an opaque surround paints a white rectangle onto a dark page.
    expect(MERMAID_THEME_VARIABLES.background).toBe("transparent");
    expect(MERMAID_THEME_VARIABLES.clusterBkg).toBe("transparent");
  });

  it("copies Baram's light tokens faithfully", () => {
    // The palette holds literals, because it is handed to a library that cannot
    // read our stylesheet. This re-resolves each one from the generated token
    // CSS — the canonical source — so a token change cannot leave a stale copy
    // behind in silence.
    const resolve = tokenResolver();
    for (const [token, literal] of Object.entries(MERMAID_PALETTE_TOKENS)) {
      expect(`${token}=${normalizeHex(resolve(token))}`).toBe(
        `${token}=${normalizeHex(literal)}`,
      );
    }
  });

  it("puts every copied token to work", () => {
    // Vacuity guard: a token could be declared above, asserted by the check
    // before this one, and used nowhere — which would make the guard describe
    // nothing. Every value must actually appear in the palette.
    const used = new Set(Object.values(MERMAID_THEME_VARIABLES));
    for (const literal of Object.values(MERMAID_PALETTE_TOKENS)) {
      expect(used).toContain(literal);
    }
  });

  it("gives every git branch chip a legible label", () => {
    // ‼️ Mermaid's own default is white text on ALL eight branch colours, and
    // six of them fail AA against it — measured: yellow #dede00 at 1.44:1,
    // cyan #00ecec 1.48, green #00ec76 1.58, lime #9dec00 1.46, magenta
    // #ec00ec 3.63, blue #0076ec 4.37. Only the dark blue and the red pass.
    // The chips are pinned (they are categorical, see below), so the labels
    // have to be paired to them rather than left at one constant.
    for (let i = 0; i <= 7; i++) {
      const chip = MERMAID_THEME_VARIABLES[`git${i}`];
      const label = MERMAID_THEME_VARIABLES[`gitBranchLabel${i}`];
      expect(chip, `git${i} chip`).toBeDefined();
      expect(label, `git${i} label`).toBeDefined();
      const ratio = contrastRatio(label, chip);
      expect(`git${i} ${label} on ${chip} = ${ratio?.toFixed(2)}`).toBe(
        `git${i} ${label} on ${chip} = ${Math.max(ratio ?? 0, AA_TEXT_RATIO).toFixed(2)}`,
      );
    }
  });

  it("states the palette in hex, so our own contrast utilities can read it", () => {
    // ‼️ Not cosmetic. `contrastRatio`/`onSolidForeground` parse hex only and
    // return null / fall back to white for anything else — the check above
    // would pass vacuously on the `hsl()` strings mermaid reports, which is the
    // exact shape these values were pinned from.
    for (const [name, value] of Object.entries(MERMAID_THEME_VARIABLES)) {
      if (!/^(pie\d+|git\d|gitBranchLabel\d)$/.test(name)) continue;
      expect(`${name}=${value}`).toMatch(/=#[0-9a-f]{6}$/);
      expect(contrastRatio(value, "#ffffff")).not.toBeNull();
    }
  });

  it("keeps the qualitative series distinguishable", () => {
    // ‼️ pie/git colours are CATEGORICAL — their job is to differ from each
    // other. Derived from the brand palette they all come out at 16.7%
    // saturation, i.e. twelve identical pale greys, so they are pinned instead.
    // This asserts the property that matters: they are distinct.
    const series = Object.entries(MERMAID_THEME_VARIABLES)
      .filter(([k]) => /^(pie\d+|git\d)$/.test(k))
      .map(([, v]) => v);
    expect(series).toHaveLength(20);
    expect(new Set(series).size).toBe(series.length);
    // …and they are NOT the near-neutral brand tints.
    const brand = new Set(Object.values(MERMAID_PALETTE_TOKENS));
    expect(series.some((c) => brand.has(c))).toBe(false);
  });
});

describe("the PNG / Pandoc raster path", () => {
  it("uses the fixed theme under a dark app theme", async () => {
    document.documentElement.dataset.theme = "dark";
    await renderMermaidRasterSvg("flowchart LR\n A --> B");
    expect(themesUsed()).toEqual([MERMAID_THEME]);
  });

  it("uses the same theme under a light app theme", async () => {
    document.documentElement.dataset.theme = "light";
    await renderMermaidRasterSvg("flowchart LR\n A --> B");
    expect(themesUsed()).toEqual([MERMAID_THEME]);
  });

  it("uses the same theme when no theme is set at all", async () => {
    // ‼️ The `system` case. `data-theme` is absent, which used to mean
    // "default" — so a system-dark user got a LIGHT diagram in a dark editor,
    // while an explicit-dark user got a dark one. Two dark editors, two
    // palettes.
    delete document.documentElement.dataset.theme;
    await renderMermaidRasterSvg("flowchart LR\n A --> B");
    expect(themesUsed()).toEqual([MERMAID_THEME]);
  });
});

describe("the live NodeView path", () => {
  it("uses the fixed theme under a dark app theme", async () => {
    document.documentElement.dataset.theme = "dark";
    const editor = new Editor({
      content: "<p>seed</p>",
      extensions: createBaramExtensions(),
    });
    editors.push(editor);
    render(<EditorContent editor={editor} />);
    act(() => {
      editor.commands.setContent(
        markdownToProsemirror(
          "lead\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\ntrail",
          editor.schema,
        ).toJSON(),
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    // The block is off-screen, so wake it exactly the way an export does.
    //
    // ‼️ OUTSIDE `act`. React holds its commits until an act scope exits, so a
    // wake-then-wait inside one watches a DOM that cannot change and the render
    // effect never runs — the same trap documented in
    // utils/export/__tests__/export-heavy-blocks.test.tsx.
    await settleHeavyBlocks(editor.view.dom);

    // Premise: the diagram really did render, so the theme assertion below is
    // about a call that happened rather than about an absent one.
    expect(renderSvg).toHaveBeenCalled();
    expect(initialize).toHaveBeenCalled();
    expect(themesUsed()).toEqual([MERMAID_THEME]);
  });
});
