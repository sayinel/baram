# File Version History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add periodic auto-snapshot (so history accumulates) and a file-scoped Version History view (right-click a file → its versions → diff → single-file restore), reusing the existing §71 snapshot backend/store/UI.

**Architecture:** Snapshots are vault-wide captures created by the existing Rust `create_snapshot`. A new save-path "dirty gate" + an app-level interval hook create `"auto"` snapshots at the configured `snapshotInterval`. The already-built-but-dead per-file store path (`loadFileHistory`/`fileHistory`/`fileHistoryPath`/`clearFileHistory`) is activated by a file-tree context-menu action that opens the existing left Snapshots panel in a file-scoped mode. A pure helper collapses the per-file snapshot list to distinct content versions (by checksum); the existing `DiffView` renders version-vs-current.

**Tech Stack:** React 19 + TypeScript (strict, verbatimModuleSyntax), Zustand, Tauri IPC. Tests: Vitest. No Rust changes (only TS calls into the existing `create_snapshot`/`get_file_history`/`get_snapshot_diff`/`restore_snapshot`).

## Global Constraints

- **No Rust changes.** All backend commands already exist (`create_snapshot`, `list_snapshots`, `get_file_history`, `get_snapshot_diff`, `restore_snapshot`). The retention policy runs inside `create_snapshot` — do NOT add pruning.
- **Snapshot file paths are VAULT-RELATIVE.** `SnapshotFileEntry.path`, and the `filePath` args to `get_file_history` / `get_snapshot_diff` / `restore_snapshot` / `loadFileHistory` / `loadDiff` / `performRestore`, are all vault-relative (e.g. `notes/a.md`). The file tree's `entry.path` is ABSOLUTE. The context-menu action MUST convert absolute → vault-relative (`absPath.slice(rootPath.length + 1)` when under rootPath) before calling `loadFileHistory`.
- **Auto-snapshot is periodic + dirty-gated**, NOT per-save (snapshots are vault-wide; per-save would be far too frequent). Interval comes from resolved `snapshotIntervalMinutes` (default 30; `0` disables). Only snapshot when a save happened since the last auto-snapshot.
- **Distinct versions by checksum.** `get_file_history` returns *every* snapshot containing the file (all of them, since snapshots are vault-wide). The file-mode list must collapse to versions where the file's `checksum` changed (consecutive-collapse, newest-first). Rust query + its tests are untouched.
- **Reuse:** `DiffView`, the snapshot store's four dead file-mode actions, the Snapshots sidebar panel + ActivityBar toggle. New surface is minimal.
- **Zustand:** components use `useShallow` for multi-field selectors, never a bare `useStore()` call. Non-reactive reads use `useXStore.getState()`.
- **verbatimModuleSyntax:** type-only imports use `import type`. File size ~300-line guide (extract the file-mode view into its own component).
- `npm test` = vitest. `npm run typecheck` checks app + node + test. Commits: Conventional Commits, `feat(§71):` prefix, lowercase after the colon.

---

## File Structure

**New files:**
- `src/stores/editor/snapshot-versions.ts` — pure `distinctFileVersions(entries, filePath)`.
- `src/stores/editor/__tests__/snapshot-versions.test.ts`
- `src/hooks/use-auto-snapshot.ts` — interval timer that triggers `performAutoSnapshot`.
- `src/hooks/__tests__/use-auto-snapshot.test.ts`
- `src/components/sidebar/FileHistoryView.tsx` — the file-scoped panel view.
- `src/components/sidebar/__tests__/file-history-view.test.tsx`
- `src/stores/editor/__tests__/snapshot-auto.test.ts` — store gate + performAutoSnapshot.

