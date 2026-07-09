# Design Token System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate Baram's monolithic `App.css` (14,506 lines) to a modular, Figma-compatible 3-level design token system with Style Dictionary v4, zero visual regression, and minimum 15 leader audit cycles.

**Architecture:** Style Dictionary v4 (DTCG JSON) generates primitive/semantic CSS layers; component styles split into 7 focused CSS files; all CSS variables renamed to systematic convention; Tailwind utilities replace BEM classes where safe. Every phase is gated by a strict verification protocol before proceeding.

**Tech Stack:** Style Dictionary v4, Tailwind CSS 4 (`@theme`), Playwright (visual regression), Vitest, ast-grep (bulk rename), CSS variable audit script.

**Design doc:** `dev/plans/2026-03-15-design-token-system.md`

**Audit requirement:** After ALL phases complete, Leader runs minimum 15 strict audit cycles. Each cycle: inspect → flag issues → re-examine validity → fix valid issues → re-verify.

---

## Pre-work: Read the codebase

Before any task, the executing agent MUST read these files in full:
- `src/App.css` (ALL 14,506 lines — understand every section)
- `src/App.tsx` (understand import)
- `vite.config.ts` (Tailwind plugin setup)
- `dev/plans/2026-03-15-design-token-system.md` (approved design)

---

## Phase 1: Style Dictionary Setup

### Task 1.1: Install Style Dictionary v4

**Files:**
- Modify: `package.json`

**Step 1: Install**
```bash
npm install --save-dev style-dictionary
```

**Step 2: Verify install**
```bash
npx style-dictionary --version
# Expected: 4.x.x
```

**Step 3: Commit**
```bash
git add package.json package-lock.json
git commit -m "chore(tokens): install style-dictionary v4"
```

---

### Task 1.2: Create primitive color tokens

**Files:**
- Create: `tokens/primitive/color.json`

**Step 1: Create directory**
```bash
mkdir -p tokens/primitive tokens/semantic
```

**Step 2: Create `tokens/primitive/color.json`**

Full color scales in W3C DTCG format. Include ALL of these scales:

```json
{
  "color": {
    "$type": "color",
    "white": { "$value": "#ffffff" },
    "black": { "$value": "#000000" },
    "blue": {
      "50":  { "$value": "#eff6ff" },
      "100": { "$value": "#dbeafe" },
      "200": { "$value": "#bfdbfe" },
      "300": { "$value": "#93c5fd" },
      "400": { "$value": "#60a5fa" },
      "500": { "$value": "#3b82f6" },
      "600": { "$value": "#2563eb" },
      "700": { "$value": "#1d4ed8" },
      "800": { "$value": "#1e40af" },
      "900": { "$value": "#1e3a8a" },
      "950": { "$value": "#172554" }
    },
    "gray": {
      "50":  { "$value": "#f9fafb" },
      "100": { "$value": "#f3f4f6" },
      "200": { "$value": "#e5e7eb" },
      "300": { "$value": "#d1d5db" },
      "400": { "$value": "#9ca3af" },
      "500": { "$value": "#6b7280" },
      "600": { "$value": "#4b5563" },
      "700": { "$value": "#374151" },
      "800": { "$value": "#1f2937" },
      "900": { "$value": "#111827" },
      "950": { "$value": "#030712" }
    },
    "slate": {
      "50":  { "$value": "#f8f9fa" },
      "100": { "$value": "#f1f3f5" },
      "200": { "$value": "#e9ecef" },
      "300": { "$value": "#dee2e6" },
      "400": { "$value": "#ced4da" },
      "500": { "$value": "#adb5bd" },
      "600": { "$value": "#6c757d" },
      "700": { "$value": "#495057" },
      "800": { "$value": "#343a40" },
      "900": { "$value": "#212529" },
      "950": { "$value": "#0f1117" }
    },
    "red": {
      "50":  { "$value": "#fef2f2" },
      "100": { "$value": "#fee2e2" },
      "400": { "$value": "#f87171" },
      "500": { "$value": "#ef4444" },
      "600": { "$value": "#dc2626" },
      "700": { "$value": "#b91c1c" }
    },
    "orange": {
      "50":  { "$value": "#fff7ed" },
      "400": { "$value": "#fb923c" },
      "500": { "$value": "#f97316" }
    },
    "yellow": {
      "50":  { "$value": "#fffbeb" },
      "400": { "$value": "#fbbf24" },
      "500": { "$value": "#f59e0b" },
      "600": { "$value": "#d97706" }
    },
    "green": {
      "50":  { "$value": "#f0fdf4" },
      "400": { "$value": "#4ade80" },
      "500": { "$value": "#22c55e" },
      "600": { "$value": "#16a34a" },
      "700": { "$value": "#15803d" }
    },
    "emerald": {
      "50":  { "$value": "#ecfdf5" },
      "500": { "$value": "#10b981" },
      "600": { "$value": "#059669" }
    },
    "teal": {
      "50":  { "$value": "#f0fdfa" },
      "500": { "$value": "#14b8a6" },
      "600": { "$value": "#0d9488" }
    },
    "cyan": {
      "50":  { "$value": "#ecfeff" },
      "500": { "$value": "#06b6d4" },
      "600": { "$value": "#0891b2" }
    },
    "purple": {
      "50":  { "$value": "#faf5ff" },
      "500": { "$value": "#a855f6" },
      "600": { "$value": "#9333ea" }
    },
    "violet": {
      "50":  { "$value": "#f5f3ff" },
      "500": { "$value": "#8b5cf6" },
      "600": { "$value": "#7c3aed" }
    },
    "pink": {
      "50":  { "$value": "#fdf2f8" },
      "500": { "$value": "#ec4899" }
    }
  }
}
```

