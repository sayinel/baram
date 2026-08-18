# File Tree Conveniences (PR4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add sort options, collapse-all, and auto-reveal-on-tab-switch to the Baram file tree (spec §4.5, PR4 of the file-tree-enhancements series).

**Architecture:** Sorting is driven by a single pure comparator applied at every TS ordering site (`buildFileTree` + the two incremental `insertSorted` sites); the sort order is stored per-vault in `.baram/config.json` (§86 vault-config layer) and loaded into the file store on vault open. Collapse-all is a new store action that clears `expandedDirs`. Auto-reveal expands a file's ancestor directories on tab switch so the existing PR3 `scrollIntoView` effect can bring it into view.

**Tech Stack:** React 19 + TypeScript (strict, verbatimModuleSyntax), Zustand, Tauri 2.0, Rust (serde). Tests: Vitest (TS), cargo test (Rust).

## Global Constraints

- **`§4.5` spec deviation — reuse `modifiedAt`, do NOT add a new `mtime` field.** The spec text says "add `mtime: Option<u64>` to Rust `FileEntry`", but `FileEntry.modified_at: u64` already exists (`src-tauri/src/commands/fs_cmd.rs:5-14`), is populated in the read-dir loop (`src-tauri/src/fs/mod.rs:133-167`), and serializes as `modifiedAt` in `IpcFileEntry` (`src/ipc/types.ts:77-84`). It is only *dropped* by `buildFileTree`. PR4 threads the existing `modifiedAt` through the tree; **no Rust `FileEntry` change and no Rust sort change.**
- **Folder-first is always fixed** — dirs before files, regardless of sort order (dirs never interleave with files).
- **Sort order values (canonical):** `"name-asc" | "name-desc" | "mtime-asc" | "mtime-desc"`. Default `"name-asc"`.
- **Persistence = per-vault vault-config (§86), not global settings.** Key path: `VaultConfig.fileTree.sortOrder`. Load on vault open, save on change. When `rootPath` is null (no folder open) skip persistence and use the default.
- **Auto-reveal is a no-op while a filter is active** — if search query (`searchQuery.trim() !== ""`) or tag filter (`tagFilter !== null` / `filteredPaths !== null`) is active, do NOT expand ancestors or touch the filter; only the existing scroll attempt runs (and no-ops if the node isn't rendered). Spec §4.5: "필터를 건드리지 않고 스크롤만 시도".
- **Zustand selectors:** components use `useShallow((s) => ({...}))`, never a bare `useStore()` call.
- **verbatimModuleSyntax:** type-only imports must use `import type`.
- **Icons:** the sidebar uses local hand-rolled inline SVG components in `src/components/sidebar/file-tree-icons.tsx` (shared `S` constant, `stroke="currentColor"`, `strokeWidth:2`), NOT lucide-react. New icons follow that pattern.
- **CSS:** reuse existing `--color-*` tokens and the `.file-tree-action-btn` / `.file-tree-header` classes; no hard-coded colors.
- **`npm test` = vitest** (never `npx jest`). Rust: `cargo test`. `npm run typecheck` checks app + node + test projects.
- **Commits:** Conventional Commits with `feat(§4.5):` prefix.

---

## File Structure

**New files:**
- `src/stores/file/file-tree-sort.ts` — pure sort module (`SortOrder`, `compareEntries`, `sortTreeNodes`, `DEFAULT_SORT_ORDER`).
- `src/stores/file/__tests__/file-tree-sort.test.ts` — comparator + recursive resort tests.
- `src/components/sidebar/file-tree-reveal.ts` — pure `ancestorDirs(filePath, rootPath)` helper.
- `src/components/sidebar/__tests__/file-tree-reveal.test.ts` — ancestor-chain tests.
- `src/components/sidebar/FileTreeSortDropdown.tsx` — header sort dropdown (modeled on `ExportFormatDropdown`).
- `src/components/sidebar/__tests__/FileTreeSortDropdown.test.tsx` — dropdown render + change test.

**Modified files:**
- `src-tauri/src/context/vault_config.rs` — add `FileTreeSection { sort_order: Option<String> }` + `file_tree` field + roundtrip test.
- `src/ipc/types.ts` — add `fileTree?: { sortOrder?: string }` to the `VaultConfig` TS type.
- `src/stores/file/file.ts` — `FileEntry.modifiedAt?`, thread through `buildFileTree`, `fileTreeSortOrder` state + `setFileTreeSortOrder`, `collapseAllDirs`, load sort order in `_loadContextFileTree`, use `compareEntries` in both `insertSorted` sites.
- `src/stores/__tests__/` — new store test file for sort state + collapse-all.
- `src/components/sidebar/FileTree.tsx` — header dropdown + collapse-all button wiring, auto-reveal in the active-tab effect.
- `src/components/sidebar/file-tree-icons.tsx` — `IconSort`, `IconCollapseAll`.
- `src/components/sidebar/__tests__/file-tree-a11y.test.tsx` (or a new render test) — header controls present.
- `src/styles/file-tree.css` — dropdown styles (if not fully covered by `.file-tree-action-btn`).

---

## Task 1: Pure sort module

**Files:**
- Modify: `src/stores/file/file.ts` (add `modifiedAt?: number` to the tree `FileEntry` interface, `file.ts:20-25`)
- Create: `src/stores/file/file-tree-sort.ts`
- Test: `src/stores/file/__tests__/file-tree-sort.test.ts`

**Interfaces:**
- Consumes: `FileEntry` (type-only) from `./file` — `{ children?: FileEntry[]; isDir: boolean; name: string; path: string; modifiedAt?: number }`.
- Produces: `type SortOrder = "name-asc" | "name-desc" | "mtime-asc" | "mtime-desc"`, `const DEFAULT_SORT_ORDER: SortOrder`, `compareEntries(a, b, order): number`, `sortTreeNodes(nodes, order): FileEntry[]`.

> **Order dependency:** `compareEntries` reads `a.modifiedAt`, so the `modifiedAt?: number` field must be added to the `FileEntry` interface (`file.ts:20-25`) as the first change in this task — otherwise this task's own test and `compareEntries` fail typecheck. Add ONLY the type field here; threading `modifiedAt` through `buildFileTree` happens in Task 3.

- [ ] **Step 0: Add `modifiedAt?` to the tree FileEntry interface**

In `src/stores/file/file.ts:20-25`:

```ts
export interface FileEntry {
  children?: FileEntry[];
  isDir: boolean;
  modifiedAt?: number;
  name: string;
  path: string;
}
```

- [ ] **Step 1: Write the failing test**

```ts
// src/stores/file/__tests__/file-tree-sort.test.ts
import { describe, expect, it } from "vitest";
import type { FileEntry } from "../file";
import {
  DEFAULT_SORT_ORDER,
  compareEntries,
  sortTreeNodes,
} from "../file-tree-sort";

const f = (name: string, isDir: boolean, modifiedAt = 0): FileEntry => ({
  isDir,
  name,
  path: `/r/${name}`,
  modifiedAt,
});

describe("file-tree-sort", () => {
  it("defaults to name ascending", () => {
    expect(DEFAULT_SORT_ORDER).toBe("name-asc");
  });

  it("keeps folders before files regardless of order", () => {
    const dir = f("z-dir", true);
    const file = f("a-file", false);
    for (const order of [
      "name-asc",
      "name-desc",
      "mtime-asc",
      "mtime-desc",
    ] as const) {
      expect(compareEntries(dir, file, order)).toBeLessThan(0);
      expect(compareEntries(file, dir, order)).toBeGreaterThan(0);
    }
  });

  it("sorts by name ascending and descending", () => {
    const a = f("apple.md", false);
    const b = f("banana.md", false);
    expect(compareEntries(a, b, "name-asc")).toBeLessThan(0);
    expect(compareEntries(a, b, "name-desc")).toBeGreaterThan(0);
  });

  it("sorts by modifiedAt ascending (oldest first) and descending (newest first)", () => {
    const older = f("old.md", false, 100);
    const newer = f("new.md", false, 200);
    expect(compareEntries(older, newer, "mtime-asc")).toBeLessThan(0);
    expect(compareEntries(older, newer, "mtime-desc")).toBeGreaterThan(0);
  });

  it("falls back to name when modifiedAt is equal or missing", () => {
    const a = f("a.md", false, 100);
    const b = f("b.md", false, 100);
    expect(compareEntries(a, b, "mtime-desc")).toBeLessThan(0); // a before b by name tiebreak
    const x: FileEntry = { isDir: false, name: "x.md", path: "/r/x.md" };
    const y: FileEntry = { isDir: false, name: "y.md", path: "/r/y.md" };
    expect(compareEntries(x, y, "mtime-asc")).toBeLessThan(0);
  });

  it("recursively resorts a nested tree without mutating the input", () => {
    const input: FileEntry[] = [
      f("b.md", false),
      {
        isDir: true,
        name: "dir",
        path: "/r/dir",
        children: [f("d.md", false), f("c.md", false)],
      },
      f("a.md", false),
    ];
    const out = sortTreeNodes(input, "name-asc");
    expect(out.map((n) => n.name)).toEqual(["dir", "a.md", "b.md"]);
    expect(out[0].children?.map((n) => n.name)).toEqual(["c.md", "d.md"]);
    // input untouched
    expect(input.map((n) => n.name)).toEqual(["b.md", "dir", "a.md"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- file-tree-sort`
Expected: FAIL — cannot resolve `../file-tree-sort`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/stores/file/file-tree-sort.ts
import type { FileEntry } from "./file";

export type SortOrder = "name-asc" | "name-desc" | "mtime-asc" | "mtime-desc";

export const DEFAULT_SORT_ORDER: SortOrder = "name-asc";

/**
 * Folder-first is always fixed (§4.5). Within a group, order by the selected
 * key; equal/missing keys fall back to a stable name compare so ordering is
 * deterministic.
 */
export function compareEntries(
  a: FileEntry,
  b: FileEntry,
  order: SortOrder,
): number {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;

  let result: number;
  switch (order) {
    case "name-asc":
      result = a.name.localeCompare(b.name);
      break;
    case "name-desc":
      result = b.name.localeCompare(a.name);
      break;
    case "mtime-asc":
      result = (a.modifiedAt ?? 0) - (b.modifiedAt ?? 0);
      break;
    case "mtime-desc":
      result = (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0);
      break;
  }
  if (result === 0) result = a.name.localeCompare(b.name);
  return result;
}

/** Returns a new tree with every level sorted; does not mutate the input. */
export function sortTreeNodes(
  nodes: FileEntry[],
  order: SortOrder,
): FileEntry[] {
  return [...nodes]
    .sort((a, b) => compareEntries(a, b, order))
    .map((n) =>
      n.children
        ? { ...n, children: sortTreeNodes(n.children, order) }
        : n,
    );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- file-tree-sort`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/stores/file/file.ts src/stores/file/file-tree-sort.ts src/stores/file/__tests__/file-tree-sort.test.ts
git commit -m "feat(§4.5): pure file-tree sort comparator + recursive resort"
```

---

## Task 2: VaultConfig fileTree section (Rust + TS type)

**Files:**
- Modify: `src-tauri/src/context/vault_config.rs` (section struct + `file_tree` field + test)
- Modify: `src/ipc/types.ts` (VaultConfig TS type ~lines 379-404)

**Interfaces:**
- Consumes: existing `VaultConfig` struct (`src-tauri/src/context/vault_config.rs:117-142`) and TS `VaultConfig` type (`src/ipc/types.ts:379-404`).
- Produces: Rust `FileTreeSection { sort_order: Option<String> }` reachable as `config.file_tree`; TS `VaultConfig.fileTree?: { sortOrder?: string }`. Serde renames `sort_order` → `sortOrder` and `file_tree` → `fileTree`.

- [ ] **Step 1: Write the failing Rust test**

Add to the existing `mod tests` in `src-tauri/src/context/vault_config.rs` (roundtrip section, mirroring the existing section-survival tests):

```rust
#[test]
fn file_tree_section_roundtrips() {
    let json = r#"{ "fileTree": { "sortOrder": "mtime-desc" } }"#;
    let cfg: VaultConfig = serde_json::from_str(json).unwrap();
    assert_eq!(
        cfg.file_tree.as_ref().and_then(|f| f.sort_order.as_deref()),
        Some("mtime-desc")
    );
    // re-serialize and confirm the camelCase key survives
    let out = serde_json::to_string(&cfg).unwrap();
    assert!(out.contains("\"fileTree\""));
    assert!(out.contains("\"sortOrder\""));
}

#[test]
fn file_tree_section_defaults_to_none_when_absent() {
    let cfg: VaultConfig = serde_json::from_str("{}").unwrap();
    assert!(cfg.file_tree.is_none());
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test file_tree_section`
Expected: FAIL — `VaultConfig` has no field `file_tree`.

- [ ] **Step 3: Add the section struct and field**

Add the section struct next to the other section structs in `vault_config.rs` (match their derives exactly — the existing sections derive `Serialize, Deserialize, Debug, Default, Clone` and use `#[serde(rename_all = "camelCase")]` and `#[serde(skip_serializing_if = "Option::is_none")]`; copy that pattern):

```rust
#[derive(Serialize, Deserialize, Debug, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileTreeSection {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_order: Option<String>,
}
```

Add the field to `VaultConfig` (follow the exact attribute style of neighboring optional sections like `git`/`editor`):

```rust
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_tree: Option<FileTreeSection>,
```

> Note to implementer: read the actual `VaultConfig` struct and its existing section structs first and match their derive list, `serde` attributes, and default handling exactly — do not invent attributes not used by sibling sections.

- [ ] **Step 4: Run Rust test to verify it passes**

Run: `cd src-tauri && cargo test file_tree_section`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the TS type**

In `src/ipc/types.ts`, add to the `VaultConfig` interface (place near the other optional section fields, alphabetical-ish with existing sections):

```ts
  fileTree?: {
    sortOrder?: string;
  };
```

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
cd src-tauri && cargo test file_tree_section && cd ..
git add src-tauri/src/context/vault_config.rs src/ipc/types.ts
git commit -m "feat(§4.5): VaultConfig fileTree.sortOrder section"
```

---

## Task 3: File store — modifiedAt threading, sort state, collapse-all

**Files:**
- Modify: `src/stores/file/file.ts`
- Test: `src/stores/__tests__/file-store-sort.test.ts` (new)

**Interfaces:**
- Consumes: `compareEntries`, `sortTreeNodes`, `DEFAULT_SORT_ORDER`, `type SortOrder` from `./file-tree-sort` (Task 1); `getVaultConfigByPath` / `setVaultConfigByPath` from `../../ipc/context` (verify exact names/signatures in that file before use — the explore reported both exist).
- Produces (new store surface):
  - `FileEntry.modifiedAt?: number` (tree node type at `file.ts:20-25`).
  - State `fileTreeSortOrder: SortOrder`.
  - `setFileTreeSortOrder(order: SortOrder): void` — sets state, resorts `fileTree` via `sortTreeNodes`, persists to vault config (fire-and-forget; skip when `rootPath` null).
  - `collapseAllDirs(): void` — `set({ expandedDirs: new Set() })`.
  - `buildFileTree(entries, order)` now takes a `SortOrder` param and keeps `modifiedAt` on nodes.

- [ ] **Step 1: Write the failing test**

```ts
// src/stores/__tests__/file-store-sort.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { useFileStore } from "../file/file";

const flat = [
  { isDir: true, name: "b-dir", path: "/r/b-dir", modifiedAt: 10, size: 0 },
  { isDir: true, name: "a-dir", path: "/r/a-dir", modifiedAt: 20, size: 0 },
  { isDir: false, name: "old.md", path: "/r/old.md", modifiedAt: 1, size: 0 },
  { isDir: false, name: "new.md", path: "/r/new.md", modifiedAt: 99, size: 0 },
];

beforeEach(() => {
  useFileStore.setState({
    rootPath: null, // skip vault-config persistence in unit test
    fileTree: [],
    expandedDirs: new Set(),
    fileTreeSortOrder: "name-asc",
  });
});

describe("file store — sort order", () => {
  it("collapseAllDirs clears expandedDirs", () => {
    useFileStore.setState({ expandedDirs: new Set(["/r/a", "/r/b"]) });
    useFileStore.getState().collapseAllDirs();
    expect(useFileStore.getState().expandedDirs.size).toBe(0);
  });

  it("setFileTreeSortOrder resorts the existing tree (dirs stay first)", () => {
    // seed a tree ordered name-asc
    useFileStore.setState({
      fileTree: [
        { isDir: true, name: "a-dir", path: "/r/a-dir", modifiedAt: 20 },
        { isDir: true, name: "b-dir", path: "/r/b-dir", modifiedAt: 10 },
        { isDir: false, name: "new.md", path: "/r/new.md", modifiedAt: 99 },
        { isDir: false, name: "old.md", path: "/r/old.md", modifiedAt: 1 },
      ],
    });
    useFileStore.getState().setFileTreeSortOrder("mtime-desc");
    const names = useFileStore.getState().fileTree.map((n) => n.name);
    // dirs first (newest dir first: a-dir=20 > b-dir=10), then files newest first
    expect(names).toEqual(["a-dir", "b-dir", "new.md", "old.md"]);
    expect(useFileStore.getState().fileTreeSortOrder).toBe("mtime-desc");
  });
});
```

> Note: if `buildFileTree` is not exported, this test drives the public store surface (`setFileTreeSortOrder`, `collapseAllDirs`) instead of `buildFileTree` directly. Add a focused `buildFileTree` unit test only if the implementer exports it; otherwise the store-level test above is sufficient.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- file-store-sort`
Expected: FAIL — `collapseAllDirs` / `setFileTreeSortOrder` / `fileTreeSortOrder` do not exist.

- [ ] **Step 3: Implement the store changes**

3a. (`FileEntry.modifiedAt?` was already added to `file.ts:20-25` in Task 1 — do not re-add.)

3b. Import the sort module at the top of `file.ts`:

```ts
import {
  DEFAULT_SORT_ORDER,
  compareEntries,
  sortTreeNodes,
  type SortOrder,
} from "./file-tree-sort";
```

3c. `buildFileTree` (`file.ts:134-172`): add an `order: SortOrder` parameter, keep `modifiedAt` when mapping IPC entries to tree nodes, and replace the inline comparator (lines 153-156) with `compareEntries(a, b, order)`. Apply the same comparator to every level (the function already groups by parent — sort each group with `compareEntries`). Preserve the existing grouping logic; only the mapping (keep `modifiedAt: e.modifiedAt`) and the sort callback change.

3d. Both incremental inserts — `addFileEntry`'s `insertSorted` (`file.ts:426-429`) and `moveFileEntry`'s `insertSorted` (`file.ts:540-543`) — replace their inline folder-first+name comparator with `compareEntries(a, b, get().fileTreeSortOrder)`.

3e. State + interface: add to the `FileState` interface and the store body:

```ts
  // interface
  fileTreeSortOrder: SortOrder;
  setFileTreeSortOrder: (order: SortOrder) => void;
  collapseAllDirs: () => void;
```

```ts
  // store body
  fileTreeSortOrder: DEFAULT_SORT_ORDER,
  collapseAllDirs: () => set({ expandedDirs: new Set() }),
  setFileTreeSortOrder: (order) => {
    set((state) => ({
      fileTreeSortOrder: order,
      fileTree: sortTreeNodes(state.fileTree, order),
    }));
    const { rootPath } = get();
    if (!rootPath) return;
    // persist to vault config (fire-and-forget; merge with existing config)
    void persistSortOrder(rootPath, order);
  },
```

3f. Add the persistence helper near the top of `file.ts` (module scope, not in the store). Verify `getVaultConfigByPath` / `setVaultConfigByPath` names + shapes in `src/ipc/context.ts` before wiring; the read-merge-write shape:

```ts
async function persistSortOrder(
  vaultPath: string,
  order: SortOrder,
): Promise<void> {
  try {
    const current = await getVaultConfigByPath(vaultPath);
    await setVaultConfigByPath(vaultPath, {
      ...current,
      fileTree: { ...current.fileTree, sortOrder: order },
    });
  } catch {
    // non-fatal: sort still applies in-session
  }
}
```

3g. In `_loadContextFileTree` (`file.ts:257-300`): before `buildFileTree`, load the persisted order and set it, then build with it:

```ts
let order = get().fileTreeSortOrder;
try {
  const cfg = await getVaultConfigByPath(path);
  const saved = cfg.fileTree?.sortOrder;
  if (
    saved === "name-asc" ||
    saved === "name-desc" ||
    saved === "mtime-asc" ||
    saved === "mtime-desc"
  ) {
    order = saved;
  }
} catch {
  // use current/default order
}
set({ fileTreeSortOrder: order });
const tree = buildFileTree(entries, order);
```

> The exact call site of `buildFileTree` inside `_loadContextFileTree` must be updated to pass `order`. Search for every `buildFileTree(` call in `file.ts` and pass the current order (`get().fileTreeSortOrder`) at each.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- file-store-sort`
Expected: PASS.

- [ ] **Step 5: Run the existing file-store suite (regression) + typecheck**

Run: `npm test -- src/stores/__tests__/ && npm run typecheck`
Expected: PASS (existing `file-store-mtime`, `file-move-openfiles`, `file-open-folder`, etc. still green).

- [ ] **Step 6: Commit**

```bash
git add src/stores/file/file.ts src/stores/__tests__/file-store-sort.test.ts
git commit -m "feat(§4.5): file store sort order state, resort, collapse-all, modifiedAt threading"
```

---

## Task 4: Auto-reveal ancestor helper + effect wiring

**Files:**
- Create: `src/components/sidebar/file-tree-reveal.ts`
- Test: `src/components/sidebar/__tests__/file-tree-reveal.test.ts`
- Modify: `src/components/sidebar/FileTree.tsx` (active-tab effect, `file-tree-reveal.ts:151-160` region)

**Interfaces:**
- Consumes: `dirname` from `../../utils/path-utils` (`path-utils.ts:24-29`); `expandDir` from `useFileStore`.
- Produces: `ancestorDirs(filePath: string, rootPath: string): string[]` — the chain of directory paths strictly between `rootPath` (exclusive of the file, inclusive up to but not including `rootPath` itself) that must be expanded to reveal `filePath`. Ordered root→leaf.

- [ ] **Step 1: Write the failing test**

```ts
// src/components/sidebar/__tests__/file-tree-reveal.test.ts
import { describe, expect, it } from "vitest";
import { ancestorDirs } from "../file-tree-reveal";

describe("ancestorDirs", () => {
  it("returns ancestor dirs between root and file, root-to-leaf", () => {
    expect(ancestorDirs("/vault/a/b/note.md", "/vault")).toEqual([
      "/vault/a",
      "/vault/a/b",
    ]);
  });

  it("returns empty when the file is a direct child of root", () => {
    expect(ancestorDirs("/vault/note.md", "/vault")).toEqual([]);
  });

  it("returns empty when the file is not under root", () => {
    expect(ancestorDirs("/other/x.md", "/vault")).toEqual([]);
  });

  it("does not include the root itself or the file itself", () => {
    const out = ancestorDirs("/vault/a/b/c/note.md", "/vault");
    expect(out).not.toContain("/vault");
    expect(out).not.toContain("/vault/a/b/c/note.md");
    expect(out).toEqual(["/vault/a", "/vault/a/b", "/vault/a/b/c"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- file-tree-reveal`
Expected: FAIL — cannot resolve `../file-tree-reveal`.

- [ ] **Step 3: Implement the helper**

```ts
// src/components/sidebar/file-tree-reveal.ts
import { dirname } from "../../utils/path-utils";

/**
 * Directory paths that must be expanded to reveal `filePath`, ordered
 * root→leaf. Excludes `rootPath` itself and the file itself. Returns [] when
 * the file is a direct child of root or is not under root.
 */
export function ancestorDirs(filePath: string, rootPath: string): string[] {
  if (!rootPath || !filePath.startsWith(rootPath + "/")) return [];
  const chain: string[] = [];
  let dir = dirname(filePath);
  while (dir && dir !== rootPath && dir.startsWith(rootPath + "/")) {
    chain.push(dir);
    dir = dirname(dir);
  }
  return chain.reverse();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- file-tree-reveal`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire auto-reveal into the active-tab effect**

In `FileTree.tsx`, the active-tab sync effect (`~lines 151-160`) currently does:

```tsx
useEffect(() => {
  if (activeFilePath) {
    shouldStealFocusRef.current = false;
    selectSingle(activeFilePath);
    setFocusedPath(activeFilePath);
  }
}, [activeFilePath, selectSingle, setFocusedPath]);
```

Add ancestor expansion BEFORE `setFocusedPath`, guarded by the filter-inactive condition so the scrollIntoView effect (deps `[focusedPath]`, runs post-commit) finds the now-rendered node. Pull `expandDir`, `rootPath`, and the filter state into the component's existing `useShallow` selectors (do not add a bare store call). The filter guard: skip when `searchQuery.trim() !== ""` or `tagFilter !== null` (both already available in `FileTree.tsx`).

```tsx
useEffect(() => {
  if (!activeFilePath) return;
  shouldStealFocusRef.current = false;
  const filterActive = searchQuery.trim() !== "" || tagFilter !== null;
  if (!filterActive && rootPath) {
    // auto-reveal: expand ancestor dirs so the row renders and can scroll in
    for (const dir of ancestorDirs(activeFilePath, rootPath)) {
      expandDir(dir);
    }
  }
  selectSingle(activeFilePath);
  setFocusedPath(activeFilePath);
}, [
  activeFilePath,
  searchQuery,
  tagFilter,
  rootPath,
  expandDir,
  selectSingle,
  setFocusedPath,
]);
```

> `expandDir` is a no-op when the dir is already expanded (`file.ts:583-589` early-returns), so repeated tab switches don't churn state. Confirm `searchQuery` and `tagFilter` are already in scope in this component (per the explore they are — `searchQuery` from `useFileTreeSearch`, `tagFilter` from the file store). Add `rootPath`/`expandDir` to the existing `useShallow` file-store selector if not already selected.

- [ ] **Step 6: Verify no regression in the a11y/nav tests + typecheck**

Run: `npm test -- src/components/sidebar/__tests__/ && npm run typecheck`
Expected: PASS (PR3 focus-steal + a11y tests still green; the tab-sync effect still sets `shouldStealFocusRef.current = false` first).

- [ ] **Step 7: Commit**

```bash
git add src/components/sidebar/file-tree-reveal.ts src/components/sidebar/__tests__/file-tree-reveal.test.ts src/components/sidebar/FileTree.tsx
git commit -m "feat(§4.5): auto-reveal active file — expand ancestors on tab switch"
```

---

## Task 5: Header UI — sort dropdown + collapse-all button

**Files:**
- Create: `src/components/sidebar/FileTreeSortDropdown.tsx`
- Test: `src/components/sidebar/__tests__/FileTreeSortDropdown.test.tsx`
- Modify: `src/components/sidebar/file-tree-icons.tsx` (add `IconSort`, `IconCollapseAll`)
- Modify: `src/components/sidebar/FileTree.tsx` (header JSX ~lines 482-513)
- Modify: `src/styles/file-tree.css` (dropdown menu styles)

**Interfaces:**
- Consumes: `SortOrder` type from `../../stores/file/file-tree-sort`; `fileTreeSortOrder`, `setFileTreeSortOrder`, `collapseAllDirs` from `useFileStore` (Task 3); the `.file-tree-action-btn` / `.file-tree-header` classes; the shared `S` icon constant.
- Produces: `<FileTreeSortDropdown value onChange />` header control; `<IconSort />`, `<IconCollapseAll />`.
- Pattern reference: `src/components/export/ExportFormatDropdown.tsx` (self-contained `useState(open)` + `useRef` + outside-click `mousedown` listener + `aria-haspopup="listbox"`).

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/sidebar/__tests__/FileTreeSortDropdown.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FileTreeSortDropdown } from "../FileTreeSortDropdown";

describe("FileTreeSortDropdown", () => {
  it("opens the menu and calls onChange with the picked order", () => {
    const onChange = vi.fn();
    render(<FileTreeSortDropdown onChange={onChange} value="name-asc" />);

    fireEvent.click(screen.getByRole("button", { name: /sort/i }));
    fireEvent.click(screen.getByText(/modified \(newest\)/i));

    expect(onChange).toHaveBeenCalledWith("mtime-desc");
  });

  it("marks the active order as selected", () => {
    render(<FileTreeSortDropdown onChange={vi.fn()} value="name-desc" />);
    fireEvent.click(screen.getByRole("button", { name: /sort/i }));
    const active = screen.getByRole("option", { selected: true });
    expect(active).toHaveTextContent(/name \(z–a\)/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- FileTreeSortDropdown`
Expected: FAIL — cannot resolve `../FileTreeSortDropdown`.

- [ ] **Step 3: Add the icons**

In `src/components/sidebar/file-tree-icons.tsx`, following the existing `S` constant + `<svg {...S}>` pattern (read the file first and copy the exact shape of `IconNewFile`), add:

```tsx
export function IconSort() {
  return (
    <svg {...S}>
      <path d="M11 5h10" />
      <path d="M11 9h7" />
      <path d="M11 13h4" />
      <path d="m3 17 3 3 3-3" />
      <path d="M6 4v16" />
    </svg>
  );
}

export function IconCollapseAll() {
  return (
    <svg {...S}>
      <path d="m7 15 5-5 5 5" />
      <path d="m7 9 5-5 5 5" />
    </svg>
  );
}
```

> Match whatever `S` spreads (viewBox, stroke, fill, sizes) — do not hard-code sizes that differ from `S`.

- [ ] **Step 4: Implement the dropdown**

```tsx
// src/components/sidebar/FileTreeSortDropdown.tsx
import { useEffect, useRef, useState } from "react";
import type { SortOrder } from "../../stores/file/file-tree-sort";
import { IconSort } from "./file-tree-icons";

const OPTIONS: { label: string; value: SortOrder }[] = [
  { label: "Name (A–Z)", value: "name-asc" },
  { label: "Name (Z–A)", value: "name-desc" },
  { label: "Modified (newest)", value: "mtime-desc" },
  { label: "Modified (oldest)", value: "mtime-asc" },
];

export function FileTreeSortDropdown({
  onChange,
  value,
}: {
  onChange: (order: SortOrder) => void;
  value: SortOrder;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="file-tree-sort" ref={ref}>
      <button
        aria-haspopup="listbox"
        className="file-tree-action-btn"
        onClick={() => setOpen((o) => !o)}
        title="Sort files"
        type="button"
      >
        <IconSort />
      </button>
      {open && (
        <ul className="file-tree-sort-menu" role="listbox">
          {OPTIONS.map((opt) => (
            <li
              aria-selected={opt.value === value}
              className={`file-tree-sort-option${
                opt.value === value ? " file-tree-sort-option-active" : ""
              }`}
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              role="option"
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

> Note the className template uses a leading space inside the backtick (` file-tree-sort-option-active`) — the same class-merge bug fixed in PR2. Keep the space in the backtick text.

- [ ] **Step 5: Run the dropdown test to verify it passes**

Run: `npm test -- FileTreeSortDropdown`
Expected: PASS (2 tests).

- [ ] **Step 6: Wire into the FileTree header + collapse-all button**

In `FileTree.tsx` header (`~lines 482-513`), pull `fileTreeSortOrder`, `setFileTreeSortOrder`, `collapseAllDirs` into the existing `useShallow` file-store selector, and add the two controls after the search input (before or after the New File/New Folder buttons — keep the existing buttons):

```tsx
<FileTreeSortDropdown
  onChange={setFileTreeSortOrder}
  value={fileTreeSortOrder}
/>
<button
  className="file-tree-action-btn"
  onClick={collapseAllDirs}
  title="Collapse all"
  type="button"
>
  <IconCollapseAll />
</button>
```

Import `FileTreeSortDropdown` and `IconCollapseAll` at the top of `FileTree.tsx`.

- [ ] **Step 7: Add dropdown menu CSS**

In `src/styles/file-tree.css`, add menu styles using existing tokens (position the menu absolutely under the button; reuse the popup surface tokens used by `.file-tree-context-menu`). Read `.file-tree-context-menu` styles and mirror the surface (`--color-bg-*`, `--shadow-md`, `border-radius`, `z-index`):

```css
.file-tree-sort {
  position: relative;
  display: inline-flex;
}
.file-tree-sort-menu {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 20;
  margin: 2px 0 0;
  padding: 4px;
  min-width: 160px;
  list-style: none;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  box-shadow: var(--shadow-md);
}
.file-tree-sort-option {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.8rem;
  cursor: pointer;
  white-space: nowrap;
}
.file-tree-sort-option:hover {
  background: var(--color-bg-hover);
}
.file-tree-sort-option-active {
  color: var(--color-accent-default);
}
```

> Verify the exact token names against `src/styles/file-tree.css` / `base.css` (e.g. `--color-bg-elevated` vs `--color-bg-default`, `--color-border-default`) — use whatever the context menu already uses; do not introduce undefined variables (run `npm run audit:css-vars` after).

- [ ] **Step 8: Verify header render + full gates**

Run: `npm test -- src/components/sidebar/__tests__/`
Run: `npm run typecheck && npm run audit:css-vars`
Expected: PASS; no undefined CSS variables.

- [ ] **Step 9: Commit**

```bash
git add src/components/sidebar/FileTreeSortDropdown.tsx src/components/sidebar/__tests__/FileTreeSortDropdown.test.tsx src/components/sidebar/file-tree-icons.tsx src/components/sidebar/FileTree.tsx src/styles/file-tree.css
git commit -m "feat(§4.5): file tree header — sort dropdown + collapse-all button"
```

---

## Final Verification (before PR)

- [ ] `npm run typecheck` — 0 errors (app + node + test projects).
- [ ] `npm test` — full suite green.
- [ ] `cd src-tauri && cargo test` — Rust green (new `file_tree_section` tests + existing).
- [ ] `npm run audit:css-vars` — no undefined variables.
- [ ] Manual GUI checklist for the user:
  - Sort dropdown: switch each of the 4 orders; folders always stay above files; mtime orders reflect actual modified times; order persists after closing/reopening the vault (per-vault).
  - Collapse-all: expand several folders, click collapse-all → all collapse.
  - Auto-reveal: with a deeply nested file, open it via Quick Switcher / wikilink → its ancestor folders expand and the row scrolls into view.
  - Auto-reveal + filter: with a search/tag filter active, opening a file does NOT change the filter.
  - Regression: PR3 keyboard nav, click/DnD, context menu, rename all still work; editing focus not stolen by tab switches.

## Notes / backlog (do not implement in PR4)

- i18n: header control labels/titles are literals (matches existing "New File"/"Filter files…" literals); i18n pass is a separate concern.
- `fileTreeSortOrder` is not applied to the flat search-results view or tag-filtered view ordering (those have their own ordering); out of scope.
- Rust `list_dir` flat sort is left as-is (display order is re-established by `buildFileTree`); no change needed.
