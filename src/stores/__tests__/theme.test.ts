import type { ThemeDef, ThemeMode } from "../../types/theme";

// §54 Theme System — settings store theme functionality tests
import { beforeEach, describe, expect, it } from "vitest";

import { solePalette } from "../../types/__tests__/helpers/theme-palette";
import {
  BUILT_IN_THEMES,
  findThemeById,
  THEME_COLOR_KEYS,
  THEME_MODES,
  themeModes,
} from "../../types/theme";
import { useSettingsStore } from "../settings/store";

// Reset store state before each test
beforeEach(() => {
  useSettingsStore.setState({
    activeThemeId: "system",
    theme: "system",
    customThemes: [],
  });
});

// ─── Built-in themes ─────────────────────────────────────────────────────────

describe("Built-in themes", () => {
  it("has exactly 8 built-in themes", () => {
    expect(BUILT_IN_THEMES).toHaveLength(8);
  });

  it("includes default-light and default-dark", () => {
    const ids = BUILT_IN_THEMES.map((t) => t.id);
    expect(ids).toContain("default-light");
    expect(ids).toContain("default-dark");
  });

  it("includes tokyo-night, solarized-light, solarized-dark, nord", () => {
    const ids = BUILT_IN_THEMES.map((t) => t.id);
    expect(ids).toContain("tokyo-night");
    expect(ids).toContain("solarized-light");
    expect(ids).toContain("solarized-dark");
    expect(ids).toContain("nord");
  });

  it("every built-in theme has exactly the THEME_COLOR_KEYS palette", () => {
    // 매직 넘버(25)로 세지 않는다 — line-highlight 슬롯 제거(24키)에서 숫자
    // 핀이 깨졌듯, 계약의 단일 출처는 THEME_COLOR_KEYS다. 개수는 파생으로
    // 따라오고, 키 집합까지 대조해 이름 drift도 함께 잡는다.
    const expected = new Set<string>(THEME_COLOR_KEYS.map((e) => e.key));
    for (const theme of BUILT_IN_THEMES) {
      expect(new Set(Object.keys(solePalette(theme)))).toEqual(expected);
    }
  });

  it("every built-in theme has all required status and graph keys", () => {
    const requiredKeys = [
      "--color-status-danger",
      "--color-status-warning",
      "--color-status-success",
      "--color-accent-subtle",
      "--color-accent-ai",
      "--color-bg-input",
      "--color-graph-node",
      "--color-graph-active",
      "--color-graph-edge",
    ];
    for (const theme of BUILT_IN_THEMES) {
      for (const key of requiredKeys) {
        expect(solePalette(theme)).toHaveProperty(key);
      }
    }
  });

  it("every built-in theme has source=builtin", () => {
    for (const theme of BUILT_IN_THEMES) {
      expect(theme.source).toBe("builtin");
    }
  });

  it("light themes declare the light mode only", () => {
    const lightIds = ["default-light", "solarized-light"];
    for (const id of lightIds) {
      const theme = BUILT_IN_THEMES.find((t) => t.id === id)!;
      expect(themeModes(theme)).toEqual(["light"]);
    }
  });

  it("dark themes declare the dark mode only", () => {
    const darkIds = ["default-dark", "tokyo-night", "solarized-dark", "nord"];
    for (const id of darkIds) {
      const theme = BUILT_IN_THEMES.find((t) => t.id === id)!;
      expect(themeModes(theme)).toEqual(["dark"]);
    }
  });
});

// ─── findThemeById ────────────────────────────────────────────────────────────

describe("findThemeById", () => {
  it("finds a built-in theme by id", () => {
    const theme = findThemeById("default-light", []);
    expect(theme).toBeDefined();
    expect(theme!.name).toBe("Default Light");
  });

  it("finds a custom theme by id", () => {
    const custom: ThemeDef = {
      id: "my-custom",
      name: "My Custom",
      source: "custom",
      modes: { light: { colors: solePalette(BUILT_IN_THEMES[0]) } },
    };
    const theme = findThemeById("my-custom", [custom]);
    expect(theme).toBeDefined();
    expect(theme!.name).toBe("My Custom");
  });

  it("returns undefined for unknown id", () => {
    expect(findThemeById("nonexistent", [])).toBeUndefined();
  });

  it("prefers built-in over custom when ids collide", () => {
    // Built-in takes precedence since BUILT_IN_THEMES is searched first
    const fake: ThemeDef = {
      id: "default-light",
      name: "Fake Light",
      source: "custom",
      modes: { dark: { colors: solePalette(BUILT_IN_THEMES[1]) } },
    };
    const result = findThemeById("default-light", [fake]);
    expect(result!.source).toBe("builtin");
    expect(themeModes(result!)).toEqual(["light"]);
  });
});

