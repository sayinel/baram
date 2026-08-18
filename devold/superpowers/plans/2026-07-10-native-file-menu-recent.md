# Native File Menu — Open Recent Submenu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standard **File ▸ Open Recent** submenu to the OS-native application menu that mirrors the in-app Vault Tab '+' menu's recent folders/files list.

**Architecture:** `build_menu` creates an empty "Open Recent" submenu inside the File menu at startup. A new `update_recent_menu` IPC command clears and repopulates that submenu from a frontend-supplied `entries[]` list. The frontend re-syncs whenever `recentFolders`/`recentFiles`/`locale` change (same pattern as `syncMenuLocale`). Clicks flow through the existing global `on_menu_event` → `"menu-event"` pipe; item ids encode the path (`recent_folder:<path>` / `recent_file:<path>` / `recent_clear`), and a new prefix branch in the frontend `switch` routes them to the existing self-healing open helpers.

**Tech Stack:** Rust + Tauri 2.0 `tauri::menu` API; React + TypeScript 19; Zustand (settings store); Vitest.

**Design spec:** `dev/superpowers/specs/2026-07-10-native-file-menu-recent-design.md`

## Global Constraints

- TypeScript strict mode; kebab-case filenames; functional components/hooks only.
- Reuse shared utilities — `basename()` from `src/utils/path-utils.ts`; do NOT reimplement.
- i18n keys are **flat dotted strings** (e.g. `"menu.file.openRecent"`), not nested objects.
- Reuse existing `recent.folders` / `recent.files` / `recent.clear` / `recent.vaultBadge` i18n keys for the group headers / clear action / vault badge.
- Menu item caps in the submenu: 5 folders + 5 files (matches `ContextAddMenu`'s `.slice(0, 5)`).
- Rust IPC commands return `Result<T, String>`.
- Any new IPC command MUST be registered in `src-tauri/ipc-registry.json` AND typed in `src/ipc/types.ts`.
- Commit messages in English, Conventional Commits, with the `§82` section reference.
- Full verification target: `npm run test`, `npm run typecheck`, `npm run rust:_test` all green.

---

### Task 1: Rust — empty "Open Recent" submenu + `update_recent_menu` command

**Files:**
- Modify: `src-tauri/src/menu.rs` (File submenu build + `MenuState` registration)
- Modify: `src-tauri/src/lib.rs` (`RecentMenuEntry` struct, `update_recent_menu` command, `invoke_handler` registration)
- Modify: `src-tauri/ipc-registry.json` (register the command)

**Interfaces:**
- Produces:
  - Submenu registered in `MenuState.submenus` under key `"menu_file_open_recent"`.
  - IPC command `update_recent_menu(entries: Vec<RecentMenuEntry>)` where
    `RecentMenuEntry { kind: String /* "item" | "separator" */, id: Option<String>, label: Option<String>, enabled: Option<bool> }`.

- [ ] **Step 1: Add the empty "Open Recent" submenu to the File menu in `menu.rs`**

In `src-tauri/src/menu.rs`, immediately after the `file_open_folder` item is built (currently ends at line ~31, before `let file_save = ...`), add:

```rust
    // --- Open Recent submenu (§82; populated at runtime via update_recent_menu) ---
    let file_open_recent = SubmenuBuilder::new(app, "Open Recent").build()?;
```

Then insert it into the File submenu builder — change the `file_menu` builder so it reads:

```rust
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&file_new)
        .item(&file_open)
        .item(&file_open_folder)
        .item(&file_open_recent)
        .separator()
        .item(&file_save)
        .item(&file_save_as)
        .item(&file_close_tab)
        .item(&file_close_folder)
        .separator()
        .item(&export_doc)
        .build()?;
```

- [ ] **Step 2: Register the submenu in `MenuState.submenus`**

In `menu.rs`, in the `menu_subs.insert(...)` block (currently starts ~line 519 with `menu_subs.insert("menu_file".into(), file_menu);`), add this line right after the `menu_file` insert:

```rust
    menu_subs.insert("menu_file_open_recent".into(), file_open_recent);
```

- [ ] **Step 3: Add the `RecentMenuEntry` struct + `update_recent_menu` command in `lib.rs`**

In `src-tauri/src/lib.rs`, immediately after the existing `update_menu_locale` command (ends at line ~63), add:

```rust
#[derive(serde::Deserialize)]
struct RecentMenuEntry {
    kind: String, // "item" | "separator"
    id: Option<String>,
    label: Option<String>,
    enabled: Option<bool>,
}

#[tauri::command]
fn update_recent_menu(
    app: tauri::AppHandle,
    state: tauri::State<'_, menu::MenuState>,
    entries: Vec<RecentMenuEntry>,
) -> Result<(), String> {
    let submenu = state
        .submenus
        .get("menu_file_open_recent")
        .ok_or_else(|| "open-recent submenu not found".to_string())?;

    // Clear existing children (remove-then-append avoids duplicate accumulation).
    let count = submenu.items().map_err(|e| e.to_string())?.len();
    for _ in 0..count {
        submenu.remove_at(0).map_err(|e| e.to_string())?;
    }

    for entry in &entries {
        if entry.kind == "separator" {
            let sep = tauri::menu::PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
            submenu.append(&sep).map_err(|e| e.to_string())?;
        } else {
            let label = entry.label.clone().unwrap_or_default();
            let enabled = entry.enabled.unwrap_or(true);
            let mut builder = tauri::menu::MenuItemBuilder::new(label).enabled(enabled);
            if let Some(id) = &entry.id {
                builder = builder.id(id.clone());
            }
            let item = builder.build(&app).map_err(|e| e.to_string())?;
            submenu.append(&item).map_err(|e| e.to_string())?;
        }
    }

    // Empty recents => grey out the whole submenu.
    submenu
        .set_enabled(!entries.is_empty())
        .map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 4: Register the command in the `invoke_handler!` macro**

In `src-tauri/src/lib.rs`, in the `tauri::generate_handler![ ... ]` list, add `update_recent_menu,` right after the existing `update_menu_locale,` entry (line ~152):

```rust
            update_menu_locale,
            update_recent_menu,
```

- [ ] **Step 5: Register the command in `ipc-registry.json`**

In `src-tauri/ipc-registry.json`, immediately after the `update_menu_locale` command object (the `},` closing it, line ~269), insert:

```json
    {
      "name": "update_recent_menu",
      "input": { "entries": "RecentMenuEntry[]" },
      "output": "void",
      "module": "app",
      "spec": "§82",
      "phase": 3,
      "milestone": "M10",
      "status": "implemented",
      "description": "File 메뉴의 Open Recent 서브메뉴를 최근 항목으로 재구성",
      "_note": "TS wrapper: syncRecentMenu in src/ipc/recent-menu.ts"
    },