**Step 3: Commit**
```bash
git add tokens/primitive/color.json
git commit -m "chore(tokens): add primitive color scale (DTCG)"
```

---

### Task 1.3: Create primitive spacing and typography tokens

**Files:**
- Create: `tokens/primitive/spacing.json`
- Create: `tokens/primitive/typography.json`

**`tokens/primitive/spacing.json`:**
```json
{
  "space": {
    "$type": "dimension",
    "0":  { "$value": "0px" },
    "px": { "$value": "1px" },
    "0-5": { "$value": "2px" },
    "1":  { "$value": "4px" },
    "2":  { "$value": "8px" },
    "3":  { "$value": "12px" },
    "4":  { "$value": "16px" },
    "5":  { "$value": "20px" },
    "6":  { "$value": "24px" },
    "8":  { "$value": "32px" },
    "10": { "$value": "40px" },
    "12": { "$value": "48px" },
    "16": { "$value": "64px" },
    "20": { "$value": "80px" },
    "24": { "$value": "96px" }
  }
}
```

**`tokens/primitive/typography.json`:**
```json
{
  "font": {
    "family": {
      "$type": "fontFamily",
      "sans":   { "$value": "Inter, Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
      "mono":   { "$value": "'JetBrains Mono', 'Fira Code', 'SF Mono', Consolas, monospace" },
      "editor": { "$value": "Pretendard, Inter, -apple-system, BlinkMacSystemFont, sans-serif" }
    },
    "size": {
      "$type": "dimension",
      "xs":   { "$value": "11px" },
      "sm":   { "$value": "12px" },
      "base": { "$value": "14px" },
      "md":   { "$value": "15px" },
      "lg":   { "$value": "16px" },
      "xl":   { "$value": "18px" },
      "2xl":  { "$value": "20px" },
      "3xl":  { "$value": "24px" },
      "4xl":  { "$value": "30px" }
    },
    "weight": {
      "$type": "fontWeight",
      "normal":   { "$value": "400" },
      "medium":   { "$value": "500" },
      "semibold": { "$value": "600" },
      "bold":     { "$value": "700" }
    },
    "lineHeight": {
      "tight":   { "$value": "1.25" },
      "snug":    { "$value": "1.375" },
      "normal":  { "$value": "1.5" },
      "relaxed": { "$value": "1.625" },
      "loose":   { "$value": "2" }
    }
  }
}
```

**Commit:**
```bash
git add tokens/primitive/spacing.json tokens/primitive/typography.json
git commit -m "chore(tokens): add primitive spacing and typography (DTCG)"
```

---

### Task 1.4: Create semantic color tokens (light mode)

