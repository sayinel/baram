// §296 — the shared media-toolbar (image §3.3, SVG §5.1, Mermaid §5.5, video
// §296) used `--color-text-muted` for its icon color. That token is defined
// in every generated stylesheet but is NOT one of the 25 keys a custom theme
// (Nord, Solarized ×2, Tokyo Night, Baram Garden ×2) actually overrides
// (`THEME_COLOR_KEYS`/`ThemeColors`, src/types/theme.ts) — same shape as the
// list-styling bug this file's sibling guards (list-styling.test.ts). This is
// a real, independent legibility defect on its own merits: this app's live
// persisted settings had `activeThemeId: "nord"`; Nord sets
// `--color-bg-default: #2e3440` (theme-set, correctly follows) but not
// `--color-text-muted`, which resolves to the dark-base value `#64748b` —
// contrast 2.62:1 against that background, under the WCAG 3:1 floor for
// graphical/icon content. `--color-text-secondary` IS theme-set and clears
// 5.56:1 on the same pair. (It was NOT, however, what caused the specific
// sliced-looking-button bug report on video — that was `tables.css`'s paint
// containment clipping the toolbar, fixed separately there.)
//
// Scoped to `.media-toolbar`/`.media-toolbar-btn` rather than reusing
// list-styling's list-selector filter, so this guards the shared component
// regardless of which node view's CSS file a future button color lives in.
import { describe, expect, it } from "vitest";

import { THEME_COLOR_KEYS } from "../../types/theme";
import { DERIVED_KEYS } from "../../utils/theme-vars";
import { cssDeclarations, cssRules } from "./css-rules";

function where(rule: { file: string; line: number; selector: string }): string {
  return `${rule.file}:${rule.line} ${rule.selector}`;
}

describe("media-toolbar colors follow the active theme (§296)", () => {
  const THEME_SAFE = new Set<string>([
    ...THEME_COLOR_KEYS.map(({ key }) => key),
    ...DERIVED_KEYS,
  ]);

  const TOOLBAR_RULES = cssRules().filter((rule) =>
    rule.selector.includes(".media-toolbar"),
  );

  it("found the shared media-toolbar rules, so the check below is not vacuous", () => {
    expect(TOOLBAR_RULES.length).toBeGreaterThan(0);
    expect(THEME_SAFE.has("--color-text-muted")).toBe(false);
    expect(THEME_SAFE.has("--color-text-secondary")).toBe(true);
  });

  it("names only tokens every theme overrides", () => {
    const offenders = TOOLBAR_RULES.flatMap((rule) =>
      cssDeclarations(rule.body)
        .filter((declaration) =>
          /(?:^|-)(?:color|background)$/u.test(declaration.prop),
        )
        .flatMap((declaration) =>
          [...declaration.value.matchAll(/var\(\s*(--color-[\w-]+)/gu)]
            .map((match) => match[1])
            .filter((token) => !THEME_SAFE.has(token))
            .map((token) => `${where(rule)} { ${declaration.prop}: ${token} }`),
        ),
    );
    expect(offenders).toEqual([]);
  });
});