// ─── setActiveTheme ───────────────────────────────────────────────────────────

describe("setActiveTheme", () => {
  it("sets activeThemeId", () => {
    useSettingsStore.getState().setActiveTheme("default-light");
    expect(useSettingsStore.getState().activeThemeId).toBe("default-light");
  });

  it("syncs theme field to light for a light theme", () => {
    useSettingsStore.getState().setActiveTheme("default-light");
    expect(useSettingsStore.getState().theme).toBe("light");
  });

  it("syncs theme field to dark for a dark theme", () => {
    useSettingsStore.getState().setActiveTheme("default-dark");
    expect(useSettingsStore.getState().theme).toBe("dark");
  });

  it("sets theme=system when id is system", () => {
    useSettingsStore.getState().setActiveTheme("default-dark");
    useSettingsStore.getState().setActiveTheme("system");
    expect(useSettingsStore.getState().theme).toBe("system");
    expect(useSettingsStore.getState().activeThemeId).toBe("system");
  });

  it("falls back to system for an unknown theme id", () => {
    useSettingsStore.getState().setActiveTheme("totally-unknown-id");
    // §357 이 필드는 파생이다. 해석되지 않는 id 는 use-settings-effects 가
    // data-theme 을 아예 지워 cascade 에 맡기므로 화면은 OS 를 따라간다 —
    // 옛 "light" 는 그 화면과 어긋난 값이었다.
    expect(useSettingsStore.getState().theme).toBe("system");
  });
});

// ─── setTheme (legacy bridge) ─────────────────────────────────────────────────

describe("setTheme (legacy bridge)", () => {
  it("maps light → default-light", () => {
    useSettingsStore.getState().setTheme("light");
    expect(useSettingsStore.getState().activeThemeId).toBe("default-light");
  });

  it("maps dark → default-dark", () => {
    useSettingsStore.getState().setTheme("dark");
    expect(useSettingsStore.getState().activeThemeId).toBe("default-dark");
  });

  it("maps system → system", () => {
    useSettingsStore.getState().setTheme("dark");
    useSettingsStore.getState().setTheme("system");
    expect(useSettingsStore.getState().activeThemeId).toBe("system");
  });
});

// ─── saveCustomTheme ──────────────────────────────────────────────────────────

describe("saveCustomTheme", () => {
  const makeCustom = (id: string, name: string): ThemeDef => ({
    id,
    name,
    source: "custom",
    modes: { light: { colors: solePalette(BUILT_IN_THEMES[0]) } },
  });

  it("adds a new custom theme", () => {
    useSettingsStore.getState().saveCustomTheme(makeCustom("c1", "Custom 1"));
    expect(useSettingsStore.getState().customThemes).toHaveLength(1);
    expect(useSettingsStore.getState().customThemes[0].id).toBe("c1");
  });

  it("updates an existing custom theme (same id)", () => {
    useSettingsStore.getState().saveCustomTheme(makeCustom("c1", "Original"));
    useSettingsStore.getState().saveCustomTheme(makeCustom("c1", "Updated"));
    const themes = useSettingsStore.getState().customThemes;
    expect(themes).toHaveLength(1);
    expect(themes[0].name).toBe("Updated");
  });

  it("preserves other custom themes when updating one", () => {
    useSettingsStore.getState().saveCustomTheme(makeCustom("c1", "First"));
    useSettingsStore.getState().saveCustomTheme(makeCustom("c2", "Second"));
    useSettingsStore
      .getState()
      .saveCustomTheme(makeCustom("c1", "First Updated"));
    const themes = useSettingsStore.getState().customThemes;
    expect(themes).toHaveLength(2);
    expect(themes.find((t) => t.id === "c2")!.name).toBe("Second");
  });
});

// ─── deleteCustomTheme ────────────────────────────────────────────────────────