**Modified files:**
- `src/stores/editor/snapshot.ts` — `pendingAutoSnapshot` + `markPendingAutoSnapshot` + `performAutoSnapshot`.
- `src/hooks/use-auto-save.ts` — mark the gate after a successful md save.
- `src/App.tsx` — mark the gate after a successful non-md (code) save; mount `useAutoSnapshot()`.
- `src/components/sidebar/hooks/use-file-tree-actions.ts` — `showVersionHistory(absPath)`.
- `src/components/sidebar/file-tree-context-menu.tsx` — "Version History" menu item.
- `src/components/sidebar/FileTree.tsx` — dispatch `"versionHistory"` action.
- `src/components/sidebar/VersionHistoryPanel.tsx` — file-mode branch (`fileHistoryPath` → `<FileHistoryView />`).

---

## Task 1: Snapshot store — auto-snapshot gate + action

**Files:**
- Modify: `src/stores/editor/snapshot.ts`
- Test: `src/stores/editor/__tests__/snapshot-auto.test.ts`

**Interfaces:**
- Produces on `useSnapshotStore`: `pendingAutoSnapshot: boolean`, `markPendingAutoSnapshot: () => void`, `performAutoSnapshot: (vaultPath: string) => Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/stores/editor/__tests__/snapshot-auto.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../ipc/invoke", () => ({
  createSnapshot: vi.fn().mockResolvedValue("snap-1"),
  listSnapshots: vi.fn().mockResolvedValue([]),
  getFileHistory: vi.fn().mockResolvedValue([]),
  getSnapshotDiff: vi.fn(),
  deleteSnapshot: vi.fn(),
  restoreSnapshot: vi.fn(),
  readFile: vi.fn(),
}));

import { createSnapshot } from "../../../ipc/invoke";
import { useSnapshotStore } from "../snapshot";

beforeEach(() => {
  useSnapshotStore.setState({ pendingAutoSnapshot: false, snapshots: [] });
  vi.clearAllMocks();
});

describe("snapshot store — auto-snapshot gate", () => {
  it("markPendingAutoSnapshot sets the gate", () => {
    useSnapshotStore.getState().markPendingAutoSnapshot();
    expect(useSnapshotStore.getState().pendingAutoSnapshot).toBe(true);
  });

  it("performAutoSnapshot is a no-op when the gate is clear", async () => {
    await useSnapshotStore.getState().performAutoSnapshot("/vault");
    expect(createSnapshot).not.toHaveBeenCalled();
  });

  it("performAutoSnapshot creates an 'auto' snapshot and clears the gate when pending", async () => {
    useSnapshotStore.getState().markPendingAutoSnapshot();
    await useSnapshotStore.getState().performAutoSnapshot("/vault");
    expect(createSnapshot).toHaveBeenCalledWith("/vault", "auto", null);
    expect(useSnapshotStore.getState().pendingAutoSnapshot).toBe(false);
  });

  it("re-arms the gate if snapshot creation fails", async () => {
    (createSnapshot as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("disk full"),
    );
    useSnapshotStore.getState().markPendingAutoSnapshot();
    await useSnapshotStore.getState().performAutoSnapshot("/vault");
    expect(useSnapshotStore.getState().pendingAutoSnapshot).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- snapshot-auto`
Expected: FAIL — `markPendingAutoSnapshot` / `performAutoSnapshot` / `pendingAutoSnapshot` do not exist.

- [ ] **Step 3: Implement**

In `src/stores/editor/snapshot.ts`, add to the `SnapshotState` interface:

```ts
  pendingAutoSnapshot: boolean;
  markPendingAutoSnapshot: () => void;
  performAutoSnapshot: (vaultPath: string) => Promise<void>;
```

Add to the initial state (near `creating: false`): `pendingAutoSnapshot: false,`.

Add the actions in the store body:

```ts
  markPendingAutoSnapshot: () => set({ pendingAutoSnapshot: true }),

  performAutoSnapshot: async (vaultPath) => {
    if (!get().pendingAutoSnapshot) return;
    set({ pendingAutoSnapshot: false });
    try {
      await createSnapshot(vaultPath, "auto", null);
      await get().loadSnapshots(vaultPath);
    } catch (e) {
      // re-arm so the next tick retries; surface the error
      set({ pendingAutoSnapshot: true, error: String(e) });
    }
  },
```