```

- [ ] **Step 6: Build the Rust backend to verify it compiles**

Run: `npm run build && cargo test --manifest-path src-tauri/Cargo.toml --no-run`
Expected: `npm run build` (tsc + vite) succeeds; `cargo test --no-run` compiles the crate with no errors (the `Submenu::set_enabled`, `remove_at`, `append`, `items` and `MenuItemBuilder`/`PredefinedMenuItem::separator` calls all resolve).

> If `Submenu::set_enabled` does not resolve on this Tauri version, replace the `set_enabled` block with an empty-state placeholder: when `entries.is_empty()`, append one disabled item `MenuItemBuilder::new("—").enabled(false).build(&app)?` instead. Prefer `set_enabled` if it compiles.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/menu.rs src-tauri/src/lib.rs src-tauri/ipc-registry.json
git commit -m "feat(§82): add empty Open Recent submenu + update_recent_menu IPC command"
```

---

### Task 2: i18n — `menu.file.openRecent` label + locale mapping

**Files:**
- Modify: `src/i18n/en.json`
- Modify: `src/i18n/ko.json`
- Modify: `src/ipc/menu-locale.ts` (add submenu id → i18n key mapping)
- Test: `src/utils/__tests__/recent-i18n.test.ts`

**Interfaces:**
- Produces: i18n key `"menu.file.openRecent"` resolvable in `en`/`ko`; `MENU_I18N_MAP["menu_file_open_recent"] = "menu.file.openRecent"`.