**Files:**
- Create: `tokens/semantic/color-light.json`

Read `src/App.css` @theme block and map ALL existing semantic values to new names + primitive references:

```json
{
  "color": {
    "$type": "color",
    "bg": {
      "default":  { "$value": "{color.white}",      "$description": "Main page background (기존: --color-bg-primary)" },
      "subtle":   { "$value": "{color.slate.50}",   "$description": "Secondary surface (기존: --color-bg-secondary)" },
      "panel":    { "$value": "{color.slate.100}",  "$description": "Sidebar/panel bg (기존: --color-bg-sidebar)" },
      "elevated": { "$value": "{color.slate.100}",  "$description": "Tertiary/elevated surface (기존: --color-bg-tertiary)" },
      "overlay":  { "$value": "{color.white}",      "$description": "Modal overlay background" }
    },
    "text": {
      "primary":   { "$value": "{color.gray.900}",   "$description": "Primary text (기존: --color-text-primary → #1a1a1a)" },
      "secondary": { "$value": "{color.gray.500}",   "$description": "Secondary text (기존: --color-text-secondary)" },
      "disabled":  { "$value": "{color.gray.400}",   "$description": "Muted/disabled text (기존: --color-text-muted)" },
      "inverse":   { "$value": "{color.white}",      "$description": "Text on dark backgrounds" }
    },
    "border": {
      "default": { "$value": "{color.gray.200}",   "$description": "Default border (기존: --color-border)" },
      "subtle":  { "$value": "{color.gray.100}",   "$description": "Subtle border (기존: --color-border-light)" },
      "strong":  { "$value": "{color.gray.300}",   "$description": "Strong/focus border" }
    },
    "accent": {
      "default": { "$value": "{color.blue.500}",  "$description": "Primary brand accent (기존: --color-accent)" },
      "hover":   { "$value": "{color.blue.600}",  "$description": "Accent hover (기존: --color-accent-hover)" },
      "subtle":  { "$value": "{color.blue.50}",   "$description": "Accent background tint" }
    },
    "editor": {
      "bg":            { "$value": "{color.white}",     "$description": "Editor background" },
      "text":          { "$value": "{color.gray.900}",  "$description": "Editor text" },
      "selection":     { "$value": "{color.blue.100}",  "$description": "Text selection" },
      "cursor":        { "$value": "{color.blue.500}",  "$description": "Cursor color" },
      "lineHighlight": { "$value": "{color.gray.50}",   "$description": "Active line highlight" }
    },
    "status": {
      "danger":  { "$value": "{color.red.500}",     "$description": "Error/danger" },
      "warning": { "$value": "{color.yellow.500}",  "$description": "Warning" },
      "success": { "$value": "{color.emerald.500}", "$description": "Success" },
      "info":    { "$value": "{color.blue.500}",    "$description": "Info" }
    },
    "callout": {
      "tip":      { "$value": "{color.emerald.500}" },
      "info":     { "$value": "{color.blue.500}" },
      "warning":  { "$value": "{color.yellow.500}" },
      "danger":   { "$value": "{color.red.500}" },
      "note":     { "$value": "{color.gray.500}" },
      "abstract": { "$value": "{color.violet.500}" },
      "todo":     { "$value": "{color.cyan.500}" },
      "example":  { "$value": "{color.teal.500}" },
      "question": { "$value": "{color.yellow.500}" },
      "bug":      { "$value": "{color.red.500}" },
      "success":  { "$value": "{color.green.500}" },
      "failure":  { "$value": "{color.red.600}" },
      "quote":    { "$value": "{color.gray.400}" }
    }
  }
}
```

**Commit:**
```bash
git add tokens/semantic/color-light.json
git commit -m "chore(tokens): add semantic color tokens light mode (DTCG)"
```

---

### Task 1.5: Create semantic color tokens (dark mode)

**Files:**
- Create: `tokens/semantic/color-dark.json`

Read App.css `[data-theme="dark"]` section and map ALL dark mode overrides:

