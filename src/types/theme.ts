// §54 Theme System — Type definitions and built-in theme data

// ---------------------------------------------------------------------------
// 1. ThemeColors — 16 CSS custom property keys
// ---------------------------------------------------------------------------

export interface ThemeColors {
  "--color-accent": string;
  "--color-accent-hover": string;
  "--color-bg-primary": string;
  "--color-bg-secondary": string;

  "--color-bg-sidebar": string;
  "--color-bg-tertiary": string;
  "--color-border": string;

  "--color-border-light": string;
  "--color-editor-bg": string;

  "--color-editor-cursor": string;
  "--color-editor-line-highlight": string;

  "--color-editor-selection": string;
  "--color-editor-text": string;
  "--color-text-muted": string;
  "--color-text-primary": string;
  "--color-text-secondary": string;
}

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
// 3. THEME_COLOR_KEYS — metadata for rendering color pickers in ThemeEditor
// ---------------------------------------------------------------------------

export const THEME_COLOR_KEYS: {
  category: string;
  key: keyof ThemeColors;
  label: string;
}[] = [
  // Background
  {
    key: "--color-bg-primary",
    label: "Primary Background",
    category: "Background",
  },
  {
    key: "--color-bg-secondary",
    label: "Secondary Background",
    category: "Background",
  },
  {
    key: "--color-bg-sidebar",
    label: "Sidebar Background",
    category: "Background",
  },
  {
    key: "--color-bg-tertiary",
    label: "Tertiary Background",
    category: "Background",
  },

  // Text
  { key: "--color-text-primary", label: "Primary Text", category: "Text" },
  { key: "--color-text-secondary", label: "Secondary Text", category: "Text" },
  { key: "--color-text-muted", label: "Muted Text", category: "Text" },

  // Border
  { key: "--color-border", label: "Border", category: "Border" },
  { key: "--color-border-light", label: "Light Border", category: "Border" },

  // Accent
  { key: "--color-accent", label: "Accent", category: "Accent" },
  { key: "--color-accent-hover", label: "Accent Hover", category: "Accent" },

  // Editor
  { key: "--color-editor-bg", label: "Editor Background", category: "Editor" },
  { key: "--color-editor-text", label: "Editor Text", category: "Editor" },
  {
    key: "--color-editor-selection",
    label: "Editor Selection",
    category: "Editor",
  },
  { key: "--color-editor-cursor", label: "Editor Cursor", category: "Editor" },
  {
    key: "--color-editor-line-highlight",
    label: "Editor Line Highlight",
    category: "Editor",
  },
];

// ---------------------------------------------------------------------------
// 4. BUILT_IN_THEMES — 6 shipped themes
// ---------------------------------------------------------------------------