- [ ] **Step 1: Write the failing test**

In `src/utils/__tests__/recent-i18n.test.ts`, add a new test inside the existing `describe` block:

```ts
  it("resolves the Open Recent menu label", () => {
    expect(t("menu.file.openRecent", "en")).toBe("Open Recent");
    expect(t("menu.file.openRecent", "ko")).toBe("최근 항목");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/recent-i18n.test.ts`
Expected: FAIL — `t("menu.file.openRecent", "en")` returns the key itself (`"menu.file.openRecent"`) instead of `"Open Recent"`.

- [ ] **Step 3: Add the i18n keys**

In `src/i18n/en.json`, after the `"menu.file.openFolder": "Open Folder...",` line, add:

```json
  "menu.file.openRecent": "Open Recent",
```

In `src/i18n/ko.json`, after the `"menu.file.openFolder": ...,` line, add:

```json
  "menu.file.openRecent": "최근 항목",
```

- [ ] **Step 4: Add the submenu → i18n mapping in `menu-locale.ts`**

In `src/ipc/menu-locale.ts`, in the `MENU_I18N_MAP`, under the `// File menu` group, add after `file_open_folder: "menu.file.openFolder",`:

```ts
  menu_file_open_recent: "menu.file.openRecent",
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/utils/__tests__/recent-i18n.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/i18n/en.json src/i18n/ko.json src/ipc/menu-locale.ts src/utils/__tests__/recent-i18n.test.ts
git commit -m "feat(§82): add Open Recent menu i18n label + locale mapping"
```

---

### Task 3: Frontend core — `recent-menu.ts` entry assembly + event routing

**Files:**
- Create: `src/ipc/recent-menu.ts`
- Modify: `src/ipc/types.ts` (add `RecentMenuEntry`)
- Test: `src/ipc/__tests__/recent-menu.test.ts`

**Interfaces:**
- Consumes: `RecentFolderEntry` / `RecentFileEntry` from `src/stores/settings/general-settings.ts`; `openRecentFolder` / `openRecentFile` from `src/utils/recent-open.ts`; `basename` from `src/utils/path-utils.ts`; `t` / `Locale` from `src/i18n`; `useSettingsStore` from `src/stores/settings/store.ts`; `invoke` from `@tauri-apps/api/core`.
- Produces:
  - `RecentMenuEntry` interface (in `types.ts`).
  - `buildRecentMenuEntries(folders: RecentFolderEntry[], files: RecentFileEntry[], locale: Locale): RecentMenuEntry[]`
  - `handleRecentMenuEvent(payload: string): boolean`
  - `syncRecentMenu(): Promise<void>`

- [ ] **Step 1: Add the `RecentMenuEntry` type to `types.ts`**

At the end of `src/ipc/types.ts`, append:

```ts
// §82 Native "Open Recent" submenu payload (frontend → update_recent_menu)
export interface RecentMenuEntry {
  enabled?: boolean; // default true; false for non-clickable group headers
  id?: string; // present for kind:"item"; "recent_folder:<path>" | "recent_file:<path>" | "recent_clear"
  kind: "item" | "separator";
  label?: string; // present for kind:"item"
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/ipc/__tests__/recent-menu.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildRecentMenuEntries, handleRecentMenuEvent } from "../recent-menu";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const openFolderMock = vi.hoisted(() => vi.fn());
const openFileMock = vi.hoisted(() => vi.fn());
vi.mock("../../utils/recent-open", () => ({
  openRecentFolder: openFolderMock,
  openRecentFile: openFileMock,
}));

const clearRecentMock = vi.hoisted(() => vi.fn());
vi.mock("../../stores/settings/store", () => ({
  useSettingsStore: { getState: () => ({ clearRecent: clearRecentMock }) },
}));

const folder = (path: string, isVault?: boolean) => ({
  path,
  lastOpened: 0,
  isVault,
});
const file = (path: string) => ({ path, lastOpened: 0 });

describe("buildRecentMenuEntries", () => {
  it("returns [] when there are no recents", () => {
    expect(buildRecentMenuEntries([], [], "en")).toEqual([]);
  });

  it("emits folders, files, and a trailing clear action in order", () => {
    const entries = buildRecentMenuEntries(
      [folder("/a/vault", true), folder("/a/docs")],
      [file("/a/notes.md")],
      "en",
    );
    expect(entries).toEqual([
      { kind: "item", label: "Recent Folders", enabled: false },
      { kind: "item", id: "recent_folder:/a/vault", label: "vault — Vault" },
      { kind: "item", id: "recent_folder:/a/docs", label: "docs" },
      { kind: "separator" },
      { kind: "item", label: "Recent Files", enabled: false },
      { kind: "item", id: "recent_file:/a/notes.md", label: "notes.md" },
      { kind: "separator" },
      { kind: "item", id: "recent_clear", label: "Clear Recent" },
    ]);
  });

  it("omits the folders section when there are no folders", () => {
    const entries = buildRecentMenuEntries([], [file("/a/notes.md")], "en");
    expect(entries).toEqual([
      { kind: "item", label: "Recent Files", enabled: false },
      { kind: "item", id: "recent_file:/a/notes.md", label: "notes.md" },
      { kind: "separator" },
      { kind: "item", id: "recent_clear", label: "Clear Recent" },
    ]);
  });

  it("caps each section at 5 items", () => {
    const many = Array.from({ length: 8 }, (_, i) => file(`/a/f${i}.md`));
    const entries = buildRecentMenuEntries([], many, "en");
    const fileItems = entries.filter((e) => e.id?.startsWith("recent_file:"));
    expect(fileItems).toHaveLength(5);
  });
});

describe("handleRecentMenuEvent", () => {
  beforeEach(() => {
    openFolderMock.mockReset();
    openFileMock.mockReset();
    clearRecentMock.mockReset();
  });

  it("routes recent_folder: to openRecentFolder with the decoded path", () => {
    expect(handleRecentMenuEvent("recent_folder:/a/b:c")).toBe(true);
    expect(openFolderMock).toHaveBeenCalledWith("/a/b:c");
  });

  it("routes recent_file: to openRecentFile with the decoded path", () => {
    expect(handleRecentMenuEvent("recent_file:/a/n.md")).toBe(true);
    expect(openFileMock).toHaveBeenCalledWith("/a/n.md");
  });

  it("routes recent_clear to clearRecent", () => {
    expect(handleRecentMenuEvent("recent_clear")).toBe(true);
    expect(clearRecentMock).toHaveBeenCalledTimes(1);
  });

  it("returns false for unrelated payloads", () => {
    expect(handleRecentMenuEvent("file_save")).toBe(false);
    expect(openFolderMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/ipc/__tests__/recent-menu.test.ts`
Expected: FAIL — cannot resolve `../recent-menu` (module not created yet).

- [ ] **Step 4: Create `src/ipc/recent-menu.ts`**

