# Vault M2a: Multi-Context Support Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable multiple vault/folder contexts to be open simultaneously with seamless switching via the context tab bar.

**Architecture:** Remove the single-context enforcement in both Rust (`set_vault_root` deletes previous context) and frontend (`openFolder` removes all contexts). Upgrade `WatcherState` and `LinkIndexState` from single-instance to per-context `HashMap`. The frontend `contextStore` already supports arrays — just stop deleting. Add a new `addFolder()` function for opening additional contexts. Upgrade ContextTabBar with "+", close, and context menu. Sidebar file tree switches when active context changes.

**Tech Stack:** Rust (Tauri 2.0), TypeScript (Zustand, React), Vitest, cargo test

**Design doc:** `docs/design/part12-vault-system.md` §12.4, §12.8, §12.9, §12.13 M2

**Prerequisite:** M1 complete (`feature/vault-system-design` branch)

---

## File Structure

### Rust (modify)
- `src-tauri/src/commands/fs_cmd.rs` — Remove single-context enforcement in `set_vault_root`; update `watch_dir` to per-context
- `src-tauri/src/commands/index_cmd.rs` — Per-context `LinkIndexState`
- `src-tauri/src/lib.rs` — Update managed state types

### Frontend (modify)
- `src/stores/file/file.ts` — Remove context deletion in `openFolder`; add `addFolder()`; per-context file trees
- `src/stores/context/context.ts` — Add `openFolderInContext()` helper
- `src/components/layout/ContextTabBar.tsx` — Full UI: "+", close, context menu, drag
- `src/styles/context-tab-bar.css` — Extended styles
- `src/components/layout/Sidebar.tsx` — (minor) context-switch file tree reload

### Frontend (create)
- `src/components/layout/ContextAddMenu.tsx` — "+" dropdown menu component

---

## Chunk 1: Rust Backend — Enable Multi-Context

### Task 1: Remove single-context enforcement in set_vault_root

**Files:**
- Modify: `src-tauri/src/commands/fs_cmd.rs`

The current `set_vault_root` (lines 78-124) deletes the previous active context before adding a new one. This enforces single-context. For M2, we keep old contexts alive and just add/activate the new one.

- [ ] **Step 1: Update set_vault_root to not delete previous context**

In `src-tauri/src/commands/fs_cmd.rs`, find `set_vault_root`. Replace the section that removes the previous context:

```rust
// BEFORE (lines 98-100):
if let Some(prev_id) = ctx_mgr.active_id().await {
    let _ = ctx_mgr.remove(&prev_id).await;
}

// AFTER:
// M2: Don't remove previous context — allow multiple contexts to coexist.
// Just check if this path is already registered as a context.
let existing_id = {
    let contexts = ctx_mgr.list().await;
    contexts.iter().find(|c| c.path == path).map(|c| c.id.clone())
};

if let Some(id) = existing_id {
    // Path already open — just activate it
    ctx_mgr.set_active(&id).await?;
    return Ok(());
}
```

This means: if the path is already a context, just switch to it. Otherwise, add it as a new context (the code below this section already handles that).

- [ ] **Step 2: Run tests**

Run: `cd src-tauri && cargo test`
Expected: all 233+ tests pass

- [ ] **Step 3: Run clippy**

Run: `cd src-tauri && cargo clippy -- -D warnings`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git commit -am "feat(§88): allow multiple contexts in set_vault_root (M2)"
```

---

### Task 2: Per-context WatcherState

**Files:**
- Modify: `src-tauri/src/lib.rs` — Change WatcherState type
- Modify: `src-tauri/src/commands/fs_cmd.rs` — Update watch_dir to use context_id

- [ ] **Step 1: Change WatcherState to HashMap**

In `src-tauri/src/lib.rs`, change:
```rust
// BEFORE:
pub struct WatcherState(pub std::sync::Mutex<Option<notify::RecommendedWatcher>>);