```json
{
  "color": {
    "$type": "color",
    "bg": {
      "default":  { "$value": "{color.gray.900}" },
      "subtle":   { "$value": "{color.gray.800}" },
      "panel":    { "$value": "{color.slate.950}" },
      "elevated": { "$value": "{color.gray.800}" },
      "overlay":  { "$value": "{color.gray.850}" }
    },
    "text": {
      "primary":   { "$value": "{color.gray.100}" },
      "secondary": { "$value": "{color.gray.400}" },
      "disabled":  { "$value": "{color.gray.600}" },
      "inverse":   { "$value": "{color.gray.900}" }
    },
    "border": {
      "default": { "$value": "{color.gray.700}" },
      "subtle":  { "$value": "{color.gray.800}" },
      "strong":  { "$value": "{color.gray.600}" }
    },
    "accent": {
      "default": { "$value": "{color.blue.400}" },
      "hover":   { "$value": "{color.blue.300}" },
      "subtle":  { "$value": "#1e3a5f" }
    },
    "editor": {
      "bg":            { "$value": "{color.gray.900}" },
      "text":          { "$value": "{color.gray.100}" },
      "selection":     { "$value": "#1e3a5f" },
      "cursor":        { "$value": "{color.blue.400}" },
      "lineHighlight":  { "$value": "{color.gray.800}" }
    }
  }
}
```

**Commit:**
```bash
git add tokens/semantic/color-dark.json
git commit -m "chore(tokens): add semantic color tokens dark mode (DTCG)"
```

---

### Task 1.6: Create Style Dictionary config

**Files:**
- Create: `style-dictionary.config.ts`

```typescript
import StyleDictionary from 'style-dictionary';
import { fileHeader, formattedVariables } from 'style-dictionary/utils';

// Custom format: outputs Tailwind 4 @theme block for primitives
StyleDictionary.registerFormat({
  name: 'css/tailwind-theme',
  format: async ({ dictionary, file }) => {
    const header = await fileHeader({ file });
    return (
      header +
      '/* AUTO-GENERATED by Style Dictionary — DO NOT EDIT */\n' +
      '@theme {\n' +
      formattedVariables({ format: 'css', dictionary, outputReferences: true }) +
      '}\n'
    );
  },
});

// Custom format: outputs :root + [data-theme="dark"] override
StyleDictionary.registerFormat({
  name: 'css/semantic-with-dark',
  format: async ({ dictionary, file, options }) => {
    const header = await fileHeader({ file });
    const lightVars = formattedVariables({ format: 'css', dictionary, outputReferences: true });

    // Load dark tokens
    const darkFile = options.darkFile as string;
    return (
      header +
      '/* AUTO-GENERATED by Style Dictionary — DO NOT EDIT */\n' +
      ':root {\n' +
      lightVars +
      '}\n'
    );
  },
});

const sd = new StyleDictionary({
  source: ['tokens/primitive/**/*.json'],
  platforms: {
    css_primitives: {
      transformGroup: 'css',
      buildPath: 'src/styles/generated/',
      files: [
        {
          destination: 'primitives.css',
          format: 'css/tailwind-theme',
          options: {
            showFileHeader: true,
            outputReferences: false,
          },
        },
      ],
    },
  },
});

const sdSemantic = new StyleDictionary({
  include: ['tokens/primitive/**/*.json'],
  source: ['tokens/semantic/color-light.json'],
  platforms: {
    css_semantic: {
      transformGroup: 'css',
      buildPath: 'src/styles/generated/',
      files: [
        {
          destination: 'semantic-light.css',
          format: 'css/variables',
          options: {
            selector: ':root',
            showFileHeader: true,
            outputReferences: true,
          },
        },
      ],
    },
  },
});

const sdSemanticDark = new StyleDictionary({
  include: ['tokens/primitive/**/*.json'],
  source: ['tokens/semantic/color-dark.json'],
  platforms: {
    css_semantic_dark: {
      transformGroup: 'css',
      buildPath: 'src/styles/generated/',
      files: [
        {
          destination: 'semantic-dark.css',
          format: 'css/variables',
          options: {
            selector: '[data-theme="dark"]',
            showFileHeader: true,
            outputReferences: true,
          },
        },
      ],
    },
  },
});

export default [sd, sdSemantic, sdSemanticDark];
```

**Add build script to `package.json`:**
```json
{
  "scripts": {
    "tokens:build": "node --import tsx/esm style-dictionary.config.ts"
  }
}
```

