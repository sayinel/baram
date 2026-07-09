# Extension Settings System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable Extension-specific settings declared in `registry.json` to be auto-rendered in a new "Extensions" tab in the Settings modal.

**Architecture:** `registry.json` gains a `settings` array per Extension. A new `extensionSettings` map in the Zustand store persists key-value pairs. `ExtensionsTab.tsx` reads the registry at build time and renders UI controls for each setting automatically.

**Tech Stack:** React, Zustand (persist), TypeScript, Vite JSON import

---

### Task 1: Add `extensionSettings` to settings-store

**Files:**
- Modify: `src/stores/settings-store.ts`

**Step 1: Add extensionSettings state and actions**

In `src/stores/settings-store.ts`, add to the `SettingsState` interface:

```typescript
// Extension settings (dynamic key-value)
extensionSettings: Record<string, unknown>;
setExtensionSetting: (key: string, value: unknown) => void;
```

Add initial state and setter in the `create` call:

```typescript
extensionSettings: {},
setExtensionSetting: (key, value) =>
  set((state) => ({
    extensionSettings: { ...state.extensionSettings, [key]: value },
  })),
```

Add `extensionSettings` to the `partialize` function.

**Step 2: Migrate existing Extension settings into extensionSettings**

Move these 3 fields from top-level state into `extensionSettings` defaults:
- `codeBlockLineNumbers` (boolean, default: false)
- `codeBlockStyle` (string, default: "default")
- `diagrams` (boolean, default: true)

Remove the 3 fields and their individual setters from the interface. Remove them from `partialize`.

Add a Zustand `migrate` (version 1) in the persist config that moves old top-level keys into `extensionSettings`:

```typescript
version: 1,
migrate: (persisted: Record<string, unknown>) => {
  const state = persisted as Record<string, unknown>;
  const ext = (state.extensionSettings ?? {}) as Record<string, unknown>;
  for (const key of ["codeBlockLineNumbers", "codeBlockStyle", "diagrams"]) {
    if (key in state && !(key in ext)) {
      ext[key] = state[key];
      delete state[key];
    }
  }
  state.extensionSettings = ext;
  return state;
},
```

**Step 3: Add backward-compatible getters**

So existing code like `useSettingsStore((s) => s.codeBlockStyle)` keeps working, add **computed getters** via Zustand's store enhancer pattern. The simplest approach: keep the 3 fields as derived getters that read from `extensionSettings`:

```typescript
// In the create callback, after extensionSettings:
get codeBlockLineNumbers() {
  return (useSettingsStore.getState().extensionSettings.codeBlockLineNumbers ?? false) as boolean;
},
get codeBlockStyle() {
  return (useSettingsStore.getState().extensionSettings.codeBlockStyle ?? "default") as CodeBlockStyle;
},
get diagrams() {
  return (useSettingsStore.getState().extensionSettings.diagrams ?? true) as boolean;
},
```

Note: Zustand `create()` doesn't support getters inside the state factory. Instead, use a simpler approach — keep these as regular state fields, but sync them from `extensionSettings` inside `setExtensionSetting`:

```typescript
setExtensionSetting: (key, value) =>
  set((state) => {
    const newExt = { ...state.extensionSettings, [key]: value };
    const patch: Partial<SettingsState> = { extensionSettings: newExt };
    // Backward compat: sync legacy fields
    if (key === "codeBlockLineNumbers") patch.codeBlockLineNumbers = value as boolean;
    if (key === "codeBlockStyle") patch.codeBlockStyle = value as CodeBlockStyle;
    if (key === "diagrams") patch.diagrams = value as boolean;
    return patch;
  }),
```

