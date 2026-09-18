// §54 Theme System — Type definitions and built-in theme data

export type { ThemeColorKey, ThemeColors } from "./theme-color-keys";
export { THEME_COLOR_KEYS, THEME_COLOR_VALUE_RE } from "./theme-color-keys";

import type { ThemeColors } from "./theme-color-keys";

import { THEME_COLOR_VALUE_RE } from "./theme-color-keys";

// ---------------------------------------------------------------------------
// 2. ThemeDef — A complete theme definition
// ---------------------------------------------------------------------------

export interface ThemeDef {
  base: "dark" | "light";
  builtIn: boolean;
  colors: ThemeColors;
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// 3. Theme key migration map (v9 → v10)
// ---------------------------------------------------------------------------

/** Old CSS variable key → new key. Used by settings migration v10. */
export const THEME_KEY_MIGRATION_V10: Record<string, keyof ThemeColors> = {
  "--color-accent": "--color-accent-default",
  "--color-bg-primary": "--color-bg-default",
  "--color-bg-secondary": "--color-bg-subtle",
  "--color-bg-sidebar": "--color-bg-panel",
  "--color-bg-tertiary": "--color-bg-elevated",
  "--color-border": "--color-border-default",
  "--color-border-light": "--color-border-subtle",
  "--color-text-muted": "--color-text-disabled",
};

/**
 * Migrate a ThemeColors object from old key names to new key names.
 * Keys that don't need migration are passed through unchanged.
 * Missing keys are filled from `fallback` — 필수다(적대 리뷰): optional이던
 * 시절 기본값이 Default Light라, fallback을 잊은 호출자마다 다크 테마가
 * 라이트 값과 섞이는 footgun이 시그니처에 남아 있었다. 테마의 base를 알면
 * defaultColorsForBase(base)를 넘긴다.
 */
export function migrateThemeColors(
  old: Record<string, string>,
  fallback: ThemeColors,
): ThemeColors {
  const migrated: Record<string, string> = {};

  // 1차: canonical(비이주) 키를 먼저 앉힌다. 2차: 옛 키는 canonical 자리가
  // **유효한 값으로** 차 있지 않을 때만 이주한다. 두 단계로 나누는 이유(적대
  // 리뷰 2회): 옛 키와 canonical 키가 공존하면 순회 순서가 승자를 정했고(옛
  // 키가 뒤면 stale 값이 canonical을 덮음), 존재만 보는 가드로 고치면 이번엔
  // 빈 문자열 같은 invalid canonical이 유효한 옛 값을 무조건 버렸다. 정체가
  // 순서를 이기되, invalid canonical은 유효한 옛 값에게 자리를 내준다.
  for (const [key, value] of Object.entries(old)) {
    if (THEME_KEY_MIGRATION_V10[key]) continue;
    migrated[key] = value;
  }
  for (const [key, value] of Object.entries(old)) {
    const newKey = THEME_KEY_MIGRATION_V10[key];
    if (!newKey) continue;
    if (THEME_COLOR_VALUE_RE.test(migrated[newKey] ?? "")) continue;
    migrated[newKey] = value;
  }

  // Fill any missing keys from fallback.
  for (const key of Object.keys(fallback)) {
    if (!(key in migrated)) {
      migrated[key] = fallback[key as keyof ThemeColors];
    }
  }

  return migrated as unknown as ThemeColors;
}

/** 테마 base에 맞는 기본 팔레트 — migrateThemeColors의 fill 출처로 쓴다. */
export function defaultColorsForBase(base: "dark" | "light"): ThemeColors {
  return BUILT_IN_THEMES.find(
    (t) => t.id === (base === "dark" ? "default-dark" : "default-light"),
  )!.colors;
}

// ---------------------------------------------------------------------------
// 5. BUILT_IN_THEMES — 8 shipped themes
// ---------------------------------------------------------------------------

export const BUILT_IN_THEMES: ThemeDef[] = [
  // ── Default Light ───────────────────────────────────────────────────────
  {
    id: "default-light",
    name: "Default Light",
    base: "light",
    builtIn: true,
    colors: {
      "--color-bg-default": "#ffffff",
      "--color-bg-subtle": "#f8f9fa",
      "--color-bg-panel": "#f1f3f5",
      "--color-bg-elevated": "#f0f0f3",

      "--color-text-primary": "#1a1a1a",
      "--color-text-secondary": "#6b7280",
      "--color-text-disabled": "#9ca3af",

      "--color-border-default": "#e5e7eb",
      "--color-border-subtle": "#f3f4f6",

      "--color-accent-default": "#3b82f6",
      "--color-accent-hover": "#2563eb",

      "--color-editor-bg": "#ffffff",
      "--color-editor-text": "#1a1a1a",
      "--color-editor-selection": "#bfdbfe",
      "--color-editor-cursor": "#1a1a1a",

      "--color-status-danger": "#ef4444",
      "--color-status-warning": "#f59e0b",
      "--color-status-success": "#10b981",
      "--color-accent-subtle": "#eff6ff",
      "--color-accent-ai": "#8b5cf6",
      "--color-bg-input": "#ffffff",
      "--color-graph-node": "#6b7280",
      "--color-graph-active": "#3b82f6",
      "--color-graph-edge": "#9ca3af",
    },
  },

  // ── Default Dark ────────────────────────────────────────────────────────
  {
    id: "default-dark",
    name: "Default Dark",
    base: "dark",
    builtIn: true,
    colors: {
      "--color-bg-default": "#1a1a2e",
      "--color-bg-subtle": "#16213e",
      "--color-bg-panel": "#0f172a",
      "--color-bg-elevated": "#1e2a45",

      "--color-text-primary": "#e2e8f0",
      "--color-text-secondary": "#94a3b8",
      "--color-text-disabled": "#64748b",

      "--color-border-default": "#334155",
      "--color-border-subtle": "#1e293b",

      "--color-accent-default": "#60a5fa",
      "--color-accent-hover": "#3b82f6",

      "--color-editor-bg": "#1a1a2e",
      "--color-editor-text": "#e2e8f0",
      "--color-editor-selection": "#1e3a5f",
      "--color-editor-cursor": "#e2e8f0",

      "--color-status-danger": "#ef4444",
      "--color-status-warning": "#f59e0b",
      "--color-status-success": "#10b981",
      "--color-accent-subtle": "#172554",
      "--color-accent-ai": "#a78bfa",
      "--color-bg-input": "#1e293b",
      "--color-graph-node": "#6b7280",
      "--color-graph-active": "#60a5fa",
      "--color-graph-edge": "#374151",
    },
  },

  // ── Tokyo Night ─────────────────────────────────────────────────────────
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    base: "dark",
    builtIn: true,
    colors: {
      "--color-bg-default": "#1a1b26",
      "--color-bg-subtle": "#16161e",
      "--color-bg-panel": "#13131a",
      "--color-bg-elevated": "#1f2335",

      "--color-text-primary": "#a9b1d6",
      "--color-text-secondary": "#787c99",
      "--color-text-disabled": "#565a6e",

      "--color-border-default": "#292e42",
      "--color-border-subtle": "#1f2335",

      "--color-accent-default": "#7aa2f7",
      "--color-accent-hover": "#5d8ffa",

      "--color-editor-bg": "#1a1b26",
      "--color-editor-text": "#a9b1d6",
      "--color-editor-selection": "#283457",
      "--color-editor-cursor": "#c0caf5",

      "--color-status-danger": "#f7768e",
      "--color-status-warning": "#e0af68",
      "--color-status-success": "#9ece6a",
      "--color-accent-subtle": "#1f2335",
      "--color-accent-ai": "#bb9af7",
      "--color-bg-input": "#1f2335",
      "--color-graph-node": "#565a6e",
      "--color-graph-active": "#7aa2f7",
      "--color-graph-edge": "#292e42",
    },
  },