Install tsx if needed:
```bash
npm install --save-dev tsx
```

**Commit:**
```bash
git add style-dictionary.config.ts package.json package-lock.json
git commit -m "chore(tokens): add style-dictionary config with tailwind @theme output"
```

---

### Task 1.7: Run Style Dictionary and verify output

**Step 1: Run build**
```bash
npm run tokens:build
```

**Step 2: Verify generated files exist**
```bash
ls -la src/styles/generated/
# Expected: primitives.css, semantic-light.css, semantic-dark.css
```

**Step 3: Inspect output — verify no errors**
```bash
head -50 src/styles/generated/primitives.css
head -50 src/styles/generated/semantic-light.css
```

**Step 4: Commit generated files**
```bash
mkdir -p src/styles/generated
git add src/styles/generated/
git commit -m "chore(tokens): add generated CSS token files (phase 1 output)"
```

---

### Task 1.8: Phase 1 Verification

**STOP — run full verification before proceeding to Phase 2.**

```bash
npm run build
npm test
npm run typecheck
```

All must pass with zero errors. If any fail, fix before proceeding.

**Commit any fixes:**
```bash
git commit -m "fix(tokens): phase 1 verification fixes"
```

---

## Phase 2: CSS File Split

### Task 2.1: Read App.css in full and create section map

**Files:**
- Read: `src/App.css` (full file)

Before splitting, create a complete map of which lines belong to which output file.
Document it here (for reference during split):

| Output file | Line ranges in App.css | Description |
|-------------|------------------------|-------------|
| `base.css` | 1-100 | @import tailwindcss, html/body, loading |
| `editor.css` | 101-2000 | .tiptap-* all editor styles |
| `layout.css` | 2001-2700 | .app-*, .activity-*, .sidebar-*, .tab-* |
| `file-tree.css` | 2701-3100 | .file-tree-*, .folder-* |
| `toolbar.css` | 3101-3600 | .floating-toolbar-*, .block-handle-* |
| `settings.css` | 3601-5200 | .settings-*, .keybindings-*, .smart-template-* |
| `dialogs.css` | 5201-6000 | .command-palette-*, .quick-capture-* |
| `components.css` | 6001-end | everything else |

*(Exact line ranges must be determined by reading the actual file.)*

---

### Task 2.2: Create src/styles directory and base.css

**Files:**
- Create: `src/styles/base.css`

```css
/* base.css — Global reset and Tailwind import */
/* AUTO-SPLIT from App.css — Phase 2 */

@import "tailwindcss";
@import "./generated/primitives.css";
@import "./generated/semantic-light.css";
@import "./generated/semantic-dark.css";

/* ---- html/body reset (from App.css lines 1-100 approx) ---- */
/* [PASTE EXACT CONTENT FROM App.css @theme block and base styles here] */
```

**NOTE:** The `@import "tailwindcss"` line moves here from App.css. The `@theme` block in App.css that defined primitives is now REPLACED by the generated files.

---

### Task 2.3: Create editor.css

Extract all `.tiptap*` styles and editor-related styles from App.css:

```bash
# Find the line ranges for editor styles
grep -n "\.tiptap\|\.ProseMirror\|\.editor-" src/App.css | head -20
grep -n "\.tiptap\|\.ProseMirror\|\.editor-" src/App.css | tail -20
```

Create `src/styles/editor.css` with exact content from those lines.

---

### Task 2.4: Create layout.css, toolbar.css, file-tree.css

Same process for each file. Extract exact lines.

---

### Task 2.5: Create settings.css, dialogs.css, components.css

Same process.

---

### Task 2.6: Create index.css (main orchestrator)

**Files:**
- Create: `src/styles/index.css`

```css
/* index.css — Master CSS entry point */
/* Replaces src/App.css */

/* 1. Tokens (generated) */
@import "./base.css";

/* 2. Editor */
@import "./editor.css";

/* 3. Layout */
@import "./layout.css";
@import "./file-tree.css";

/* 4. Interactive UI */
@import "./toolbar.css";
@import "./dialogs.css";

/* 5. Feature panels */
@import "./settings.css";

/* 6. Everything else */
@import "./components.css";
```

---