// AFTER:
pub struct WatcherState(pub std::sync::Mutex<std::collections::HashMap<String, notify::RecommendedWatcher>>);
```

And update the `.manage()` call:
```rust
// BEFORE:
.manage(WatcherState(std::sync::Mutex::new(None)))

// AFTER:
.manage(WatcherState(std::sync::Mutex::new(std::collections::HashMap::new())))
```

- [ ] **Step 2: Update watch_dir to use context_id**

In `src-tauri/src/commands/fs_cmd.rs`, find `watch_dir`. Add `context_id` parameter and use it as the HashMap key. The `context_id` defaults to the path if not provided (backward compat):

```rust
#[tauri::command]
pub async fn watch_dir(
    path: String,
    state: tauri::State<'_, crate::VaultRootState>,
    watcher_state: tauri::State<'_, crate::WatcherState>,
    ctx_mgr: tauri::State<'_, crate::context::ContextManager>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    check(&path)?;
    check_vault(&path, &state).await?;

    // Use active context id as watcher key, fallback to path
    let watcher_key = ctx_mgr.active_id().await.unwrap_or_else(|| path.clone());

    let watcher = crate::fs::create_watcher(&path, app)
        .map_err(|e| e.to_string())?;

    let mut guard = watcher_state.0.lock().map_err(|e| e.to_string())?;
    guard.insert(watcher_key, watcher);
    Ok(())
}
```

Note: check how the existing `create_watcher` works and adapt accordingly. The key change is `guard.insert(key, watcher)` instead of `*guard = Some(watcher)`.

- [ ] **Step 3: Verify compilation and tests**

Run: `cd src-tauri && cargo check && cargo test`
Expected: compiles and all tests pass

- [ ] **Step 4: Commit**

```bash
git commit -am "feat(§88): per-context WatcherState (HashMap) for multi-context file watching"
```

---

### Task 3: Per-context LinkIndexState

**Files:**
- Modify: `src-tauri/src/commands/index_cmd.rs` — HashMap-based index
- Modify: `src-tauri/src/lib.rs` — Update managed state type

- [ ] **Step 1: Change LinkIndexState to HashMap**

In `src-tauri/src/commands/index_cmd.rs`:
```rust
// BEFORE:
pub struct LinkIndexState(pub tokio::sync::Mutex<index::LinkIndex>);

// AFTER:
pub struct LinkIndexState(pub tokio::sync::Mutex<std::collections::HashMap<String, index::LinkIndex>>);
```

In `src-tauri/src/lib.rs`:
```rust
// BEFORE:
.manage(index_cmd::LinkIndexState(tokio::sync::Mutex::new(
    index::LinkIndex::new(),
)))

// AFTER:
.manage(index_cmd::LinkIndexState(tokio::sync::Mutex::new(
    std::collections::HashMap::new(),
)))
```

- [ ] **Step 2: Update refresh_index to use context key**

```rust
#[tauri::command]
pub async fn refresh_index(
    root_path: String,
    state: tauri::State<'_, LinkIndexState>,
    ctx_mgr: tauri::State<'_, crate::context::ContextManager>,
) -> Result<(), String> {
    let key = ctx_mgr.active_id().await.unwrap_or_else(|| root_path.clone());
    let new_index = crate::index::LinkIndex::build_from_root(&root_path)
        .await
        .map_err(|e| e.to_string())?;
    let mut map = state.0.lock().await;
    map.insert(key, new_index);
    Ok(())
}
```

- [ ] **Step 3: Update query commands (get_backlinks, get_link_index, etc.) to use active context's index**

Each query command needs to:
1. Get active context id from ContextManager
2. Look up the correct index from the HashMap
3. Return empty results if no index exists for the context

```rust
// Helper to get active index
async fn get_active_index<'a>(
    map: &'a HashMap<String, index::LinkIndex>,
    ctx_mgr: &tauri::State<'_, crate::context::ContextManager>,
) -> Option<&'a index::LinkIndex> {
    let key = ctx_mgr.active_id().await?;
    map.get(&key)
}
```

Apply this pattern to: `get_backlinks`, `get_link_index`, `update_file_index`, `get_unlinked_mentions`, `rename_file_with_links`, `rename_block_id`, `rename_namespace`.

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test`
Expected: all tests pass