> `createSnapshot` is already imported from `../../ipc/invoke`. Pass `null` for the label (auto snapshots are unlabeled) — confirm the IPC signature is `createSnapshot(vaultPath, type, label)` and accepts `null` (it does; `performCreate` passes `label` which may be `undefined`; use `null` for explicitness — if the type is `label?: string`, pass `undefined` instead to satisfy the type). Match the existing `createSnapshot` call's label type.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- snapshot-auto`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/stores/editor/snapshot.ts src/stores/editor/__tests__/snapshot-auto.test.ts
git commit -m "feat(§71): snapshot store auto-snapshot gate + performAutoSnapshot"
```

---

## Task 2: Save-path dirty gate wiring

**Files:**
- Modify: `src/hooks/use-auto-save.ts` (md save)
- Modify: `src/App.tsx` (non-md / code save)

**Interfaces:**
- Consumes: `useSnapshotStore.getState().markPendingAutoSnapshot()` (Task 1).

- [ ] **Step 1: Wire the md save**

In `src/hooks/use-auto-save.ts`, inside `save()`, after the successful `writeFile(...)` + `markDirty(pending.id, false)` (around the `updateFileIndex(...)` call), add a gate mark:

```ts
      useSnapshotStore.getState().markPendingAutoSnapshot();
```

Add the import: `import { useSnapshotStore } from "../stores/editor/snapshot";`. Place the call INSIDE the `try` block after a confirmed successful write (not on the error path).

- [ ] **Step 2: Wire the non-md (code) save**

In `src/App.tsx`, find the non-markdown / code auto-save site (the one referenced by `use-auto-save.ts`'s comment "handled by App.tsx code auto-save"). After its successful `writeFile`, add the same `useSnapshotStore.getState().markPendingAutoSnapshot();` call. Import `useSnapshotStore` if not already imported.

> Implementer: grep `App.tsx` for `writeFile` / the code-editor save handler to locate the exact site. If App.tsx has multiple save paths, mark the gate on each successful file write.

- [ ] **Step 3: Typecheck + verify no regression**

Run: `npm run typecheck`
Run: `npm test -- use-auto-save` (if such a test exists; otherwise `npm test -- src/hooks/`)
Expected: typecheck 0; existing hook tests still green.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/use-auto-save.ts src/App.tsx
git commit -m "feat(§71): mark auto-snapshot gate on successful file save"
```

---

## Task 3: `useAutoSnapshot` interval hook

**Files:**
- Create: `src/hooks/use-auto-snapshot.ts`
- Test: `src/hooks/__tests__/use-auto-snapshot.test.ts`
- Modify: `src/App.tsx` (mount the hook)

**Interfaces:**
- Consumes: `useFileStore` (`rootPath`), `useResolvedSettings()` (`snapshotIntervalMinutes`), `useSnapshotStore.getState().performAutoSnapshot`.
- Produces: `useAutoSnapshot(): void`.

- [ ] **Step 1: Write the failing test**

```ts
// src/hooks/__tests__/use-auto-snapshot.test.ts
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const performAutoSnapshot = vi.fn().mockResolvedValue(undefined);
vi.mock("../../stores/editor/snapshot", () => ({
  useSnapshotStore: { getState: () => ({ performAutoSnapshot }) },
}));

let rootPath: string | null = "/vault";
vi.mock("../../stores/file/file", () => ({
  useFileStore: (sel: (s: { rootPath: string | null }) => unknown) =>
    sel({ rootPath }),
}));

let intervalMinutes = 30;
vi.mock("../use-resolved-settings", () => ({
  useResolvedSettings: () => ({ snapshotIntervalMinutes: intervalMinutes }),
}));

import { useAutoSnapshot } from "../use-auto-snapshot";

beforeEach(() => {
  vi.useFakeTimers();
  rootPath = "/vault";
  intervalMinutes = 30;
  performAutoSnapshot.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("useAutoSnapshot", () => {
  it("calls performAutoSnapshot(rootPath) each interval", () => {
    renderHook(() => useAutoSnapshot());
    vi.advanceTimersByTime(30 * 60 * 1000);
    expect(performAutoSnapshot).toHaveBeenCalledWith("/vault");
  });

  it("does not run when interval is 0 (disabled)", () => {
    intervalMinutes = 0;
    renderHook(() => useAutoSnapshot());
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(performAutoSnapshot).not.toHaveBeenCalled();
  });

  it("does not run when no vault is open", () => {
    rootPath = null;
    renderHook(() => useAutoSnapshot());
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(performAutoSnapshot).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- use-auto-snapshot`
Expected: FAIL — cannot resolve `../use-auto-snapshot`.