export const BUILT_IN_THEMES: ThemeDef[] = [
  // ── Default Light ───────────────────────────────────────────────────────
  {
    id: "default-light",
    name: "Default Light",
    base: "light",
    builtIn: true,
    colors: {
      "--color-bg-primary": "#ffffff",
      "--color-bg-secondary": "#f8f9fa",
      "--color-bg-sidebar": "#f1f3f5",
      "--color-bg-tertiary": "#f0f0f3",

      "--color-text-primary": "#1a1a1a",
      "--color-text-secondary": "#6b7280",
      "--color-text-muted": "#9ca3af",

      "--color-border": "#e5e7eb",
      "--color-border-light": "#f3f4f6",

      "--color-accent": "#3b82f6",
      "--color-accent-hover": "#2563eb",

      "--color-editor-bg": "#ffffff",
      "--color-editor-text": "#1a1a1a",
      "--color-editor-selection": "#bfdbfe",
      "--color-editor-cursor": "#1a1a1a",
      "--color-editor-line-highlight": "#f8f9fa",
    },
  },

  // ── Default Dark ────────────────────────────────────────────────────────
  {
    id: "default-dark",
    name: "Default Dark",
    base: "dark",
    builtIn: true,
    colors: {
      "--color-bg-primary": "#1a1a2e",
      "--color-bg-secondary": "#16213e",
      "--color-bg-sidebar": "#0f172a",
      "--color-bg-tertiary": "#1e2a45",

      "--color-text-primary": "#e2e8f0",
      "--color-text-secondary": "#94a3b8",
      "--color-text-muted": "#64748b",

      "--color-border": "#334155",
      "--color-border-light": "#1e293b",

      "--color-accent": "#60a5fa",
      "--color-accent-hover": "#3b82f6",

      "--color-editor-bg": "#1a1a2e",
      "--color-editor-text": "#e2e8f0",
      "--color-editor-selection": "#1e3a5f",
      "--color-editor-cursor": "#e2e8f0",
      "--color-editor-line-highlight": "#16213e",
    },
  },

  // ── Tokyo Night ─────────────────────────────────────────────────────────
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    base: "dark",
    builtIn: true,
    colors: {
      "--color-bg-primary": "#1a1b26",
      "--color-bg-secondary": "#16161e",
      "--color-bg-sidebar": "#13131a",
      "--color-bg-tertiary": "#1f2335",

      "--color-text-primary": "#a9b1d6",
      "--color-text-secondary": "#787c99",
      "--color-text-muted": "#565a6e",

      "--color-border": "#292e42",
      "--color-border-light": "#1f2335",

      "--color-accent": "#7aa2f7",
      "--color-accent-hover": "#5d8ffa",

      "--color-editor-bg": "#1a1b26",
      "--color-editor-text": "#a9b1d6",
      "--color-editor-selection": "#283457",
      "--color-editor-cursor": "#c0caf5",
      "--color-editor-line-highlight": "#1e2030",
    },
  },

  // ── Solarized Light ─────────────────────────────────────────────────────
  {
    id: "solarized-light",
    name: "Solarized Light",
    base: "light",
    builtIn: true,
    colors: {
      "--color-bg-primary": "#fdf6e3",
      "--color-bg-secondary": "#eee8d5",
      "--color-bg-sidebar": "#eee8d5",
      "--color-bg-tertiary": "#e8e1cb",

      "--color-text-primary": "#657b83",
      "--color-text-secondary": "#839496",
      "--color-text-muted": "#93a1a1",

      "--color-border": "#d3cbb7",
      "--color-border-light": "#eee8d5",

      "--color-accent": "#268bd2",
      "--color-accent-hover": "#1a6fb5",

      "--color-editor-bg": "#fdf6e3",
      "--color-editor-text": "#657b83",
      "--color-editor-selection": "#e0dbc8",
      "--color-editor-cursor": "#586e75",
      "--color-editor-line-highlight": "#eee8d5",
    },
  },

  // ── Solarized Dark ──────────────────────────────────────────────────────
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    base: "dark",
    builtIn: true,
    colors: {
      "--color-bg-primary": "#002b36",
      "--color-bg-secondary": "#073642",
      "--color-bg-sidebar": "#001e27",
      "--color-bg-tertiary": "#0a3d4e",

      "--color-text-primary": "#839496",
      "--color-text-secondary": "#657b83",
      "--color-text-muted": "#586e75",

      "--color-border": "#094a5c",
      "--color-border-light": "#073642",

      "--color-accent": "#268bd2",
      "--color-accent-hover": "#2aa0e8",

      "--color-editor-bg": "#002b36",
      "--color-editor-text": "#839496",
      "--color-editor-selection": "#094a5c",
      "--color-editor-cursor": "#93a1a1",
      "--color-editor-line-highlight": "#073642",
    },
  },

  // ── Nord ─────────────────────────────────────────────────────────────────
  {
    id: "nord",
    name: "Nord",
    base: "dark",
    builtIn: true,
    colors: {
      "--color-bg-primary": "#2e3440",
      "--color-bg-secondary": "#3b4252",
      "--color-bg-sidebar": "#282e3a",
      "--color-bg-tertiary": "#434c5e",

      "--color-text-primary": "#d8dee9",
      "--color-text-secondary": "#a4aebb",
      "--color-text-muted": "#7b88a1",

      "--color-border": "#4c566a",
      "--color-border-light": "#3b4252",

      "--color-accent": "#88c0d0",
      "--color-accent-hover": "#81a1c1",

      "--color-editor-bg": "#2e3440",
      "--color-editor-text": "#d8dee9",
      "--color-editor-selection": "#434c5e",
      "--color-editor-cursor": "#d8dee9",
      "--color-editor-line-highlight": "#3b4252",
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