describe("deleteCustomTheme", () => {
  const custom: ThemeDef = {
    id: "deletable",
    name: "Deletable",
    source: "custom",
    modes: { dark: { colors: solePalette(BUILT_IN_THEMES[1]) } },
  };

  beforeEach(() => {
    useSettingsStore.setState({ customThemes: [custom] });
  });

  it("removes the theme from customThemes", () => {
    useSettingsStore.getState().deleteCustomTheme("deletable");
    expect(useSettingsStore.getState().customThemes).toHaveLength(0);
  });

  it("falls back to system when deleting the active theme", () => {
    useSettingsStore.setState({ activeThemeId: "deletable", theme: "dark" });
    useSettingsStore.getState().deleteCustomTheme("deletable");
    expect(useSettingsStore.getState().activeThemeId).toBe("system");
    expect(useSettingsStore.getState().theme).toBe("system");
  });

  it("does not change activeThemeId when deleting a non-active theme", () => {
    useSettingsStore.setState({
      activeThemeId: "default-light",
      theme: "light",
    });
    useSettingsStore.getState().deleteCustomTheme("deletable");
    expect(useSettingsStore.getState().activeThemeId).toBe("default-light");
  });

  it("is a no-op for a non-existent id", () => {
    useSettingsStore.getState().deleteCustomTheme("does-not-exist");
    expect(useSettingsStore.getState().customThemes).toHaveLength(1);
  });
});

// ─── Migration logic (static) ─────────────────────────────────────────────────

describe("Theme migration v0/v1 → v2 (logic verification)", () => {
  it("maps old theme=light to activeThemeId=default-light", () => {
    // Simulate what migrate() does for version < 2
    const persisted: Record<string, unknown> = { theme: "light" };
    if (!persisted.activeThemeId) {
      if (persisted.theme === "light")
        persisted.activeThemeId = "default-light";
      else if (persisted.theme === "dark")
        persisted.activeThemeId = "default-dark";
      else persisted.activeThemeId = "system";
    }
    if (!persisted.customThemes) persisted.customThemes = [];
    expect(persisted.activeThemeId).toBe("default-light");
    expect(persisted.customThemes).toEqual([]);
  });

  it("maps old theme=dark to activeThemeId=default-dark", () => {
    const persisted: Record<string, unknown> = { theme: "dark" };
    if (!persisted.activeThemeId) {
      persisted.activeThemeId =
        persisted.theme === "dark" ? "default-dark" : "system";
    }
    expect(persisted.activeThemeId).toBe("default-dark");
  });

  it("maps old theme=system to activeThemeId=system", () => {
    const persisted: Record<string, unknown> = { theme: "system" };
    if (!persisted.activeThemeId) {
      if (persisted.theme === "light")
        persisted.activeThemeId = "default-light";
      else if (persisted.theme === "dark")
        persisted.activeThemeId = "default-dark";
      else persisted.activeThemeId = "system";
    }
    expect(persisted.activeThemeId).toBe("system");
  });

  it("preserves existing activeThemeId during migration", () => {
    const persisted: Record<string, unknown> = {
      theme: "light",
      activeThemeId: "tokyo-night",
    };
    if (!persisted.activeThemeId) {
      persisted.activeThemeId = "default-light";
    }
    // Should not overwrite existing value
    expect(persisted.activeThemeId).toBe("tokyo-night");
  });
});

// ‼️ External review #8 — `["light", "dark"]` was written four times: three `MODE_KEYS`
// declarations in `src/themes/` plus the literal inside `themeModes` itself, in the file the
// reviewer named as canonical. `themeModes` could not BE the canonical form — it takes a
// `ThemeDef` and projects one theme's declared modes, while two of the three sites have no
// `ThemeDef` at all. `THEME_MODES` is the universe those three walk.
describe("THEME_MODES (external review #8)", () => {
  it("is the closed universe of modes, light first", () => {
    // Order is observable: `theme-gallery.tsx` draws `themeModes(theme)[0]`, so a paired
    // theme's card shows its light palette. A reversal would be silent everywhere else.
    expect([...THEME_MODES]).toEqual(["light", "dark"]);
  });

  it("is what themeModes filters, so the two cannot disagree", () => {
    // The pin that makes the de-duplication real rather than cosmetic: a theme declaring
    // both modes must project to exactly the shared list.
    const paired: ThemeDef = {
      id: "paired",
      modes: { dark: {}, light: {} },
      name: "Paired",
      source: "custom",
    };
    expect(themeModes(paired)).toEqual([...THEME_MODES]);
  });

  it("covers every mode a ThemeMode can be", () => {
    // Non-vacuity for the two above: if `THEME_MODES` were ever emptied, both would still
    // pass against a `themeModes` that returned nothing.
    const modes: Record<ThemeMode, true> = { dark: true, light: true };
    expect([...THEME_MODES].sort()).toEqual(Object.keys(modes).sort());
  });
});