- [ ] **Step 3: Implement**

```ts
// src/hooks/use-auto-snapshot.ts
import { useEffect } from "react";
import { useFileStore } from "../stores/file/file";
import { useSnapshotStore } from "../stores/editor/snapshot";
import { useResolvedSettings } from "./use-resolved-settings";

/**
 * §71 Periodic auto-snapshot. While a vault is open and `snapshotIntervalMinutes`
 * is > 0, fires `performAutoSnapshot` every interval; the store no-ops the tick
 * unless a file was saved since the last snapshot (the dirty gate).
 */
export function useAutoSnapshot(): void {
  const rootPath = useFileStore((s) => s.rootPath);
  const { snapshotIntervalMinutes } = useResolvedSettings();

  useEffect(() => {
    if (!rootPath) return;
    const minutes = snapshotIntervalMinutes ?? 30;
    if (minutes <= 0) return;
    const id = setInterval(
      () => {
        void useSnapshotStore.getState().performAutoSnapshot(rootPath);
      },
      minutes * 60 * 1000,
    );
    return () => clearInterval(id);
  }, [rootPath, snapshotIntervalMinutes]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- use-auto-snapshot`
Expected: PASS (3 tests).

- [ ] **Step 5: Mount in App**

In `src/App.tsx`, call `useAutoSnapshot()` alongside the other top-level app hooks (e.g. near where `useFileWatcher()` / similar app-level hooks are invoked). Import it.

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
npm test -- use-auto-snapshot
git add src/hooks/use-auto-snapshot.ts src/hooks/__tests__/use-auto-snapshot.test.ts src/App.tsx
git commit -m "feat(§71): periodic auto-snapshot hook driven by snapshotInterval"
```

---

## Task 4: `distinctFileVersions` helper

**Files:**
- Create: `src/stores/editor/snapshot-versions.ts`
- Test: `src/stores/editor/__tests__/snapshot-versions.test.ts`

**Interfaces:**
- Consumes: `SnapshotEntry` (type-only) from `../../ipc/types` (`{ id, timestamp, files: { path, checksum }[], ... }`).
- Produces: `distinctFileVersions(entries: SnapshotEntry[], filePath: string): SnapshotEntry[]` — newest-first, keeping an entry only when the file's checksum differs from the previous kept entry (consecutive-collapse). Entries not containing the file are skipped.

- [ ] **Step 1: Write the failing test**

```ts
// src/stores/editor/__tests__/snapshot-versions.test.ts
import { describe, expect, it } from "vitest";
import type { SnapshotEntry } from "../../../ipc/types";
import { distinctFileVersions } from "../snapshot-versions";

const snap = (id: string, ts: string, cksum: string | null): SnapshotEntry =>
  ({
    id,
    timestamp: ts,
    type: "auto",
    label: null,
    totalSizeBytes: 0,
    files: cksum
      ? [{ path: "a.md", checksum: cksum, sizeBytes: 1 }]
      : [{ path: "other.md", checksum: "x", sizeBytes: 1 }],
  }) as unknown as SnapshotEntry;

