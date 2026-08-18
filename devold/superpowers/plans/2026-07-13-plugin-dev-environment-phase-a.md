# Plugin Dev Environment — Phase A (Lifecycle + Local Dev Loop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a developer register a local plugin *folder*, load it, edit it, and press **Reload** to re-run it — and fix the latent asset-protocol-scope gap so installed plugins load at all.

**Architecture:** Same-context ESM loading (Obsidian model — required by `tiptapExtensions`). Dev plugins are referenced in place (no copy); their source folders are persisted in Rust `config.json` and granted asset-protocol scope at runtime via `app.asset_protocol_scope().allow_directory(path, true)` (the established pattern from `context_cmd.rs:13-16` / `fs_cmd.rs:81`). Reload = clean `unloadPlugin` (existing disposable teardown) → `loadPlugin` with a cache-busted import URL.

**Tech Stack:** Rust (Tauri 2, `tauri-plugin-dialog`, `serde_json`, `thiserror`), TypeScript/React 19, Zustand, Vitest, cargo test.

## Global Constraints

- Plugin install dir: `~/.baram/plugins/` (`get_plugin_dir()`, `plugin/mod.rs:104`). NOT under `$APPDATA/**` (the only static asset scope, `tauri.conf.json:26`) → runtime `allow_directory` is mandatory.
- IPC commands return `Result<T, String>` (Tauri serialization constraint).
- Rust: custom errors via `thiserror` (`PluginError`, `plugin/mod.rs:8`).
- TS strict mode; files ≤ ~300 lines; function names camelCase, components/Extensions PascalCase; kebab-case filenames.
- Zustand: never bare `useStore()` in components — use `useShallow((s) => ({...}))`.
- Tests: `npm test` → `vitest run` (never `jest`). Rust: `cargo test`.
- Commits: Conventional Commits, English, reference `§69`.
- **Testability note:** Tauri command handlers that need `AppHandle` (config I/O, asset scope) cannot be unit-tested without a running app. For those, extract pure helpers and unit-test *them*; the command wiring is verified by `cargo build` + an explicit **manual GUI verification** step. Pure Rust helpers and frontend logic get real automated tests.

---

### Task 1: Rust — grant asset scope to the plugin install dir at startup (latent bug fix)

**Files:**
- Modify: `src-tauri/src/commands/plugin_cmd.rs` (add command)
- Modify: `src-tauri/src/lib.rs:232-237` (register command)
- Modify: `src/ipc/plugin-invoke.ts` (add wrapper)
- Modify: `src/plugins/plugin-lifecycle.ts:10` (call before loading)

**Interfaces:**
- Produces (Rust): `#[tauri::command] pub async fn plugin_prepare_scopes(app: tauri::AppHandle) -> Result<(), String>`
- Produces (TS): `pluginPrepareScopes(): Promise<void>`

- [ ] **Step 1: Add the command to `plugin_cmd.rs`**

```rust
use tauri::Manager;

/// Grant the asset protocol runtime scope for the plugin install dir so
/// convertFileSrc(index.mjs) can load. ~/.baram/plugins is NOT covered by the
/// static $APPDATA scope, so this MUST run before any plugin loads.
#[tauri::command]
pub async fn plugin_prepare_scopes(app: tauri::AppHandle) -> Result<(), String> {
    let dir = plugin::get_plugin_dir().map_err(|e| e.to_string())?;
    app.asset_protocol_scope()
        .allow_directory(&dir, true)
        .map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 2: Register it in `lib.rs`**

In the `tauri::generate_handler![ ... ]` block (after `plugin_cmd::plugin_get_dir,` at line 237), add:

```rust
            plugin_cmd::plugin_prepare_scopes,