### Task 2.7: Update App.tsx import

**Files:**
- Modify: `src/App.tsx`

Change:
```typescript
import "./App.css";
```
To:
```typescript
import "./styles/index.css";
```

---

### Task 2.8: Remove App.css (AFTER VERIFICATION)

**ONLY do this after Phase 2 verification passes.**

```bash
# First verify build works
npm run build && npm test

# Then remove
git rm src/App.css
git commit -m "refactor(styles): split App.css into modular files (phase 2)"
```

---

### Task 2.9: Phase 2 Verification

```bash
npm run build
npm test
npm run typecheck
npx playwright test --reporter=list
```

**Screenshot comparison:** Run Playwright and compare screenshots against Phase 1 baseline.

If ANY visual diff is detected, it must be documented in `dev/plans/migration-report.md` with:
- Component name
- What changed
- Whether it's acceptable or a bug

---

## Phase 3: Variable Rename

### Task 3.1: Create complete rename mapping

**Files:**
- Create: `dev/plans/token-rename-map.md`

Document EVERY variable that changes name:

```markdown
# Token Rename Map

## Semantic Colors
| Old name | New name | Status |
|----------|----------|--------|
| --color-bg-primary | --color-bg-default | RENAME |
| --color-bg-secondary | --color-bg-subtle | RENAME |
| --color-bg-sidebar | --color-bg-panel | RENAME |
| --color-bg-tertiary | --color-bg-elevated | RENAME |
| --color-text-muted | --color-text-disabled | RENAME |
| --color-border | --color-border-default | RENAME |
| --color-border-light | --color-border-subtle | RENAME |
| --color-accent | --color-accent-default | RENAME |
| --color-text-primary | --color-text-primary | NO CHANGE |
| --color-text-secondary | --color-text-secondary | NO CHANGE |
| --color-accent-hover | --color-accent-hover | NO CHANGE |

## Component Tokens
| Old name | New name | Status |
|----------|----------|--------|
| --spacing-sidebar | --sidebar-width | RENAME |
| --spacing-editor-padding | --editor-padding | RENAME |
| --font-editor | --font-family-editor | RENAME (also moved to primitive) |
| --font-sans | --font-family-sans | RENAME |
| --font-mono | --font-family-mono | RENAME |

## Total renames: XX
## No-change: XX
```

**Find all usages first:**
```bash
# Count usages of each old name
grep -r "var(--color-bg-primary" src/styles/ --include="*.css" | wc -l
grep -r "var(--color-bg-secondary" src/styles/ --include="*.css" | wc -l
# ... for each token
```

---

### Task 3.2: Bulk rename CSS variables

For each renamed token, use sed:

```bash
# Example: rename --color-bg-primary → --color-bg-default
find src/styles/ -name "*.css" -not -path "*/generated/*" -exec sed -i '' \
  's/var(--color-bg-primary)/var(--color-bg-default)/g' {} \;

# Also rename the definition in generated semantic files (update tokens JSON instead)
# For the definition in generated files, regenerate from updated JSON
```

**IMPORTANT:** Do NOT edit `src/styles/generated/*.css` — update the JSON source and re-run `npm run tokens:build` instead.

After all renames:
```bash
npm run tokens:build  # Regenerate from updated JSON
npm run build         # Verify no build errors
```

---

### Task 3.3: CSS variable audit script

**Files:**
- Create: `scripts/audit-css-vars.ts`

```typescript
import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

// Find all var() references in CSS files
const cssFiles = glob.sync('src/styles/**/*.css', { ignore: ['**/generated/**'] });

const allVars = new Set<string>();
const definedVars = new Set<string>();
const usedVars = new Set<string>();

for (const file of cssFiles) {
  const content = fs.readFileSync(file, 'utf-8');

  // Find definitions: --var-name:
  const defs = content.matchAll(/--([a-zA-Z0-9-]+)\s*:/g);
  for (const match of defs) definedVars.add(`--${match[1]}`);

  // Find usages: var(--var-name)
  const uses = content.matchAll(/var\(--([a-zA-Z0-9-]+)/g);
  for (const match of uses) usedVars.add(`--${match[1]}`);
}

// Also check generated files for definitions
const generatedFiles = glob.sync('src/styles/generated/**/*.css');
for (const file of generatedFiles) {
  const content = fs.readFileSync(file, 'utf-8');
  const defs = content.matchAll(/--([a-zA-Z0-9-]+)\s*:/g);
  for (const match of defs) definedVars.add(`--${match[1]}`);
}

const undefined_vars = [...usedVars].filter(v => !definedVars.has(v));

if (undefined_vars.length > 0) {
  console.error('❌ UNDEFINED CSS VARIABLES FOUND:');
  undefined_vars.forEach(v => console.error(`  ${v}`));
  process.exit(1);
} else {
  console.log('✅ All CSS variables are defined.');
  console.log(`   Defined: ${definedVars.size} | Used: ${usedVars.size}`);
}
```