describe("distinctFileVersions", () => {
  it("collapses consecutive same-checksum snapshots, newest first", () => {
    const entries = [
      snap("s1", "2026-01-01T00-00-00", "A"),
      snap("s2", "2026-01-02T00-00-00", "A"),
      snap("s3", "2026-01-03T00-00-00", "B"),
    ];
    const out = distinctFileVersions(entries, "a.md");
    // newest first: s3(B) kept, s2(A) kept (differs from B), s1(A) collapsed into s2
    expect(out.map((e) => e.id)).toEqual(["s3", "s2"]);
  });

  it("preserves an A→B→A history (non-consecutive repeats)", () => {
    const entries = [
      snap("s1", "2026-01-01T00-00-00", "A"),
      snap("s2", "2026-01-02T00-00-00", "B"),
      snap("s3", "2026-01-03T00-00-00", "A"),
    ];
    const out = distinctFileVersions(entries, "a.md");
    expect(out.map((e) => e.id)).toEqual(["s3", "s2", "s1"]);
  });

  it("skips snapshots that do not contain the file", () => {
    const entries = [
      snap("s1", "2026-01-01T00-00-00", "A"),
      snap("s2", "2026-01-02T00-00-00", null), // only other.md
    ];
    const out = distinctFileVersions(entries, "a.md");
    expect(out.map((e) => e.id)).toEqual(["s1"]);
  });

  it("returns empty for a file with no versions", () => {
    expect(distinctFileVersions([], "a.md")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- snapshot-versions`
Expected: FAIL — cannot resolve `../snapshot-versions`.

- [ ] **Step 3: Implement**

```ts
// src/stores/editor/snapshot-versions.ts
import type { SnapshotEntry } from "../../ipc/types";

/**
 * §71 Reduce the raw per-file snapshot list (every snapshot containing the file)
 * to DISTINCT content versions: newest-first, keeping an entry only when the
 * file's checksum differs from the previous kept entry. Snapshots that don't
 * contain the file are skipped.
 */
export function distinctFileVersions(
  entries: SnapshotEntry[],
  filePath: string,
): SnapshotEntry[] {
  const withChecksum = entries
    .map((entry) => ({
      entry,
      checksum: entry.files.find((f) => f.path === filePath)?.checksum,
    }))
    .filter(
      (x): x is { entry: SnapshotEntry; checksum: string } =>
        x.checksum != null,
    )
    .sort((a, b) => b.entry.timestamp.localeCompare(a.entry.timestamp));

  const result: SnapshotEntry[] = [];
  let prev: string | null = null;
  for (const { entry, checksum } of withChecksum) {
    if (checksum !== prev) {
      result.push(entry);
      prev = checksum;
    }
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- snapshot-versions`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/stores/editor/snapshot-versions.ts src/stores/editor/__tests__/snapshot-versions.test.ts
git commit -m "feat(§71): distinctFileVersions — collapse per-file snapshots by checksum"
```

---

## Task 5: File-mode entry point (context menu → open Snapshots panel)

**Files:**
- Modify: `src/components/sidebar/hooks/use-file-tree-actions.ts`
- Modify: `src/components/sidebar/file-tree-context-menu.tsx`
- Modify: `src/components/sidebar/FileTree.tsx`
- Test: `src/components/sidebar/hooks/__tests__/use-file-tree-actions.test.ts` (extend if it exists, else new focused test)

**Interfaces:**
- Consumes: `useSnapshotStore.getState().loadFileHistory`, `useUIStore.getState().setSidebarPanel`, `useFileStore` `rootPath`.
- Produces: `showVersionHistory(absPath: string)` on the actions returned by `use-file-tree-actions`; context-menu item dispatching `"versionHistory"`; FileTree dispatch case.

- [ ] **Step 1: Write the failing test**

```ts
// src/components/sidebar/hooks/__tests__/use-file-tree-actions.test.ts  (add to existing or new)
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSnapshotStore } from "../../../../stores/editor/snapshot";
import { useUIStore } from "../../../../stores/ui/ui";
import { useFileStore } from "../../../../stores/file/file";
import { renderHook } from "@testing-library/react";
import { useFileTreeActions } from "../use-file-tree-actions";

describe("showVersionHistory", () => {
  beforeEach(() => {
    useFileStore.setState({ rootPath: "/vault" });
    useSnapshotStore.setState({ fileHistoryPath: null, fileHistory: [] });
    useUIStore.setState({ sidebarPanel: "files" });
  });

  it("loads the file's history (vault-relative) and opens the Snapshots panel", () => {
    const loadFileHistory = vi
      .spyOn(useSnapshotStore.getState(), "loadFileHistory")
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => useFileTreeActions());
    result.current.showVersionHistory("/vault/notes/a.md");
    expect(loadFileHistory).toHaveBeenCalledWith("/vault", "notes/a.md");
    expect(useUIStore.getState().sidebarPanel).toBe("snapshots");
  });
});
```

> Implementer: check the real `use-file-tree-actions` shape (it returns an object of action functions — the reconnaissance listed `copyPath, duplicateFile, exportFile, openInNewTab, revealInFileManager`, etc.). Add `showVersionHistory` alongside them and match how those read `rootPath` (hook scope vs `useFileStore.getState()`). Adjust the test's spy approach to the store's actual method binding if the direct `spyOn(getState())` doesn't intercept (an alternative: set a real `loadFileHistory` and assert `fileHistoryPath`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- use-file-tree-actions`
Expected: FAIL — `showVersionHistory` does not exist.

- [ ] **Step 3: Add the action** in `src/components/sidebar/hooks/use-file-tree-actions.ts`:

```ts
  showVersionHistory: (absPath: string) => {
    const root = useFileStore.getState().rootPath;
    if (!root) return;
    const relPath = absPath.startsWith(root + "/")
      ? absPath.slice(root.length + 1)
      : absPath;
    void useSnapshotStore.getState().loadFileHistory(root, relPath);
    useUIStore.getState().setSidebarPanel("snapshots");
  },
```

Add imports for `useSnapshotStore` and `useUIStore` if not present. Match the existing return-object structure (the actions are returned from the hook — add `showVersionHistory` to that object). If the hook already has `rootPath` in scope, use it instead of `getState()`.

- [ ] **Step 4: Add the context-menu item** in `src/components/sidebar/file-tree-context-menu.tsx`, in the SINGLE-file section (near Reveal / Export), following the existing `onClick={() => onAction("...")}` pattern:

```tsx
        <button
          className="file-tree-context-menu-item"
          onClick={() => onAction("versionHistory")}
        >
          Version History
        </button>
```

(Match the exact class + structure of sibling items — read the surrounding items first.)

- [ ] **Step 5: Dispatch in FileTree** — in `src/components/sidebar/FileTree.tsx`, find the context-menu action dispatcher (the `switch`/handler mapping action strings to `use-file-tree-actions` functions) and add:

```ts
      case "versionHistory":
        actions.showVersionHistory(menu.path);
        break;
```

(Use the real variable names — `actions`, the menu's file path field. Read the existing dispatch cases to match the exact shape, e.g. how `"reveal"` / `"exportFile"` dispatch.)

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test -- use-file-tree-actions src/components/sidebar/__tests__/`
Run: `npm run typecheck`
Expected: new test passes; no sidebar regressions; typecheck 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/sidebar/hooks/use-file-tree-actions.ts src/components/sidebar/file-tree-context-menu.tsx src/components/sidebar/FileTree.tsx src/components/sidebar/hooks/__tests__/use-file-tree-actions.test.ts
git commit -m "feat(§71): file tree Version History action opens file-scoped snapshots"
```

---

## Task 6: FileHistoryView + panel file-mode branch

**Files:**
- Create: `src/components/sidebar/FileHistoryView.tsx`
- Modify: `src/components/sidebar/VersionHistoryPanel.tsx` (branch on `fileHistoryPath`)
- Test: `src/components/sidebar/__tests__/file-history-view.test.tsx`

**Interfaces:**
- Consumes: `useSnapshotStore` (`fileHistoryPath`, `fileHistory`, `loading`, `activeDiff`, `loadDiff`, `performRestore`, `clearFileHistory`, `closeDiff`); `useFileStore` (`rootPath`); `distinctFileVersions` (Task 4); `DiffView`; `basename` from `../../utils/path-utils`.
- Produces: `<FileHistoryView />`; `VersionHistoryPanel` renders it when `fileHistoryPath` is set.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/sidebar/__tests__/file-history-view.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { SnapshotEntry } from "../../../ipc/types";
import { useSnapshotStore } from "../../../stores/editor/snapshot";
import { useFileStore } from "../../../stores/file/file";
import { FileHistoryView } from "../FileHistoryView";

const entry = (id: string, ts: string, cksum: string): SnapshotEntry =>
  ({
    id,
    timestamp: ts,
    type: "auto",
    label: null,
    totalSizeBytes: 0,
    files: [{ path: "notes/a.md", checksum: cksum, sizeBytes: 1 }],
  }) as unknown as SnapshotEntry;

beforeEach(() => {
  useFileStore.setState({ rootPath: "/vault" });
  useSnapshotStore.setState({
    fileHistoryPath: "notes/a.md",
    fileHistory: [
      entry("s1", "2026-01-01T00-00-00", "A"),
      entry("s2", "2026-01-02T00-00-00", "B"),
    ],
    activeDiff: null,
    loading: false,
  });
});

describe("FileHistoryView", () => {
  it("shows the file name and its distinct versions", () => {
    render(<FileHistoryView />);
    expect(screen.getByText(/a\.md/)).toBeInTheDocument();
    // two distinct checksums → two version rows
    expect(document.querySelectorAll(".file-history-version").length).toBe(2);
  });

  it("returns to vault mode via the back control", () => {
    render(<FileHistoryView />);
    fireEvent.click(screen.getByRole("button", { name: /all snapshots/i }));
    expect(useSnapshotStore.getState().fileHistoryPath).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- file-history-view`
Expected: FAIL — cannot resolve `../FileHistoryView`.

- [ ] **Step 3: Implement `FileHistoryView`**

```tsx
// src/components/sidebar/FileHistoryView.tsx
import { useShallow } from "zustand/shallow";
import { basename } from "../../utils/path-utils";
import { useFileStore } from "../../stores/file/file";
import { useSnapshotStore } from "../../stores/editor/snapshot";
import { distinctFileVersions } from "../../stores/editor/snapshot-versions";
import { DiffView } from "../editor/DiffView";

export function FileHistoryView() {
  const rootPath = useFileStore((s) => s.rootPath);
  const {
    fileHistory,
    fileHistoryPath,
    loading,
    activeDiff,
    loadDiff,
    performRestore,
    clearFileHistory,
    closeDiff,
  } = useSnapshotStore(
    useShallow((s) => ({
      fileHistory: s.fileHistory,
      fileHistoryPath: s.fileHistoryPath,
      loading: s.loading,
      activeDiff: s.activeDiff,
      loadDiff: s.loadDiff,
      performRestore: s.performRestore,
      clearFileHistory: s.clearFileHistory,
      closeDiff: s.closeDiff,
    })),
  );

  if (!fileHistoryPath || !rootPath) return null;
  const versions = distinctFileVersions(fileHistory, fileHistoryPath);

  const back = () => {
    closeDiff();
    clearFileHistory();
  };

  return (
    <div className="sidebar-panel snapshot-panel file-history-view">
      <div className="snapshot-panel-header">
        <button className="snapshot-action-btn" onClick={back} title="All snapshots">
          {"←"} All snapshots
        </button>
        <span className="snapshot-panel-title text-truncate">
          {basename(fileHistoryPath)}
        </span>
      </div>

      {loading && <div className="snapshot-loading">Loading history…</div>}
      {!loading && versions.length === 0 && (
        <div className="snapshot-empty">No versions yet for this file.</div>
      )}

      {!loading && versions.length > 0 && (
        <div className="snapshot-list">
          {versions.map((v) => (
            <div className="file-history-version" key={v.id}>
              <button
                className="file-history-version-open"
                onClick={() => loadDiff(rootPath, v.id, fileHistoryPath)}
                title="View changes"
              >
                <span className="file-history-version-time">{v.timestamp}</span>
                {v.label && <span className="file-history-version-label">{v.label}</span>}
              </button>
              <button
                className="file-history-version-restore"
                onClick={() => performRestore(rootPath, v.id, [fileHistoryPath])}
                title="Restore this version"
              >
                Restore
              </button>
            </div>
          ))}
        </div>
      )}

      {activeDiff && (
        <DiffView diff={activeDiff.diff} filePath={activeDiff.filePath} onClose={closeDiff} />
      )}
    </div>
  );
}
```

> Verify `DiffView`'s exact prop names (`diff`, `filePath`, `onClose?`) against `src/components/editor/DiffView.tsx`; verify `basename` is exported from `path-utils`. The `timestamp` is a filesystem-safe ISO string (`YYYY-MM-DDTHH-MM-SS`) — rendering it raw is acceptable for this PR (human-friendly formatting is backlog). Reuse existing `snapshot-*` CSS classes; add minimal `.file-history-*` rules only if needed (see Step 5).

- [ ] **Step 4: Branch in VersionHistoryPanel**

In `src/components/sidebar/VersionHistoryPanel.tsx`, read `fileHistoryPath` from the store (add to the destructured selector) and add a branch right after the `if (!rootPath)` guard, BEFORE the `selectedSnapshotId` check:

```tsx
  if (fileHistoryPath) {
    return <FileHistoryView />;
  }
```

Import `FileHistoryView`.

- [ ] **Step 5: CSS (only if needed)**

If the reused `snapshot-*` classes don't lay out the version rows acceptably, add minimal `.file-history-version` / `.file-history-version-open` / `.file-history-version-restore` rules to `src/styles/*.css` (the snapshot styles live in `src/styles/components.css` per the reconnaissance) using existing `--color-*` tokens only. Run `npm run audit:css-vars` after — 0 new undefined.

- [ ] **Step 6: Run tests + full gates**

Run: `npm test -- file-history-view src/components/sidebar/__tests__/`
Run: `npm run typecheck && npm run audit:css-vars`
Expected: new tests pass; no sidebar regressions; typecheck 0; no new undefined CSS vars.

- [ ] **Step 7: Commit**

```bash
git add src/components/sidebar/FileHistoryView.tsx src/components/sidebar/VersionHistoryPanel.tsx src/components/sidebar/__tests__/file-history-view.test.tsx src/styles/*.css
git commit -m "feat(§71): file-scoped version history view with diff + single-file restore"
```

---

## Final Verification (before PR)

- [ ] `npm run typecheck` — 0 errors.
- [ ] `npm test` — full suite green.
- [ ] `cd src-tauri && cargo test` — Rust green (unchanged; confirm no accidental breakage).
- [ ] `npm run audit:css-vars` — no new undefined variables.
- [ ] Manual GUI checklist for the user:
  - Auto-snapshot: edit + save a file, wait the interval (or temporarily lower `snapshotInterval` in Settings), confirm a new "auto" snapshot appears in Version History; no new snapshot if nothing was edited since the last.
  - Right-click a file → "Version History" → the Snapshots panel opens showing that file's distinct versions (not every 30-min snapshot).
  - Click a version → diff (snapshot vs current). "Restore" → the file reverts (and an open tab reloads).
  - "← All snapshots" → returns to the vault snapshot list.
  - Non-vault folder or `snapshotInterval = 0` → no auto-snapshot, no errors.
  - Regression: manual "+" snapshot, vault restore, and PR1–PR5 file-tree features still work.

## Notes / backlog (do not implement in PR)

- On-save-immediate and before-risky-op auto-snapshots (§7.5) — deferred.
- Command palette "Snapshot: Create / Browse History" — deferred.
- Side-by-side diff — unified `DiffView` kept.
- Human-friendly timestamp formatting + per-version size/label polish in the file-history list.