```

- [ ] **Step 3: Add the TS wrapper to `src/ipc/plugin-invoke.ts`**

```ts
export async function pluginPrepareScopes(): Promise<void> {
  return invoke<void>("plugin_prepare_scopes");
}
```

- [ ] **Step 4: Call it at startup in `plugin-lifecycle.ts`**

At the top of `initializePlugins()` (before reading the store), add:

```ts
import { pluginPrepareScopes } from "../ipc/plugin-invoke";
// ...
export async function initializePlugins(): Promise<void> {
  // Grant asset scope for ~/.baram/plugins before any load (see Global Constraints).
  await pluginPrepareScopes().catch((err) =>
    logger.error("[PluginLifecycle] prepare scopes failed:", err),
  );

  const { installedPlugins } = usePluginStore.getState();
  // ... rest unchanged
```

- [ ] **Step 5: Compile check**

Run: `cd src-tauri && cargo build 2>&1 | tail -5`
Expected: builds clean (no errors).

- [ ] **Step 6: Manual GUI verification**

Run: `npm run tauri dev`. Install (or place) a plugin under `~/.baram/plugins/<id>/` with a valid `index.mjs`, enable it, restart. Expected: plugin activates with no `asset:` 403 in the devtools console (previously it would fail to `import()`).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/plugin_cmd.rs src-tauri/src/lib.rs src/ipc/plugin-invoke.ts src/plugins/plugin-lifecycle.ts
git commit -m "fix(§69): grant asset scope to plugin install dir at startup"
```

---

### Task 2: Rust — dev-folder persistence + add/remove/list commands

**Files:**
- Modify: `src-tauri/src/plugin/mod.rs` (add `is_dev` field, pure helpers, dev-folder logic)
- Modify: `src-tauri/src/commands/plugin_cmd.rs` (3 commands)
- Modify: `src-tauri/src/lib.rs` (register 3 commands)
- Test: `src-tauri/src/plugin/mod.rs` `#[cfg(test)]` module

**Interfaces:**
- Consumes: `config::get_config(app, key)`, `config::set_config(app, key, value)` (`config/mod.rs:59,71`); `validate_manifest`, `get_plugin_dir`, `PluginManifest`, `InstalledPluginInfo` (`plugin/mod.rs`).
- Produces (Rust pure): `pub fn normalize_dev_list(existing: &[String], add: Option<&str>, remove: Option<&str>) -> Vec<String>`; `pub fn read_manifest_at(folder: &Path) -> Result<PluginManifest, PluginError>`
- Produces (commands): `plugin_add_dev_folder(app, path: String) -> Result<InstalledPluginInfo, String>`, `plugin_remove_dev_folder(app, path: String) -> Result<(), String>`, `plugin_list_dev(app) -> Result<Vec<InstalledPluginInfo>, String>`
- Config key: `"plugin.devFolders"` → JSON-encoded `Vec<String>` stored as a string.

- [ ] **Step 1: Write failing unit tests in `plugin/mod.rs` tests module**

Append to the `#[cfg(test)] mod tests`:

```rust
    #[test]
    fn test_normalize_dev_list_add_dedups() {
        let list = vec!["/a".to_string(), "/b".to_string()];
        let out = normalize_dev_list(&list, Some("/a"), None);
        assert_eq!(out, vec!["/a".to_string(), "/b".to_string()]); // no dupe
        let out2 = normalize_dev_list(&list, Some("/c"), None);
        assert_eq!(out2, vec!["/a".to_string(), "/b".to_string(), "/c".to_string()]);
    }

    #[test]
    fn test_normalize_dev_list_remove() {
        let list = vec!["/a".to_string(), "/b".to_string()];
        let out = normalize_dev_list(&list, None, Some("/a"));
        assert_eq!(out, vec!["/b".to_string()]);
    }

    #[test]
    fn test_read_manifest_at_missing() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(read_manifest_at(tmp.path()).is_err());
    }

    #[test]
    fn test_read_manifest_at_valid() {
        let tmp = tempfile::tempdir().unwrap();
        let json = r#"{"id":"dev-x","name":"Dev X","description":"","version":"1.0.0","author":"","license":"MIT","main":"index.mjs","engines":{"baram":">=0.2.0"},"capabilities":["statusbar"]}"#;
        std::fs::write(tmp.path().join("baram-plugin.json"), json).unwrap();
        let m = read_manifest_at(tmp.path()).unwrap();
        assert_eq!(m.id, "dev-x");
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test plugin::tests 2>&1 | tail -15`
Expected: FAIL — `normalize_dev_list` / `read_manifest_at` not found.

- [ ] **Step 3: Add `is_dev` field + pure helpers to `plugin/mod.rs`**

Add `is_dev` to `InstalledPluginInfo` (after `checksum`, line 69):

```rust
    #[serde(default)]
    pub is_dev: bool,
```

> Every existing `InstalledPluginInfo { ... }` literal must add `is_dev: false`. There are three: in `install_plugin` (line ~180), in `list_installed` (line ~222). Update both.

Add the pure helpers (near the other helper fns, before the tests module):

```rust
use std::path::Path;

/// Dedup-aware add/remove for the persisted dev-folder list.
pub fn normalize_dev_list(existing: &[String], add: Option<&str>, remove: Option<&str>) -> Vec<String> {
    let mut out: Vec<String> = existing.to_vec();
    if let Some(r) = remove {
        out.retain(|p| p != r);
    }
    if let Some(a) = add {
        if !out.iter().any(|p| p == a) {
            out.push(a.to_string());
        }
    }
    out
}

/// Read + validate a manifest from an arbitrary folder (dev plugin source).
pub fn read_manifest_at(folder: &Path) -> Result<PluginManifest, PluginError> {
    let manifest_path = folder.join("baram-plugin.json");
    if !manifest_path.exists() {
        return Err(PluginError::InvalidManifest(
            "baram-plugin.json not found in dev folder".to_string(),
        ));
    }
    let content = std::fs::read_to_string(&manifest_path)?;
    let manifest: PluginManifest = serde_json::from_str(&content)?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test plugin::tests 2>&1 | tail -15`
Expected: PASS (all tests including the 3 new ones).

- [ ] **Step 5: Add the 3 commands to `plugin_cmd.rs`**

```rust
use crate::config;

const DEV_FOLDERS_KEY: &str = "plugin.devFolders";

fn read_dev_folders(app: &tauri::AppHandle) -> Result<Vec<String>, String> {
    match config::get_config(app, DEV_FOLDERS_KEY).map_err(|e| e.to_string())? {
        Some(s) => serde_json::from_str(&s).map_err(|e| e.to_string()),
        None => Ok(Vec::new()),
    }
}

fn write_dev_folders(app: &tauri::AppHandle, list: &[String]) -> Result<(), String> {
    let s = serde_json::to_string(list).map_err(|e| e.to_string())?;
    config::set_config(app, DEV_FOLDERS_KEY, &s).map_err(|e| e.to_string())
}

fn dev_info(app: &tauri::AppHandle, path: &str) -> Result<plugin::InstalledPluginInfo, String> {
    let folder = std::path::Path::new(path);
    let manifest = plugin::read_manifest_at(folder).map_err(|e| e.to_string())?;
    app.asset_protocol_scope()
        .allow_directory(folder, true)
        .map_err(|e| e.to_string())?;
    Ok(plugin::InstalledPluginInfo {
        manifest,
        install_path: path.to_string(),
        checksum: String::new(),
        is_dev: true,
    })
}

#[tauri::command]
pub async fn plugin_add_dev_folder(
    app: tauri::AppHandle,
    path: String,
) -> Result<plugin::InstalledPluginInfo, String> {
    let info = dev_info(&app, &path)?; // validates manifest + grants scope
    let list = plugin::normalize_dev_list(&read_dev_folders(&app)?, Some(&path), None);
    write_dev_folders(&app, &list)?;
    Ok(info)
}

#[tauri::command]
pub async fn plugin_remove_dev_folder(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let list = plugin::normalize_dev_list(&read_dev_folders(&app)?, None, Some(&path));
    write_dev_folders(&app, &list)
}

#[tauri::command]
pub async fn plugin_list_dev(
    app: tauri::AppHandle,
) -> Result<Vec<plugin::InstalledPluginInfo>, String> {
    let mut out = Vec::new();
    for path in read_dev_folders(&app)? {
        match dev_info(&app, &path) {
            Ok(info) => out.push(info),
            Err(e) => log::warn!("[plugin] skip dev folder {path}: {e}"),
        }
    }
    Ok(out)
}
```

> If `log::warn!` is not already available in this file, use `eprintln!("[plugin] skip dev folder {path}: {e}");` instead — do not add a new dependency.

- [ ] **Step 6: Register the 3 commands in `lib.rs`**

After `plugin_cmd::plugin_prepare_scopes,` (from Task 1), add:

```rust
            plugin_cmd::plugin_add_dev_folder,
            plugin_cmd::plugin_remove_dev_folder,
            plugin_cmd::plugin_list_dev,
```

- [ ] **Step 7: Compile check**

Run: `cd src-tauri && cargo build 2>&1 | tail -5`
Expected: builds clean.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/plugin/mod.rs src-tauri/src/commands/plugin_cmd.rs src-tauri/src/lib.rs
git commit -m "feat(§69): dev-folder register/remove/list Rust commands + asset scope"
```

---

### Task 3: Frontend — `reloadPlugin` with cache-busting + injectable importer seam

**Files:**
- Modify: `src/plugins/plugin-loader.ts`
- Test: `src/plugins/__tests__/plugin-loader.test.ts` (create)

**Interfaces:**
- Consumes: existing `PluginLoader.loadPlugin`, `unloadPlugin`, `createExtensionContext`.
- Produces: `PluginLoader.reloadPlugin(installPath: string, manifest: PluginManifest): Promise<void>`; constructor/factory accepts an optional `importer: (url: string) => Promise<PluginModule>` (default `(url) => import(/* @vite-ignore */ url)`) so tests can inject a fake module.

- [ ] **Step 1: Write the failing test**

Create `src/plugins/__tests__/plugin-loader.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));

