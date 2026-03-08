# Settings Redesign P0 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reorganize the 8-tab settings modal into 5 merged categories with search functionality and theme mini-preview.

**Architecture:** Refactor `SettingsModal.tsx` to merge General+Files, Appearance+Workspace, Markdown+Extensions into unified tabs. Add a search bar that filters settings by label/description. Replace theme color swatches with a mini editor mockup showing actual theme appearance. The existing side-navigation layout is preserved but widened.

**Tech Stack:** React, TypeScript, CSS (existing App.css patterns), Zustand settings-store

---

## Overview

| Task | Description | Files |
|------|-------------|-------|
| 1 | Restructure nav: merge tabs, update types | `SettingsModal.tsx` |
| 2 | Merge Files → General tab | `SettingsModal.tsx` |
| 3 | Merge Extensions → Markdown tab | `SettingsModal.tsx` |
| 4 | Merge Workspace → Appearance tab | `SettingsModal.tsx` |
| 5 | Add settings search | `SettingsModal.tsx`, `App.css` |
| 6 | Theme mini editor preview | `SettingsModal.tsx`, `App.css` |
| 7 | Widen modal + polish CSS | `App.css` |
| 8 | Build verification | — |

---

### Task 1: Restructure Navigation — Merge Tabs and Update Types

**Files:**
- Modify: `src/components/settings/SettingsModal.tsx:22-76`

**Step 1: Update SettingsTab type and TABS array**

Replace lines 22-33:

```tsx
type SettingsTab = "general" | "editor" | "appearance" | "markdown" | "ai";

const TABS: { id: SettingsTab; label: string; icon: string }[] = [
  { id: "general", label: "General", icon: "⚙" },
  { id: "editor", label: "Editor", icon: "✎" },
  { id: "appearance", label: "Appearance", icon: "◑" },
  { id: "markdown", label: "Markdown", icon: "M↓" },
  { id: "ai", label: "AI", icon: "✦" },
];
```

**Step 2: Update render switch in settings-content**

Replace lines 62-71 content rendering:

```tsx
<div className="settings-content">
  {activeTab === "general" && <GeneralTab />}
  {activeTab === "editor" && <EditorTab />}
  {activeTab === "appearance" && <AppearanceTab />}
  {activeTab === "markdown" && <MarkdownTab />}
  {activeTab === "ai" && <AITab />}
</div>
```

**Step 3: Update nav rendering to show icons**

Replace lines 52-60:

```tsx
{TABS.map((tab) => (
  <button
    key={tab.id}
    className={`settings-nav-item ${activeTab === tab.id ? "settings-nav-active" : ""}`}
    onClick={() => setActiveTab(tab.id)}
  >
    <span className="settings-nav-icon">{tab.icon}</span>
    {tab.label}
  </button>
))}
```

**Step 4: Remove unused imports**

Remove the `ExtensionsTab` and `WorkspaceTab` imports (lines 11-12) since their content will be inlined.

**Step 5: Run build to check for type errors**

Run: `cd /Users/donghoon.yoo/work/projects/baram && npx tsc --noEmit 2>&1 | head -30`
Expected: May show errors for removed tabs — will fix in next tasks.

---

### Task 2: Merge Files Tab Content into General Tab

**Files:**
- Modify: `src/components/settings/SettingsModal.tsx` — `GeneralTab` and `FilesTab` functions

**Step 1: Add Files settings to GeneralTab destructuring**

In `GeneralTab()` (line 80-98), add to the `useSettingsStore()` destructuring:

```tsx
const {
  // ...existing fields...
  wikilinkFormat, setWikilinkFormat,
  autoUpdateLinks, setAutoUpdateLinks,
  snapshotInterval, setSnapshotInterval,
  snapshotMaxCount, setSnapshotMaxCount,
} = useSettingsStore();
```

**Step 2: Add Links & Snapshots sections before the Journal section**

Insert after the "System" section (after line 144, before the Journal section header):

