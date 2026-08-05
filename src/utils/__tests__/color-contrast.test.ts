// §54 / #330 — the accent pairing must clear WCAG AA for every theme, including
// the ones users invent. These tests pin the maths, the guarantee it rests on, and
// the exact fills the eight built-in themes end up with.
import { describe, expect, it } from "vitest";

import { BUILT_IN_THEMES } from "../../types/theme";
import {
  AA_TEXT_RATIO,
  accentSolidFill,
  contrastRatio,
  onSolidForeground,
  relativeLuminance,
  solidHoverFill,
} from "../color-contrast";

const BLACK = "#000000";
const WHITE = "#ffffff";

/** Every colour with channels on this grid — coarse enough to stay fast. */
function* srgbGrid(step: number): Generator<string> {
  for (let r = 0; r < 256; r += step) {
    for (let g = 0; g < 256; g += step) {
      for (let b = 0; b < 256; b += step) {
        yield `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
      }
    }
  }
}

describe("AA_TEXT_RATIO", () => {
  it("is the WCAG AA threshold", () => {
    // Pinned because the guarantees below are asserted against this constant.
    // Lowering it would otherwise weaken every one of them silently.
    expect(AA_TEXT_RATIO).toBe(4.5);
  });
});

describe("contrastRatio", () => {
  it("matches the WCAG reference ratios", () => {
    expect(contrastRatio(WHITE, BLACK)).toBeCloseTo(21, 2);
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 5);
    // The two ratios #330 was filed over.
    expect(contrastRatio(WHITE, "#3b82f6")).toBeCloseTo(3.68, 2);
    expect(contrastRatio(WHITE, "#60a5fa")).toBeCloseTo(2.54, 2);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#3b82f6", WHITE)).toBe(
      contrastRatio(WHITE, "#3b82f6"),
    );
  });

  it("reads shorthand and mixed-case hex", () => {
    expect(contrastRatio("#FFF", BLACK)).toBeCloseTo(21, 2);
    expect(relativeLuminance("#fff")).toBeCloseTo(1, 5);
  });

  it("reads 4- and 8-digit hex by discarding alpha", () => {
    // `#rrggbbaa` is valid CSS and a common export format. Rejecting it would send
    // a translucent accent down the unparseable path, where the foreground stays
    // white — reintroducing #330 for anyone who imports such a theme.
    expect(relativeLuminance("#b4d15680")).toBe(relativeLuminance("#b4d156"));
    expect(relativeLuminance("#fff8")).toBe(relativeLuminance("#ffffff"));
    expect(onSolidForeground("#b4d15680")).toBe(BLACK);
  });

  it("returns null rather than a wrong number for formats it cannot read", () => {
    expect(contrastRatio("rgb(0, 0, 0)", WHITE)).toBeNull();
    expect(contrastRatio("blue", WHITE)).toBeNull();
    expect(relativeLuminance("#12345")).toBeNull();
    expect(relativeLuminance("")).toBeNull();
  });
});

describe("onSolidForeground", () => {
  it("clears AA against every colour in the sRGB cube", () => {
    // The whole design rests on this: white-or-black is never worse than ~4.58:1,
    // so a user may pick any accent and the derived foreground stays legible.
    let worst = Infinity;
    let worstFill = "";
    for (const fill of srgbGrid(6)) {
      const ratio = contrastRatio(onSolidForeground(fill), fill) ?? 0;
      if (ratio < worst) {
        worst = ratio;
        worstFill = fill;
      }
    }
    expect(worst, `worst fill was ${worstFill}`).toBeGreaterThanOrEqual(
      AA_TEXT_RATIO,
    );
  });

  it("clears AA at the exact crossover colour the grid can step over", () => {
    // Where white and black contrast are equal — the global minimum, ~4.58:1.
    const ratio = contrastRatio(onSolidForeground("#5d60ff"), "#5d60ff") ?? 0;
    expect(ratio).toBeGreaterThanOrEqual(AA_TEXT_RATIO);
    expect(ratio).toBeLessThan(4.7);
  });

  it("keeps white on a dark fill and flips to black on a light one", () => {
    expect(onSolidForeground("#123d96")).toBe(WHITE);
    expect(onSolidForeground("#b4d156")).toBe(BLACK);
  });

  it("keeps the pre-#330 white for a colour it cannot parse", () => {
    expect(onSolidForeground("var(--something)")).toBe(WHITE);
  });
});