  // ── Solarized Light ─────────────────────────────────────────────────────
  {
    id: "solarized-light",
    name: "Solarized Light",
    base: "light",
    builtIn: true,
    colors: {
      "--color-bg-default": "#fdf6e3",
      "--color-bg-subtle": "#eee8d5",
      "--color-bg-panel": "#eee8d5",
      "--color-bg-elevated": "#e8e1cb",

      "--color-text-primary": "#657b83",
      "--color-text-secondary": "#839496",
      "--color-text-disabled": "#93a1a1",

      "--color-border-default": "#d3cbb7",
      "--color-border-subtle": "#eee8d5",

      "--color-accent-default": "#268bd2",
      "--color-accent-hover": "#1a6fb5",

      "--color-editor-bg": "#fdf6e3",
      "--color-editor-text": "#657b83",
      "--color-editor-selection": "#e0dbc8",
      "--color-editor-cursor": "#586e75",

      "--color-status-danger": "#dc322f",
      "--color-status-warning": "#b58900",
      "--color-status-success": "#859900",
      "--color-accent-subtle": "#eee8d5",
      "--color-accent-ai": "#6c71c4",
      "--color-bg-input": "#fdf6e3",
      "--color-graph-node": "#839496",
      "--color-graph-active": "#268bd2",
      "--color-graph-edge": "#93a1a1",
    },
  },

