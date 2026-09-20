import type { InstalledTheme } from "../theme-install";

// §361 — InstalledTheme → ThemeDef, and the merged lookup `use-settings-effects.ts` and
// `appearance-settings.ts` read a community theme through.
import { describe, expect, it } from "vitest";

import { findThemeById } from "../../types/theme";
import {
  installedThemeDefs,
  installedThemeToDef,
  lookupThemes,
  themeCssCacheKey,
} from "../installed-theme-defs";

function installed(over: Partial<InstalledTheme> = {}): InstalledTheme {
  return {
    checksum: "c".repeat(64),
    id: "dracula",
    installedAt: "2026-09-01T00:00:00.000Z",
    installPath: "/home/.baram/themes/dracula",
    manifest: {
      author: "a",
      description: "d",
      engines: { baram: ">=0.7.0" },
      id: "dracula",
      license: "MIT",
      modes: { dark: { tokens: "dark/tokens.json" } },
      name: "Dracula",
      version: "1.0.0",
    },
    modes: {
      dark: { colors: undefined, css: false },
    },
    ...over,
  };
}

describe("themeCssCacheKey", () => {
  it("combines id and mode uniquely", () => {
    expect(themeCssCacheKey("dracula", "dark")).toBe("dracula:dark");
    expect(themeCssCacheKey("dracula", "light")).not.toBe(
      themeCssCacheKey("dracula", "dark"),
    );
  });
});

describe("installedThemeToDef", () => {
  it("carries source, id and name across", () => {
    const def = installedThemeToDef(installed());
    expect(def.source).toBe("community");
    expect(def.id).toBe("dracula");
    expect(def.name).toBe("Dracula");
  });

  it("only includes modes the record declared", () => {
    const def = installedThemeToDef(installed());
    expect(Object.keys(def.modes)).toEqual(["dark"]);
    expect(def.modes.light).toBeUndefined();
  });

  it("carries colors straight through, no cache needed", () => {
    const colors = { "--color-bg-default": "#000000" } as never;
    const def = installedThemeToDef(
      installed({ modes: { dark: { colors, css: false } } }),
    );
    expect(def.modes.dark?.colors).toBe(colors);
  });

  // ‼️ The core contract this file exists to hold: `css: true` on the record does NOT mean
  // the ThemeDef gets CSS text for free — it means "look it up in the cache I was handed."
  // A mutation that returns the record's OWN (nonexistent) css field here would go undetected
  // by a test that never sets `cssByKey`, so this asserts both directions.
  describe("the css field is cache-only, never invented from the boolean flag", () => {
    it("stays undefined with no cache and no cache entry", () => {
      const def = installedThemeToDef(
        installed({ modes: { dark: { css: true } } }),
      );
      expect(def.modes.dark?.css).toBeUndefined();
    });

    it("stays undefined even with a populated cache, when the mode's flag is false", () => {
      const def = installedThemeToDef(
        installed({ modes: { dark: { css: false } } }),
        { "dracula:dark": "body{color:red}" },
      );
      expect(def.modes.dark?.css).toBeUndefined();
    });

    it("resolves from the cache when the flag is true and the key is present", () => {
      const def = installedThemeToDef(
        installed({ modes: { dark: { css: true } } }),
        {
          "dracula:dark": "body{color:red}",
        },
      );
      expect(def.modes.dark?.css).toBe("body{color:red}");
    });

    it("stays undefined when the flag is true but the cache has not warmed yet", () => {
      const def = installedThemeToDef(
        installed({ modes: { dark: { css: true } } }),
        {},
      );
      expect(def.modes.dark?.css).toBeUndefined();
    });
  });
});

describe("installedThemeDefs", () => {
  it("converts every record, in no particular guaranteed order", () => {
    const defs = installedThemeDefs({
      dracula: installed(),
      solarized: installed({
        id: "solarized",
        manifest: {
          ...installed().manifest,
          id: "solarized",
          name: "Solarized",
        },
      }),
    });
    expect(defs.map((d) => d.id).sort()).toEqual(["dracula", "solarized"]);
  });

  it("returns an empty array for no installed themes", () => {
    expect(installedThemeDefs({})).toEqual([]);
  });
});

describe("lookupThemes", () => {
  it("merges custom and installed themes so findThemeById sees both", () => {
    const custom = installedThemeToDef(installed({ id: "mine" }));
    // 재사용: a "custom"-labelled ThemeDef is fine here — lookupThemes doesn't care about
    // source, only that findThemeById can search the merged array.
    const merged = lookupThemes([{ ...custom, id: "mine", source: "custom" }], {
      dracula: installed(),
    });
    expect(findThemeById("mine", merged)?.source).toBe("custom");
    expect(findThemeById("dracula", merged)?.source).toBe("community");
  });

  it("finds nothing for an id neither side has", () => {
    const merged = lookupThemes([], { dracula: installed() });
    expect(findThemeById("nope", merged)).toBeUndefined();
  });
});