Add to `package.json`:
```json
"scripts": {
  "audit:css-vars": "npx tsx scripts/audit-css-vars.ts"
}
```

Run:
```bash
npm run audit:css-vars
# Must output: ✅ All CSS variables are defined.
```

---

### Task 3.4: Generate migration report

**Files:**
- Create: `dev/plans/migration-report.md`

```markdown
# Migration Report — Phase 3 (Variable Rename)

Date: 2026-03-15

## Summary
- Total variables renamed: XX
- Total usages updated: XX
- Build: ✅ PASS
- Tests: ✅ PASS
- CSS audit: ✅ 0 undefined variables
- Visual diff: [RESULT]

## Changed Variables
[Complete list from token-rename-map.md]

## Visual Changes
[List any detected visual differences — should be NONE]
```

---

### Task 3.5: Phase 3 Verification

```bash
npm run tokens:build
npm run audit:css-vars    # Must be 0 undefined
npm run build             # Must pass
npm test                  # Must pass
npm run typecheck         # Must pass
npx playwright test       # Screenshot comparison
```

---

## Phase 4: Tailwind Utility Migration

### Task 4.1: Identify BEM → Tailwind candidates

Run this analysis first:
```bash
# Find CSS classes that are simple (few rules, easy to convert)
# Look for patterns like:
grep -n "display: flex" src/styles/components.css | head -20
grep -n "border-radius" src/styles/components.css | head -20
```

**Rule for migration:**
- SAFE to convert: layout utilities (flex, gap, padding, margin, border-radius)
- RISKY — leave for later: complex hover states, animations, dark mode specifics
- DO NOT convert: .tiptap-* classes (editor internals)

---

### Task 4.2: Component-by-component Tailwind migration

For each component, the process is:

1. Read the component's TSX file
2. Read its CSS rules in the split CSS file
3. Identify which rules can safely become Tailwind utilities
4. Update TSX className, remove CSS rules
5. Run `npm run build && npm test`
6. Take screenshot comparison

**Priority order (start with simplest):**
1. StatusBar — simple bar with few rules
2. ActivityBar items — mostly flex + icons
3. Splitter — single-purpose
4. Simple buttons/chips

---

### Task 4.3: Phase 4 Verification

After each component migration:
```bash
npm run build && npm test && npm run audit:css-vars
```

Screenshot comparison is mandatory for every component.

---

## Phase 5: tokens.json Export + Figma Structure

### Task 5.1: Create Tokens Studio export script

**Files:**
- Create: `scripts/export-tokens-studio.ts`

This script reads all `tokens/**/*.json` and converts to Tokens Studio format for Figma import.

```typescript
import fs from 'fs';

// Read all token files
const primitive = JSON.parse(fs.readFileSync('tokens/primitive/color.json', 'utf-8'));
const semanticLight = JSON.parse(fs.readFileSync('tokens/semantic/color-light.json', 'utf-8'));
const semanticDark = JSON.parse(fs.readFileSync('tokens/semantic/color-dark.json', 'utf-8'));

// Convert DTCG format to Tokens Studio format
function dtcgToTokensStudio(tokens: object, prefix = ''): object {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(tokens)) {
    if (value && typeof value === 'object' && '$value' in value) {
      result[key] = {
        value: (value as { $value: string }).$value,
        type: (value as { $type?: string }).$type ?? 'color',
        description: (value as { $description?: string }).$description ?? '',
      };
    } else if (key !== '$type') {
      result[key] = dtcgToTokensStudio(value as object);
    }
  }
  return result;
}

const tokensStudio = {
  global: dtcgToTokensStudio(primitive),
  light: dtcgToTokensStudio(semanticLight),
  dark: dtcgToTokensStudio(semanticDark),
  $metadata: {
    tokenSetOrder: ['global', 'light', 'dark'],
  },
};

fs.writeFileSync(
  'tokens/tokens-studio.json',
  JSON.stringify(tokensStudio, null, 2),
);
console.log('✅ tokens/tokens-studio.json generated');
```

