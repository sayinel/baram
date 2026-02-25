// §54 Theme Editor — color picker editor for customizing themes
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { useSettingsStore } from "../../stores/settings-store";
import { writeFile } from "../../ipc/invoke";
import { findThemeById, BUILT_IN_THEMES, THEME_COLOR_KEYS } from "../../types/theme";
import type { ThemeColors, ThemeDef } from "../../types/theme";

interface ThemeEditorProps {
  onClose: () => void;
}

export function ThemeEditor({ onClose }: ThemeEditorProps) {
  const { activeThemeId, customThemes, saveCustomTheme, setActiveTheme } =
    useSettingsStore();

  // Resolve the starting theme
  const sourceTheme = useMemo(() => {
    if (activeThemeId === "system") {
      return BUILT_IN_THEMES.find((t) => t.id === "default-light")!;
    }
    return findThemeById(activeThemeId, customThemes) ?? BUILT_IN_THEMES[0];
  }, [activeThemeId, customThemes]);

  // Local editing state
  const [name, setName] = useState(() =>
    sourceTheme.builtIn ? `Custom ${sourceTheme.name}` : sourceTheme.name,
  );
  const [base, setBase] = useState<"light" | "dark">(sourceTheme.base);
  const [colors, setColors] = useState<ThemeColors>(() => ({ ...sourceTheme.colors }));

  // Keep a ref to the original colors so we can restore on cancel/unmount
  const originalColorsRef = useRef<ThemeColors>({ ...sourceTheme.colors });

  // Group color keys by category
  const categories = useMemo(() => {
    const map = new Map<string, typeof THEME_COLOR_KEYS>();
    for (const entry of THEME_COLOR_KEYS) {
      const list = map.get(entry.category) ?? [];
      list.push(entry);
      map.set(entry.category, list);
    }
    return map;
  }, []);

  // Apply editing colors to CSS variables in real-time
  useEffect(() => {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(colors)) {
      root.style.setProperty(key, value);
    }
  }, [colors]);

  // Restore original colors on unmount (cancel / navigate away)
  useEffect(() => {
    const orig = originalColorsRef.current;
    return () => {
      const root = document.documentElement;
      for (const [key, value] of Object.entries(orig)) {
        root.style.setProperty(key, value);
      }
    };
  }, []);

  const handleColorChange = useCallback(
    (key: keyof ThemeColors, value: string) => {
      setColors((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const handleSave = useCallback(() => {
    const isCustom = !sourceTheme.builtIn;
    const themeId = isCustom ? sourceTheme.id : `custom-${Date.now()}`;

    const themeDef: ThemeDef = {
      id: themeId,
      name,
      base,
      colors: { ...colors },
      builtIn: false,
    };

    saveCustomTheme(themeDef);
    setActiveTheme(themeId);
    onClose();
  }, [sourceTheme, name, base, colors, saveCustomTheme, setActiveTheme, onClose]);

  const handleCancel = useCallback(() => {
    // Restore original colors before closing
    const root = document.documentElement;
    for (const [key, value] of Object.entries(originalColorsRef.current)) {
      root.style.setProperty(key, value);
    }
    onClose();
  }, [onClose]);

  const handleExport = useCallback(async () => {
    const path = await save({
      filters: [{ name: "JSON", extensions: ["json"] }],
      defaultPath: `${name}.json`,
    });
    if (!path) return;
    const data = JSON.stringify({ name, base, colors }, null, 2);
    await writeFile(path, data);
  }, [name, base, colors]);

  return (
    <div className="theme-editor">
      <div className="theme-editor-header">
        <input
          type="text"
          className="theme-editor-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Theme name..."
        />
        <div className="theme-editor-base-toggle">
          <button
            className={`theme-editor-base-btn ${base === "light" ? "theme-editor-base-btn-active" : ""}`}
            onClick={() => setBase("light")}
          >
            Light
          </button>
          <button
            className={`theme-editor-base-btn ${base === "dark" ? "theme-editor-base-btn-active" : ""}`}
            onClick={() => setBase("dark")}
          >
            Dark
          </button>
        </div>
      </div>

      {Array.from(categories.entries()).map(([category, entries]) => (
        <div key={category}>
          <div className="theme-editor-category">{category}</div>
          {entries.map((entry) => (
            <div key={entry.key} className="theme-editor-row">
              <span className="theme-editor-label">{entry.label}</span>
              <input
                type="color"
                className="theme-editor-color"
                value={colors[entry.key]}
                onChange={(e) => handleColorChange(entry.key, e.target.value)}
              />
              <span className="theme-editor-hex">{colors[entry.key]}</span>
            </div>
          ))}
        </div>
      ))}

      <div className="theme-editor-actions">
        <button className="theme-action-btn" onClick={handleSave}>
          Save
        </button>
        <button className="theme-action-btn" onClick={handleCancel}>
          Cancel
        </button>
        <button className="theme-action-btn" onClick={handleExport}>
          Export
        </button>
      </div>
    </div>
  );
}
