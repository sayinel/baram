# §54 Theme System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a theme system with 6 built-in themes, a color picker editor for custom themes, and JSON import/export — replacing the current light/dark/system toggle.

**Architecture:** Themes are JSON objects (`ThemeDef`) mapping 16 CSS variable names to color values. Built-in themes are defined in `src/types/theme.ts`. Custom themes are stored in Zustand (`customThemes[]`). Active theme is applied by setting `data-theme` to the theme's `base` ("light"/"dark") and overriding CSS variables via `document.documentElement.style.setProperty()`. The Appearance tab in Settings shows a theme gallery + color picker editor.

**Tech Stack:** React, Zustand (persist), CSS custom properties, native `<input type="color">`

---

### Task 1: Theme types and built-in theme definitions

**Files:**
- Create: `src/types/theme.ts`

**Step 1: Create theme types and built-in themes**

Create `src/types/theme.ts` with:

```typescript
export interface ThemeColors {
  "--color-bg-primary": string;
  "--color-bg-secondary": string;
  "--color-bg-sidebar": string;
  "--color-bg-tertiary": string;
  "--color-text-primary": string;
  "--color-text-secondary": string;
  "--color-text-muted": string;
  "--color-border": string;
  "--color-border-light": string;
  "--color-accent": string;
  "--color-accent-hover": string;
  "--color-editor-bg": string;
  "--color-editor-text": string;
  "--color-editor-selection": string;
  "--color-editor-cursor": string;
  "--color-editor-line-highlight": string;
}

export interface ThemeDef {
  id: string;
  name: string;
  base: "light" | "dark";
  colors: ThemeColors;
  builtIn: boolean;
}

// All 16 CSS variable keys, in display order by category
export const THEME_COLOR_KEYS: { key: keyof ThemeColors; label: string; category: string }[] = [
  // Background
  { key: "--color-bg-primary", label: "Background", category: "Background" },
  { key: "--color-bg-secondary", label: "Secondary BG", category: "Background" },
  { key: "--color-bg-sidebar", label: "Sidebar BG", category: "Background" },
  { key: "--color-bg-tertiary", label: "Tertiary BG", category: "Background" },
  // Text
  { key: "--color-text-primary", label: "Text", category: "Text" },
  { key: "--color-text-secondary", label: "Secondary Text", category: "Text" },
  { key: "--color-text-muted", label: "Muted Text", category: "Text" },
  // Border
  { key: "--color-border", label: "Border", category: "Border" },
  { key: "--color-border-light", label: "Light Border", category: "Border" },
  // Accent
  { key: "--color-accent", label: "Accent", category: "Accent" },
  { key: "--color-accent-hover", label: "Accent Hover", category: "Accent" },
  // Editor
  { key: "--color-editor-bg", label: "Editor BG", category: "Editor" },
  { key: "--color-editor-text", label: "Editor Text", category: "Editor" },
  { key: "--color-editor-selection", label: "Selection", category: "Editor" },
  { key: "--color-editor-cursor", label: "Cursor", category: "Editor" },
  { key: "--color-editor-line-highlight", label: "Line Highlight", category: "Editor" },
];

export const BUILT_IN_THEMES: ThemeDef[] = [
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

export function findThemeById(id: string, customThemes: ThemeDef[]): ThemeDef | undefined {
  return BUILT_IN_THEMES.find((t) => t.id === id) ?? customThemes.find((t) => t.id === id);
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add src/types/theme.ts
git commit -m "feat(§54): add theme types and 6 built-in theme definitions"
```

---

### Task 2: Update settings-store for theme system

**Files:**
- Modify: `src/stores/settings-store.ts`

**Step 1: Update the store**

Replace the existing `theme` field and `setTheme` with new theme-aware state:

1. Add import: `import type { ThemeDef } from "../types/theme";`

2. Replace in `SettingsState` interface:
   - Remove: `theme: Theme;` and `setTheme: (theme: Theme) => void;`
   - Add:
     ```typescript
     activeThemeId: string;   // "system" | "default-light" | "default-dark" | custom id
     customThemes: ThemeDef[];
     setActiveTheme: (id: string) => void;
     saveCustomTheme: (theme: ThemeDef) => void;
     deleteCustomTheme: (id: string) => void;
     ```