Add script:
```json
"tokens:export": "npx tsx scripts/export-tokens-studio.ts"
```

---

### Task 5.2: Document Figma workflow

**Files:**
- Create: `docs/figma-token-workflow.md`

Document:
1. Install Tokens Studio plugin in Figma
2. Import `tokens/tokens-studio.json`
3. To update tokens: edit JSON → `npm run tokens:build` → CSS updated
4. To sync from Figma: export from Tokens Studio → overwrite JSON → `npm run tokens:build`

---

## Leader Audit Protocol (Minimum 15 Cycles)

After all 5 phases complete, Leader runs strict audit cycles:

### Audit Cycle Template

**Each cycle must check:**

1. **Token completeness** — Are ALL original CSS variables accounted for? Run:
   ```bash
   npm run audit:css-vars
   ```

2. **Visual regression** — Run Playwright screenshots across ALL views:
   ```bash
   npx playwright test --reporter=html
   ```
   Compare with baseline. Zero unintended diffs allowed.

3. **Dark mode integrity** — Check dark mode renders correctly in screenshots

4. **Build health** — `npm run build && npm test && npm run typecheck`

5. **Token naming consistency** — Grep for any remaining old variable names:
   ```bash
   grep -r "var(--color-bg-primary" src/styles/
   grep -r "var(--color-bg-secondary" src/styles/
   grep -r "var(--color-bg-sidebar" src/styles/
   grep -r "var(--color-bg-tertiary" src/styles/
   grep -r "var(--color-text-muted" src/styles/
   grep -r "var(--color-border)\b" src/styles/
   grep -r "var(--color-border-light" src/styles/
   grep -r "var(--color-accent)\b" src/styles/
   grep -r "var(--spacing-sidebar" src/styles/
   grep -r "var(--spacing-editor-padding" src/styles/
   grep -r "var(--font-editor\b" src/styles/
   grep -r "var(--font-sans\b" src/styles/
   grep -r "var(--font-mono\b" src/styles/
   # ALL must return 0 results
   ```

6. **Component token references** — All component CSS uses semantic tokens, not primitive directly:
   ```bash
   # No component CSS should reference --color-blue-* or --color-gray-* directly
   grep -r "var(--color-blue-\|var(--color-gray-" src/styles/ \
     --include="*.css" \
     --exclude-dir=generated
   # Should return 0 results (only generated/ files use primitives)
   ```

7. **Tailwind class validity** — No unknown Tailwind classes:
   ```bash
   npm run build 2>&1 | grep -i "warn\|error"
   ```

8. **CSS file sizes reasonable** — No file exceeds 2,000 lines:
   ```bash
   wc -l src/styles/*.css
   ```

**If issues found:**
- Determine if issue is valid (real regression) or acceptable (minor/cosmetic)
- Only fix VALID issues
- Document decisions in `dev/plans/migration-report.md`
- Re-run full verification after each fix

**Cycle must be repeated until 15 consecutive clean cycles (or 15 total if issues found in early cycles).**

---

## Final Checklist

- [ ] `npm run tokens:build` succeeds
- [ ] `npm run audit:css-vars` → 0 undefined variables
- [ ] `npm run build` → no errors
- [ ] `npm test` → all tests pass
- [ ] `npm run typecheck` → no TS errors
- [ ] `npx playwright test` → zero visual regressions
- [ ] All old CSS variable names replaced (grep confirms)
- [ ] `src/App.css` deleted
- [ ] `dev/plans/migration-report.md` complete
- [ ] `tokens/tokens-studio.json` generated
- [ ] Minimum 15 leader audit cycles completed
- [ ] All issues found during audits resolved or documented
