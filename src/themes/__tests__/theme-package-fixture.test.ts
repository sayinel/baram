// 0091 fix round 1, Finding 3 (MAJOR) — the cross-language contract:
// `themePackageEntries` here and this crate's install path
// (`plugin::build_zip_bytes` → `plugin::archive::extract_zip_bytes` →
// `install::read_staged_theme_manifest`) each read the same fixture rather than
// one side consuming the other's runtime output — the same idiom
// `src-tauri/src/plugin/fixtures/manifest-boundary.json` already uses for the
// plugin-manifest boundary. The Rust half is
// `the_theme_package_fixture_shared_with_the_frontend_installs`
// (`src-tauri/src/plugin/install.rs`).
import type { ThemeDef } from "../../types/theme";
import type { PackageMeta } from "../theme-package-export";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { THEME_COLOR_KEYS, THEME_COLOR_VALUE_RE } from "../../types/theme";
import { themePackageEntries } from "../theme-package-export";

interface Fixture {
  expectedEntryNames: string[];
  expectedManifest: Record<string, unknown>;
  meta: PackageMeta;
  theme: ThemeDef;
}

const fixture = JSON.parse(
  readFileSync(
    join(process.cwd(), "src-tauri/src/plugin/fixtures/theme-package.json"),
    "utf8",
  ),
) as Fixture;

describe("the theme-package fixture shared with the backend", () => {
  it("themePackageEntries(fixture.theme, fixture.meta) produces exactly the checked-in entry names", () => {
    const entries = themePackageEntries(fixture.theme, fixture.meta);
    expect(Object.keys(entries).sort()).toEqual(
      [...fixture.expectedEntryNames].sort(),
    );
  });

  it("themePackageEntries(fixture.theme, fixture.meta) produces exactly the checked-in manifest", () => {
    const entries = themePackageEntries(fixture.theme, fixture.meta);
    const manifest: unknown = JSON.parse(
      new TextDecoder().decode(entries["baram-theme.json"]),
    );
    expect(manifest).toEqual(fixture.expectedManifest);
  });

  it("each mode's tokens.json matches the fixture's own colours exactly", () => {
    const entries = themePackageEntries(fixture.theme, fixture.meta);
    for (const mode of Object.keys(
      fixture.theme.modes,
    ) as (keyof typeof fixture.theme.modes)[]) {
      const decoded: unknown = JSON.parse(
        new TextDecoder().decode(entries[`${mode}/tokens.json`]),
      );
      expect(decoded).toEqual(fixture.theme.modes[mode]?.colors);
    }
  });

  // ‼️ 0091 fix round 2, Finding N3 (re-review) — checks `fixture.theme.modes.*.colors`
  // DIRECTLY, not the output of `themePackageEntries`. Every other test in this file
  // compares that output to a fixture field the output was itself built from, which
  // cannot catch a fixture whose input palette was already wrong: re-review mutation F3
  // deleted a key from `theme.modes.light.colors` and changed another value, and every
  // existing assertion here stayed green (they only pin "the function copies `colors`
  // through unchanged", which is still true of a broken palette). This is the same
  // 24-key / `THEME_COLOR_VALUE_RE` rule `theme-package-export.test.ts` already runs over
  // `defaultColorsForBase`'s output, run here over the fixture's own literal data instead.
  it("the fixture's own palettes are complete THEME_COLOR_KEYS sets with THEME_COLOR_VALUE_RE-shaped values", () => {
    for (const mode of Object.keys(
      fixture.theme.modes,
    ) as (keyof typeof fixture.theme.modes)[]) {
      const colors = fixture.theme.modes[mode]?.colors;
      for (const { key } of THEME_COLOR_KEYS) {
        expect(colors?.[key]).toEqual(expect.any(String));
        expect(THEME_COLOR_VALUE_RE.test(colors?.[key] as string)).toBe(true);
      }
    }
  });
});
