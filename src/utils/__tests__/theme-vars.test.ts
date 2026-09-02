import type { ThemeColors } from "../../types/theme";

// §54 / #330 — theme variables are applied and cleared through one module so a
// colour and the foreground derived from it can never be written out of step.
import { beforeEach, describe, expect, it } from "vitest";

import { BUILT_IN_THEMES, THEME_COLOR_KEYS } from "../../types/theme";
import { relativeLuminance } from "../color-contrast";
import {
  appliesInlineVars,
  applyThemeVars,
  clearThemeVars,
  DERIVED_KEYS,
} from "../theme-vars";

const NORD = BUILT_IN_THEMES.find((t) => t.id === "nord")!;
const SOLARIZED_LIGHT = BUILT_IN_THEMES.find(
  (t) => t.id === "solarized-light",
)!;

function inlineKeys(root: HTMLElement): string[] {
  return Array.from({ length: root.style.length }, (_, i) =>
    root.style.item(i),
  );
}

describe("THEME_COLOR_KEYS", () => {
  it("covers every ThemeColors key", () => {
    // clearThemeVars derives its removal list from this array. The hand-written
    // list it replaced had drifted to 16 of 25 keys, leaving nine overrides behind
    // on a switch back to a default theme — so the array being complete IS the fix.
    const declared = THEME_COLOR_KEYS.map((entry) => entry.key).sort();
    const actual = (Object.keys(NORD.colors) as (keyof ThemeColors)[]).sort();
    expect(declared).toEqual(actual);
  });

  it("does not offer the derived keys as user-editable colours", () => {
    // Letting a user pick these would let them save a failing pairing.
    for (const key of DERIVED_KEYS) {
      expect(THEME_COLOR_KEYS.map((e) => e.key)).not.toContain(key);
    }
  });
});

describe("appliesInlineVars", () => {
  // Two places used to know which themes carry inline variables: the settings
  // effect (an `isDefault` string comparison plus an early return for `system`)
  // and the theme editor (which knew nothing, so it SET the source colours on
  // cancel and pinned a light palette under an OS dark cascade). One predicate.
  it.each(["system", "default-light", "default-dark"])(
    "reports that %s is governed by the generated cascade",
    (id) => {
      expect(appliesInlineVars(id)).toBe(false);
    },
  );

  it("reports that a shipped non-default theme carries inline variables", () => {
    // Every built-in but the two defaults: their values live in ThemeColors, not
    // in src/styles/generated/.
    for (const theme of BUILT_IN_THEMES) {
      if (theme.id === "default-light" || theme.id === "default-dark") continue;
      expect(appliesInlineVars(theme.id)).toBe(true);
    }
  });

  it("reports that a custom theme carries inline variables", () => {
    expect(appliesInlineVars("custom-1730000000000")).toBe(true);
  });
});

describe("applyThemeVars", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
  });

  it("writes every theme colour", () => {
    applyThemeVars(root, NORD.colors, NORD.base);
    for (const [key, value] of Object.entries(NORD.colors)) {
      expect(root.style.getPropertyValue(key)).toBe(value);
    }
  });

  it("skips keys the stored palette is missing instead of writing 'undefined'", () => {
    // 저장분은 runtime cast라 키가 빠질 수 있다(옛 저장 테마·미래 키 추가).
    // whitelist 순회 도입 직후에는 빠진 키가 setProperty(key, undefined)로
    // 흘러 리터럴 "undefined" custom property가 cascade 기본값을 가렸다
    // (적대 리뷰). 빠진 키는 아예 쓰지 않아야 한다.
    const partial = { ...NORD.colors } as Record<string, string>;
    delete partial["--color-bg-input"];
    applyThemeVars(root, partial as typeof NORD.colors, NORD.base);
    expect(root.style.getPropertyValue("--color-bg-input")).toBe("");
  });

  it("writes the derived accent pairing alongside the colours", () => {
    applyThemeVars(root, NORD.colors, NORD.base);
    // Nord's pale cyan accent takes dark text — white on it is 2.00:1.
    expect(root.style.getPropertyValue("--color-accent-solid")).toBe("#88c0d0");
    expect(root.style.getPropertyValue("--color-accent-on-solid")).toBe(
      "#000000",
    );
    expect(root.style.getPropertyValue("--color-accent-solid-hover")).not.toBe(
      "",
    );
  });

  it("derives from the base it is given, not from the colours alone", () => {
    // Same palette, different base: the light reading steps the fill to the
    // palette's darker blue so white text can stay.
    applyThemeVars(root, SOLARIZED_LIGHT.colors, "light");
    expect(root.style.getPropertyValue("--color-accent-solid")).toBe("#1a6fb5");
    expect(root.style.getPropertyValue("--color-accent-on-solid")).toBe(
      "#ffffff",
    );

    applyThemeVars(root, SOLARIZED_LIGHT.colors, "dark");
    expect(root.style.getPropertyValue("--color-accent-solid")).toBe("#268bd2");
    expect(root.style.getPropertyValue("--color-accent-on-solid")).toBe(
      "#000000",
    );
  });
});

