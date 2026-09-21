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
});
