# Perspective (화면구성) Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the user-facing "Space / Workspace Preset" concept to a single term — "Perspective" (en) / "화면구성" (ko) — and reduce the StatusBar item from a stateful badge to a lightweight launcher.

**Architecture:** Pure rename plus one small UI simplification. All changes are string-value edits in two i18n files, hardcoded label edits in the Command Palette, and a launcher conversion in `StatusBar.tsx`. No feature behavior, no i18n key renames, no internal identifiers, and no persisted state are touched.

**Tech Stack:** React 19 + TypeScript, Zustand, Vitest + @testing-library/react, lucide-react icons, custom i18n (`src/i18n`).

## Global Constraints

- **Rename only.** No feature scoping/isolation. No behavior change beyond the StatusBar launcher simplification.
- **Korean term is `화면구성`** — no middle space. **English term is `Perspective`.**
- **Do NOT rename i18n keys** — change values only; every `t()` call site stays.
- **Do NOT rename internal identifiers**: `WorkspacePreset`, `BUILTIN_PRESETS`, `activePresetId`, `applyPreset`, `useWorkspaceStore`, `src/spaces/*`, CSS class names (`status-space-*`).
- **Do NOT change persisted state**: persist key `baram:workspace` and `activePresetId` untouched.
- **Do NOT touch different-meaning strings**: `space.zettel.disabled`, `space.zettel.noDirectory` (Zettel feature area), and any "workspace" meaning the open vault/folder (`home.emptyWorkspace`, "Scanning workspace…", `settings.general.*Startup.desc`).
- **Zustand rule**: components use `useShallow` for multi-field selectors; a single-value selector may be used bare.
- **Commits**: Conventional Commits, English messages, reference `§4.3`/`§4.8`.
- **Tests**: `npm test` (Vitest). Never `npx jest`.

---

### Task 1: i18n value edits + new `statusbar.perspective` key

**Files:**
- Modify: `src/i18n/en.json`
- Modify: `src/i18n/ko.json`

**Interfaces:**
- Produces: a new i18n key `statusbar.perspective` (`"Perspective"` / `"화면구성"`) consumed by Task 2 (StatusBar). All other edits are value swaps on existing keys.

- [ ] **Step 1: Edit `src/i18n/en.json` values**

Change these existing values (keys unchanged):

```jsonc
"settings.appearance.workspacePresets": "Perspectives",     // was "Workspace Presets"
"menu.workspace": "Perspective",                            // was "Workspace"
"keybindings.category.workspace": "Perspective",            // was "Workspace"
"keybindings.workspace.writing": "Writing Perspective",     // was "Writing Preset"
"keybindings.workspace.journal": "Journal Perspective",     // was "Journal Preset"
"keybindings.workspace.zettelkasten": "Zettel Perspective", // was "Zettel Preset"
"keybindings.workspace.skills": "Skills Perspective",       // was "Skills Preset"
```

Then add the new key (place it right after the `space.zettel.noDirectory` line):

```jsonc
"statusbar.perspective": "Perspective",
```

Leave unchanged: `space.zettel.disabled`, `space.zettel.noDirectory`, `home.emptyWorkspace`, `settings.general.journalStartup.desc`, `settings.general.zettelkastenStartup.desc`, `settings.workspace.preset.*`, `menu.workspace.{writing,journal,skills,zettel}`.

- [ ] **Step 2: Edit `src/i18n/ko.json` values**

Change these existing values (keys unchanged):

```jsonc
"settings.appearance.workspacePresets": "화면구성",          // was "워크스페이스 프리셋"
"menu.workspace": "화면구성",                                // was "워크스페이스"
"keybindings.category.workspace": "화면구성",                // was "워크스페이스"
"keybindings.workspace.writing": "글쓰기 화면구성",           // was "글쓰기 프리셋"
"keybindings.workspace.journal": "저널 화면구성",            // was "저널 프리셋"
"keybindings.workspace.zettelkasten": "Zettel 화면구성",     // was "Zettel 프리셋"
"keybindings.workspace.skills": "Skills 화면구성",           // was "Skills 프리셋"
```

Then add the new key (right after the `space.zettel.noDirectory` line):

```jsonc
"statusbar.perspective": "화면구성",
```

Leave unchanged (ko): `space.zettel.*`, `settings.workspace.preset.*` (글쓰기/저널/Skills), `menu.workspace.{writing,journal,skills,zettel}` (글쓰기/저널/스킬 편집/제텔).

- [ ] **Step 3: Verify JSON is valid and both locales have the new key**

Run:

```bash
node -e "const e=require('./src/i18n/en.json'), k=require('./src/i18n/ko.json'); if(e['statusbar.perspective']!=='Perspective') throw new Error('en key missing/wrong'); if(k['statusbar.perspective']!=='화면구성') throw new Error('ko key missing/wrong'); if(e['menu.workspace']!=='Perspective'||k['menu.workspace']!=='화면구성') throw new Error('menu.workspace not renamed'); console.log('i18n OK');"
```

Expected: `i18n OK` (and no JSON parse error).

- [ ] **Step 4: Commit**