describe("derived status foregrounds", () => {
  it("writes one per status family", () => {
    const root = document.createElement("div");
    applyThemeVars(root, NORD.colors, NORD.base);
    // Nord keeps the default status palette: white on all three fails AA, so all
    // three take dark text.
    for (const family of ["danger", "success", "warning"]) {
      expect(
        root.style.getPropertyValue(`--color-status-${family}-on-solid`),
      ).toBe("#000000");
    }
  });

  it("moves a hover fill away from whichever foreground was derived", () => {
    // The regression this pairs with: the stylesheet used to express this hover as
    // `color-mix(danger 85%, white)`. Solarized's #dc322f clears AA with white by
    // 0.13, so it takes a WHITE foreground — and lightening then moved the fill
    // toward its own text, dropping it to 3.83:1. The direction must be derived.
    const root = document.createElement("div");
    const luminance = (hex: string): number => relativeLuminance(hex)!;

    applyThemeVars(
      root,
      { ...NORD.colors, "--color-status-danger": "#dc322f" },
      NORD.base,
    );
    expect(root.style.getPropertyValue("--color-status-danger-on-solid")).toBe(
      "#ffffff",
    );
    expect(
      luminance(
        root.style.getPropertyValue("--color-status-danger-solid-hover"),
      ),
    ).toBeLessThan(luminance("#dc322f"));

    // …and the opposite case still goes the other way.
    applyThemeVars(
      root,
      { ...NORD.colors, "--color-status-danger": "#ef4444" },
      NORD.base,
    );
    expect(root.style.getPropertyValue("--color-status-danger-on-solid")).toBe(
      "#000000",
    );
    expect(
      luminance(
        root.style.getPropertyValue("--color-status-danger-solid-hover"),
      ),
    ).toBeGreaterThan(luminance("#ef4444"));
  });

  it("follows a user-edited status colour", () => {
    // The point of deriving these: a user who picks a dark red danger should get
    // white text on it, not the black the shipped palette needs.
    const root = document.createElement("div");
    applyThemeVars(
      root,
      { ...NORD.colors, "--color-status-danger": "#5c0f0f" },
      NORD.base,
    );
    expect(root.style.getPropertyValue("--color-status-danger-on-solid")).toBe(
      "#ffffff",
    );
    expect(root.style.getPropertyValue("--color-status-success-on-solid")).toBe(
      "#000000",
    );
  });
});

describe("clearThemeVars", () => {
  it("removes everything applyThemeVars can set", () => {
    const root = document.createElement("div");
    applyThemeVars(root, NORD.colors, NORD.base);
    expect(inlineKeys(root).length).toBeGreaterThan(0);

    clearThemeVars(root);
    expect(inlineKeys(root)).toEqual([]);
  });

  it("leaves no accent override behind when switching to a default theme", () => {
    // The regression this pairing of functions exists to prevent: a stale
    // --color-accent-solid would keep overriding the default theme's cascade.
    const root = document.createElement("div");
    applyThemeVars(root, NORD.colors, NORD.base);
    clearThemeVars(root);
    for (const key of DERIVED_KEYS) {
      expect(root.style.getPropertyValue(key)).toBe("");
    }
    expect(root.style.getPropertyValue("--color-accent-default")).toBe("");
    // A key the old 16-entry list omitted.
    expect(root.style.getPropertyValue("--color-accent-subtle")).toBe("");
    expect(root.style.getPropertyValue("--color-status-danger")).toBe("");
  });
});

// 감사 BLOCKER — 테마 colors의 여분 키가 inline style로 주입되면, import한 JSON
// 한 장이 `display: none` 같은 속성을 <html>에 영구히 박을 수 있다(clearThemeVars는
// 알려진 키만 지운다). applyThemeVars가 최후 방어선으로 whitelist만 쓴다.
describe("applyThemeVars — 여분 키 주입 차단 (감사 BLOCKER)", () => {
  beforeEach(() => {
    clearThemeVars(document.documentElement);
  });

  it("colors에 끼어든 알 수 없는 키는 inline style에 쓰이지 않는다", () => {
    const root = document.documentElement;
    const poisoned = {
      ...NORD.colors,
      display: "none",
      "pointer-events": "none",
      "--evil-custom": "1",
    } as unknown as ThemeColors;

    applyThemeVars(root, poisoned, "dark");

    expect(root.style.getPropertyValue("display")).toBe("");
    expect(root.style.getPropertyValue("pointer-events")).toBe("");
    expect(root.style.getPropertyValue("--evil-custom")).toBe("");
    // 정상 키는 그대로 적용된다.
    expect(root.style.getPropertyValue("--color-accent-default")).not.toBe("");
  });
});