```tsx
<SettingsSectionHeader title="Links" />

<SettingsRow label="Internal Link Format" description="How internal links are written in Markdown">
  <select
    className="settings-select"
    value={wikilinkFormat}
    onChange={(e) => setWikilinkFormat(e.target.value as "wikilink" | "markdown")}
  >
    <option value="wikilink">{"[[Wikilink]]"}</option>
    <option value="markdown">[Markdown](link)</option>
  </select>
</SettingsRow>

<SettingsRow label="Auto-update Links" description="Update internal links when a file is renamed">
  <ToggleSwitch checked={autoUpdateLinks} onChange={setAutoUpdateLinks} />
</SettingsRow>

<SettingsSectionHeader title="Snapshots" />

<SettingsRow label="Snapshot Interval" description={`Auto-snapshot every ${snapshotInterval} minutes (0 = disabled)`}>
  <input
    type="range"
    className="settings-range"
    min={0}
    max={120}
    step={5}
    value={snapshotInterval}
    onChange={(e) => setSnapshotInterval(Number(e.target.value))}
  />
</SettingsRow>

<SettingsRow label="Max Snapshots" description={`Keep up to ${snapshotMaxCount} snapshots per file`}>
  <input
    type="range"
    className="settings-range"
    min={5}
    max={200}
    step={5}
    value={snapshotMaxCount}
    onChange={(e) => setSnapshotMaxCount(Number(e.target.value))}
  />
</SettingsRow>
```

**Step 3: Delete the standalone FilesTab function**

Remove the entire `FilesTab` function (lines 607-635).

**Step 4: Run build**

Run: `cd /Users/donghoon.yoo/work/projects/baram && npx tsc --noEmit 2>&1 | head -20`
Expected: PASS (no type errors)

---

### Task 3: Merge Extensions Tab Content into Markdown Tab

**Files:**
- Modify: `src/components/settings/SettingsModal.tsx` — `MarkdownTab` function
- Reference (read-only): `src/components/settings/ExtensionsTab.tsx`

**Step 1: Import registry and add extension rendering to MarkdownTab**

Add the registry import at top of file:

```tsx
import registry from "../../extensions/registry.json";
```

**Step 2: Expand MarkdownTab to include extension settings**

After the existing Markdown settings (after the Typography section), add:

```tsx
{/* Extension-specific settings from registry.json */}
{getExtensionsWithSettings().map((ext) => (
  <div key={ext.name}>
    <SettingsSectionHeader title={formatExtName(ext.name)} />
    {ext.settings.map((setting) => (
      <ExtensionSettingRow key={setting.key} setting={setting} />
    ))}
  </div>
))}
```

**Step 3: Inline the helper functions from ExtensionsTab.tsx**

Add these before the MarkdownTab function (or at the bottom of the file near shared components):

```tsx
// Extension settings helpers (merged from ExtensionsTab)
interface SettingOption { value: string; label: string; }
interface SettingDef {
  key: string;
  type: "boolean" | "select" | "number" | "string";
  label: string;
  description: string;
  default: unknown;
  options?: SettingOption[];
  min?: number; max?: number; step?: number;
  placeholder?: string;
}
interface RegistryEntry { name: string; settings?: SettingDef[]; }

function getExtensionsWithSettings() {
  const allEntries: RegistryEntry[] = [
    ...(registry.nodes as RegistryEntry[]),
    ...(registry.marks as RegistryEntry[]),
    ...(registry.plugins as RegistryEntry[]),
  ];
  return allEntries
    .filter((e): e is RegistryEntry & { settings: SettingDef[] } =>
      Array.isArray(e.settings) && e.settings.length > 0)
    .map((e) => ({ name: e.name, settings: e.settings }));
}

function formatExtName(name: string): string {
  return (name.replace(/([A-Z])/g, " $1").charAt(0).toUpperCase() +
    name.replace(/([A-Z])/g, " $1").slice(1));
}
```

**Step 4: Inline the ExtensionSettingRow component**

Copy the `ExtensionSettingRow` function from `ExtensionsTab.tsx` (lines 90-183) into `SettingsModal.tsx`, using the existing `ToggleSwitch` and `SettingsRow` components instead of raw HTML:

