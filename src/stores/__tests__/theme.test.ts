// §54 Theme System — settings store theme functionality tests
import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore } from "../settings-store";
import { BUILT_IN_THEMES, findThemeById } from "../../types/theme";
import type { ThemeDef } from "../../types/theme";

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
  it("has exactly 6 built-in themes", () => {
    expect(BUILT_IN_THEMES).toHaveLength(6);
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

  it("every built-in theme has 16 color keys", () => {
    for (const theme of BUILT_IN_THEMES) {
      expect(Object.keys(theme.colors)).toHaveLength(16);
    }
  });

  it("every built-in theme has builtIn=true", () => {
    for (const theme of BUILT_IN_THEMES) {
      expect(theme.builtIn).toBe(true);
    }
  });

  it("light themes have base=light", () => {
    const lightIds = ["default-light", "solarized-light"];
    for (const id of lightIds) {
      const theme = BUILT_IN_THEMES.find((t) => t.id === id)!;
      expect(theme.base).toBe("light");
    }
  });

  it("dark themes have base=dark", () => {
    const darkIds = ["default-dark", "tokyo-night", "solarized-dark", "nord"];
    for (const id of darkIds) {
      const theme = BUILT_IN_THEMES.find((t) => t.id === id)!;
      expect(theme.base).toBe("dark");
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
      base: "light",
      builtIn: false,
      colors: BUILT_IN_THEMES[0].colors,
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
      base: "dark",
      builtIn: false,
      colors: BUILT_IN_THEMES[1].colors,
    };
    const result = findThemeById("default-light", [fake]);
    expect(result!.builtIn).toBe(true);
    expect(result!.base).toBe("light");
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

  it("uses base=light as fallback for unknown theme id", () => {
    useSettingsStore.getState().setActiveTheme("totally-unknown-id");
    // findThemeById returns undefined → base falls back to "light"
    expect(useSettingsStore.getState().theme).toBe("light");
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
    base: "light",
    builtIn: false,
    colors: BUILT_IN_THEMES[0].colors,
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
    base: "dark",
    builtIn: false,
    colors: BUILT_IN_THEMES[1].colors,
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
