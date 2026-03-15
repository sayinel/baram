// §54 Theme Editor — color picker editor for customizing themes
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { save } from "@tauri-apps/plugin-dialog";

import type { ThemeColors, ThemeDef } from "../../types/theme";

import { useTranslation } from "../../i18n/useTranslation";
import { writeFile } from "../../ipc/invoke";
import { useSettingsStore } from "../../stores/settings/store";
import {
  BUILT_IN_THEMES,
  findThemeById,
  THEME_COLOR_KEYS,
} from "../../types/theme";

interface ThemeEditorProps {
  onClose: () => void;
}

export function ThemeEditor({ onClose }: ThemeEditorProps) {
  const { t } = useTranslation();
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
  const [base, setBase] = useState<"dark" | "light">(sourceTheme.base);
  const [colors, setColors] = useState<ThemeColors>(() => ({
    ...sourceTheme.colors,
  }));

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
  }, [
    sourceTheme,
    name,
    base,
    colors,
    saveCustomTheme,
    setActiveTheme,
    onClose,
  ]);

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
          className="theme-editor-name"
          onChange={(e) => setName(e.target.value)}
          placeholder={t("settings.theme.namePlaceholder")}
          type="text"
          value={name}
        />
        <div className="theme-editor-base-toggle">
          <button
            className={`theme-editor-base-btn ${base === "light" ? "theme-editor-base-btn-active" : ""}`}
            onClick={() => setBase("light")}
          >
            {t("settings.theme.light")}
          </button>
          <button
            className={`theme-editor-base-btn ${base === "dark" ? "theme-editor-base-btn-active" : ""}`}
            onClick={() => setBase("dark")}
          >
            {t("settings.theme.dark")}
          </button>
        </div>
      </div>

      {Array.from(categories.entries()).map(([category, entries]) => (
        <div key={category}>
          <div className="theme-editor-category">{category}</div>
          {entries.map((entry) => (
            <div className="theme-editor-row" key={entry.key}>
              <span className="theme-editor-label">{entry.label}</span>
              <input
                className="theme-editor-color"
                onChange={(e) => handleColorChange(entry.key, e.target.value)}
                type="color"
                value={colors[entry.key]}
              />
              <span className="theme-editor-hex">{colors[entry.key]}</span>
            </div>
          ))}
        </div>
      ))}

      <div className="theme-editor-actions">
        <button className="theme-action-btn" onClick={handleSave}>
          {t("common.save")}
        </button>
        <button className="theme-action-btn" onClick={handleCancel}>
          {t("common.cancel")}
        </button>
        <button className="theme-action-btn" onClick={handleExport}>
          {t("settings.theme.export")}
        </button>
      </div>
    </div>
  );
}