```tsx
function ExtensionSettingRow({ setting }: { setting: SettingDef }) {
  const { extensionSettings, setExtensionSetting } = useSettingsStore();
  const value = extensionSettings[setting.key] ?? setting.default;

  switch (setting.type) {
    case "boolean":
      return (
        <SettingsRow label={setting.label} description={setting.description}>
          <ToggleSwitch
            checked={!!value}
            onChange={(v) => setExtensionSetting(setting.key, v)}
          />
        </SettingsRow>
      );
    case "select":
      return (
        <SettingsRow label={setting.label} description={setting.description}>
          <select
            className="settings-select"
            value={value as string}
            onChange={(e) => setExtensionSetting(setting.key, e.target.value)}
          >
            {(setting.options ?? []).map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </SettingsRow>
      );
    case "number":
      return (
        <SettingsRow label={setting.label} description={`${setting.description} (${value})`}>
          <input
            type="range" className="settings-range"
            min={setting.min ?? 0} max={setting.max ?? 100} step={setting.step ?? 1}
            value={value as number}
            onChange={(e) => setExtensionSetting(setting.key, Number(e.target.value))}
          />
        </SettingsRow>
      );
    case "string":
      return (
        <SettingsRow label={setting.label} description={setting.description}>
          <input
            type="text" className="settings-input"
            value={value as string}
            onChange={(e) => setExtensionSetting(setting.key, e.target.value)}
            placeholder={setting.placeholder ?? ""}
          />
        </SettingsRow>
      );
    default:
      return null;
  }
}
```

**Step 5: Run build**

Run: `cd /Users/donghoon.yoo/work/projects/baram && npx tsc --noEmit 2>&1 | head -20`
Expected: PASS

---

### Task 4: Merge Workspace Tab Content into Appearance Tab

**Files:**
- Modify: `src/components/settings/SettingsModal.tsx` — `AppearanceTab` function
- Reference (read-only): `src/components/settings/WorkspaceTab.tsx`

**Step 1: Import workspace store**

Add import:

```tsx
import { useWorkspaceStore, BUILTIN_PRESETS } from "../../stores/workspace-store";
import type { WorkspacePreset } from "../../stores/workspace-store";
```

**Step 2: Add Workspace section to AppearanceTab**

After the theme gallery and theme actions (after line 602, before the closing `</div>`), add:

```tsx
<SettingsSectionHeader title="Workspace Presets" />
<WorkspaceSection />
```

**Step 3: Inline WorkspaceSection as a local component**

Create a `WorkspaceSection` function containing the workspace preset gallery logic from `WorkspaceTab.tsx`. This includes `PresetCard`, `LayoutDiagram`, and layout summary helpers. Keep them as local functions within `SettingsModal.tsx`.

**Step 4: Run build**

Run: `cd /Users/donghoon.yoo/work/projects/baram && npx tsc --noEmit 2>&1 | head -20`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/settings/SettingsModal.tsx
git commit -m "refactor(§settings): merge Files+Extensions+Workspace into unified tabs

Merge General+Files, Markdown+Extensions, Appearance+Workspace.
Reduce settings navigation from 8 tabs to 5 categories."
```

---

### Task 5: Add Settings Search

**Files:**
- Modify: `src/components/settings/SettingsModal.tsx`
- Modify: `src/App.css`

**Step 1: Define searchable settings registry**

Create a `SETTINGS_REGISTRY` array that maps each setting to its label, description, category, and keywords for search. This data structure enables filtering.

```tsx
interface SearchableSetting {
  id: string;
  label: string;
  description: string;
  category: SettingsTab;
  section: string;
  keywords?: string[];
}

