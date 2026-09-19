// §54 Theme System — Type definitions and built-in theme data

export type { ThemeColorKey, ThemeColors } from "./theme-color-keys";
export { THEME_COLOR_KEYS, THEME_COLOR_VALUE_RE } from "./theme-color-keys";

import type { ThemeColors } from "./theme-color-keys";
import type { ThemeSource } from "./theme-sources";

import { DEFAULT_DARK_PALETTE } from "./generated/palette-dark";
import { DEFAULT_LIGHT_PALETTE } from "./generated/palette-light";
import { THEME_COLOR_VALUE_RE } from "./theme-color-keys";

// ---------------------------------------------------------------------------
// 1. ThemeDef — A complete theme definition
// ---------------------------------------------------------------------------

export type ThemeMode = "dark" | "light";

/** 한 모드가 제공하는 것. 토큰과 CSS 모두 선택이지만 최소 하나는 있어야 한다(§355). */
export interface ThemeModeAssets {
  colors?: ThemeColors;
  /** 설치 시점에 위생 처리된 CSS (§358). 이 계획 범위에서는 항상 undefined다. */
  css?: string;
}

/**
 * 한 테마. `base`(한 모드)가 아니라 `modes`(모드 맵)를 갖는다 — 설치 테마가
 * 라이트/다크 쌍을 함께 싣고 OS를 따라갈 수 있어야 하기 때문이다(§357).
 * 행이 무엇을 할 수 있는지는 `source`가 정한다(theme-sources.ts).
 */
export interface ThemeDef {
  id: string;
  /** 선언된 모드만 키로 갖는다. 둘 다 있으면 OS 설정을 따라간다. */
  modes: Partial<Record<ThemeMode, ThemeModeAssets>>;
  name: string;
  source: ThemeSource;
}

/** 선언 순서가 아니라 고정 순서로 돌려준다 — UI가 정렬을 다시 하지 않도록. */
export function themeModes(theme: ThemeDef): ThemeMode[] {
  return (["light", "dark"] as const).filter(
    (m) => theme.modes[m] !== undefined,
  );
}

/**
 * 지금 적용해야 할 모드.
 *
 * 쌍을 가진 테마만 OS를 따라간다. 한 모드짜리 테마가 OS를 따라가면 다크 모드에서
 * 라이트 테마를 고른 사용자에게 아무것도 적용되지 않는다 — 고른 것이 무시되는 셈이다.
 */
export function resolveThemeMode(
  theme: ThemeDef,
  prefersDark: boolean,
): ThemeMode | undefined {
  const available = themeModes(theme);
  if (available.length === 0) return undefined;
  if (available.length === 1) return available[0];
  return prefersDark ? "dark" : "light";
}

/**
 * 스토어의 `theme` 필드 값 — light/dark 두 값만 아는 소비자(CSS·CodeMirror)를 위한 신호다.
 *
 * 쌍을 가진 테마는 OS를 따라가므로 "system"이다. `activeThemeId`가 진짜 선택이고
 * 이 필드는 그것의 파생이다. 함수로 두는 이유: `setActiveTheme`과 rehydrate 동기화가
 * **같은 규칙**을 써야 하고, 두 곳에 같은 삼항식을 적으면 한쪽만 고쳐지는 날이 온다.
 */
export function themeFieldFor(
  theme: ThemeDef | undefined,
): "dark" | "light" | "system" {
  if (theme === undefined) return "system";
  const modes = themeModes(theme);
  return modes.length === 1 ? modes[0] : "system";
}

// ---------------------------------------------------------------------------
// 2. Theme key migration map (v9 → v10)
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
 * 라이트 값과 섞이는 footgun이 시그니처에 남아 있었다. 이 색들이 어느 모드의
 * 것인지 알면 defaultColorsForBase(mode)를 넘긴다 — `base`는 더 이상 ThemeDef의
 * 필드가 아니라 그 헬퍼의 매개변수 이름이다(§357에서 modes 맵으로 바뀌었다).
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

/** 모드에 맞는 기본 팔레트 — migrateThemeColors의 fill 출처로 쓴다. */
export function defaultColorsForBase(base: ThemeMode): ThemeColors {
  return base === "dark" ? DEFAULT_DARK_PALETTE : DEFAULT_LIGHT_PALETTE;
}

// ---------------------------------------------------------------------------
// 3. BUILT_IN_THEMES — 8 shipped themes
// ---------------------------------------------------------------------------

export const BUILT_IN_THEMES: ThemeDef[] = [
  // ── Default Light ───────────────────────────────────────────────────────
  {
    id: "default-light",
    name: "Default Light",
    source: "builtin",
    modes: { light: { colors: DEFAULT_LIGHT_PALETTE } },
  },

  // ── Default Dark ────────────────────────────────────────────────────────
  {
    id: "default-dark",
    name: "Default Dark",
    source: "builtin",
    modes: { dark: { colors: DEFAULT_DARK_PALETTE } },
  },

  // ── Tokyo Night ─────────────────────────────────────────────────────────
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    source: "builtin",
    modes: {
      dark: {
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
    },
  },

  // ── Solarized Light ─────────────────────────────────────────────────────
  {
    id: "solarized-light",
    name: "Solarized Light",
    source: "builtin",
    modes: {
      light: {
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
    },
  },

  // ── Solarized Dark ──────────────────────────────────────────────────────
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    source: "builtin",
    modes: {
      dark: {
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
    },
  },

  // ── Nord ─────────────────────────────────────────────────────────────────
  {
    id: "nord",
    name: "Nord",
    source: "builtin",
    modes: {
      dark: {
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
    },
  },

  // ── Baram Garden Light ─────────────────────────────────────────────────
  {
    id: "baram-garden-light",
    name: "Baram Garden Light",
    source: "builtin",
    modes: {
      light: {
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
    },
  },

  // ── Baram Garden Dark ──────────────────────────────────────────────────
  {
    id: "baram-garden-dark",
    name: "Baram Garden Dark",
    source: "builtin",
    modes: {
      dark: {
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
    },
  },
];

// ---------------------------------------------------------------------------
// 4. Helper — find a theme by ID across built-in and custom themes
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