```ts
// §82 Native "Open Recent" submenu — assemble entries from the recent store,
// push them into the Rust menu, and route menu clicks back to open helpers.
import { invoke } from "@tauri-apps/api/core";

import { type Locale, t } from "../i18n";
import type {
  RecentFileEntry,
  RecentFolderEntry,
} from "../stores/settings/general-settings";
import { useSettingsStore } from "../stores/settings/store";
import { basename } from "../utils/path-utils";
import { openRecentFile, openRecentFolder } from "../utils/recent-open";
import type { RecentMenuEntry } from "./types";

const MAX_ITEMS = 5;
const FOLDER_PREFIX = "recent_folder:";
const FILE_PREFIX = "recent_file:";
const CLEAR_ID = "recent_clear";

/** Assemble the ordered menu-entry list mirroring the in-app '+' recent menu. */
export function buildRecentMenuEntries(
  folders: RecentFolderEntry[],
  files: RecentFileEntry[],
  locale: Locale,
): RecentMenuEntry[] {
  const topFolders = folders.slice(0, MAX_ITEMS);
  const topFiles = files.slice(0, MAX_ITEMS);
  if (topFolders.length === 0 && topFiles.length === 0) return [];

  const entries: RecentMenuEntry[] = [];

  if (topFolders.length > 0) {
    entries.push({
      kind: "item",
      label: t("recent.folders", locale),
      enabled: false,
    });
    for (const f of topFolders) {
      const label = f.isVault
        ? `${basename(f.path)} — ${t("recent.vaultBadge", locale)}`
        : basename(f.path);
      entries.push({ kind: "item", id: `${FOLDER_PREFIX}${f.path}`, label });
    }
  }

  if (topFiles.length > 0) {
    if (entries.length > 0) entries.push({ kind: "separator" });
    entries.push({
      kind: "item",
      label: t("recent.files", locale),
      enabled: false,
    });
    for (const f of topFiles) {
      entries.push({
        kind: "item",
        id: `${FILE_PREFIX}${f.path}`,
        label: basename(f.path),
      });
    }
  }

  entries.push({ kind: "separator" });
  entries.push({ kind: "item", id: CLEAR_ID, label: t("recent.clear", locale) });
  return entries;
}

/** Route a "menu-event" payload if it belongs to the recent submenu. */
export function handleRecentMenuEvent(payload: string): boolean {
  if (payload.startsWith(FOLDER_PREFIX)) {
    void openRecentFolder(payload.slice(FOLDER_PREFIX.length));
    return true;
  }
  if (payload.startsWith(FILE_PREFIX)) {
    void openRecentFile(payload.slice(FILE_PREFIX.length));
    return true;
  }
  if (payload === CLEAR_ID) {
    useSettingsStore.getState().clearRecent();
    return true;
  }
  return false;
}

/** Push the current recent list into the native menu. */
export async function syncRecentMenu(): Promise<void> {
  const s = useSettingsStore.getState();
  const entries = buildRecentMenuEntries(
    s.recentFolders,
    s.recentFiles,
    s.locale as Locale,
  );
  await invoke("update_recent_menu", { entries });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/ipc/__tests__/recent-menu.test.ts`
Expected: PASS (all 8 tests).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/ipc/recent-menu.ts src/ipc/types.ts src/ipc/__tests__/recent-menu.test.ts
git commit -m "feat(§82): recent-menu entry assembly + event routing helpers"
```

---

### Task 4: Wire into the app — sync effect + menu-event dispatch

**Files:**
- Modify: `src/hooks/use-settings-effects.ts` (sync on recent/locale change + mount)
- Modify: `src/hooks/use-menu-event-handler.ts` (dispatch recent menu clicks)

**Interfaces:**
- Consumes: `syncRecentMenu`, `handleRecentMenuEvent` from `src/ipc/recent-menu.ts`.

- [ ] **Step 1: Add the recent-menu sync effect in `use-settings-effects.ts`**

In `src/hooks/use-settings-effects.ts`, the existing locale sync effect ends the hook (lines ~117-123). Right after it (before the closing `}` of `useSettingsEffects`), add:

```ts
  // Sync the native "Open Recent" submenu on recent-list / locale change (and on mount)
  const recentFolders = useSettingsStore((s) => s.recentFolders);
  const recentFiles = useSettingsStore((s) => s.recentFiles);
  useEffect(() => {
    import("../ipc/recent-menu").then(({ syncRecentMenu }) => {
      syncRecentMenu().catch((e) => logger.error(e));
    });
  }, [recentFolders, recentFiles, locale]);