const SETTINGS_REGISTRY: SearchableSetting[] = [
  { id: "onLaunch", label: "On Launch", description: "What to do when Baram starts", category: "general", section: "Startup" },
  { id: "showWelcome", label: "Show Welcome", description: "Show the welcome screen on startup", category: "general", section: "Startup" },
  { id: "autoSave", label: "Auto Save", description: "Automatically save changes after editing", category: "general", section: "Saving" },
  { id: "autoSaveDelay", label: "Save Delay", description: "Wait before saving", category: "general", section: "Saving" },
  { id: "spellCheck", label: "Spell Check", description: "Check spelling while typing", category: "general", section: "System" },
  { id: "wikilinkFormat", label: "Internal Link Format", description: "How internal links are written", category: "general", section: "Links" },
  { id: "autoUpdateLinks", label: "Auto-update Links", description: "Update internal links when a file is renamed", category: "general", section: "Links" },
  { id: "journalEnabled", label: "Enable Journal", description: "Create daily notes in a journal folder", category: "general", section: "Journal" },
  { id: "fontFamily", label: "Font Family", description: "Typeface used in the editor", category: "editor", section: "Font" },
  { id: "fontSize", label: "Font Size", description: "Size of text in the editor", category: "editor", section: "Font" },
  { id: "lineHeight", label: "Line Height", description: "Spacing between lines", category: "editor", section: "Font" },
  { id: "tabSize", label: "Tab Size", description: "Spaces per tab", category: "editor", section: "Behavior" },
  { id: "autoPairBrackets", label: "Auto Pair Brackets", description: "Auto-close brackets and quotes", category: "editor", section: "Behavior" },
  { id: "lineNumbers", label: "Line Numbers", description: "Show line numbers in source mode", category: "editor", section: "Display" },
  { id: "editorMaxWidth", label: "Editor Max Width", description: "Maximum content width", category: "editor", section: "Display" },
  { id: "activeThemeId", label: "Theme", description: "Color theme for the editor", category: "appearance", section: "Theme", keywords: ["dark", "light", "color"] },
  { id: "inlineMath", label: "Inline Math", description: "Enable math expressions", category: "markdown", section: "Extended Syntax", keywords: ["katex", "latex"] },
  { id: "highlight", label: "Highlight", description: "Enable highlight syntax", category: "markdown", section: "Extended Syntax" },
  { id: "strikethrough", label: "Strikethrough", description: "Enable strikethrough syntax", category: "markdown", section: "Extended Syntax" },
  { id: "smartPunctuation", label: "Smart Punctuation", description: "Convert straight quotes and dashes", category: "markdown", section: "Typography" },
  { id: "provider", label: "AI Provider", description: "Choose the AI service", category: "ai", section: "Provider", keywords: ["claude", "openai", "ollama", "gemini"] },
  { id: "apiKey", label: "API Key", description: "API key for AI provider", category: "ai", section: "Provider" },
  { id: "model", label: "Model", description: "Model name for AI requests", category: "ai", section: "Provider" },
  { id: "ghostTextEnabled", label: "Ghost Text", description: "Show inline text completion suggestions", category: "ai", section: "Ghost Text" },
  { id: "privacyMode", label: "Privacy Mode", description: "Do not send content to AI providers", category: "ai", section: "Privacy" },
];
```

**Step 2: Add search state and filter logic to SettingsModal**

In the `SettingsModal` function, add:

```tsx
const [searchQuery, setSearchQuery] = useState("");

const searchResults = useMemo(() => {
  if (!searchQuery.trim()) return null;
  const q = searchQuery.toLowerCase();
  return SETTINGS_REGISTRY.filter(
    (s) =>
      s.label.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.section.toLowerCase().includes(q) ||
      (s.keywords ?? []).some((k) => k.includes(q))
  );
}, [searchQuery]);

// Group search results by category
const groupedResults = useMemo(() => {
  if (!searchResults) return null;
  const map = new Map<SettingsTab, SearchableSetting[]>();
  for (const r of searchResults) {
    const list = map.get(r.category) ?? [];
    list.push(r);
    map.set(r.category, list);
  }
  return map;
}, [searchResults]);
```

**Step 3: Add search input to the header**

In the settings header, add a search input:

```tsx
<div className="settings-header">
  <h2 className="settings-title">Settings</h2>
  <div className="settings-search-wrapper">
    <input
      type="text"
      className="settings-search"
      placeholder="Search settings..."
      value={searchQuery}
      onChange={(e) => setSearchQuery(e.target.value)}
    />
    {searchQuery && (
      <button className="settings-search-clear" onClick={() => setSearchQuery("")}>
        {"\u00D7"}
      </button>
    )}
  </div>
  <button className="settings-close" onClick={toggleSettings} title="Close">
    {"\u00D7"}
  </button>
</div>
```

**Step 4: Render search results when query is active**

In the content area, when `searchQuery` is non-empty, show grouped results instead of the active tab:

```tsx
<div className="settings-content">
  {searchQuery.trim() ? (
    <SettingsSearchResults grouped={groupedResults} query={searchQuery} />
  ) : (
    <>
      {activeTab === "general" && <GeneralTab />}
      {activeTab === "editor" && <EditorTab />}
      {activeTab === "appearance" && <AppearanceTab />}
      {activeTab === "markdown" && <MarkdownTab />}
      {activeTab === "ai" && <AITab />}
    </>
  )}
