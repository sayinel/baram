# Design: Rename "Space / Workspace Preset" → "Perspective / 화면구성"

- **Date**: 2026-07-09
- **Status**: Approved (design)
- **Scope**: Rename only (no feature scoping / no behavior change), plus one small StatusBar UI change.
- **Related design docs**: §4.3 (workspace presets), §4.8 (status bar), §52 (workspace preset store), §82 (space/context interaction)

## Motivation

Baram has four "spaces" (Writing, Zettel, Journal, Skills). Users perceive them as isolated
spaces, but the implementation does **not** isolate anything:

- The concept is `WorkspacePreset` (`src/stores/file/workspace.ts`). Each preset is just a
  `layout` ({ sidebarOpen, sidebarPanel, rightPanelOpen, rightPanelMode }).
- `applyPreset(id)` only sets the initial layout (and, for journal/zettel, opens the backing
  vault/context). Per the §82 rule it **never force-closes** an open sidebar.
- `activePresetId` is read **only for display** (StatusBar icon/label/highlight, Settings active
  state, `revertSpaceIfContextClosed` fallback). It scopes no features.
- The Activity Bar toggles every panel freely, independent of the active preset.

So "Space" over-promises containment/isolation the feature never provides. Worse, the current
user-facing terminology is already **inconsistent**: Settings says "Workspace Presets", the
system menu says "Workspace", keybindings say "… Preset", and the StatusBar tooltip says
"Switch Space". The word "workspace" is also overloaded (it elsewhere means the open
vault/folder — `emptyWorkspace`, "Scanning workspace…").

**Decision**: unify all user-facing occurrences of this concept to a single honest term —
**"Perspective" (en) / "화면구성" (ko)** — and reduce the StatusBar item from a stateful
badge to a lightweight launcher. This also disambiguates "workspace" (= open vault/folder)
from the layout concept.

The term "Perspective" mirrors the Eclipse IDE concept (a named arrangement of panels for a
task), which is exactly what this feature is.

## Non-goals

- **No feature scoping / isolation.** The feature stays fluid and non-modal.
- **No i18n key renames.** Only string *values* change; every `t()` call site is untouched.
- **No internal identifier renames.** `WorkspacePreset`, `BUILTIN_PRESETS`, `activePresetId`,
  `applyPreset`, `useWorkspaceStore`, `src/spaces/` (`SpaceDefinition`, `SpaceLayout`,
  `getSpace`, `ensureSpaceContext`), and CSS class names (`status-space-*`) all stay as-is.
- **No persisted-state changes.** The persist key `baram:workspace` and `activePresetId` are
  untouched → zero migration risk.
- Internal-naming cleanup (unifying `Workspace`/`Space` identifiers) is a possible **separate
  future task**, explicitly out of scope here.

## Design

### 1. Terminology unification (i18n values only)

Change the following **values** (keys unchanged). English → "Perspective"; Korean → "화면구성".

| Key | Current (en → new en) | Current (ko → new ko) |
| --- | --- | --- |
| `settings.appearance.workspacePresets` | "Workspace Presets" → "Perspectives" | "워크스페이스 프리셋" → "화면구성" |
| `menu.workspace` | "Workspace" → "Perspective" | "워크스페이스" → "화면구성" |
| `keybindings.category.workspace` | "Workspace" → "Perspective" | "워크스페이스" → "화면구성" |
| `keybindings.workspace.writing` | "Writing Preset" → "Writing Perspective" | "글쓰기 프리셋" → "글쓰기 화면구성" |
| `keybindings.workspace.journal` | "Journal Preset" → "Journal Perspective" | "저널 프리셋" → "저널 화면구성" |
| `keybindings.workspace.zettelkasten` | "Zettel Preset" → "Zettel Perspective" | "Zettel 프리셋" → "Zettel 화면구성" |
| `keybindings.workspace.skills` | "Skills Preset" → "Skills Perspective" | "Skills 프리셋" → "Skills 화면구성" |

New key for the StatusBar launcher label + tooltip:

- `statusbar.perspective` = "Perspective" (en) / "화면구성" (ko)

Individual preset item names stay unchanged (Writing / Journal / Zettel / Skills), incl.
`settings.workspace.preset.*` and `menu.workspace.{writing,journal,skills,zettel}`
(ko: "글쓰기" / "저널" / "제텔" / "스킬 편집").

**Explicitly NOT changed** (different meaning — "the Zettel feature area", not the layout
concept):
- `space.zettel.disabled`, `space.zettel.noDirectory`
- Any "workspace" that means the open vault/folder (`home.emptyWorkspace`, "Scanning
  workspace…", `settings.general.*Startup.desc` "opening a workspace with …").

### 2. StatusBar widget → lightweight launcher (`src/components/layout/StatusBar.tsx`)

The only structural change. Convert the stateful badge into a neutral launcher.

**Button:**
- Icon: replace the per-preset `SpaceIcon` (`:156`, `:168`) with a **fixed neutral layout
  icon** — lucide `PanelsTopLeft`.
- Label: replace the dynamic `spaceLabel` / `"Default"` (`:157`, `:169`) with the **fixed**
  `t("statusbar.perspective")` → "화면구성".
- Keep the `ChevronDown` affordance.
- Tooltip (`:166`): "Switch Space" → `t("statusbar.perspective")`.

**Menu (unchanged behavior, minus highlight):**
- Still lists all four `BUILTIN_PRESETS` as a plain action list (per-preset icon + name).
- **Remove** the active highlight — drop the `activePresetId === preset.id` →
  `status-space-menu-active` conditional (`:178`). Clicking applies + closes (idempotent).

**Resulting cleanup:**
- `currentPreset`, `SpaceIcon`, `spaceLabel` locals (`:155-157`) are removed.
- `activePresetId` is no longer read in StatusBar → drop it from the `useWorkspaceStore`
  selector (`:92-97`), keeping only `applyPreset`. `BUILTIN_PRESETS` and `SPACE_ICONS` (for
  menu items) stay.
- CSS class names (`status-space-*`) are left as-is (internal; renaming is out of scope).

### 3. Command Palette (`src/components/command/CommandPalette.tsx`)

- Command internal ids (e.g. `space.zettelkasten`) stay.
- Any user-visible command **label/title** that says "Space"/"Workspace" for this concept →
  "Perspective" / "화면구성" (exact strings confirmed during implementation, ~lines 600-619).

## Affected files

- `src/i18n/en.json` — value edits (table above) + new `statusbar.perspective`.
- `src/i18n/ko.json` — value edits + new `statusbar.perspective`.
- `src/components/layout/StatusBar.tsx` — launcher conversion.
- `src/components/command/CommandPalette.tsx` — command label(s), if any say Space/Workspace.

Everything else (stores, `src/spaces/`, native-menu wiring, keybinding action ids, CSS files)
is untouched.

## Verification

- **Types**: `npx tsc --noEmit` clean.
- **Tests**: `npm test`. `workspace-store.test.ts` behavior is unchanged (no logic touched).
  If a StatusBar test exists and asserts the old label/highlight, update it to the launcher.
- **Manual (WKWebView)**:
  - StatusBar shows a fixed "화면구성" launcher (icon + label + ▾), regardless of active preset,
    including first launch (no more "Default").
  - Opening the menu switches perspective correctly; no persistent active highlight; label does
    not drift after manually toggling panels (stale-badge issue gone).
  - Settings → the section reads "화면구성"; system menu + keybinding labels updated. (Native
    Tauri menu is built at startup — verify after an app restart / menu rebuild.)

## Known follow-ups (out of scope)

- Optional internal-identifier unification (`WorkspacePreset` / `SpaceDefinition` → a single
  "perspective" vocabulary), which would touch persisted state and require migration.
- Optional fix for `activePresetId` staleness (auto-clear to Custom when the live layout
  diverges from the applied preset). Not needed once the StatusBar no longer displays state.