Keep the 3 fields in the interface (read-only from Extension code's perspective), but remove individual setters (`setCodeBlockLineNumbers`, `setCodeBlockStyle`, `setDiagrams`). The Extensions tab will use `setExtensionSetting()` only.

**Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: clean compilation

**Step 5: Commit**

```bash
git add src/stores/settings-store.ts
git commit -m "refactor: add extensionSettings map with migration for Extension settings"
```

---

### Task 2: Add settings schema to registry.json

**Files:**
- Modify: `src/extensions/registry.json`

**Step 1: Add settings to codeBlock entry**

Find the `codeBlock` entry and add:

```json
"settings": [
  {
    "key": "codeBlockLineNumbers",
    "type": "boolean",
    "label": "Line Numbers",
    "description": "Show line numbers in code blocks",
    "default": false
  },
  {
    "key": "codeBlockStyle",
    "type": "select",
    "label": "Code Block Style",
    "description": "Visual style for code blocks",
    "default": "default",
    "options": [
      { "value": "default", "label": "Default" },
      { "value": "minimal", "label": "Minimal" },
      { "value": "contrast", "label": "Contrast" },
      { "value": "paper", "label": "Paper" }
    ]
  }
]
```

**Step 2: Add settings to mermaidBlock entry**

```json
"settings": [
  {
    "key": "diagrams",
    "type": "boolean",
    "label": "Enable Diagrams",
    "description": "Render Mermaid diagrams in code blocks",
    "default": true
  }
]
```

**Step 3: Commit**

```bash
git add src/extensions/registry.json
git commit -m "feat: add settings schema to registry.json for codeBlock and mermaidBlock"
```

---

### Task 3: Create ExtensionsTab component

**Files:**
- Create: `src/components/settings/ExtensionsTab.tsx`

**Step 1: Create the component**

```typescript
// Extension settings tab — auto-renders UI from registry.json settings schema
import registry from "../../extensions/registry.json";
import { useSettingsStore } from "../../stores/settings-store";

interface SettingOption {
  value: string;
  label: string;
}

interface SettingDef {
  key: string;
  type: "boolean" | "select" | "number" | "string";
  label: string;
  description: string;
  default: unknown;
  options?: SettingOption[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}

interface RegistryEntry {
  name: string;
  settings?: SettingDef[];
  [key: string]: unknown;
}

// Collect all extensions (nodes + marks + plugins) that have settings
function getExtensionsWithSettings(): { name: string; settings: SettingDef[] }[] {
  const all = [
    ...(registry.nodes as RegistryEntry[]),
    ...(registry.marks as RegistryEntry[]),
    ...(registry.plugins as RegistryEntry[]),
  ];
  return all
    .filter((ext) => ext.settings && ext.settings.length > 0)
    .map((ext) => ({
      name: ext.name,
      settings: ext.settings as SettingDef[],
    }));
}

// Human-readable name from camelCase
function formatName(name: string): string {
  return name
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

export function ExtensionsTab() {
  const extensions = getExtensionsWithSettings();
  const { extensionSettings, setExtensionSetting } = useSettingsStore();

  if (extensions.length === 0) {
    return (
      <div className="settings-section">
        <div className="settings-empty">No extension settings available.</div>
      </div>
    );
  }

  return (
    <div className="settings-section">
      {extensions.map((ext) => (
        <div key={ext.name}>
          <div className="settings-section-header">{formatName(ext.name)}</div>
          {ext.settings.map((setting) => (
            <ExtensionSettingRow
              key={setting.key}
              setting={setting}
              value={extensionSettings[setting.key] ?? setting.default}
              onChange={(val) => setExtensionSetting(setting.key, val)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function ExtensionSettingRow({
  setting,
  value,
  onChange,
}: {
  setting: SettingDef;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-info">
        <span className="settings-row-label">{setting.label}</span>
        <span className="settings-row-description">{setting.description}</span>
      </div>
      <div className="settings-row-control">
        {setting.type === "boolean" && (
          <button
            className={`settings-toggle ${value ? "settings-toggle-on" : ""}`}
            onClick={() => onChange(!value)}
            role="switch"
            aria-checked={!!value}
          >
            <span className="settings-toggle-thumb" />
          </button>
        )}
        {setting.type === "select" && setting.options && (
          <select
            className="settings-select"
            value={String(value)}
            onChange={(e) => onChange(e.target.value)}
          >
            {setting.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        )}
        {setting.type === "number" && (
          <input
            type="range"
            className="settings-range"
            min={setting.min ?? 0}
            max={setting.max ?? 100}
            step={setting.step ?? 1}
            value={Number(value)}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        )}
        {setting.type === "string" && (
          <input
            type="text"
            className="settings-input"
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
            placeholder={setting.placeholder}
          />
        )}
      </div>
    </div>
  );
}
```

**Step 2: Verify no TypeScript errors**

Run: `npx tsc --noEmit`
Expected: clean

**Step 3: Commit**

```bash
git add src/components/settings/ExtensionsTab.tsx
git commit -m "feat: add ExtensionsTab component with registry-based auto rendering"
```

---

### Task 4: Update SettingsModal — add Extensions tab, trim Markdown tab

**Files:**
- Modify: `src/components/settings/SettingsModal.tsx`

**Step 1: Add import for ExtensionsTab**

```typescript
import { ExtensionsTab } from "./ExtensionsTab";
```

**Step 2: Add "extensions" to TABS array**

```typescript
type SettingsTab = "general" | "editor" | "appearance" | "files" | "markdown" | "extensions" | "ai";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "editor", label: "Editor" },
  { id: "appearance", label: "Appearance" },
  { id: "files", label: "Files" },
  { id: "markdown", label: "Markdown" },
  { id: "extensions", label: "Extensions" },
  { id: "ai", label: "AI" },
];
```

**Step 3: Add rendering for Extensions tab**

In the settings-content div, add:

```tsx
{activeTab === "extensions" && <ExtensionsTab />}
```

**Step 4: Remove Extension settings from MarkdownTab**

Remove from MarkdownTab:
- `diagrams` toggle and its `useSettingsStore` destructuring
- `codeBlockLineNumbers` toggle
- `codeBlockStyle` select
- The "Code Blocks" section header

The MarkdownTab should only keep:
- Extended Syntax section: inlineMath, highlight, strikethrough
- Typography section: smartPunctuation

**Step 5: Remove unused setters from SettingsModal imports**

Since the 3 Extension setters are removed from `settings-store.ts`, remove any references to `setCodeBlockLineNumbers`, `setCodeBlockStyle`, `setDiagrams` from SettingsModal.

**Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: clean

**Step 7: Commit**

```bash
git add src/components/settings/SettingsModal.tsx
git commit -m "feat: add Extensions tab to Settings modal, trim Markdown tab"
```

---

### Task 5: Verify all tests pass + final commit

**Files:**
- (none new)

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (no regressions from settings refactor)

**Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: clean

**Step 3: Verify backward compat — existing Extension code unchanged**

Confirm that `src/extensions/nodes/code-block-node-view.ts` and `src/extensions/nodes/code-block-view.tsx` still compile without changes. They read `useSettingsStore((s) => s.codeBlockStyle)` and `useSettingsStore((s) => s.codeBlockLineNumbers)` which should still work via the compat fields.

**Step 4: Final squash commit if needed, or leave as-is**

If all passes, no further changes needed.