- [ ] **Step 5: Run clippy**

Run: `cd src-tauri && cargo clippy -- -D warnings`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(§88): per-context LinkIndexState for multi-vault link isolation"
```

---

## Chunk 2: Frontend — Multi-Context File Management

### Task 4: Enable multi-context in openFolder

**Files:**
- Modify: `src/stores/file/file.ts`

- [ ] **Step 1: Remove context deletion loop from openFolder**

In `src/stores/file/file.ts`, find `openFolder()`. Remove the loop that deletes all existing contexts:

```typescript
// REMOVE these lines:
// Remove any existing contexts (M1: only one at a time)
for (const ctx of [...contextStore.contexts]) {
  await contextStore.removeContext(ctx.id).catch(() => {});
}
```

The Rust `set_vault_root` bridge already handles dedup (activates existing context if path matches).

- [ ] **Step 2: Create addFolder() for opening additional contexts**

Add a new exported function in `src/stores/file/file.ts`:

```typescript
/**
 * §81 Open an additional folder as a new context without replacing the current one.
 * Used by the "+" button in ContextTabBar.
 */
export async function addFolder(path: string): Promise<void> {
  // Detect vault vs folder
  const isVault = await listDir(path + "/.baram", false)
    .then(() => true)
    .catch(() => false);

  const contextStore = useContextStore.getState();

  // Check if already open
  const existing = contextStore.contexts.find((c) => c.path === path);
  if (existing) {
    await contextStore.setActiveContext(existing.id);
    return;
  }

  // Register in backend (set_vault_root handles ContextManager sync)
  await setVaultRoot(path);

  // Register in frontend contextStore
  await contextStore.addContext(isVault ? "vault" : "folder", path);

  // Derive rootPath from active context
  const activeCtx = contextStore.activeContext();
  const rootPath = activeCtx?.path ?? path;

  // Build file tree for new context
  const entries = await listDir(rootPath, true);
  const tree = buildFileTree(entries, rootPath);
  useFileStore.getState().setRootPath(rootPath);
  useFileStore.getState().setFileTree(tree);

  // Update settings
  useSettingsStore.getState().addRecentFolder(path);

  // Background index
  refreshIndex(rootPath)
    .then(() => useLinkStore.getState().invalidate())
    .catch((err) => logger.warn("§30 addFolder: index build failed", err));
}
```

- [ ] **Step 3: TypeScript check + tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git commit -am "feat(§81): enable multi-context openFolder + addFolder()"
```

---

### Task 5: Sidebar file tree switches on context change

**Files:**
- Modify: `src/stores/file/file.ts` — Enhance cross-store sync to reload file tree

The cross-store subscription already syncs `rootPath`. Extend it to also reload the file tree when switching contexts.

- [ ] **Step 1: Enhance the context subscription to reload file tree**

In `src/stores/file/file.ts`, find the `useContextStore.subscribe` block at the bottom. Extend it to rebuild the file tree:

```typescript
// §81 Cross-store sync: when active context changes, switch file tree
useContextStore.subscribe((state, prevState) => {
  if (
    state.activeContextId !== prevState.activeContextId &&
    state.activeContextId
  ) {
    const ctx = state.contexts.find((c) => c.id === state.activeContextId);
    if (ctx && ctx.contextType !== "file") {
      const fileStore = useFileStore.getState();
      if (fileStore.rootPath !== ctx.path) {
        fileStore.setRootPath(ctx.path);
        // Reload file tree for the new context
        listDir(ctx.path, true)
          .then((entries) => {
            const tree = buildFileTree(entries, ctx.path);
            useFileStore.getState().setFileTree(tree);
          })
          .catch((err) => logger.warn("§81 context switch: listDir failed", err));
        // Rebuild link index for the new context
        refreshIndex(ctx.path)
          .then(() => useLinkStore.getState().invalidate())
          .catch((err) =>
            logger.warn("§81 context switch: refreshIndex failed", err),
          );
      }
    }
  }
});
```