```bash
git add src/i18n/en.json src/i18n/ko.json
git commit -m "feat(§4.3): rename Workspace-preset i18n strings to Perspective/화면구성"
```

---

### Task 2: StatusBar stateful badge → lightweight launcher

**Files:**
- Modify: `src/components/layout/StatusBar.tsx`
- Test: `src/components/layout/__tests__/StatusBar.test.tsx`

**Interfaces:**
- Consumes: `statusbar.perspective` i18n key (Task 1); existing `BUILTIN_PRESETS`, `SPACE_ICONS`, `useWorkspaceStore().applyPreset`.
- Produces: a launcher button with `data-testid="perspective-launcher"` whose label is fixed (independent of `activePresetId`), and a menu of `BUILTIN_PRESETS` with no active-highlight.

- [ ] **Step 1: Write the failing tests**

Append this `describe` block to `src/components/layout/__tests__/StatusBar.test.tsx`. It reuses the existing imports (`render`, `screen`, `fireEvent`, `expect`, `it`, `describe`, `beforeEach`, `vi`, store imports, `StatusBar`). Add these two imports at the top of the file if not already present:

```tsx
import { t } from "../../../i18n";
import { useWorkspaceStore } from "../../../stores/file/workspace";
```

Then append:

```tsx
describe("StatusBar — Perspective launcher", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ activePresetId: null });
    useEditorStore.setState({ activeTabId: null, tabs: [] });
    useFileStore.getState().setRootPath("/vault");
  });

  function expectedLabel() {
    const locale = useSettingsStore.getState().locale;
    return t("statusbar.perspective", locale);
  }

  it("shows a fixed perspective label, not 'Default', when no preset is active", () => {
    render(<StatusBar editor={null} mode="wysiwyg" />);
    const launcher = screen.getByTestId("perspective-launcher");
    expect(launcher.textContent).toContain(expectedLabel());
    expect(launcher.textContent).not.toContain("Default");
  });

  it("keeps the fixed label even when a preset is active (no stale badge)", () => {
    useWorkspaceStore.setState({ activePresetId: "journal" });
    render(<StatusBar editor={null} mode="wysiwyg" />);
    const launcher = screen.getByTestId("perspective-launcher");
    expect(launcher.textContent).toContain(expectedLabel());
    expect(launcher.textContent).not.toContain("Journal");
  });

  it("opens a menu of all presets and applies one on click", () => {
    render(<StatusBar editor={null} mode="wysiwyg" />);
    fireEvent.click(screen.getByTestId("perspective-launcher"));
    const writingItem = screen.getByText("Writing");
    const journalItem = screen.getByText("Journal");
    expect(writingItem).toBeTruthy();
    expect(journalItem).toBeTruthy();
    // No stateful active highlight on menu items.
    expect(writingItem.closest("button")?.className).not.toContain(
      "status-space-menu-active",
    );
    fireEvent.click(writingItem);
    expect(useWorkspaceStore.getState().activePresetId).toBe("writing");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/components/layout/__tests__/StatusBar.test.tsx`
Expected: FAIL — the three new tests fail (`getByTestId("perspective-launcher")` not found; the button currently renders the preset name / "Default" and menu items carry `status-space-menu-active`).

- [ ] **Step 3: Update imports in `StatusBar.tsx`**

In the lucide-react import block, add `PanelsTopLeft`:

```tsx
import {
  Calendar,
  ChevronDown,
  PanelsTopLeft,
  Pencil,
  Star,
  StickyNote,
  Zap,
} from "lucide-react";
```

Add the translation hook import (near the other hook imports at the top):

```tsx
import { useTranslation } from "../../i18n/useTranslation";
```

- [ ] **Step 4: Simplify the workspace selector**

Replace the `useWorkspaceStore` selector (currently pulling `activePresetId` + `applyPreset` via `useShallow`) with a single-value selector, and add the `t` hook:

```tsx
const applyPreset = useWorkspaceStore((s) => s.applyPreset);
const { t } = useTranslation();
```

- [ ] **Step 5: Remove the stateful locals**

Delete these three lines (the `currentPreset` / `SpaceIcon` / `spaceLabel` derivations):

```tsx
const currentPreset = BUILTIN_PRESETS.find((p) => p.id === activePresetId);
const SpaceIcon = (activePresetId && SPACE_ICONS[activePresetId]) || Pencil;
const spaceLabel = currentPreset?.name ?? "Default";
```

- [ ] **Step 6: Replace the launcher button + menu JSX**

Replace the `status-space-wrapper` block with:

```tsx
<div className="status-space-wrapper" ref={spaceMenuRef}>
  <button
    className="status-space-btn"
    data-testid="perspective-launcher"
    onClick={() => setSpaceMenuOpen((v) => !v)}
    title={t("statusbar.perspective")}
  >
    <PanelsTopLeft size={12} strokeWidth={1.5} />
    {t("statusbar.perspective")}
    <ChevronDown size={10} strokeWidth={1.5} />
  </button>
  {spaceMenuOpen && (
    <div className="status-space-menu">
      {BUILTIN_PRESETS.map((preset) => {
        const Icon = SPACE_ICONS[preset.id] || Pencil;
        return (
          <button
            className="status-space-menu-item"
            key={preset.id}
            onClick={() => handleSpaceSelect(preset.id)}
          >
            <Icon size={12} strokeWidth={1.5} />
            {preset.name}
          </button>
        );
      })}
    </div>
  )}
</div>
```

