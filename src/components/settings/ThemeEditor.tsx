// §54 Theme Editor — color picker editor for customizing themes
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { save } from "@tauri-apps/plugin-dialog";

import type {
  ThemeColorKey,
  ThemeColors,
  ThemeDef,
  ThemeMode,
} from "../../types/theme";

import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../i18n/useTranslation";
import { writeFile } from "../../ipc/invoke";
import { useSettingsStore } from "../../stores/settings/store";
import {
  BUILT_IN_THEMES,
  defaultColorsForBase,
  findThemeById,
  resolveThemeMode,
  THEME_COLOR_KEYS,
  themeModes,
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
    useSettingsStore(
      useShallow((s) => ({
        activeThemeId: s.activeThemeId,
        customThemes: s.customThemes,
        saveCustomTheme: s.saveCustomTheme,
        setActiveTheme: s.setActiveTheme,
      })),
    );

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

  // Local editing state. 편집을 시작할 모드는 출발 테마가 선언한 첫 모드다 —
  // 모드가 없거나 토큰 없이 CSS만 싣는 테마(§358)는 보여줄 색이 없으므로 그
  // 모드의 기본 팔레트에서 출발한다.
  const startMode = themeModes(sourceTheme)[0] ?? "light";
  const [name, setName] = useState(() =>
    sourceTheme.source === "builtin"
      ? `Custom ${sourceTheme.name}`
      : sourceTheme.name,
  );
  const [base, setBase] = useState<ThemeMode>(startMode);
  const [colors, setColors] = useState<ThemeColors>(() => ({
    ...(sourceTheme.modes[startMode]?.colors ??
      defaultColorsForBase(startMode)),
  }));

  // Set once the edited colours have been adopted as a real theme, so the unmount
  // cleanup knows there is no preview left to undo. Without it, correctness depends
  // on the cleanup running BEFORE the settings effect re-applies the saved theme —
  // true only while save + close land in one commit (React flushes passive destroys
  // before creates), and silently false the moment the close is deferred.
  const savedRef = useRef(false);

  // Group color keys by category
  const categories = useMemo(() => {
    const map = new Map<string, (typeof THEME_COLOR_KEYS)[number][]>();
    for (const entry of THEME_COLOR_KEYS) {
      const list = map.get(entry.category) ?? [];
      list.push(entry);
      map.set(entry.category, list);
    }
    return map;
  }, []);

  // Apply editing colors to CSS variables in real-time. data-theme도 함께 —
  // 24색 inline vars만 바꾸면 base를 토글해도 <html data-theme>는 이전 값에
  // 머물러, 25키 밖 semantic 토큰·native widget(color-scheme)·CodeMirror가
  // 옛 base로 남은 혼합 미리보기가 됐다(적대 리뷰).
  useEffect(() => {
    const root = document.documentElement;
    applyThemeVars(root, colors, base);
    // 동등성 관문: 이 effect는 색 드래그 틱마다 돈다 — 같은 값이라도
    // setAttribute는 attribute-changed 경로를 타서 셀렉터 재매칭을 유발할
    // 수 있다 (CLAUDE.md의 고빈도 경로 규칙과 같은 이유).
    if (root.dataset.theme !== base) root.dataset.theme = base;
  }, [colors, base]);

  // Restore original colors on unmount (cancel / navigate away)
  useEffect(() => {
    // Aliased so the cleanup reads the ref through a stable local (lint rule), not
    // a value captured at effect time — `saved` must be read AT cleanup.
    const saved = savedRef;
    return () => {
      if (saved.current) return;
      restorePreview();
    };
  }, []);

  const handleColorChange = useCallback((key: ThemeColorKey, value: string) => {
    setColors((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSave = useCallback(() => {
    // From here the settings effect owns the DOM: these colours are a real theme.
    savedRef.current = true;
    // ‼️ 부정(`!builtIn`)이 아니라 명시 비교다. 새 모델에는 community·dev도
    // 있고, 그것들을 "내 테마"로 취급하면 편집이 설치본을 덮어쓴다.
    const isCustom = sourceTheme.source === "custom";
    const themeId = isCustom ? sourceTheme.id : `custom-${Date.now()}`;

    const themeDef: ThemeDef = {
      id: themeId,
      name,
      source: "custom",
      modes: { [base]: { colors: { ...colors } } },
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
    restorePreview();
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
          aria-label={t("settings.theme.namePlaceholder")}
          className="theme-editor-name"
          onChange={(e) => setName(e.target.value)}
          placeholder={t("settings.theme.namePlaceholder")}
          type="text"
          value={name}
        />
        <div className="theme-editor-base-toggle">
          <button
            aria-pressed={base === "light"}
            className={`theme-editor-base-btn ${base === "light" ? "theme-editor-base-btn-active" : ""}`}
            onClick={() => setBase("light")}
          >
            {t("settings.theme.light")}
          </button>
          <button
            aria-pressed={base === "dark"}
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
              {/* 옆의 span은 시각 라벨일 뿐 input과 연결돼 있지 않다 — 스크린
                  리더에는 24개가 전부 무명의 color picker로 읽힌다. */}
              <input
                aria-label={entry.label}
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
function restorePreview(): void {
  const root = document.documentElement;
  const { activeThemeId, customThemes } = useSettingsStore.getState();
  const resolved = findThemeById(activeThemeId, customThemes);
  // 적용될 모드는 OS 설정이 정한다 — use-settings-effects와 같은 규칙이어야
  // 복원이 그 효과가 남겨둘 상태와 일치한다. 편집 중인 모드는 여기 쓰지 않는다:
  // 그것은 미리보기의 것이고, 복원은 미리보기를 지우는 일이다.
  const mode =
    resolved === undefined
      ? undefined
      : resolveThemeMode(
          resolved,
          window.matchMedia("(prefers-color-scheme: dark)").matches,
        );
  const colors = mode === undefined ? undefined : resolved?.modes[mode]?.colors;
  const hasInlineVars =
    resolved !== undefined && appliesInlineVars(activeThemeId);
  // 색·base·attribute 전부를 호출 시점의 store에서 읽는다(적대 리뷰 2라운드):
  // 편집기를 열 때 캡처한 색을 쓰면, 편집 중 활성 테마가 바뀌는 경로가 생기는
  // 순간 "현재 테마의 base + 과거 테마의 색"이 섞인 복원이 된다. 오늘의 UI는
  // 편집 중 테마 전환을 막지만, 이 함수의 정합성이 그 우연에 기대면 안 된다.
  if (hasInlineVars && mode !== undefined && colors !== undefined) {
    applyThemeVars(root, colors, mode);
  } else {
    clearThemeVars(root);
  }
  // preview effect가 data-theme도 편집 중인 모드로 밀어뒀으므로 attribute까지
  // 되돌린다 — use-settings-effects와 같은 규칙: 해석되는 테마는 그 모드,
  // system·미해석은 attribute 제거(= prefers-color-scheme 경로).
  if (mode !== undefined) {
    root.dataset.theme = mode;
  } else {
    root.removeAttribute("data-theme");
  }
}
