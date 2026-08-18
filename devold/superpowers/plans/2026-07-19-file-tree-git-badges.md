# File Tree Git Status Badges (PR5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render git status dots on file tree rows — M (modified, yellow) / U (untracked/added, green) on files, a neutral dot on folders containing changes (spec §4.5, PR5, the final PR of the file-tree-enhancements series).

**Architecture:** A new Rust `repo_root` field on `GitStatusInfo` gives the absolute repo workdir so absolute tree paths can be matched to repo-relative git change paths. A pure builder reduces the git store's `changes` array into a `{ files: Map, dirs: Set }` badge index (with folder rollup). A `useGitBadges` hook drives a debounced (≥1s) refresh off the Tauri `file:*` watcher events and returns the index, which flows through `FileTreeContext` to each `FileTreeNode` as a small colored dot.

**Tech Stack:** Rust (git2, serde), React 19 + TypeScript (strict, verbatimModuleSyntax), Zustand, Tauri events. Tests: Vitest (TS), cargo test (Rust).

## Global Constraints

- **Path matching is the central correctness concern.** `FileEntry.path` (tree nodes) is ABSOLUTE; git `change.path` is REPO-workdir-RELATIVE, and the repo root may be an ANCESTOR of the vault `rootPath` (git discovers upward). Match by reconstructing each change's absolute path = `repoRoot + "/" + change.path`, then compare to the node's absolute path. `repoRoot` comes from the new Rust `repo_root` field (libgit2 `repo.workdir()`), normalized to strip any trailing slash.
- **`changes` is an array with possible duplicate paths** (a file can appear as both a staged row and a workdir row). The badge builder must reduce to at most one badge per path.
- **Status → badge color mapping:** `modified`/`renamed` → **modified (yellow, `--color-git-modified`)**; `added`/`untracked` → **added (green, `--color-git-added`)**; `deleted` → NO file badge (file isn't in the tree) but DOES contribute to folder rollup. On a per-path collision, `modified` wins over `added`.
- **Folder rollup:** a folder shows a neutral dot (`--color-text-muted`) when ANY change (including deleted) falls strictly under it AND under the vault `rootPath`. Changes outside `rootPath` are ignored (not in the tree).
- **Zero render cost when not a git repo:** the badge index is empty when `!isRepo` (git store `changes` is `[]`), so `FileTreeNode` renders no dot.
- **Colors: existing `--color-*` tokens only** — `--color-git-modified`, `--color-git-added`, `--color-text-muted`. No new tokens, no hardcoded colors.
- **Refresh debounce ≥ 1s** on Tauri `file:created`/`file:deleted`/`file:changed` events (no reusable debounce util exists — use an inline `setTimeout`/`clearTimeout` ref, matching `use-file-watcher.ts`). Follow that file's async-IIFE + `unlistenFns` + cleanup-race pattern for the `listen()` subscription.
- **Zustand:** components/hooks use `useShallow` for multi-field selectors, never a bare `useStore()` call.
- **verbatimModuleSyntax:** type-only imports use `import type`.
- `npm test` = vitest (never jest). `cargo test` for Rust. `npm run typecheck` checks app + node + test.
- Commits: Conventional Commits, `feat(§4.5):` prefix, lowercase after the colon (repo commitlint rejects capitalized subjects).

---

## File Structure

**New files:**
- `src/stores/system/git-badges.ts` — pure badge-index builder (`GitBadgeStatus`, `GitBadgeIndex`, `buildGitBadgeIndex`, `EMPTY_GIT_BADGE_INDEX`).
- `src/stores/system/__tests__/git-badges.test.ts` — builder tests.
- `src/components/sidebar/hooks/use-git-badges.ts` — refresh hook + memoized index.
- `src/components/sidebar/hooks/__tests__/use-git-badges.test.ts` — hook test (index derivation; refresh wiring best-effort).

**Modified files:**
- `src-tauri/src/git/types.rs` — `GitStatusInfo.repo_root: Option<String>`.
- `src-tauri/src/git/basic.rs` — populate `repo_root` from `repo.workdir()` (and the not-a-repo early return).
- `src/ipc/types.ts` — `GitStatusInfo.repo_root: string | null`.
- `src/stores/system/git.ts` — `repoRoot: string | null` state + set it in `refresh`.
- `src/components/sidebar/FileTreeContext.tsx` — add `gitBadges: GitBadgeIndex` to the context value.
- `src/components/sidebar/FileTree.tsx` — call `useGitBadges(rootPath)`, provide `gitBadges` in the context value.
- `src/components/sidebar/FileTreeNode.tsx` — render the badge dot on file + dir rows.
- `src/styles/file-tree.css` — `.file-tree-git-badge*` classes.
- `src/stores/__tests__/git-store.test.ts` (or a new store test) — `refresh` sets `repoRoot` (only if easily testable with the existing mock; otherwise cover via the builder + hook tests).

---

## Task 1: Rust `repo_root` + TS type + store state

**Files:**
- Modify: `src-tauri/src/git/types.rs` (`GitStatusInfo` struct)
- Modify: `src-tauri/src/git/basic.rs` (populate `repo_root` in both the success and not-a-repo paths)
- Modify: `src/ipc/types.ts` (`GitStatusInfo` TS type)
- Modify: `src/stores/system/git.ts` (`repoRoot` state + set in `refresh`)

**Interfaces:**
- Produces: Rust `GitStatusInfo.repo_root: Option<String>` (serialized as `repo_root`); TS `GitStatusInfo.repo_root: string | null`; git store state `repoRoot: string | null` (default `null`), set from `info.repo_root` in `refresh`.

- [ ] **Step 1: Write the failing Rust test**

Add a test module (or extend an existing one) in `src-tauri/src/git/basic.rs` that runs `git_status`-equivalent logic against a temp repo and asserts `repo_root` is populated. If the existing git module has no test harness for a real repo, add a minimal one using `git2::Repository::init` on a `tempfile::TempDir` (check `Cargo.toml` for `tempfile` in dev-deps; the fs module tests already use temp dirs — mirror that). Minimal test:

```rust
#[cfg(test)]
mod repo_root_tests {
    use super::*;

    #[test]
    fn status_reports_repo_root_for_a_repo() {
        let dir = tempfile::tempdir().unwrap();
        git2::Repository::init(dir.path()).unwrap();
        let info = status(dir.path().to_str().unwrap()).unwrap();
        assert!(info.is_repo);
        assert!(info.repo_root.is_some());
        // workdir path resolves to the temp dir (allow trailing slash / symlink canonicalization differences)
        let root = info.repo_root.unwrap();
        assert!(!root.is_empty());
    }

    #[test]
    fn status_reports_none_repo_root_outside_a_repo() {
        let dir = tempfile::tempdir().unwrap();
        let info = status(dir.path().to_str().unwrap()).unwrap();
        assert!(!info.is_repo);
        assert!(info.repo_root.is_none());
    }
}
```

> Implementer: read `basic.rs` first to learn the actual public fn name (the report referenced status logic at `basic.rs:12`). If it's not named `status`, adjust the test calls. If `tempfile` is not a dev-dependency, add it under `[dev-dependencies]` in `src-tauri/Cargo.toml` (the fs tests may already pull it — verify with `grep tempfile src-tauri/Cargo.toml`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test repo_root`
Expected: FAIL — `GitStatusInfo` has no field `repo_root`.

- [ ] **Step 3: Add `repo_root` to the struct + populate it**

In `src-tauri/src/git/types.rs`, add to `GitStatusInfo` (match the existing field style — no `rename_all` on this struct, fields serialize as-is like `is_repo`):

```rust
pub repo_root: Option<String>,
```

In `src-tauri/src/git/basic.rs`:
- In the not-a-repo early return (currently `{ branch:"", changes:[], is_repo:false }`), add `repo_root: None`.
- In the success path, after opening/discovering the repo, set `repo_root: repo.workdir().map(|p| p.to_string_lossy().to_string())`. (`workdir()` returns `Option<&Path>`; bare repos have no workdir → `None`.)

- [ ] **Step 4: Run Rust test + build**

Run: `cd src-tauri && cargo test repo_root`
Expected: PASS. Also `cargo build` succeeds (all `GitStatusInfo { ... }` constructors now include `repo_root` — fix any other construction sites the compiler flags).

- [ ] **Step 5: TS type + store state**

In `src/ipc/types.ts`, add to the `GitStatusInfo` interface:

```ts
  repo_root: string | null;
```

In `src/stores/system/git.ts`:
- Add `repoRoot: string | null;` to the `GitState` interface (near `isRepo`).
- Add `repoRoot: null,` to the initial state.
- In `refresh`, set it from the IPC result:

```ts
set({
  isRepo: info.is_repo,
  branch: info.branch,
  changes: info.changes,
  repoRoot: info.repo_root,
  loading: false,
});
```

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
cd src-tauri && cargo test git && cd ..
git add src-tauri/src/git/types.rs src-tauri/src/git/basic.rs src/ipc/types.ts src/stores/system/git.ts
git commit -m "feat(§4.5): expose git repo_root for file-tree badge path matching"
```

---

## Task 2: Pure badge-index builder

**Files:**
- Create: `src/stores/system/git-badges.ts`
- Test: `src/stores/system/__tests__/git-badges.test.ts`

**Interfaces:**
- Consumes: `GitChange` (type-only) from `../../ipc/types` (`{ path: string; status: string; staged: boolean }`); `dirname` from `../../utils/path-utils`.
- Produces:
  - `type GitBadgeStatus = "added" | "modified"`
  - `interface GitBadgeIndex { files: Map<string, GitBadgeStatus>; dirs: Set<string> }`
  - `const EMPTY_GIT_BADGE_INDEX: GitBadgeIndex`
  - `buildGitBadgeIndex(changes: GitChange[], repoRoot: string | null, rootPath: string | null): GitBadgeIndex`

- [ ] **Step 1: Write the failing test**

```ts
// src/stores/system/__tests__/git-badges.test.ts
import { describe, expect, it } from "vitest";
import type { GitChange } from "../../../ipc/types";
import {
  EMPTY_GIT_BADGE_INDEX,
  buildGitBadgeIndex,
} from "../git-badges";

const ch = (path: string, status: string): GitChange => ({
  path,
  status,
  staged: false,
});

const ROOT = "/repo";

describe("buildGitBadgeIndex", () => {
  it("returns an empty index when repoRoot is null", () => {
    const idx = buildGitBadgeIndex([ch("a.md", "modified")], null, ROOT);
    expect(idx.files.size).toBe(0);
    expect(idx.dirs.size).toBe(0);
  });

  it("maps modified/renamed to 'modified' and added/untracked to 'added'", () => {
    const idx = buildGitBadgeIndex(
      [
        ch("m.md", "modified"),
        ch("r.md", "renamed"),
        ch("a.md", "added"),
        ch("u.md", "untracked"),
      ],
      ROOT,
      ROOT,
    );
    expect(idx.files.get("/repo/m.md")).toBe("modified");
    expect(idx.files.get("/repo/r.md")).toBe("modified");
    expect(idx.files.get("/repo/a.md")).toBe("added");
    expect(idx.files.get("/repo/u.md")).toBe("added");
  });

  it("does not create a file badge for deleted, but rolls it up to folders", () => {
    const idx = buildGitBadgeIndex([ch("sub/gone.md", "deleted")], ROOT, ROOT);
    expect(idx.files.has("/repo/sub/gone.md")).toBe(false);
    expect(idx.dirs.has("/repo/sub")).toBe(true);
  });

  it("rolls changes up to every ancestor folder under rootPath", () => {
    const idx = buildGitBadgeIndex([ch("a/b/c.md", "modified")], ROOT, ROOT);
    expect(idx.files.get("/repo/a/b/c.md")).toBe("modified");
    expect(idx.dirs.has("/repo/a")).toBe(true);
    expect(idx.dirs.has("/repo/a/b")).toBe(true);
    expect(idx.dirs.has("/repo")).toBe(false); // rootPath itself is not a badge target
  });

  it("resolves repo-relative paths against repoRoot when the vault is a subdir", () => {
    // repo at /repo, vault (rootPath) at /repo/vault; change path is repo-relative
    const idx = buildGitBadgeIndex(
      [ch("vault/note.md", "modified"), ch("other/x.md", "modified")],
      "/repo",
      "/repo/vault",
    );
    expect(idx.files.get("/repo/vault/note.md")).toBe("modified");
    // a change outside the vault is ignored (not in the tree)
    expect(idx.files.has("/repo/other/x.md")).toBe(false);
    expect(idx.dirs.has("/repo/vault")).toBe(false); // rootPath itself excluded
  });

  it("modified wins over added on a per-path collision (staged + workdir rows)", () => {
    const idx = buildGitBadgeIndex(
      [ch("f.md", "added"), ch("f.md", "modified")],
      ROOT,
      ROOT,
    );
    expect(idx.files.get("/repo/f.md")).toBe("modified");
  });

  it("normalizes a trailing slash on repoRoot (libgit2 workdir)", () => {
    const idx = buildGitBadgeIndex([ch("a.md", "modified")], "/repo/", ROOT);
    expect(idx.files.get("/repo/a.md")).toBe("modified");
  });

  it("EMPTY_GIT_BADGE_INDEX is empty", () => {
    expect(EMPTY_GIT_BADGE_INDEX.files.size).toBe(0);
    expect(EMPTY_GIT_BADGE_INDEX.dirs.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- git-badges`
Expected: FAIL — cannot resolve `../git-badges`.

- [ ] **Step 3: Implement the builder**

```ts
// src/stores/system/git-badges.ts
import type { GitChange } from "../../ipc/types";
import { dirname } from "../../utils/path-utils";

export type GitBadgeStatus = "added" | "modified";

export interface GitBadgeIndex {
  files: Map<string, GitBadgeStatus>;
  dirs: Set<string>;
}

export const EMPTY_GIT_BADGE_INDEX: GitBadgeIndex = {
  files: new Map(),
  dirs: new Set(),
};

function badgeFor(status: string): GitBadgeStatus | null {
  switch (status) {
    case "modified":
    case "renamed":
      return "modified";
    case "added":
    case "untracked":
      return "added";
    default:
      return null; // deleted (and anything unknown) → no file badge
  }
}

/**
 * Reduce the git store's `changes` (repo-relative, possibly duplicated) into a
 * badge index keyed by ABSOLUTE path. Changes outside the vault `rootPath` are
 * ignored. Folders roll up any change (including deletions) under them.
 */
export function buildGitBadgeIndex(
  changes: GitChange[],
  repoRoot: string | null,
  rootPath: string | null,
): GitBadgeIndex {
  if (!repoRoot || !rootPath) return { files: new Map(), dirs: new Set() };

  const root = repoRoot.replace(/\/+$/, "");
  const files = new Map<string, GitBadgeStatus>();
  const dirs = new Set<string>();
  const underRoot = rootPath + "/";

  for (const change of changes) {
    const abs = `${root}/${change.path}`;
    if (!abs.startsWith(underRoot)) continue; // outside the vault — not in tree

    const badge = badgeFor(change.status);
    if (badge) {
      // modified wins over added on collision
      const prev = files.get(abs);
      if (prev !== "modified") files.set(abs, badge);
    }

    // roll up to every ancestor dir strictly between the file and rootPath
    let dir = dirname(abs);
    while (dir.length > rootPath.length && dir.startsWith(underRoot)) {
      dirs.add(dir);
      dir = dirname(dir);
    }
  }

  return { files, dirs };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- git-badges`
Expected: PASS (8 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/stores/system/git-badges.ts src/stores/system/__tests__/git-badges.test.ts
git commit -m "feat(§4.5): pure git badge index builder with folder rollup"
```

---

## Task 3: `useGitBadges` refresh hook

**Files:**
- Create: `src/components/sidebar/hooks/use-git-badges.ts`
- Test: `src/components/sidebar/hooks/__tests__/use-git-badges.test.ts`

**Interfaces:**
- Consumes: `useGitStore` from `../../../stores/system/git`; `buildGitBadgeIndex`, `EMPTY_GIT_BADGE_INDEX`, type `GitBadgeIndex` from `../../../stores/system/git-badges`; `listen` + type `UnlistenFn` from `@tauri-apps/api/event`; `useShallow`.
- Produces: `useGitBadges(rootPath: string | null): GitBadgeIndex`.

- [ ] **Step 1: Write the failing test**

The refresh/`listen` wiring is hard to unit-test cleanly; the essential testable behavior is that the hook derives the index from git store state. Mock `@tauri-apps/api/event`'s `listen` to a no-op and drive the git store directly.

```ts
// src/components/sidebar/hooks/__tests__/use-git-badges.test.ts
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import { useGitStore } from "../../../../stores/system/git";
import { useGitBadges } from "../use-git-badges";

beforeEach(() => {
  useGitStore.setState({
    isRepo: true,
    repoRoot: "/repo",
    changes: [{ path: "a.md", status: "modified", staged: false }],
  });
});

describe("useGitBadges", () => {
  it("derives a badge index from git store changes", () => {
    const { result } = renderHook(() => useGitBadges("/repo"));
    expect(result.current.files.get("/repo/a.md")).toBe("modified");
  });

  it("returns an empty index when not a git repo", () => {
    useGitStore.setState({ isRepo: false, repoRoot: null, changes: [] });
    const { result } = renderHook(() => useGitBadges("/repo"));
    expect(result.current.files.size).toBe(0);
    expect(result.current.dirs.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- use-git-badges`
Expected: FAIL — cannot resolve `../use-git-badges`.

- [ ] **Step 3: Implement the hook**

Follow `src/hooks/use-file-watcher.ts` for the `listen` subscription pattern (async IIFE, `unlistenFns`, `cleanedUp` race guard). Debounce ≥ 1s via an inline `setTimeout`/`clearTimeout` ref.

```ts
// src/components/sidebar/hooks/use-git-badges.ts
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/shallow";
import { useGitStore } from "../../../stores/system/git";
import {
  EMPTY_GIT_BADGE_INDEX,
  buildGitBadgeIndex,
  type GitBadgeIndex,
} from "../../../stores/system/git-badges";

const REFRESH_DEBOUNCE_MS = 1000;

export function useGitBadges(rootPath: string | null): GitBadgeIndex {
  const { changes, isRepo, repoRoot } = useGitStore(
    useShallow((s) => ({
      changes: s.changes,
      isRepo: s.isRepo,
      repoRoot: s.repoRoot,
    })),
  );

  // Initial + rootPath-change refresh.
  useEffect(() => {
    if (!rootPath) return;
    void useGitStore.getState().refresh(rootPath);
  }, [rootPath]);

  // Debounced refresh on file-watcher events.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!rootPath) return;
    const unlistenFns: UnlistenFn[] = [];
    let cleanedUp = false;

    const schedule = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void useGitStore.getState().refresh(rootPath);
      }, REFRESH_DEBOUNCE_MS);
    };

    void (async () => {
      const fns = await Promise.all([
        listen("file:created", schedule),
        listen("file:deleted", schedule),
        listen("file:changed", schedule),
      ]);
      if (cleanedUp) {
        for (const fn of fns) fn();
        return;
      }
      unlistenFns.push(...fns);
    })();

    return () => {
      cleanedUp = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      for (const fn of unlistenFns) fn();
    };
  }, [rootPath]);

  return useMemo(
    () =>
      isRepo ? buildGitBadgeIndex(changes, repoRoot, rootPath) : EMPTY_GIT_BADGE_INDEX,
    [isRepo, changes, repoRoot, rootPath],
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- use-git-badges`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/components/sidebar/hooks/use-git-badges.ts src/components/sidebar/hooks/__tests__/use-git-badges.test.ts
git commit -m "feat(§4.5): useGitBadges hook — debounced refresh + derived index"
```

---

## Task 4: Render badges — context, node, wiring, CSS

**Files:**
- Modify: `src/components/sidebar/FileTreeContext.tsx` (add `gitBadges`)
- Modify: `src/components/sidebar/FileTree.tsx` (call `useGitBadges`, provide it)
- Modify: `src/components/sidebar/FileTreeNode.tsx` (render the dot)
- Modify: `src/styles/file-tree.css` (badge classes)
- Test: `src/components/sidebar/__tests__/file-tree-git-badge.test.tsx` (new)

**Interfaces:**
- Consumes: `GitBadgeIndex` + `EMPTY_GIT_BADGE_INDEX` from `../../stores/system/git-badges`; `useGitBadges` from `./hooks/use-git-badges`; the existing `useFileTreeContext()`.
- Produces: `FileTreeContextValue.gitBadges: GitBadgeIndex`; a `.file-tree-git-badge` dot on file/dir rows.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/sidebar/__tests__/file-tree-git-badge.test.tsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FileTreeContext } from "../FileTreeContext";
import { FileTreeNode } from "../FileTreeNode";
import { EMPTY_GIT_BADGE_INDEX } from "../../../stores/system/git-badges";

const noop = () => {};
const baseCtx = {
  creatingEntry: null,
  dragOverPath: null,
  dragSourcePaths: [],
  expandedDirs: new Set<string>(),
  focusedPath: null,
  renamingPath: null,
  selectedPaths: new Set<string>(),
  gitBadges: EMPTY_GIT_BADGE_INDEX,
};

const handlers = {
  onDirClick: noop,
  onFileClick: noop,
  onContextMenu: noop,
  onStartRename: noop,
  onConfirmRename: noop,
  onCancelRename: noop,
  onConfirmCreate: noop,
  onCancelCreate: noop,
};

function renderNode(ctx: typeof baseCtx, path = "/r/a.md") {
  return render(
    <FileTreeContext.Provider value={ctx}>
      <FileTreeNode
        depth={0}
        entry={{ name: "a.md", path, isDir: false }}
        {...handlers}
      />
    </FileTreeContext.Provider>,
  );
}

describe("FileTreeNode git badge", () => {
  it("renders no badge when the path has no git change", () => {
    const { container } = renderNode(baseCtx);
    expect(container.querySelector(".file-tree-git-badge")).toBeNull();
  });

  it("renders a modified badge for a modified file", () => {
    const files = new Map([["/r/a.md", "modified" as const]]);
    const { container } = renderNode({
      ...baseCtx,
      gitBadges: { files, dirs: new Set() },
    });
    const dot = container.querySelector(".file-tree-git-badge");
    expect(dot).not.toBeNull();
    expect(dot!.classList.contains("file-tree-git-badge-modified")).toBe(true);
  });

  it("renders an added badge for an untracked/added file", () => {
    const files = new Map([["/r/a.md", "added" as const]]);
    const { container } = renderNode({
      ...baseCtx,
      gitBadges: { files, dirs: new Set() },
    });
    expect(
      container
        .querySelector(".file-tree-git-badge")
        ?.classList.contains("file-tree-git-badge-added"),
    ).toBe(true);
  });
});
```

> Implementer: verify the exact `FileTreeNode` prop names and the `FileTreeContext` import against the current source (the reconnaissance listed props `entry`, `depth`, and 8 handlers; and `FileTreeContext` exports the context object). Adjust the harness to match the real exports (e.g. if the context is consumed only via `useFileTreeContext` and the raw `FileTreeContext` isn't exported, export it or wrap via the provider component the file already uses).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- file-tree-git-badge`
Expected: FAIL — `gitBadges` not on the context type / no badge element rendered.

- [ ] **Step 3: Add `gitBadges` to the context**

In `src/components/sidebar/FileTreeContext.tsx`, add to `FileTreeContextValue`:

```ts
  gitBadges: GitBadgeIndex;
```

Import the type: `import type { GitBadgeIndex } from "../../stores/system/git-badges";`. If the file defines a default context value, default `gitBadges` to `EMPTY_GIT_BADGE_INDEX` (import it too).

- [ ] **Step 4: Wire the hook in FileTree**

In `src/components/sidebar/FileTree.tsx`:
- `import { useGitBadges } from "./hooks/use-git-badges";`
- Call it with the existing `rootPath` in scope: `const gitBadges = useGitBadges(rootPath);`
- Add `gitBadges` to the object passed as the `FileTreeContext` provider `value` (find where the provider value is assembled — it already includes `expandedDirs`, `selectedPaths`, `focusedPath`, etc.).

- [ ] **Step 5: Render the badge in FileTreeNode**

In `src/components/sidebar/FileTreeNode.tsx`:
- Pull `gitBadges` from `useFileTreeContext()`.
- **File row:** after the `.file-tree-name` span, add:

```tsx
{(() => {
  const badge = gitBadges.files.get(entry.path);
  return badge ? (
    <span
      aria-label={badge === "modified" ? "modified" : "added"}
      className={`file-tree-git-badge file-tree-git-badge-${badge}`}
    />
  ) : null;
})()}
```

- **Directory row:** after the dir name span, add a neutral dot when the folder has changes:

```tsx
{gitBadges.dirs.has(entry.path) && (
  <span
    aria-label="contains changes"
    className="file-tree-git-badge file-tree-git-badge-dir"
  />
)}
```

> Keep the badge OUTSIDE the `text-truncate` name span so truncation doesn't clip it. The row is a flex container; the badge sits at the end. If the name span currently consumes all width, ensure the badge stays visible (it's a fixed-size dot — a `margin-left:auto` on the badge pushes it to the right edge; see CSS below).

- [ ] **Step 6: Add CSS**

In `src/styles/file-tree.css`, mirror the existing `.status-git-dot` dot primitive (6×6, `border-radius:50%`), using the required tokens:

```css
.file-tree-git-badge {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  margin-left: auto;
  margin-right: 4px;
  border-radius: 50%;
}
.file-tree-git-badge-modified {
  background: var(--color-git-modified);
}
.file-tree-git-badge-added {
  background: var(--color-git-added);
}
.file-tree-git-badge-dir {
  background: var(--color-text-muted);
}
```

> Verify `--color-git-modified`, `--color-git-added`, `--color-text-muted` are defined (reconnaissance confirmed all three in `src/styles/generated/*.css`). Run `npm run audit:css-vars` after — it must introduce ZERO new undefined variables. `margin-left:auto` right-aligns the dot within the flex row; confirm the row (`.file-tree-item`) is `display:flex` (it renders icon + name inline) — if not, adjust so the badge sits at the right edge without overlapping the name.

- [ ] **Step 7: Run tests + full gates**

Run: `npm test -- file-tree-git-badge src/components/sidebar/__tests__/`
Run: `npm run typecheck && npm run audit:css-vars`
Expected: new badge tests pass; no sidebar regressions; typecheck 0; no new undefined CSS vars.

- [ ] **Step 8: Commit**

```bash
git add src/components/sidebar/FileTreeContext.tsx src/components/sidebar/FileTree.tsx src/components/sidebar/FileTreeNode.tsx src/styles/file-tree.css src/components/sidebar/__tests__/file-tree-git-badge.test.tsx
git commit -m "feat(§4.5): render git status dots on file tree rows"
```

---

## Final Verification (before PR)

- [ ] `npm run typecheck` — 0 errors.
- [ ] `npm test` — full suite green.
- [ ] `cd src-tauri && cargo test` — Rust green (new `repo_root` tests + existing).
- [ ] `npm run audit:css-vars` — no new undefined variables.
- [ ] Manual GUI checklist for the user:
  - In a git-repo vault: edit a tracked file → after ≤1s a yellow dot appears on its row; its parent folders get a neutral dot.
  - Create a new (untracked) file → green dot; parent folders get a neutral dot.
  - Commit/stage → dots update within ~1s (via the debounced refresh on file events, or the GitPanel refresh).
  - Open a NON-git folder → no dots anywhere, no console errors, tree behaves as before.
  - Subdirectory-vault case (open a vault that is a subfolder of a larger git repo) → dots still align to the correct files.
  - Regression: PR1–PR4 features (multi-select, context menu, keyboard nav, sort, collapse/expand, auto-reveal) all still work.

## Notes / backlog (do not implement in PR5)

- Badge refresh also piggybacks on the GitPanel's existing 5s poll when that panel is open; the `useGitBadges` hook adds an independent event-driven refresh so badges work without the panel.
- Deleted-file folder rollup uses the change's reconstructed path; a folder that now contains only a deleted file still shows the neutral dot (correct — it has a pending change).
- Staged-vs-unstaged distinction is intentionally collapsed (one dot per file); the GitPanel remains the place for staged/unstaged detail.
