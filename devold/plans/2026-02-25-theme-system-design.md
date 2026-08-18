# §54 Theme System — Design

## Problem

Baram currently only supports light/dark/system theme toggle. Users cannot customize colors or choose from curated theme presets.

## Solution

CSS variable override approach. Themes are JSON objects mapping CSS variable names to color values. Built-in themes provide curated presets; custom themes are editable via a color picker UI in Settings.

## Data Model

```typescript
interface ThemeColors {
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

interface ThemeDef {
  id: string;              // "tokyo-night", "custom-abc123"
  name: string;            // "Tokyo Night"
  base: "light" | "dark";  // for CodeMirror/Mermaid
  colors: ThemeColors;
  builtIn: boolean;        // true = cannot delete/modify
}
```

## Built-in Themes (6)

| Theme | Base | Description |
|-------|------|-------------|
| Default Light | light | Current light mode colors |
| Default Dark | dark | Current dark mode colors |
| Tokyo Night | dark | Popular dark theme, blue tones |
| Solarized Light | light | Ethan Schoonover classic |
| Solarized Dark | dark | Ethan Schoonover classic |
| Nord | dark | Arctic, cool colors |

## Theme Application

Current: `data-theme="light"|"dark"` selects CSS variable block in App.css.

New:
1. Set `data-theme` to theme's `base` value ("light" or "dark")
2. For non-default themes: apply CSS variable overrides via `document.documentElement.style.setProperty()`
3. For default themes: clear inline style overrides
4. "System" mode: auto-select default-light or default-dark based on OS preference

## Theme Editor UI (Settings > Appearance)

1. **Theme Gallery**: Grid of theme cards with color preview swatches. Click to activate.
2. **Customize Button**: Opens color picker editor for the active theme. Creates a copy if built-in.
3. **Color Categories**:
   - Background (4): primary, secondary, sidebar, tertiary
   - Text (3): primary, secondary, muted
   - Border (2): border, border-light
   - Accent (2): accent, accent-hover
   - Editor (5): bg, text, selection, cursor, line-highlight
4. **Import/Export**: JSON file import/export for sharing themes
5. **Delete**: Remove custom themes (built-in cannot be deleted)

## Storage

In `settings-store.ts`:
- `activeThemeId: string` — replaces `theme: "light"|"dark"|"system"`
- `customThemes: ThemeDef[]` — user-created themes
- Actions: `setActiveTheme(id)`, `saveCustomTheme(theme)`, `deleteCustomTheme(id)`

Migration: old `theme: "system"` → `activeThemeId: "system"`, `theme: "light"` → `"default-light"`, `theme: "dark"` → `"default-dark"`.

## File Changes

| File | Change |
|------|--------|
| `src/types/theme.ts` (new) | ThemeColors, ThemeDef types + BUILT_IN_THEMES array |
| `src/stores/settings-store.ts` | Replace `theme`/`setTheme` with activeThemeId/customThemes + migration |
| `src/components/settings/SettingsModal.tsx` | Expand AppearanceTab with gallery + editor |
| `src/components/settings/ThemeEditor.tsx` (new) | Color picker theme editor |
| `src/App.tsx` | Theme application logic (CSS variable override) |
| `src/App.css` | Theme gallery/editor styles |
| `src/extensions/nodes/code-block-highlight.ts` | Use `base` field for highlight selection |
| `src/extensions/nodes/mermaid-block-view.tsx` | Use `base` field for Mermaid theme |

## CodeMirror / Mermaid Integration

Both currently check `document.documentElement.dataset.theme === "dark"`. This continues to work because we set `data-theme` to the theme's `base` value. No fundamental logic change needed, just ensure they respect the attribute.