- [ ] **Step 2: TypeScript check + tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: all pass

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(§81): auto-reload file tree and index on context switch"
```

---

## Chunk 3: UI — ContextTabBar Full Implementation

### Task 6: ContextTabBar "+" button and close

**Files:**
- Modify: `src/components/layout/ContextTabBar.tsx`
- Create: `src/components/layout/ContextAddMenu.tsx`
- Modify: `src/styles/context-tab-bar.css`

- [ ] **Step 1: Create ContextAddMenu dropdown**

```tsx
// src/components/layout/ContextAddMenu.tsx

import { useCallback, useEffect, useRef, useState } from "react";

import { open } from "@tauri-apps/plugin-dialog";

import { addFolder } from "../../stores/file/file";
import { logger } from "../../utils/logger";

interface Props {
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
}

export function ContextAddMenu({ onClose, anchorRef }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Position below the anchor
  const [style, setStyle] = useState<React.CSSProperties>({});
  useEffect(() => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setStyle({ top: rect.bottom + 2, left: rect.left });
    }
  }, [anchorRef]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, anchorRef]);

  const handleOpenFolder = useCallback(async () => {
    onClose();
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected) {
        await addFolder(selected as string);
      }
    } catch (err) {
      logger.error("[ContextAddMenu] openFolder failed:", err);
    }
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="context-add-menu"
      style={style}
    >
      <button className="context-add-menu__item" onClick={handleOpenFolder}>
        Open Folder…
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Update ContextTabBar with "+" and close buttons**