</div>
```

**Step 5: Create SettingsSearchResults component**

```tsx
function SettingsSearchResults({
  grouped,
  query,
}: {
  grouped: Map<SettingsTab, SearchableSetting[]> | null;
  query: string;
}) {
  if (!grouped || grouped.size === 0) {
    return (
      <div className="settings-search-empty">
        No settings found for "{query}"
      </div>
    );
  }

  const TAB_LABELS: Record<SettingsTab, string> = {
    general: "General",
    editor: "Editor",
    appearance: "Appearance",
    markdown: "Markdown",
    ai: "AI",
  };

  return (
    <div className="settings-section">
      {Array.from(grouped.entries()).map(([category, items]) => (
        <div key={category}>
          <SettingsSectionHeader title={TAB_LABELS[category]} />
          {items.map((item) => (
            <div key={item.id} className="settings-search-result">
              <div className="settings-row-info">
                <span className="settings-row-label">{item.label}</span>
                <span className="settings-row-description">
                  {item.section} · {item.description}
                </span>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
```

**Step 6: Add CSS for search**

Add to `App.css`:

```css
.settings-search-wrapper {
  flex: 1;
  max-width: 240px;
  margin: 0 16px;
  position: relative;
}

.settings-search {
  width: 100%;
  padding: 5px 28px 5px 10px;
  font-size: 0.8rem;
  font-family: var(--font-sans);
  border: 1px solid var(--color-border);
  border-radius: 5px;
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
  outline: none;
}

.settings-search:focus {
  border-color: var(--color-accent);
}

.settings-search-clear {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.settings-search-clear:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
}

.settings-search-empty {
  padding: 40px 20px;
  text-align: center;
  color: var(--color-text-muted);
  font-size: 0.85rem;
}

.settings-search-result {
  padding: 8px 0;
  border-bottom: 1px solid var(--color-border-light);
}
```

**Step 7: Run build**

Run: `cd /Users/donghoon.yoo/work/projects/baram && npx tsc --noEmit 2>&1 | head -20`
Expected: PASS

**Step 8: Commit**

```bash
git add src/components/settings/SettingsModal.tsx src/App.css
git commit -m "feat(§settings): add settings search functionality

Search by label, description, section name, and keywords.
Results grouped by category with breadcrumb path."
```

---

### Task 6: Theme Mini Editor Preview

**Files:**
- Modify: `src/components/settings/SettingsModal.tsx` — `AppearanceTab`
- Modify: `src/App.css`

**Step 1: Create ThemeMiniPreview component**

Replace the 5-color swatches with a mini editor mockup that uses the theme's actual colors:

```tsx
function ThemeMiniPreview({ theme }: { theme: ThemeDef }) {
  const c = theme.colors;
  return (
    <div className="theme-preview" style={{ background: c["--color-bg-primary"] }}>
      {/* Mini sidebar */}
      <div className="theme-preview-sidebar" style={{ background: c["--color-bg-sidebar"], borderRight: `1px solid ${c["--color-border"]}` }}>
        <div className="theme-preview-sidebar-item" style={{ background: c["--color-bg-tertiary"] }} />
        <div className="theme-preview-sidebar-item" style={{ background: c["--color-bg-tertiary"] }} />
        <div className="theme-preview-sidebar-item" style={{ background: c["--color-bg-tertiary"] }} />
      </div>
      {/* Mini editor */}
      <div className="theme-preview-editor" style={{ background: c["--color-editor-bg"] }}>
        <div className="theme-preview-heading" style={{ color: c["--color-editor-text"] }}>Heading</div>
        <div className="theme-preview-text" style={{ color: c["--color-editor-text"] }}>
          Some <span style={{ color: c["--color-accent"], fontWeight: 600 }}>bold</span> text
        </div>
        <div className="theme-preview-quote" style={{ borderLeft: `2px solid ${c["--color-accent"]}`, color: c["--color-text-secondary"], paddingLeft: 6 }}>
          blockquote
        </div>
        <div className="theme-preview-code" style={{ background: c["--color-bg-tertiary"], color: c["--color-editor-text"] }}>
          code
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Update theme card rendering**

In `AppearanceTab`, replace the swatches section in each theme card:

```tsx
{/* Replace theme-card-swatches with mini preview */}
<ThemeMiniPreview theme={theme} />
```

Also update the System (Auto) card to show a split preview (light left / dark right).

**Step 3: Add CSS for theme mini preview**

```css
.theme-preview {
  width: 100%;
  height: 80px;
  border-radius: 4px;
  display: flex;
  overflow: hidden;
  border: 1px solid rgba(128, 128, 128, 0.2);
}

.theme-preview-sidebar {
  width: 28%;
  padding: 6px 4px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.theme-preview-sidebar-item {
  height: 4px;
  border-radius: 2px;
  width: 80%;
}

.theme-preview-editor {
  flex: 1;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  overflow: hidden;
}

.theme-preview-heading {
  font-size: 8px;
  font-weight: 700;
  line-height: 1.2;
}

.theme-preview-text {
  font-size: 6px;
  line-height: 1.3;
}

.theme-preview-quote {
  font-size: 5.5px;
  line-height: 1.3;
  font-style: italic;
}

.theme-preview-code {
  font-size: 5.5px;
  padding: 2px 4px;
  border-radius: 2px;
  font-family: monospace;
  width: fit-content;
}
```

**Step 4: Widen theme cards**

Update `.theme-gallery` grid:

```css
.theme-gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
```

**Step 5: Run build and visually verify**

Run: `cd /Users/donghoon.yoo/work/projects/baram && npx tsc --noEmit 2>&1 | head -20`
Expected: PASS

**Step 6: Commit**

```bash
git add src/components/settings/SettingsModal.tsx src/App.css
git commit -m "feat(§settings): replace theme swatches with mini editor preview

Each theme card now shows a miniature editor mockup with actual
theme colors (sidebar, editor, heading, bold, blockquote, code)."
```

---

### Task 7: Widen Modal and Polish CSS

**Files:**
- Modify: `src/App.css`

**Step 1: Widen the settings modal**

Update `.settings-modal` width from 640px to 720px:

```css
.settings-modal {
  width: 720px;
  max-height: 85vh;
  /* ...rest unchanged... */
}
```

**Step 2: Add nav icon styles**

```css
.settings-nav-icon {
  display: inline-block;
  width: 20px;
  text-align: center;
  margin-right: 6px;
  font-size: 0.8rem;
}
```

**Step 3: Improve nav item active state**

The left border accent indicator is already present (`box-shadow: inset 2px 0 0 var(--color-accent)`). No change needed.

**Step 4: Run build**

Run: `cd /Users/donghoon.yoo/work/projects/baram && npx tsc --noEmit 2>&1 | head -20`
Expected: PASS

**Step 5: Commit**

```bash
git add src/App.css
git commit -m "style(§settings): widen modal to 720px, add nav icons"
```

---

### Task 8: Build Verification and Test

**Step 1: Full TypeScript check**

Run: `cd /Users/donghoon.yoo/work/projects/baram && npx tsc --noEmit`
Expected: PASS (0 errors)

**Step 2: Run Vitest**

Run: `cd /Users/donghoon.yoo/work/projects/baram && npx vitest run 2>&1 | tail -20`
Expected: All tests pass (no regressions)

**Step 3: Dev server smoke test**

Run: `cd /Users/donghoon.yoo/work/projects/baram && npm run dev`
Manual verification:
- Settings modal opens with 5 tabs (General, Editor, Appearance, Markdown, AI)
- General tab includes Links and Snapshots sections
- Markdown tab includes Extension settings (Code Block, Mermaid)
- Appearance tab includes Workspace Presets section
- Theme cards show mini editor preview
- Search bar filters settings correctly
- Modal width is comfortable

**Step 4: Final commit if any fixes needed**

---

## Notes

- `ExtensionsTab.tsx` and `WorkspaceTab.tsx` files can be kept for now (dead code) or deleted. Prefer deletion to avoid confusion.
- The search functionality in Task 5 is a static registry approach. For full dynamic search (rendering actual controls in results), a more complex approach with render functions per setting would be needed — this is a future enhancement.
- Theme mini preview sizes are tuned for the wider card grid (180px min). Adjust if needed after visual testing.