```

(`locale` and `logger` are already in scope from the existing locale effect / imports.)

- [ ] **Step 2: Import and call `handleRecentMenuEvent` in `use-menu-event-handler.ts`**

In `src/hooks/use-menu-event-handler.ts`, add the import alongside the existing imports (after line 13):

```ts
import { handleRecentMenuEvent } from "../ipc/recent-menu";
```

Then, inside the `listen<string>("menu-event", async (event) => {` callback, as the very first statement before `switch (event.payload) {` (line ~60), add:

```ts
      if (handleRecentMenuEvent(event.payload)) return;
```

- [ ] **Step 3: Typecheck + lint the two files**

Run: `npm run typecheck && npx eslint src/hooks/use-settings-effects.ts src/hooks/use-menu-event-handler.ts src/ipc/recent-menu.ts --max-warnings=0`
Expected: no errors, no warnings.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/use-settings-effects.ts src/hooks/use-menu-event-handler.ts
git commit -m "feat(§82): wire native Open Recent submenu sync + click dispatch"
```

---

### Task 5: Full verification & manual GUI check

**Files:** none (verification only)

- [ ] **Step 1: Run the full frontend test suite**

Run: `npm run test`
Expected: all suites pass (prior baseline 2739 passed | 6 skipped, plus the new `recent-menu` + `recent-i18n` tests).

- [ ] **Step 2: Run frontend lint + typecheck**

Run: `npm run lint:frontend`
Expected: format, eslint, stylelint, typecheck, knip all green. (If knip flags `buildRecentMenuEntries` as unused because it is only referenced by tests, that is expected only if tests are excluded from knip config — check `knip.*`; the function is exported and used by `syncRecentMenu`, so it should not flag.)

- [ ] **Step 3: Run the Rust test suite**

Run: `npm run rust:_test`
Expected: Rust tests compile and pass (baseline 163/163, 4 ignored). No new Rust unit tests are added (menu glue needs a live Tauri app); this step confirms no regression.

- [ ] **Step 4: Manual GUI verification (macOS)**

Run: `npm run tauri dev`
Verify each:
1. **Open Recent present:** File ▸ Open Recent appears after "Open Folder…".
2. **Empty state:** with no recents (fresh profile / after Clear), "Open Recent" is greyed/disabled.
3. **Populated:** open a folder and a file, then reopen the menu — Open Recent lists "Recent Folders" (disabled header) + folders, a separator, "Recent Files" (disabled header) + files, a separator, and "Clear Recent".
4. **Vault badge:** a folder opened as a vault shows ` — Vault` suffix.
5. **Open works:** clicking a recent folder re-opens it; clicking a recent file opens it.
6. **Self-heal:** rename/delete a recent path on disk, click it → toast "Path not found…" and it disappears from the submenu on next open.
7. **Clear works:** "Clear Recent" empties both sections and the submenu becomes disabled.
8. **Locale:** switch language in Settings → "Open Recent", headers, and "Clear Recent" re-localize (ko: "최근 항목" / "최근 폴더" / "최근 파일" / "최근 항목 지우기").

- [ ] **Step 5: Final commit (only if manual check required any fixes)**

```bash
git add -A
git commit -m "fix(§82): Open Recent submenu manual-verification fixes"
```

---

## Notes for the implementer

- **Do not** add a live vault-context comparison for the badge — the store's `isVault` flag is authoritative here (spec §7 out-of-scope).
- **Do not** reimplement `basename` — import from `src/utils/path-utils.ts`.
- The global `on_menu_event` handler already emits ids for dynamically-added items, so **no** Rust event-handler change is needed beyond building the items.
- If `Submenu::set_enabled` is unavailable on the pinned Tauri version, use the disabled-placeholder fallback noted in Task 1 Step 6 rather than removing the empty-state behavior.