3. Keep `theme` as a **computed compat getter** (read-only) so existing code like `useSettingsStore((s) => s.theme)` still works. The getter derives "light" | "dark" | "system" from `activeThemeId`:
   ```typescript
   // Backward compat (read-only)
   get theme(): "light" | "dark" | "system" {
     const id = useSettingsStore.getState().activeThemeId;
     if (id === "system") return "system";
     const all = [...BUILT_IN_THEMES, ...useSettingsStore.getState().customThemes];
     const t = all.find((t) => t.id === id);
     return t?.base ?? "light";
   },
   ```
   Note: Zustand doesn't support getters in state. Instead, keep `theme` as a regular field that gets synced inside `setActiveTheme`:
   ```typescript
   setActiveTheme: (id) =>
     set(() => {
       let base: "light" | "dark" | "system" = "system";
       if (id !== "system") {
         const all = [...BUILT_IN_THEMES, ...useSettingsStore.getState().customThemes];
         base = all.find((t) => t.id === id)?.base ?? "light";
       }
       return { activeThemeId: id, theme: base };
     }),
   ```

4. Initial state: `activeThemeId: "system"`, `customThemes: []`

5. Implement `saveCustomTheme` and `deleteCustomTheme`:
   ```typescript
   saveCustomTheme: (theme) =>
     set((state) => {
       const existing = state.customThemes.findIndex((t) => t.id === theme.id);
       const updated = [...state.customThemes];
       if (existing >= 0) updated[existing] = theme;
       else updated.push(theme);
       return { customThemes: updated };
     }),
   deleteCustomTheme: (id) =>
     set((state) => ({
       customThemes: state.customThemes.filter((t) => t.id !== id),
       activeThemeId: state.activeThemeId === id ? "system" : state.activeThemeId,
       theme: state.activeThemeId === id ? "system" : state.theme,
     })),
   ```

6. Add `activeThemeId` and `customThemes` to `partialize`. Keep `theme` in partialize too.

7. Update persist migration (bump to version 2): migrate old `theme: "light"` → `activeThemeId: "default-light"`, `"dark"` → `"default-dark"`, `"system"` → `"system"`.

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add src/stores/settings-store.ts
git commit -m "feat(§54): add theme store with activeThemeId, customThemes, and migration"
```

---

### Task 3: Update App.tsx theme application logic

**Files:**
- Modify: `src/App.tsx`

**Step 1: Update the theme effect**

Replace the current theme effect (around line 245-252) with logic that:
1. Reads `activeThemeId` and `customThemes` from settings store
2. If `activeThemeId === "system"`: remove `data-theme` attr, clear all CSS var overrides
3. If built-in default (default-light/default-dark): set `data-theme` to base, clear CSS var overrides
4. Otherwise: find theme by id, set `data-theme` to base, apply CSS variable overrides via `document.documentElement.style.setProperty()`

```typescript
import { BUILT_IN_THEMES, findThemeById } from "./types/theme";
import type { ThemeColors } from "./types/theme";

// Inside App component:
const { activeThemeId, customThemes } = useSettingsStore();

useEffect(() => {
  const root = document.documentElement;
  const allKeys: (keyof ThemeColors)[] = [
    "--color-bg-primary", "--color-bg-secondary", "--color-bg-sidebar", "--color-bg-tertiary",
    "--color-text-primary", "--color-text-secondary", "--color-text-muted",
    "--color-border", "--color-border-light",
    "--color-accent", "--color-accent-hover",
    "--color-editor-bg", "--color-editor-text", "--color-editor-selection",
    "--color-editor-cursor", "--color-editor-line-highlight",
  ];

  // Clear previous overrides
  for (const key of allKeys) {
    root.style.removeProperty(key);
  }

  if (activeThemeId === "system") {
    root.removeAttribute("data-theme");
    return;
  }

  const theme = findThemeById(activeThemeId, customThemes);
  if (!theme) {
    root.removeAttribute("data-theme");
    return;
  }

  // Set base mode for CodeMirror/Mermaid
  root.dataset.theme = theme.base;

  // For non-default themes, apply CSS variable overrides
  const isDefault = activeThemeId === "default-light" || activeThemeId === "default-dark";
  if (!isDefault) {
    for (const [key, value] of Object.entries(theme.colors)) {
      root.style.setProperty(key, value);
    }
  }
}, [activeThemeId, customThemes]);
```

Also update the destructuring — replace `theme` with `activeThemeId, customThemes` in the `useSettingsStore()` call.

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(§54): apply theme via CSS variable overrides in App.tsx"
```

---

### Task 4: Update AppearanceTab with theme gallery

**Files:**
- Modify: `src/components/settings/SettingsModal.tsx`

**Step 1: Rewrite AppearanceTab**

Replace the current `AppearanceTab` function with a theme gallery that shows all built-in and custom themes as clickable cards, plus a "System" option.

