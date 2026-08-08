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
import {
  appliesInlineVars,
  applyThemeVars,
  clearThemeVars,
} from "../../utils/theme-vars";

interface ThemeEditorProps {
  onClose: () => void;
}

export function ThemeEditor({ onClose }: ThemeEditorProps) {
  const { t } = useTranslation();
  const { activeThemeId, customThemes, saveCustomTheme, setActiveTheme } =
    useSettingsStore();

  // The active theme, when it has colours of its own. `system` has none by design,
  // and an id that resolves to nothing means the settings effect cleared the
  // variables too — both editing sessions start from the default-light palette.
  const resolvedTheme = useMemo(
    () =>
      activeThemeId === "system"
        ? undefined
        : findThemeById(activeThemeId, customThemes),
    [activeThemeId, customThemes],
  );

  // Resolve the starting theme
  const sourceTheme = useMemo(
    () =>
      resolvedTheme ?? BUILT_IN_THEMES.find((t) => t.id === "default-light")!,
    [resolvedTheme],
  );

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

  // The base the original colors belong to — the derived accent pairing depends on
  // it, so restoring colours without it would restore the wrong foreground (#330).
  const originalBaseRef = useRef<"dark" | "light">(sourceTheme.base);

  // Set once the edited colours have been adopted as a real theme, so the unmount
  // cleanup knows there is no preview left to undo. Without it, correctness depends
  // on the cleanup running BEFORE the settings effect re-applies the saved theme —
  // true only while save + close land in one commit (React flushes passive destroys
  // before creates), and silently false the moment the close is deferred.
  const savedRef = useRef(false);

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
    applyThemeVars(document.documentElement, colors, base);
  }, [colors, base]);

  // Restore original colors on unmount (cancel / navigate away)
  useEffect(() => {
    const orig = originalColorsRef.current;
    const origBase = originalBaseRef.current;
    // Aliased so the cleanup reads the ref through a stable local (lint rule), not
    // a value captured at effect time — `saved` must be read AT cleanup.
    const saved = savedRef;
    return () => {
      if (saved.current) return;
      restorePreview(orig, origBase);
    };
  }, []);

  const handleColorChange = useCallback(
    (key: keyof ThemeColors, value: string) => {
      setColors((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const handleSave = useCallback(() => {
    // From here the settings effect owns the DOM: these colours are a real theme.
    savedRef.current = true;
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
    restorePreview(originalColorsRef.current, originalBaseRef.current);
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

/**
 * Undo the live preview the way the settings effect would have applied the theme.
 *
 * Cascade-only themes (`system`, the two defaults) and an `activeThemeId` that
 * resolves to nothing carry NO inline variables, so restoring them by SETTING the
 * source colours pins a palette that then outranks `prefers-color-scheme` — and the
 * settings effect cannot undo it, since it depends on [activeThemeId, customThemes]
 * and leaving the editor changes neither.
 *
 * Reads the active theme at call time rather than taking a snapshot when the editor
 * opens: a snapshot would restore the PREVIOUS theme's colours over the current one
 * if a theme switch ever became reachable while the editor is open (today the picker
 * is unmounted while editing, so the two agree) — the same defect class this fixes.
 */
function restorePreview(colors: ThemeColors, base: "dark" | "light"): void {
  const root = document.documentElement;
  const { activeThemeId, customThemes } = useSettingsStore.getState();
  const hasInlineVars =
    findThemeById(activeThemeId, customThemes) !== undefined &&
    appliesInlineVars(activeThemeId);
  if (hasInlineVars) {
    applyThemeVars(root, colors, base);
  } else {
    clearThemeVars(root);
  }
}