import { PluginLoader } from "../plugin-loader";
import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  id: "dev-x", name: "Dev X", description: "", version: "1.0.0",
  author: "", license: "MIT", main: "index.mjs",
  engines: { baram: ">=0.2.0" }, capabilities: ["commands"],
};

describe("PluginLoader.reloadPlugin", () => {
  it("unloads then reloads with a cache-busted url", async () => {
    const urls: string[] = [];
    let activateCount = 0;
    let deactivateCount = 0;
    const importer = vi.fn(async (url: string) => {
      urls.push(url);
      return {
        activate: () => { activateCount++; },
        deactivate: () => { deactivateCount++; },
      };
    });
    const loader = new PluginLoader(importer);

    await loader.loadPlugin("/dev/dev-x", manifest);
    await loader.reloadPlugin("/dev/dev-x", manifest);

    expect(activateCount).toBe(2);   // loaded twice
    expect(deactivateCount).toBe(1); // unloaded once between
    expect(urls).toHaveLength(2);
    expect(urls[0]).not.toBe(urls[1]);       // cache-busted
    expect(urls[1]).toContain("?v=");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- plugin-loader 2>&1 | tail -20`
Expected: FAIL — `PluginLoader` constructor takes no importer / `reloadPlugin` undefined.

- [ ] **Step 3: Implement the seam + reload in `plugin-loader.ts`**

Add a module-load counter and importer field. Change the class head:

```ts
type Importer = (url: string) => Promise<PluginModule>;

export class PluginLoader {
  private loaded = new Map<string, LoadedPlugin>();
  private reloadCounter = 0;
  private readonly importer: Importer;

  constructor(importer?: Importer) {
    this.importer =
      importer ?? ((url) => import(/* @vite-ignore */ url) as Promise<PluginModule>);
  }
```

In `loadPlugin`, replace the dynamic-import block (currently `module = await import(...)`) with a cache-busted URL through the injected importer:

```ts
    // 2. Construct asset URL for the main entry (cache-busted for reload)
    const mainPath = `${installPath}/${manifest.main}`;
    const assetUrl = `${convertFileSrc(mainPath)}?v=${++this.reloadCounter}`;

    // 3. Dynamic import (via injectable importer)
    let module: PluginModule;
    try {
      module = await this.importer(assetUrl);
    } catch (err) {
      throw new Error(`Failed to load plugin module ${manifest.id}: ${err}`, {
        cause: err,
      });
    }
```

Add the reload method (after `loadPlugin`):

```ts
  /** Reload a plugin: clean unload (disposes subscriptions) then fresh load. */
  async reloadPlugin(installPath: string, manifest: PluginManifest): Promise<void> {
    await this.unloadPlugin(manifest.id);
    await this.loadPlugin(installPath, manifest);
  }
```

Keep the singleton export: `export const pluginLoader = new PluginLoader();`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- plugin-loader 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/plugin-loader.ts src/plugins/__tests__/plugin-loader.test.ts
git commit -m "feat(§69): plugin reloadPlugin with cache-busting + importer seam"
```

---

### Task 4: Frontend — store + lifecycle integration for dev plugins

**Files:**
- Modify: `src/plugins/types.ts:41-48` (`InstalledPlugin` gains dev fields)
- Modify: `src/ipc/plugin-invoke.ts` (dev wrappers)
- Modify: `src/stores/system/plugin.ts` (dev-plugin runtime state + action)
- Modify: `src/plugins/plugin-lifecycle.ts` (load dev plugins at startup)
- Test: `src/plugins/__tests__/plugin-store.test.ts` (extend)

**Interfaces:**
- Consumes: `pluginAddDevFolder`, `pluginRemoveDevFolder`, `pluginListDev` (Task 2 commands); `RustInstalledPluginInfo` (`ipc/plugin-invoke.ts:6`, now includes `is_dev`).
- Produces (TS wrappers): `pluginAddDevFolder(path: string): Promise<RustInstalledPluginInfo>`, `pluginRemoveDevFolder(path: string): Promise<void>`, `pluginListDev(): Promise<RustInstalledPluginInfo[]>`.
- Produces (store): `devPlugins: Record<string, InstalledPlugin>` (runtime, NOT persisted — Rust config is the source of truth), `setDevPlugins(list: InstalledPlugin[]): void`, `addDevPlugin(p: InstalledPlugin): void`, `removeDevPlugin(id: string): void`.
- `InstalledPlugin` gains: `isDev?: boolean`, `devPath?: string`.

- [ ] **Step 1: Add dev fields to `RustInstalledPluginInfo` and `InstalledPlugin`**

In `src/ipc/plugin-invoke.ts` extend the interface:

```ts
export interface RustInstalledPluginInfo {
  checksum: string;
  install_path: string;
  manifest: PluginManifest;
  is_dev?: boolean;
}
```

In `src/plugins/types.ts` `InstalledPlugin`:

```ts
export interface InstalledPlugin {
  checksum: string;
  enabled: boolean;
  installedAt: number;
  installPath: string;
  isDev?: boolean;
  manifest: PluginManifest;
  updatedAt: number;
}
```

- [ ] **Step 2: Add the dev IPC wrappers to `src/ipc/plugin-invoke.ts`**

```ts
export async function pluginAddDevFolder(
  path: string,
): Promise<RustInstalledPluginInfo> {
  return invoke<RustInstalledPluginInfo>("plugin_add_dev_folder", { path });
}

export async function pluginRemoveDevFolder(path: string): Promise<void> {
  return invoke<void>("plugin_remove_dev_folder", { path });
}

export async function pluginListDev(): Promise<RustInstalledPluginInfo[]> {
  return invoke<RustInstalledPluginInfo[]>("plugin_list_dev");
}
```

- [ ] **Step 3: Write the failing store test**

Extend `src/plugins/__tests__/plugin-store.test.ts` (add a describe block):

```ts
import { usePluginStore } from "../../stores/system/plugin";
import type { InstalledPlugin } from "../types";

function devPlugin(id: string): InstalledPlugin {
  return {
    checksum: "", enabled: true, installedAt: 0, installPath: `/dev/${id}`,
    isDev: true, updatedAt: 0,
    manifest: {
      id, name: id, description: "", version: "1.0.0", author: "",
      license: "MIT", main: "index.mjs", engines: { baram: ">=0.2.0" },
      capabilities: [],
    },
  };
}

describe("plugin store dev plugins", () => {
  it("sets, adds, and removes dev plugins without persisting", () => {
    usePluginStore.getState().setDevPlugins([devPlugin("a"), devPlugin("b")]);
    expect(Object.keys(usePluginStore.getState().devPlugins)).toEqual(["a", "b"]);
    usePluginStore.getState().removeDevPlugin("a");
    expect(Object.keys(usePluginStore.getState().devPlugins)).toEqual(["b"]);
    usePluginStore.getState().addDevPlugin(devPlugin("c"));
    expect(Object.keys(usePluginStore.getState().devPlugins).sort()).toEqual(["b", "c"]);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -- plugin-store 2>&1 | tail -20`
Expected: FAIL — `devPlugins` / `setDevPlugins` undefined.

- [ ] **Step 5: Add dev state + actions to `src/stores/system/plugin.ts`**

Add to the `PluginState` interface:

```ts
  addDevPlugin: (plugin: InstalledPlugin) => void;
  devPlugins: Record<string, InstalledPlugin>;
  removeDevPlugin: (id: string) => void;
  setDevPlugins: (list: InstalledPlugin[]) => void;
```

Add to the store body (runtime section, alongside `installing: {}`):

```ts
      devPlugins: {},

      setDevPlugins: (list) =>
        set({
          devPlugins: Object.fromEntries(list.map((p) => [p.manifest.id, p])),
        }),

      addDevPlugin: (plugin) =>
        set((state) => ({
          devPlugins: { ...state.devPlugins, [plugin.manifest.id]: plugin },
        })),

      removeDevPlugin: (id) =>
        set((state) => ({ devPlugins: omitKey(state.devPlugins, id) })),
```

> Do NOT add `devPlugins` to `partialize` — it stays runtime-only (Rust config is the source of truth).

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- plugin-store 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 7: Load dev plugins at startup in `plugin-lifecycle.ts`**

After the existing installed-plugin load block in `initializePlugins()`, add:

```ts
  // Dev plugins (source of truth = Rust config; not persisted in the store).
  try {
    const devRaw = await pluginListDev();
    const devPlugins: InstalledPlugin[] = devRaw.map((r) => ({
      checksum: r.checksum,
      enabled: true,
      installedAt: 0,
      installPath: r.install_path,
      isDev: true,
      manifest: r.manifest,
      updatedAt: 0,
    }));
    usePluginStore.getState().setDevPlugins(devPlugins);
    await Promise.allSettled(
      devPlugins.map((p) =>
        pluginLoader.loadPlugin(p.installPath, p.manifest).catch((err) => {
          logger.error(`[PluginLifecycle] dev load failed ${p.manifest.id}:`, err);
          usePluginStore.getState().setError(p.manifest.id, String(err));
        }),
      ),
    );
  } catch (err) {
    logger.error("[PluginLifecycle] dev plugin init failed:", err);
  }
```

Add the import at the top: `import { pluginListDev } from "../ipc/plugin-invoke";` and `import type { InstalledPlugin } from "./types";` (extend existing type import).

- [ ] **Step 8: Run the full frontend test suite + typecheck**

Run: `npm test -- plugin 2>&1 | tail -20 && npx tsc --noEmit 2>&1 | tail -5`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/ipc/plugin-invoke.ts src/plugins/types.ts src/stores/system/plugin.ts src/plugins/plugin-lifecycle.ts src/plugins/__tests__/plugin-store.test.ts
git commit -m "feat(§69): load dev plugins at startup + store dev-plugin state"
```

---

### Task 5: Frontend — Developer section UI in the marketplace

**Files:**
- Create: `src/components/plugins/PluginDeveloperSection.tsx`
- Modify: `src/components/plugins/PluginMarketplace.tsx` (render the section)
- Test: `src/components/plugins/__tests__/PluginDeveloperSection.test.tsx` (create)

**Interfaces:**
- Consumes: `pluginAddDevFolder`, `pluginRemoveDevFolder` (Task 4), `pluginLoader.loadPlugin/reloadPlugin/unloadPlugin` (Task 3), `usePluginStore` dev actions (Task 4), `useUIStore().showToast` (`stores/ui/ui.ts:171`), `open` from `@tauri-apps/plugin-dialog`.
- Produces: `<PluginDeveloperSection />` React component.

- [ ] **Step 1: Write the failing component test**

Create `src/components/plugins/__tests__/PluginDeveloperSection.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const open = vi.fn(async () => "/dev/dev-x");
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (...a: unknown[]) => open(...a) }));

const addDevFolder = vi.fn(async () => ({
  install_path: "/dev/dev-x", checksum: "", is_dev: true,
  manifest: {
    id: "dev-x", name: "Dev X", description: "", version: "1.0.0", author: "",
    license: "MIT", main: "index.mjs", engines: { baram: ">=0.2.0" }, capabilities: [],
  },
}));
vi.mock("../../../ipc/plugin-invoke", () => ({
  pluginAddDevFolder: (...a: unknown[]) => addDevFolder(...a),
  pluginRemoveDevFolder: vi.fn(async () => {}),
}));
vi.mock("../../../plugins/plugin-loader", () => ({
  pluginLoader: { loadPlugin: vi.fn(async () => {}), reloadPlugin: vi.fn(async () => {}), unloadPlugin: vi.fn(async () => {}) },
}));

import { PluginDeveloperSection } from "../PluginDeveloperSection";

describe("PluginDeveloperSection", () => {
  it("loads a dev plugin folder via the dialog", async () => {
    render(<PluginDeveloperSection />);
    fireEvent.click(screen.getByRole("button", { name: /load dev plugin folder/i }));
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith({ directory: true }));
    await vi.waitFor(() => expect(addDevFolder).toHaveBeenCalledWith("/dev/dev-x"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- PluginDeveloperSection 2>&1 | tail -20`
Expected: FAIL — module `../PluginDeveloperSection` not found.

- [ ] **Step 3: Implement `PluginDeveloperSection.tsx`**

```tsx
// §69 Plugin Developer section — load/reload local plugin folders during development
import { open } from "@tauri-apps/plugin-dialog";
import { useShallow } from "zustand/shallow";

import { pluginAddDevFolder, pluginRemoveDevFolder } from "../../ipc/plugin-invoke";
import { pluginLoader } from "../../plugins/plugin-loader";
import type { InstalledPlugin } from "../../plugins/types";
import { usePluginStore } from "../../stores/system/plugin";
import { useUIStore } from "../../stores/ui/ui";

function toInstalled(r: {
  install_path: string; checksum: string; manifest: InstalledPlugin["manifest"];
}): InstalledPlugin {
  return {
    checksum: r.checksum, enabled: true, installedAt: 0,
    installPath: r.install_path, isDev: true, manifest: r.manifest, updatedAt: 0,
  };
}

export function PluginDeveloperSection() {
  const { devPlugins, addDevPlugin, removeDevPlugin } = usePluginStore(
    useShallow((s) => ({
      devPlugins: s.devPlugins,
      addDevPlugin: s.addDevPlugin,
      removeDevPlugin: s.removeDevPlugin,
    })),
  );
  const showToast = useUIStore((s) => s.showToast);
  const list = Object.values(devPlugins);

  async function handleLoad() {
    const picked = await open({ directory: true });
    if (typeof picked !== "string") return;
    try {
      const info = await pluginAddDevFolder(picked);
      const plugin = toInstalled(info);
      addDevPlugin(plugin);
      await pluginLoader.loadPlugin(plugin.installPath, plugin.manifest);
      showToast(`Loaded dev plugin: ${plugin.manifest.name}`);
    } catch (err) {
      showToast(`Failed to load dev plugin: ${String(err)}`);
    }
  }

  async function handleReload(plugin: InstalledPlugin) {
    try {
      const info = await pluginAddDevFolder(plugin.installPath); // re-read manifest
      const fresh = toInstalled(info);
      addDevPlugin(fresh);
      await pluginLoader.reloadPlugin(fresh.installPath, fresh.manifest);
      if (fresh.manifest.tiptapExtensions?.length) {
        showToast(`Reloaded ${fresh.manifest.name} — restart required for Tiptap extensions`);
      } else {
        showToast(`Reloaded dev plugin: ${fresh.manifest.name}`);
      }
    } catch (err) {
      showToast(`Reload failed: ${String(err)}`);
    }
  }

  async function handleRemove(plugin: InstalledPlugin) {
    try {
      await pluginRemoveDevFolder(plugin.installPath);
      await pluginLoader.unloadPlugin(plugin.manifest.id);
      removeDevPlugin(plugin.manifest.id);
      showToast(`Removed dev plugin: ${plugin.manifest.name}`);
    } catch (err) {
      showToast(`Remove failed: ${String(err)}`);
    }
  }

  return (
    <section className="plugin-dev-section">
      <div className="flex-header">
        <h3>Developer</h3>
        <button type="button" className="icon-btn" onClick={handleLoad}>
          Load dev plugin folder…
        </button>
      </div>
      {list.length === 0 ? (
        <p className="text-muted">No dev plugins loaded. Point at a folder with baram-plugin.json.</p>
      ) : (
        <ul className="plugin-dev-list">
          {list.map((p) => (
            <li key={p.manifest.id} className="plugin-dev-item">
              <span className="text-truncate">{p.manifest.name}</span>
              <code className="text-truncate">{p.installPath}</code>
              <button type="button" className="icon-btn" onClick={() => handleReload(p)}>Reload</button>
              <button type="button" className="icon-btn" onClick={() => handleRemove(p)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- PluginDeveloperSection 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Render the section in `PluginMarketplace.tsx`**

Import at the top: `import { PluginDeveloperSection } from "./PluginDeveloperSection";` and render `<PluginDeveloperSection />` at the end of the marketplace body (after the installed/registry lists, before the closing container). Verify placement with:

Run: `grep -n "PluginDeveloperSection\|return (" src/components/plugins/PluginMarketplace.tsx | head`
Expected: import + one render site.

- [ ] **Step 6: Full suite + typecheck**

Run: `npm test -- plugin 2>&1 | tail -20 && npx tsc --noEmit 2>&1 | tail -5`
Expected: PASS, no type errors.

- [ ] **Step 7: Manual GUI verification (the whole loop)**

Run: `npm run tauri dev`. Open Plugins → Developer → "Load dev plugin folder…", pick `examples/plugins/word-count` (created in Phase E; until then use any folder with a valid `baram-plugin.json` + `index.mjs`). Edit the plugin's `index.mjs`, click **Reload**. Expected: toast confirms load/reload; a `console`-capability plugin re-runs `activate` (observable in devtools).

- [ ] **Step 8: Commit**

```bash
git add src/components/plugins/PluginDeveloperSection.tsx src/components/plugins/PluginMarketplace.tsx src/components/plugins/__tests__/PluginDeveloperSection.test.tsx
git commit -m "feat(§69): plugin Developer section — load/reload/remove local folders"
```

---

## Self-Review

**Spec coverage (Phase A rows of spec §11):**
- Auto-cleanup subscriptions → already present in `plugin-loader.ts` (`unloadPlugin` disposes `context.subscriptions`); `reloadPlugin` (Task 3) relies on it. New APIs in Phases B–D must keep pushing to `subscriptions` — noted for those plans.
- Rust `plugin_add_dev_folder` + asset scope → Task 2 (+ install-dir scope fix Task 1).
- Loader `reloadPlugin` → Task 3.
- Developer UI → Task 5.
- Store/lifecycle wiring → Task 4.

**Placeholder scan:** No TBD/TODO/"add error handling" — every code step is complete. The only forward reference is `examples/plugins/word-count` in Task 5 Step 7 (Phase E deliverable), with an explicit fallback ("any folder with a valid baram-plugin.json").

**Type consistency:** `InstalledPluginInfo.is_dev` (Rust) ↔ `RustInstalledPluginInfo.is_dev` (TS) ↔ `InstalledPlugin.isDev` (TS). `reloadPlugin(installPath, manifest)` signature identical in Task 3 (def) and Tasks 4–5 (use). `normalize_dev_list`/`read_manifest_at` names consistent across Task 2. `setDevPlugins`/`addDevPlugin`/`removeDevPlugin`/`devPlugins` consistent across Tasks 4–5.

**Out of scope (later phases):** ui/sidebar/settings/ai/network/storage APIs (B–D), types/templates/examples (E), registry (F). Phase A delivers a working, testable dev loop on its own.
