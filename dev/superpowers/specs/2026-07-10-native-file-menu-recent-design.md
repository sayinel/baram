# Native File Menu — Open Recent Submenu

**Date:** 2026-07-10
**Status:** Approved (design)
**Branch:** `feature/native-file-menu-recent`
**Design refs:** §82 (Context add menu / recent items), §4.4 (native menu)

## 1. Motivation

Baram already tracks recently opened folders and files and surfaces them in the
in-app Vault Tab **'+' menu** (`ContextAddMenu.tsx`, shipped in PR #180). The
same list is not reachable from the OS-native application menu. Users expect a
standard **File ▸ Open Recent** entry (the macOS/VS Code convention). This spec
extends the existing recent-items feature to the native File menu, reusing the
existing store, open helpers, and menu-event pipeline — no new state or IPC data
model beyond a single menu-rebuild command.

## 2. Current architecture (as-is)

- **Native menu** (`src-tauri/src/menu.rs`): built **once** at setup via
  `build_menu(app)`, returning `(Menu, MenuState)`. `MenuState` holds `HashMap`s
  of `items` / `submenus` / `predefined` keyed by id, used by `update_menu_locale`
  to re-label existing items. The File submenu = New File / Open File… /
  Open Folder… / ─ / Save / Save As… / Close Tab / Close Folder / ─ / Export….
- **Menu events** (`src-tauri/src/lib.rs`): a single global
  `app.on_menu_event(|app, event| emit("menu-event", event.id()))`. Any menu
  item — including items added later at runtime — emits its id string through
  this one handler.
- **Frontend dispatch** (`src/hooks/use-menu-event-handler.ts`): a `switch` on
  the `"menu-event"` payload string routes to handlers. It already receives a
  `handleOpenFilePath(path)` dep (currently unused).
- **Recent store** (`src/stores/settings/general-settings.ts`):
  `recentFolders: RecentFolderEntry[]` (`{ path, lastOpened, isVault? }`, cap 5),
  `recentFiles: RecentFileEntry[]` (`{ path, lastOpened }`, cap 10). Zustand
  `persist`. Actions: `addRecentFolder/File`, `removeRecentFolder/File`,
  `clearRecent`.
- **Open helpers** (`src/utils/recent-open.ts`): `openRecentFolder(path)` →
  `addFolder(path)`, `openRecentFile(path)` → `openFileByPath(path)`; both
  self-heal — on failure they remove the entry and toast (`recent.notFound`).
- **Locale sync** (`src/ipc/menu-locale.ts` + `use-settings-effects.ts`):
  `syncMenuLocale(locale)` builds `{ menuId → localized label }` from
  `MENU_I18N_MAP` and invokes `update_menu_locale`; called on mount and on
  `locale` change.

## 3. Design (to-be)

### 3.1 Data flow

```
[Zustand settings store]                        [Rust native menu]
 recentFolders / recentFiles / locale            File ▸ Open Recent  (empty submenu, built at startup)
        │                                                  ▲
        │ subscribe (change) + on mount                    │ invoke update_recent_menu(entries)
        ▼                                                  │  → clear submenu, rebuild from entries
 use-settings-effects effect ──► ipc/recent-menu.ts ───────┘  → set_enabled(!entries.isEmpty)
                                  syncRecentMenu()
                                   · localize headers/Clear via t()
                                   · assemble entries[] (path encoded in id)

 user clicks item ──► on_menu_event ──► emit "menu-event" (id string)
                                             ▼
             use-menu-event-handler switch (new prefix branches)
               "recent_folder:<path>" ─► openRecentFolder(path)
               "recent_file:<path>"   ─► openRecentFile(path)
               "recent_clear"         ─► clearRecent()
```

**Principle:** reuse the existing store, self-healing open helpers, and the
global `on_menu_event` emit pipe. New code is only: (a) a Rust submenu-rebuild
command, (b) a frontend sync helper, (c) `switch` prefix branches.

### 3.2 Approach chosen

**Dynamic nested "Open Recent" submenu, frontend-driven** (chosen over
full-menu-rebuild and fixed-slot alternatives). `build_menu` creates an empty
`Open Recent` submenu inside the File menu; a new `update_recent_menu` IPC
command clears and repopulates it whenever the recent list or locale changes.
Standard macOS convention, maximal reuse.

### 3.3 Submenu structure (full mirror of the in-app '+' menu)

```
File
  New File
  Open File...
  Open Folder...
  Open Recent      ▸ ── Recent Folders        (disabled header)
  ──────────            my-vault  — Vault
  Save                  docs
  ...                 ──────────
                       Recent Files            (disabled header)
                         notes.md
                         todo.md
                       ──────────
                       Clear Recent Items
```

- Group headers ("Recent Folders" / "Recent Files") are **disabled** menu items
  (`enabled: false`) acting as non-clickable labels, mirroring
  `ContextAddMenu`'s `.context-add-menu__label`.
- Vault folders get a ` — {vaultBadge}` suffix (label-only; from the store
  `isVault` flag, no live context comparison).
- Sections are omitted entirely when their list is empty (no empty header). When
  **both** lists are empty, the whole "Open Recent" submenu is disabled (grayed),
  and no Clear item is shown.
- Folder count cap 5, file count cap 5 in the menu (matches `ContextAddMenu`'s
  `.slice(0, 5)`), even though the store keeps up to 10 files.

### 3.4 Menu item id encoding

| Entry | id |
|---|---|
| Recent folder | `recent_folder:${path}` |
| Recent file | `recent_file:${path}` |
| Clear action | `recent_clear` |
| Group headers / separators | no id (disabled item / separator) |

Absolute paths are embedded verbatim. Frontend dispatch matches by prefix and
`slice`s the remainder as the path.

## 4. Component changes

| File | Change |
|---|---|
| `src-tauri/src/menu.rs` | Build empty `SubmenuBuilder` "Open Recent" (id `menu_file_open_recent`), insert after `Open Folder…` in the File submenu; register it in `MenuState.submenus`. |
| `src-tauri/src/lib.rs` | New command `update_recent_menu(app: AppHandle, state: State<MenuState>, entries: Vec<RecentMenuEntry>)` — resolve `menu_file_open_recent`, remove all existing child items, append rebuilt items/separators; `submenu.set_enabled(!entries.is_empty())`. Register in `invoke_handler!`. |
| `src/ipc/recent-menu.ts` (new) | `syncRecentMenu()` — read store snapshot, build localized `entries[]` (headers `enabled:false`, folder/file items with encoded ids + vault suffix, separators, Clear item), `invoke("update_recent_menu", { entries })`. |
| `src/hooks/use-settings-effects.ts` | Add an effect (same pattern as `syncMenuLocale`) subscribing to `recentFolders` / `recentFiles` / `locale`, calling `syncRecentMenu()` on mount + change. |
| `src/hooks/use-menu-event-handler.ts` | Add `switch` `default` (or dedicated) branch: `recent_folder:` → `openRecentFolder`, `recent_file:` → `openRecentFile`, `recent_clear` → `clearRecent`. Import from `recent-open.ts` / settings store. |
| `src/ipc/menu-locale.ts` | Add `menu_file_open_recent: "menu.file.openRecent"` to `MENU_I18N_MAP` (submenu title localization). |
| `src/i18n/en.json`, `src/i18n/ko.json` | Add `menu.file.openRecent` ("Open Recent" / "최근 항목"). Headers/Clear reuse existing `recent.folders` / `recent.files` / `recent.clear` / `recent.vaultBadge`. |
| `src-tauri/ipc-registry.json` + `src/ipc/types.ts` | Register `update_recent_menu` command and the `RecentMenuEntry` type. |

### 4.1 `RecentMenuEntry` shape

```ts
// src/ipc/types.ts
export interface RecentMenuEntry {
  kind: "item" | "separator";
  id?: string;        // present for kind:"item"
  label?: string;     // present for kind:"item"
  enabled?: boolean;  // default true; false for group headers
}
```

```rust
// src-tauri/src/lib.rs
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecentMenuEntry {
    kind: String,            // "item" | "separator"
    id: Option<String>,
    label: Option<String>,
    enabled: Option<bool>,   // None => true
}
```

Frontend owns i18n + ordering; Rust stays a dumb builder (item vs separator).

## 5. Edge cases & error handling

- **Stale path (moved/deleted):** click → `openRecentFolder/File` throws →
  existing self-heal removes the entry + toasts (`recent.notFound`) → next
  `syncRecentMenu` rebuild drops it. No new handling needed.
- **Empty recents:** `entries` is empty → submenu disabled (grayed "Open
  Recent"); communicates "nothing recent" without an empty popup.
- **Locale change:** the same effect re-runs `syncRecentMenu`, so headers/Clear
  re-localize; submenu title re-localizes via the existing `update_menu_locale`
  path (map entry added).
- **Rebuild ordering:** `update_recent_menu` must remove all existing children
  before appending to avoid duplicate accumulation across rebuilds.
- **Special characters in paths:** ids carry raw paths; matching uses
  `startsWith` + `slice(prefix.length)`, so colons inside paths are preserved
  (only the first `recent_file:` / `recent_folder:` prefix is stripped).

## 6. Testing

- `src/ipc/__tests__/recent-menu.test.ts` (new): given store snapshots, assert
  the assembled `entries[]` — ordering (folders header → folders → sep → files
  header → files → sep → clear), id encoding, `enabled:false` on headers, vault
  suffix on vault folders, `slice(0,5)` caps, empty-list → `[]`, and the
  `invoke("update_recent_menu", { entries })` argument.
- `use-menu-event-handler` prefix branches: add cases for `recent_folder:`,
  `recent_file:`, `recent_clear` (follow existing handler test patterns if
  present).
- i18n: extend the `recent-i18n` test pattern to assert `menu.file.openRecent`
  exists in both locales.
- Rust: `cargo build` + `cargo test` green; the remove-then-append logic is
  verified via manual GUI check (Tauri menu APIs are not unit-testable in this
  repo).
- Regression: full `npm test` green; TypeScript clean; manual GUI verification
  on macOS (open recents, vault badge, clear, empty-disabled, locale toggle,
  stale-path self-heal).

## 7. Out of scope (YAGNI)

- Live context comparison for the vault badge (store `isVault` flag suffices).
- Per-item "remove from recent" in the native menu (Clear-all only, mirroring
  the in-app menu).
- Windows/Linux-specific menu polish beyond what Tauri renders by default
  (feature is cross-platform via Tauri; primary verification on macOS).
- Icons in native menu items (not portably supported; basename text only).