  // ── Solarized Dark ──────────────────────────────────────────────────────
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    base: "dark",
    builtIn: true,
    colors: {
      "--color-bg-default": "#002b36",
      "--color-bg-subtle": "#073642",
      "--color-bg-panel": "#001e27",
      "--color-bg-elevated": "#0a3d4e",

      "--color-text-primary": "#839496",
      "--color-text-secondary": "#657b83",
      "--color-text-disabled": "#586e75",

      "--color-border-default": "#094a5c",
      "--color-border-subtle": "#073642",

      "--color-accent-default": "#268bd2",
      "--color-accent-hover": "#2aa0e8",

      "--color-editor-bg": "#002b36",
      "--color-editor-text": "#839496",
      "--color-editor-selection": "#094a5c",
      "--color-editor-cursor": "#93a1a1",

      "--color-status-danger": "#dc322f",
      "--color-status-warning": "#b58900",
      "--color-status-success": "#859900",
      "--color-accent-subtle": "#073642",
      "--color-accent-ai": "#6c71c4",
      "--color-bg-input": "#073642",
      "--color-graph-node": "#657b83",
      "--color-graph-active": "#268bd2",
      "--color-graph-edge": "#094a5c",
    },
  },

  // ── Nord ─────────────────────────────────────────────────────────────────
  {
    id: "nord",
    name: "Nord",
    base: "dark",
    builtIn: true,
    colors: {
      "--color-bg-default": "#2e3440",
      "--color-bg-subtle": "#3b4252",
      "--color-bg-panel": "#282e3a",
      "--color-bg-elevated": "#434c5e",

      "--color-text-primary": "#d8dee9",
      "--color-text-secondary": "#a4aebb",
      "--color-text-disabled": "#7b88a1",

      "--color-border-default": "#4c566a",
      "--color-border-subtle": "#3b4252",

      "--color-accent-default": "#88c0d0",
      "--color-accent-hover": "#81a1c1",

      "--color-editor-bg": "#2e3440",
      "--color-editor-text": "#d8dee9",
      "--color-editor-selection": "#434c5e",
      "--color-editor-cursor": "#d8dee9",

      "--color-status-danger": "#bf616a",
      "--color-status-warning": "#ebcb8b",
      "--color-status-success": "#a3be8c",
      "--color-accent-subtle": "#3b4252",
      "--color-accent-ai": "#b48ead",
      "--color-bg-input": "#3b4252",
      "--color-graph-node": "#7b88a1",
      "--color-graph-active": "#88c0d0",
      "--color-graph-edge": "#4c566a",
    },
  },

  // ── Baram Garden Light ─────────────────────────────────────────────────
  {
    id: "baram-garden-light",
    name: "Baram Garden Light",
    base: "light",
    builtIn: true,
    colors: {
      "--color-bg-default": "#fffef8",
      "--color-bg-subtle": "#fdf6ee",
      "--color-bg-panel": "#f9e8f0",
      "--color-bg-elevated": "#fdf8e1",

      "--color-text-primary": "#123d96",
      "--color-text-secondary": "#5a6f8c",
      "--color-text-disabled": "#a0aec0",

      "--color-border-default": "#eec2da",
      "--color-border-subtle": "#f5dce8",

      "--color-accent-default": "#123d96",
      "--color-accent-hover": "#f6b26b",

      "--color-editor-bg": "#fffef8",
      "--color-editor-text": "#123d96",
      "--color-editor-selection": "#d8e6b3",
      "--color-editor-cursor": "#123d96",

      "--color-status-danger": "#ef4444",
      "--color-status-warning": "#eab308",
      "--color-status-success": "#22c55e",
      "--color-accent-subtle": "#fdf8e1",
      "--color-accent-ai": "#7c3aed",
      "--color-bg-input": "#fffef8",
      "--color-graph-node": "#5a6f8c",
      "--color-graph-active": "#123d96",
      "--color-graph-edge": "#a0aec0",
    },
  },

  // ── Baram Garden Dark ──────────────────────────────────────────────────
  {
    id: "baram-garden-dark",
    name: "Baram Garden Dark",
    base: "dark",
    builtIn: true,
    colors: {
      "--color-bg-default": "#1a1d2e",
      "--color-bg-subtle": "#232740",
      "--color-bg-panel": "#161830",
      "--color-bg-elevated": "#2a2d42",

      "--color-text-primary": "#eec2da",
      "--color-text-secondary": "#a0aec0",
      "--color-text-disabled": "#5a6f8c",

      "--color-border-default": "#3d3562",
      "--color-border-subtle": "#2e2a4a",

      "--color-accent-default": "#b4d156",
      "--color-accent-hover": "#edd841",

      "--color-editor-bg": "#1a1d2e",
      "--color-editor-text": "#eec2da",
      "--color-editor-selection": "#2e4a28",
      "--color-editor-cursor": "#b4d156",

      "--color-status-danger": "#ef4444",
      "--color-status-warning": "#eab308",
      "--color-status-success": "#22c55e",
      "--color-accent-subtle": "#2a2d42",
      "--color-accent-ai": "#a78bfa",
      "--color-bg-input": "#232740",
      "--color-graph-node": "#5a6f8c",
      "--color-graph-active": "#b4d156",
      "--color-graph-edge": "#3d3562",
    },
  },
];

// ---------------------------------------------------------------------------
// 5. Helper — find a theme by ID across built-in and custom themes
// ---------------------------------------------------------------------------

export function findThemeById(
  id: string,
  customThemes: ThemeDef[],
): ThemeDef | undefined {
  return (
    BUILT_IN_THEMES.find((t) => t.id === id) ??
    customThemes.find((t) => t.id === id)
  );
}