Each theme card shows:
- Theme name
- 5 color swatches (bg-primary, text-primary, accent, bg-sidebar, border)
- Active indicator

Add buttons: "Customize" (opens theme editor), "Import Theme" (file picker), "New Theme" (creates from current).

Import `BUILT_IN_THEMES` from `../../types/theme` and `useSettingsStore` state.

The AppearanceTab should:
1. Show "System (Auto)" as a special card at the top
2. Show a grid of theme cards (built-in first, then custom)
3. Active theme has a highlighted border
4. "Customize" button below the gallery opens the ThemeEditor
5. Import/Export buttons

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add src/components/settings/SettingsModal.tsx
git commit -m "feat(§54): add theme gallery to Appearance tab"
```

---

### Task 5: Create ThemeEditor component

**Files:**
- Create: `src/components/settings/ThemeEditor.tsx`

**Step 1: Create the editor**

ThemeEditor receives a `ThemeDef` (or null for new theme), shows:
1. Theme name input
2. Base mode toggle (light/dark)
3. Color categories (Background, Text, Border, Accent, Editor) — each with color picker inputs using `<input type="color">`
4. "Save" and "Cancel" buttons
5. "Export" button (downloads JSON)
6. "Reset to Default" for built-in themes (reverts customization)

Use `THEME_COLOR_KEYS` from `src/types/theme.ts` to render color pickers grouped by category.

When saving: if editing a built-in theme, create a copy with `id: "custom-" + Date.now()` and `builtIn: false`. Call `saveCustomTheme()` then `setActiveTheme()`.

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add src/components/settings/ThemeEditor.tsx
git commit -m "feat(§54): add ThemeEditor component with color pickers"
```

---

### Task 6: Add CSS styles for theme gallery and editor

**Files:**
- Modify: `src/App.css`

**Step 1: Add theme gallery styles**

Add CSS for:
- `.theme-gallery` — grid layout for theme cards
- `.theme-card` — card with border, hover effect, active state
- `.theme-card-active` — highlighted border for active theme
- `.theme-card-swatches` — row of color preview circles
- `.theme-card-swatch` — individual color circle
- `.theme-card-name` — theme name label
- `.theme-card-badge` — "Custom" badge for user themes
- `.theme-card-actions` — delete button on hover for custom themes
- `.theme-editor` — container for color picker grid
- `.theme-editor-category` — section header
- `.theme-editor-row` — label + color picker row
- `.theme-editor-color` — styled `<input type="color">`
- `.theme-editor-hex` — hex value display next to picker
- `.theme-editor-actions` — save/cancel/export buttons
- `.theme-import-btn` — import button
- `.theme-system-card` — special "System" card style

All should use existing CSS variables for borders, text, etc. and support both light and dark modes.

**Step 2: Commit**

```bash
git add src/App.css
git commit -m "feat(§54): add theme gallery and editor CSS styles"
```

---

### Task 7: Wire up import/export and final integration

**Files:**
- Modify: `src/components/settings/SettingsModal.tsx`
- Modify: `src/components/settings/ThemeEditor.tsx`

**Step 1: Implement JSON import**

In AppearanceTab, add an "Import Theme" button that:
1. Opens a hidden `<input type="file" accept=".json">`
2. Reads the file as JSON
3. Validates it has required fields (`name`, `base`, `colors` with all 16 keys)
4. Generates `id: "custom-" + Date.now()`
5. Calls `saveCustomTheme()` and `setActiveTheme()`

**Step 2: Implement JSON export**

In ThemeEditor, "Export" button:
1. Creates a JSON blob from the current theme (excluding `builtIn` and `id`)
2. Downloads as `{theme-name}.json`

**Step 3: Verify TypeScript compiles and all tests pass**

Run: `npx tsc --noEmit`
Run: `npx vitest run`

**Step 4: Commit**

```bash
git add src/components/settings/SettingsModal.tsx src/components/settings/ThemeEditor.tsx
git commit -m "feat(§54): add theme import/export functionality"
```

---

### Task 8: Verify all tests pass + update docs

**Files:**
- Modify: `dev/progress.json`
- Modify: `dev/next-steps.md`

**Step 1: Run full test suite**

Run: `npx vitest run`
Run: `npx tsc --noEmit`
Expected: all pass, no regressions

**Step 2: Update progress.json**

Add `§54-theme-system` entry with status "completed".

**Step 3: Update next-steps.md**

Mark §54 as completed.

**Step 4: Commit**

```bash
git add dev/progress.json dev/next-steps.md
git commit -m "docs: mark §54 Theme System as completed"
```