(`BUILTIN_PRESETS`, `SPACE_ICONS`, `Pencil`, `ChevronDown`, `handleSpaceSelect`, `spaceMenuOpen`, `spaceMenuRef` are all still used. `activePresetId` is no longer referenced anywhere in this file.)

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- src/components/layout/__tests__/StatusBar.test.tsx`
Expected: PASS — all tests (existing Zettel-star tests + the three new launcher tests).

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (in particular, no "unused `activePresetId`/`currentPreset`/`SpaceIcon`/`spaceLabel`" and no missing-import errors).

- [ ] **Step 9: Commit**

```bash
git add src/components/layout/StatusBar.tsx src/components/layout/__tests__/StatusBar.test.tsx
git commit -m "feat(§4.8): StatusBar perspective launcher (fixed label, no stale badge)"
```

---

### Task 3: Command Palette labels + category → Perspective/화면구성

**Files:**
- Modify: `src/components/command/CommandPalette.tsx` (the `§52 Workspace Presets` block, ~lines 594-614)

**Interfaces:**
- Consumes: nothing new. Command internal `id`s (`workspace:writing`, `workspace:journal`, `space.zettelkasten`) stay unchanged.
- Produces: no exported symbols — user-facing label/category text only.

- [ ] **Step 1: Rename the three command labels/categories**

In the `§52 Workspace Presets` block, apply these edits. The `category: "Workspace"` on these three commands (and ONLY these three — `workspace:close-folder` uses `category: "File"` and must stay) becomes `"화면구성"`:

```tsx
// id: "workspace:writing"
label: "화면구성: 글쓰기",   // was "Workspace: 글쓰기"
category: "화면구성",         // was "Workspace"

// id: "workspace:journal"
label: "화면구성: 저널",     // was "Workspace: 저널"
category: "화면구성",         // was "Workspace"

// id: "space.zettelkasten"
label: "Open Zettel",        // unchanged (action phrasing, does not say Space/Workspace)
category: "화면구성",         // was "Workspace"
```

- [ ] **Step 2: Verify no stray preset-command "Workspace" label/category remains**

Run:

```bash
grep -n 'category: "Workspace"\|"Workspace: ' src/components/command/CommandPalette.tsx
```

Expected: no output (the three preset commands now use `화면구성`; `workspace:close-folder` keeps `category: "File"`, which this grep does not match).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/command/CommandPalette.tsx
git commit -m "feat(§4.3): rename Command Palette workspace-preset labels to 화면구성"
```

---

### Task 4: Full verification (suite + manual GUI)

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — no regressions (baseline was 2739 passed | 6 skipped; the three new StatusBar tests add to the passing count).

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual GUI check (WKWebView / `npm run tauri dev`)**

Verify, and only then check the boxes:
- StatusBar shows a fixed `화면구성` launcher (icon + label + ▾) — including on first launch with no active preset (no more "Default", no preset name).
- Opening the launcher menu lists Writing / Journal / Zettel / Skills; clicking one switches layout; there is no persistent active highlight.
- After manually toggling a sidebar panel, the launcher label does NOT drift (stale-badge issue is gone).
- Settings → the section header reads `화면구성`.
- System menu shows `화면구성` (rebuild/restart the app — the native Tauri menu is built at startup); keybinding labels read `… 화면구성`.
- Command Palette (⌘⇧P) shows `화면구성: 글쓰기` / `화면구성: 저널` / `Open Zettel` under the `화면구성` category.

- [ ] **Step 4: Final confirmation**

No commit needed (verification only). If any check fails, return to the owning task, fix, re-run its tests, and re-verify.

---

## Self-Review

**Spec coverage:**
- Terminology unification (i18n values, all rows of the spec table) → Task 1. ✓
- New `statusbar.perspective` key → Task 1. ✓
- StatusBar launcher (fixed icon `PanelsTopLeft`, fixed label, tooltip, drop highlight, drop `activePresetId` read) → Task 2. ✓
- Command Palette label/category rename → Task 3. ✓
- Explicit exclusions (`space.zettel.*`, folder-workspace strings, i18n key renames, internal identifiers, persisted state) → enforced via Global Constraints + per-step "leave unchanged" notes. ✓
- Verification (tsc, `npm test`, manual WKWebView incl. native-menu restart) → Task 4. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". All steps carry exact strings, code, and commands. ✓

**Type consistency:** `applyPreset` (single-value selector) matches its store signature; `t("statusbar.perspective")` matches the key added in Task 1; `data-testid="perspective-launcher"` is defined in Task 2 Step 6 and asserted in Task 2 Step 1; `SPACE_ICONS`/`BUILTIN_PRESETS`/`Pencil`/`ChevronDown` remain in scope after edits. ✓