```tsx
// src/components/layout/ContextTabBar.tsx — full rewrite

import { useCallback, useRef, useState } from "react";

import { Plus, X } from "lucide-react";
import { useShallow } from "zustand/shallow";

import { useContextStore } from "../../stores/context/context";
import "../../styles/context-tab-bar.css";
import { ContextAddMenu } from "./ContextAddMenu";

export function ContextTabBar() {
  const { contexts, activeContextId, setActiveContext, removeContext } =
    useContextStore(
      useShallow((s) => ({
        contexts: s.contexts,
        activeContextId: s.activeContextId,
        setActiveContext: s.setActiveContext,
        removeContext: s.removeContext,
      })),
    );

  const [showAddMenu, setShowAddMenu] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement>(null);

  const handleClose = useCallback(
    async (e: React.MouseEvent, contextId: string) => {
      e.stopPropagation();
      await removeContext(contextId);
    },
    [removeContext],
  );

  const handleMiddleClick = useCallback(
    (e: React.MouseEvent, contextId: string) => {
      if (e.button === 1) {
        e.preventDefault();
        removeContext(contextId);
      }
    },
    [removeContext],
  );

  // Always show tab bar when there are contexts (including single)
  // so the "+" button is accessible
  if (contexts.length === 0) return null;

  return (
    <div className="context-tab-bar">
      {contexts.map((ctx) => (
        <button
          key={ctx.id}
          className={`context-tab ${ctx.id === activeContextId ? "context-tab--active" : ""}`}
          onClick={() => setActiveContext(ctx.id)}
          onMouseDown={(e) => handleMiddleClick(e, ctx.id)}
          title={ctx.path}
        >
          <span
            className="context-tab__dot"
            style={{ backgroundColor: ctx.color }}
          />
          <span className="context-tab__label">{ctx.label}</span>
          {contexts.length > 1 && (
            <span
              className="context-tab__close"
              onClick={(e) => handleClose(e, ctx.id)}
              title="Close"
            >
              <X size={12} />
            </span>
          )}
        </button>
      ))}
      <button
        ref={addBtnRef}
        className="context-tab context-tab--add"
        onClick={() => setShowAddMenu((v) => !v)}
        title="Add context"
      >
        <Plus size={14} />
      </button>
      {showAddMenu && (
        <ContextAddMenu
          onClose={() => setShowAddMenu(false)}
          anchorRef={addBtnRef}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add CSS for close button, add button, and dropdown menu**

Append to `src/styles/context-tab-bar.css`:

```css
/* Close button */
.context-tab__close {
  display: none;
  align-items: center;
  justify-content: center;
  margin-left: 4px;
  padding: 1px;
  border-radius: 3px;
  color: var(--color-text-muted, #9ca3af);
  transition: color 0.1s, background 0.1s;
}

.context-tab:hover .context-tab__close {
  display: inline-flex;
}

.context-tab__close:hover {
  color: var(--color-text-default, #1a1a1a);
  background: rgba(0, 0, 0, 0.1);
}

[data-theme="dark"] .context-tab__close:hover {
  color: var(--color-text-default, #e0e0e0);
  background: rgba(255, 255, 255, 0.1);
}

/* Add button */
.context-tab--add {
  color: var(--color-text-muted, #9ca3af);
  padding: 3px 6px;
}

.context-tab--add:hover {
  color: var(--color-text-default, #1a1a1a);
}

[data-theme="dark"] .context-tab--add:hover {
  color: var(--color-text-default, #e0e0e0);
}

/* Add dropdown menu */
.context-add-menu {
  position: fixed;
  z-index: 1000;
  min-width: 160px;
  padding: 4px;
  background: var(--color-bg-elevated, #ffffff);
  border: 1px solid var(--color-border-default, #e5e7eb);
  border-radius: 6px;
  box-shadow: var(--shadow-md, 0 4px 6px rgba(0, 0, 0, 0.07));
}

[data-theme="dark"] .context-add-menu {
  background: var(--color-bg-elevated, #333333);
}

.context-add-menu__item {
  display: block;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-default, #1a1a1a);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.context-add-menu__item:hover {
  background: var(--color-bg-hover, rgba(0, 0, 0, 0.05));
}

[data-theme="dark"] .context-add-menu__item {
  color: var(--color-text-default, #e0e0e0);
}
```

- [ ] **Step 4: TypeScript check + tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(§82): ContextTabBar with add/close buttons and dropdown menu"
```

---

### Task 7: Context tab right-click menu

**Files:**
- Modify: `src/components/layout/ContextTabBar.tsx`

- [ ] **Step 1: Add right-click context menu**

Add a context menu state and handler to ContextTabBar. The menu should include:
- "Rename" → inline edit of label
- "Change Color" → color picker (simple preset list)
- "Close" → remove context
- "Close Others" → remove all except this one

Implementation: use a simple `contextMenu` state with `{ x, y, contextId }`, render a positioned div with menu items. Close on outside click.

- [ ] **Step 2: TypeScript check + tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: all pass

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(§82): context tab right-click menu (rename, color, close)"
```

---

## Chunk 4: Integration and Verification

### Task 8: Full regression test

- [ ] **Step 1: Run all Vitest tests**

Run: `npx vitest run`
Expected: 2267+ pass

- [ ] **Step 2: Run all Cargo tests**

Run: `cd src-tauri && cargo test`
Expected: 233+ pass

- [ ] **Step 3: Run clippy**

Run: `cd src-tauri && cargo clippy -- -D warnings`
Expected: 0 errors

- [ ] **Step 4: TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 5: Manual smoke test**

```
[ ] Open folder A → context tab bar shows (with single tab + "+" button)
[ ] Click "+" → dropdown shows "Open Folder…"
[ ] Open folder B → context tab bar shows 2 tabs
[ ] Click on context A tab → sidebar switches to A's file tree
[ ] Click on context B tab → sidebar switches to B's file tree
[ ] Editor tabs from both contexts coexist
[ ] Tab color dots match context colors
[ ] Middle-click context tab → closes it
[ ] Right-click context tab → menu appears
[ ] Close last context → back to home/empty state
[ ] Restart app → contexts persist
```

- [ ] **Step 6: Commit docs**

```bash
git commit -am "docs: update M2a status in vault system design doc"
```