describe("accentSolidFill", () => {
  it("never darkens a dark theme's fill", () => {
    // Darkening wins the text ratio but drops the button under the 3:1 non-text
    // floor against the dark page, so dark themes keep the bright accent.
    expect(accentSolidFill("#60a5fa", "#2563eb", "dark")).toBe("#60a5fa");
    expect(accentSolidFill("#88c0d0", "#81a1c1", "dark")).toBe("#88c0d0");
  });

  it("prefers a light theme's own accent-hover when that lets white pass", () => {
    expect(accentSolidFill("#3b82f6", "#2563eb", "light")).toBe("#2563eb");
    expect(accentSolidFill("#268bd2", "#1a6fb5", "light")).toBe("#1a6fb5");
  });

  it("keeps the accent when it already passes", () => {
    expect(accentSolidFill("#123d96", "#0d2d70", "light")).toBe("#123d96");
  });

  it("keeps the accent when the hover would not pass either", () => {
    // Falls through to a black foreground rather than to a fill that still fails.
    expect(accentSolidFill("#f6b26b", "#f8c48f", "light")).toBe("#f6b26b");
    expect(onSolidForeground("#f6b26b")).toBe(BLACK);
  });
});

describe("solidHoverFill", () => {
  it("moves away from the foreground, so contrast can only rise", () => {
    for (const fill of srgbGrid(16)) {
      const fg = onSolidForeground(fill);
      const base = contrastRatio(fg, fill) ?? 0;
      const hover = contrastRatio(fg, solidHoverFill(fill)) ?? 0;
      expect(hover, `fill ${fill} fg ${fg}`).toBeGreaterThanOrEqual(base);
      expect(hover).toBeGreaterThanOrEqual(AA_TEXT_RATIO);
    }
  });

  it("darkens under white text and lightens under black", () => {
    const darkFill = "#2563eb";
    expect(onSolidForeground(darkFill)).toBe(WHITE);
    expect(relativeLuminance(solidHoverFill(darkFill))!).toBeLessThan(
      relativeLuminance(darkFill)!,
    );

    const lightFill = "#60a5fa";
    expect(onSolidForeground(lightFill)).toBe(BLACK);
    expect(relativeLuminance(solidHoverFill(lightFill))!).toBeGreaterThan(
      relativeLuminance(lightFill)!,
    );
  });

  it("returns the fill unchanged when it cannot be parsed", () => {
    expect(solidHoverFill("teal")).toBe("teal");
  });
});

describe("built-in themes", () => {
  it.each(BUILT_IN_THEMES)("$id clears AA on its solid accent", (theme) => {
    const solid = accentSolidFill(
      theme.colors["--color-accent-default"],
      theme.colors["--color-accent-hover"],
      theme.base,
    );
    const fg = onSolidForeground(solid);
    expect(contrastRatio(fg, solid)!).toBeGreaterThanOrEqual(AA_TEXT_RATIO);
    expect(contrastRatio(fg, solidHoverFill(solid))!).toBeGreaterThanOrEqual(
      AA_TEXT_RATIO,
    );
  });

  it.each(BUILT_IN_THEMES)(
    "$id keeps its solid accent visible against the page",
    (theme) => {
      // WCAG 1.4.11: the button's own edge against the page is non-text contrast.
      // This is the check that rules out darkening a dark theme's fill.
      const solid = accentSolidFill(
        theme.colors["--color-accent-default"],
        theme.colors["--color-accent-hover"],
        theme.base,
      );
      expect(
        contrastRatio(solid, theme.colors["--color-bg-default"])!,
      ).toBeGreaterThanOrEqual(3);
    },
  );

  it("derives the pairing the design was approved with", () => {
    const derived = BUILT_IN_THEMES.map((theme) => {
      const solid = accentSolidFill(
        theme.colors["--color-accent-default"],
        theme.colors["--color-accent-hover"],
        theme.base,
      );
      return `${theme.id} ${solid} ${onSolidForeground(solid)}`;
    });
    expect(derived).toEqual([
      `default-light #2563eb ${WHITE}`,
      `default-dark #60a5fa ${BLACK}`,
      `tokyo-night #7aa2f7 ${BLACK}`,
      `solarized-light #1a6fb5 ${WHITE}`,
      `solarized-dark #268bd2 ${BLACK}`,
      `nord #88c0d0 ${BLACK}`,
      `baram-garden-light #123d96 ${WHITE}`,
      `baram-garden-dark #b4d156 ${BLACK}`,
    ]);
  });
});
