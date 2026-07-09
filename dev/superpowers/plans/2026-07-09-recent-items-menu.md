# Recent Folders/Files in Vault Tab "+" Menu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the already-persisted recent folders and recent files inside the Vault Tab "+" dropdown (`ContextAddMenu`), so users can reopen them without returning to the home screen.

**Architecture:** Reuse the existing `recentFolders`/`recentFiles` state in the settings store (persisted via `baram:settings`). Add store actions to remove/clear entries and a small `isVault` flag on folder entries (populated at open time — no migration, additive optional field). Extract the file-open logic into a standalone `openFileByPath()` util (currently trapped inside a hook), and build a tiny `recent-open` util that opens an item and, on failure, removes it from recents and toasts. Extend `ContextAddMenu` to render the two sections plus a "Clear Recent" action.

**Tech Stack:** React 19 + TypeScript (strict), Zustand (+ `useShallow`), Vitest + React Testing Library, lucide-react icons, custom i18n (`t(key, locale, params)`).

## Global Constraints

Copied verbatim from project conventions (`CLAUDE.md`); every task implicitly includes these.

- TypeScript **strict mode**; function components + hooks only.
- File names **kebab-case**; components/Extensions **PascalCase**; functions/hooks **camelCase**.
- Zustand: **never** bare `useStore()`; multi-field selects **must** use `useShallow((s) => ({...}))`.
- Reuse shared utilities — **no local reimplementation**: `basename()` / `dirname()` live in `src/utils/path-utils.ts`.
- CSS variables follow `--color-{category}-{qualifier}` (e.g. `--color-text-muted`, `--color-accent-default`); reuse shadow tokens `--shadow-md`.
- Tests run with **Vitest** (`npm test` → `vitest run`). Do **not** use jest.
- Single source file target **~300 lines**, split beyond ~500.
- Keep `§` design-section references in code comments/commits (§81 workspace, §82 context tab bar, §89 file open).

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/stores/settings/general-settings.ts` | Recent-items state + actions | Modify: `isVault` field, `addRecentFolder` signature, add `removeRecentFolder`/`removeRecentFile`/`clearRecent` |
| `src/stores/file/file.ts` | Folder open flows | Modify: pass `isVault` into `addRecentFolder` |
| `src/utils/open-file.ts` | Standalone "open a file by path" | **Create** (extracted from `use-file-operations`) |
| `src/hooks/use-file-operations.ts` | File-op hook | Modify: delegate `handleOpenFilePath` to `openFileByPath` |
| `src/utils/recent-open.ts` | Open a recent item; self-heal stale paths | **Create** |
| `src/i18n/en.json`, `src/i18n/ko.json` | UI strings | Modify: add `recent.*` keys |
| `src/components/layout/ContextAddMenu.tsx` | "+" dropdown UI | Modify: recent sections, vault badge, clear action; DRY file-open |
| `src/styles/context-tab-bar.css` | Dropdown styles | Modify: section label, recent item, badge |

Test files (all **Create**): `src/stores/__tests__/general-settings.test.ts`, `src/utils/__tests__/open-file.test.ts`, `src/utils/__tests__/recent-i18n.test.ts`, `src/utils/__tests__/recent-open.test.ts`, `src/components/layout/__tests__/ContextAddMenu.test.tsx`.

---

## Task 1: Store — `isVault` field + remove/clear actions

**Files:**
- Modify: `src/stores/settings/general-settings.ts`
- Test: `src/stores/__tests__/general-settings.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface RecentFolderEntry { path: string; lastOpened: number; isVault?: boolean }`
  - `interface RecentFileEntry { path: string; lastOpened: number }`
  - `addRecentFolder(path: string, isVault?: boolean): void`
  - `removeRecentFolder(path: string): void`
  - `removeRecentFile(path: string): void`
  - `clearRecent(): void`
  - `recentFolders: RecentFolderEntry[]`, `recentFiles: RecentFileEntry[]` (state, unchanged names)

- [ ] **Step 1: Write the failing test**

Create `src/stores/__tests__/general-settings.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../settings/store";

describe("general settings — recent items", () => {
  beforeEach(() => {
    useSettingsStore.setState({ recentFolders: [], recentFiles: [] });
  });

  it("addRecentFolder stores the isVault flag and dedups by path", () => {
    const s = useSettingsStore.getState();
    s.addRecentFolder("/a/vault", true);
    s.addRecentFolder("/b/plain", false);
    s.addRecentFolder("/a/vault", true); // re-add → dedup, still one entry, most recent first

    const { recentFolders } = useSettingsStore.getState();
    expect(recentFolders).toHaveLength(2);
    expect(recentFolders[0]).toMatchObject({ path: "/a/vault", isVault: true });
    expect(recentFolders[1]).toMatchObject({ path: "/b/plain", isVault: false });
  });

  it("addRecentFolder without isVault preserves a previously known flag on re-add", () => {
    const s = useSettingsStore.getState();
    s.addRecentFolder("/a/vault", true);
    s.addRecentFolder("/a/vault"); // omitted → must not clobber isVault
    expect(useSettingsStore.getState().recentFolders[0].isVault).toBe(true);
  });

  it("addRecentFolder caps the list at 5", () => {
    const s = useSettingsStore.getState();
    for (let i = 0; i < 7; i++) s.addRecentFolder(`/f/${i}`);
    expect(useSettingsStore.getState().recentFolders).toHaveLength(5);
  });

  it("removeRecentFolder / removeRecentFile remove only the matching path", () => {
    const s = useSettingsStore.getState();
    s.addRecentFolder("/keep");
    s.addRecentFolder("/drop");
    s.addRecentFile("/keep.md");
    s.addRecentFile("/drop.md");

    s.removeRecentFolder("/drop");
    s.removeRecentFile("/drop.md");

    const st = useSettingsStore.getState();
    expect(st.recentFolders.map((f) => f.path)).toEqual(["/keep"]);
    expect(st.recentFiles.map((f) => f.path)).toEqual(["/keep.md"]);
  });

  it("clearRecent empties both lists but keeps lastOpened*", () => {
    const s = useSettingsStore.getState();
    s.addRecentFolder("/x");
    s.addRecentFile("/x.md");
    s.clearRecent();
    const st = useSettingsStore.getState();
    expect(st.recentFolders).toEqual([]);
    expect(st.recentFiles).toEqual([]);
    expect(st.lastOpenedFolder).toBe("/x");
    expect(st.lastOpenedFile).toBe("/x.md");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/__tests__/general-settings.test.ts`
Expected: FAIL — `removeRecentFolder`/`removeRecentFile`/`clearRecent` are not functions; `isVault` assertions fail.

- [ ] **Step 3: Implement the store changes**

In `src/stores/settings/general-settings.ts`:

(a) Add exported entry types above `GeneralSettingsSlice` and use them in the interface. Replace the two inline `recentFiles`/`recentFolders` field types and add the new action signatures:

```ts
export interface RecentFolderEntry {
  path: string;
  lastOpened: number;
  isVault?: boolean;
}
export interface RecentFileEntry {
  path: string;
  lastOpened: number;
}
```

In `interface GeneralSettingsSlice`, change/add these members:

```ts
  addRecentFolder: (path: string, isVault?: boolean) => void;
  clearRecent: () => void;
  recentFiles: RecentFileEntry[];
  recentFolders: RecentFolderEntry[];
  removeRecentFile: (path: string) => void;
  removeRecentFolder: (path: string) => void;
```

(b) Replace the `addRecentFolder` implementation (currently lines ~82-92) with the isVault-aware version:

```ts
  addRecentFolder: (path, isVault) =>
    set((state) => {
      const prev = state.recentFolders.find((f) => f.path === path);
      const filtered = state.recentFolders.filter((f) => f.path !== path);
      // On re-add without an explicit flag, preserve the previously known value.
      const resolvedIsVault = isVault ?? prev?.isVault;
      return {
        recentFolders: [
          { path, lastOpened: Date.now(), isVault: resolvedIsVault },
          ...filtered,
        ].slice(0, 5),
        lastOpenedFolder: path,
      };
    }),
```

(c) Add the three new actions right after `addRecentFile` (after line ~104):

```ts
  removeRecentFolder: (path) =>
    set((state) => ({
      recentFolders: state.recentFolders.filter((f) => f.path !== path),
    })),

  removeRecentFile: (path) =>
    set((state) => ({
      recentFiles: state.recentFiles.filter((f) => f.path !== path),
    })),

  clearRecent: () => set({ recentFolders: [], recentFiles: [] }),
```

Note: `recentFolders`/`recentFiles` are already in the settings-store `partialize` and persisted; `isVault` is an additive optional field, so **no version bump / migration** is needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/stores/__tests__/general-settings.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stores/settings/general-settings.ts src/stores/__tests__/general-settings.test.ts
git commit -m "feat(§81): recent-folder isVault flag + remove/clear settings actions"
```

---

## Task 2: Wire `isVault` from folder-open flows

**Files:**
- Modify: `src/stores/file/file.ts` (`addFolder` ~line 109, `openFolder` ~line 196)

**Interfaces:**
- Consumes: `addRecentFolder(path, isVault?)` from Task 1.
- Produces: nothing new (behavioral wiring only).

Both functions already compute a local `isVault` boolean (from `getVaultConfigByPath`). This task passes it through so recent entries are tagged correctly even for vaults that are later closed. Verified by the type checker (the new required-shape call) plus the Task 1 store unit test that proves storage behavior.

- [ ] **Step 1: Update `addFolder`**

In `src/stores/file/file.ts`, change the final line of `addFolder` (currently `useSettingsStore.getState().addRecentFolder(path);`) to:

```ts
  // Update settings (§81 tag the recent entry with vault-ness detected above)
  useSettingsStore.getState().addRecentFolder(path, isVault);
```

- [ ] **Step 2: Update `openFolder`**

In `openFolder`, the `isVault` variable is scoped inside the `if (!existing)` block. Hoist it so it is available at the `addRecentFolder` call. Change the declaration inside the block from `let isVault = false;` to assign an outer variable:

Replace the block that currently reads:

```ts
  const existing = contextStore.contexts.find((c) => c.path === path);
  if (!existing) {
    // Detect vault via .baram/config.json (bypasses check_vault).
    // Must run BEFORE setVaultRoot to avoid Rust legacy "folder" dedup.
    const { getVaultConfigByPath } = await import("../../ipc/context");
    let isVault = false;
```

with:

```ts
  const existing = contextStore.contexts.find((c) => c.path === path);
  let isVault = false;
  if (!existing) {
    // Detect vault via .baram/config.json (bypasses check_vault).
    // Must run BEFORE setVaultRoot to avoid Rust legacy "folder" dedup.
    const { getVaultConfigByPath } = await import("../../ipc/context");
```

(Remove the now-duplicate `let isVault = false;` inside the block.) Then change the final settings line:

```ts
  // Update settings
  useSettingsStore.getState().addRecentFolder(path, isVault);
```

For an already-open folder (`existing` truthy) `isVault` stays `false`, but `addRecentFolder`'s preserve-on-re-add logic keeps any previously stored flag, so no information is lost.

- [ ] **Step 3: Verify types + existing tests**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx vitest run src/stores/__tests__/`
Expected: PASS (no regressions).

- [ ] **Step 4: Commit**

```bash
git add src/stores/file/file.ts
git commit -m "feat(§81): tag recent folders with detected vault-ness"
```

---

## Task 3: Extract `openFileByPath()` util + refactor hook

**Files:**
- Create: `src/utils/open-file.ts`
- Modify: `src/hooks/use-file-operations.ts` (`handleOpenFilePath` ~lines 304-338 + imports)
- Test: `src/utils/__tests__/open-file.test.ts` (create)

**Interfaces:**
- Consumes: `addRecentFile`, `setLastOpenedFile` (settings store), `ensureFileContext` (context store).
- Produces: `openFileByPath(filePath: string): Promise<void>` — opens/activates a tab for the file and records it in recents; **throws** on failure (does not swallow).

- [ ] **Step 1: Write the failing test**

Create `src/utils/__tests__/open-file.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readFile } from "../../ipc/fs";
import { useContextStore } from "../../stores/context/context";
import { useEditorStore } from "../../stores/editor/editor";
import { useSettingsStore } from "../../stores/settings/store";
import { openFileByPath } from "../open-file";

vi.mock("../../ipc/fs", () => ({ readFile: vi.fn() }));
vi.mock("../../plugins/plugin-lifecycle", () => ({ notifyFileOpen: vi.fn() }));

const mockReadFile = vi.mocked(readFile);

beforeEach(() => {
  useEditorStore.setState({ tabs: [], activeTabId: null });
  useSettingsStore.setState({ recentFiles: [] });
  useContextStore.setState({
    // stub context resolution so we don't touch IPC
    ensureFileContext: vi.fn(async () => ({ id: "ctx1" })),
  } as never);
});

afterEach(() => vi.clearAllMocks());

describe("openFileByPath", () => {
  it("opens a tab and records the file in recents", async () => {
    mockReadFile.mockResolvedValue("# hello");
    await openFileByPath("/vault/note.md");

    const { tabs } = useEditorStore.getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ filePath: "/vault/note.md", title: "note.md" });
    expect(useSettingsStore.getState().recentFiles[0].path).toBe("/vault/note.md");
  });

  it("throws when reading the file fails (stale path)", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    await expect(openFileByPath("/gone/x.md")).rejects.toThrow();
  });

  it("activates an already-open tab instead of opening a duplicate", async () => {
    useEditorStore.getState().openTab({
      contextId: "c",
      id: "t1",
      filePath: "/vault/note.md",
      title: "note.md",
      isDirty: false,
      isPinned: false,
    });
    await openFileByPath("/vault/note.md");
    expect(useEditorStore.getState().tabs).toHaveLength(1);
    expect(useEditorStore.getState().activeTabId).toBe("t1");
    expect(mockReadFile).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/open-file.test.ts`
Expected: FAIL — cannot find module `../open-file`.

- [ ] **Step 3: Create `src/utils/open-file.ts`**

```ts
// §89 Open a file by absolute path — shared by the file-op hook, the "+" menu,
// and recent-item reopening. Throws on failure so callers can self-heal.
import { readFile } from "../ipc/fs";
import { notifyFileOpen } from "../plugins/plugin-lifecycle";
import { useContextStore } from "../stores/context/context";
import { useEditorStore } from "../stores/editor/editor";
import { useFileStore } from "../stores/file/file";
import { useSettingsStore } from "../stores/settings/store";

export async function openFileByPath(filePath: string): Promise<void> {
  const { tabs } = useEditorStore.getState();
  const existing = tabs.find((t) => t.filePath === filePath);
  if (existing) {
    useEditorStore.getState().setActiveTab(existing.id);
    return;
  }

  // §89 Ensure a context exists (vault/folder for internal, FileContext for
  // external) BEFORE readFile so the Rust check_vault guard passes.
  const context = await useContextStore.getState().ensureFileContext(filePath);
  const content = await readFile(filePath);
  const fileName = filePath.split("/").pop() ?? "Unknown";

  useFileStore.getState().setFileContent(filePath, content);
  useEditorStore.getState().openTab({
    contextId: context.id,
    id: crypto.randomUUID(),
    filePath,
    title: fileName,
    isDirty: false,
    isPinned: false,
  });
  notifyFileOpen(filePath);
  useSettingsStore.getState().addRecentFile(filePath);
  useSettingsStore.getState().setLastOpenedFile(filePath);
}
```

- [ ] **Step 4: Refactor `use-file-operations.ts` to delegate**

Replace the whole body of `handleOpenFilePath` (lines ~304-338) with:

```ts
  // Open file by path — used by macOS file association (Finder → Baram)
  const handleOpenFilePath = useCallback(async (filePath: string) => {
    try {
      await openFileByPath(filePath);
    } catch (err) {
      logger.error("[App] Failed to open file:", err);
    }
  }, []);
```

Add the import (with the other `../utils/*` imports):

```ts
import { openFileByPath } from "../utils/open-file";
```

Remove now-unused imports: delete `import { useContextStore } from "../stores/context/context";` and change `import { notifyFileOpen, notifyFileSave } from "../plugins/plugin-lifecycle";` to `import { notifyFileSave } from "../plugins/plugin-lifecycle";` (verify with the next step that nothing else in the file references them).

- [ ] **Step 5: Run tests + typecheck to verify pass**

Run: `npx vitest run src/utils/__tests__/open-file.test.ts`
Expected: PASS (3 tests).

Run: `npx tsc --noEmit`
Expected: no errors (in particular no "unused import" or "declared but never read" for `useContextStore`/`notifyFileOpen`).

- [ ] **Step 6: Commit**

```bash
git add src/utils/open-file.ts src/hooks/use-file-operations.ts src/utils/__tests__/open-file.test.ts
git commit -m "refactor(§89): extract openFileByPath util from use-file-operations"
```

---

## Task 4: i18n keys

**Files:**
- Modify: `src/i18n/en.json`, `src/i18n/ko.json`
- Test: `src/utils/__tests__/recent-i18n.test.ts` (create)

**Interfaces:**
- Produces keys: `recent.folders`, `recent.files`, `recent.clear`, `recent.vaultBadge`, `recent.notFound` (with `{name}` param).

- [ ] **Step 1: Write the failing test**

Create `src/utils/__tests__/recent-i18n.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { t } from "../../i18n";

describe("recent-items i18n keys", () => {
  it("resolves Korean labels", () => {
    expect(t("recent.folders", "ko")).toBe("최근 폴더");
    expect(t("recent.files", "ko")).toBe("최근 파일");
    expect(t("recent.clear", "ko")).toBe("최근 항목 지우기");
    expect(t("recent.vaultBadge", "ko")).toBe("볼트");
  });

  it("resolves English labels and interpolates notFound", () => {
    expect(t("recent.folders", "en")).toBe("Recent Folders");
    expect(t("recent.notFound", "en", { name: "notes.md" })).toContain("notes.md");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/recent-i18n.test.ts`
Expected: FAIL — keys resolve to the raw key string (e.g. `"recent.folders"`), so assertions fail.

- [ ] **Step 3: Add the keys**

In `src/i18n/en.json` add (place alphabetically among existing `recent`/`r*` keys, or anywhere at the top level — the file is a flat map):

```json
  "recent.folders": "Recent Folders",
  "recent.files": "Recent Files",
  "recent.clear": "Clear Recent",
  "recent.vaultBadge": "Vault",
  "recent.notFound": "Path not found — removed from recents: {name}",
```

In `src/i18n/ko.json` add:

```json
  "recent.folders": "최근 폴더",
  "recent.files": "최근 파일",
  "recent.clear": "최근 항목 지우기",
  "recent.vaultBadge": "볼트",
  "recent.notFound": "경로를 찾을 수 없어 목록에서 제거했습니다: {name}",
```

(Ensure valid JSON — add a trailing comma on the preceding line if inserting mid-object, and none after the last object entry.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/__tests__/recent-i18n.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/i18n/en.json src/i18n/ko.json src/utils/__tests__/recent-i18n.test.ts
git commit -m "feat(§82): i18n keys for recent-items menu"
```

---

## Task 5: `recent-open.ts` — open a recent item, self-heal stale paths

**Files:**
- Create: `src/utils/recent-open.ts`
- Test: `src/utils/__tests__/recent-open.test.ts` (create)

**Interfaces:**
- Consumes: `addFolder` (file store), `openFileByPath` (Task 3), `removeRecentFolder`/`removeRecentFile` (Task 1), `showToast` (ui store), `t` + `basename`.
- Produces: `openRecentFolder(path: string): Promise<void>`, `openRecentFile(path: string): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `src/utils/__tests__/recent-open.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addFolder } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { openFileByPath } from "../open-file";
import { openRecentFolder, openRecentFile } from "../recent-open";

vi.mock("../../stores/file/file", () => ({ addFolder: vi.fn() }));
vi.mock("../open-file", () => ({ openFileByPath: vi.fn() }));

const mockAddFolder = vi.mocked(addFolder);
const mockOpenFile = vi.mocked(openFileByPath);

let removeRecentFolder: ReturnType<typeof vi.fn>;
let removeRecentFile: ReturnType<typeof vi.fn>;
let showToast: ReturnType<typeof vi.fn>;

beforeEach(() => {
  removeRecentFolder = vi.fn();
  removeRecentFile = vi.fn();
  showToast = vi.fn();
  useSettingsStore.setState({ removeRecentFolder, removeRecentFile } as never);
  useUIStore.setState({ showToast } as never);
});

afterEach(() => vi.clearAllMocks());

describe("openRecentFolder", () => {
  it("opens the folder and does not touch recents on success", async () => {
    mockAddFolder.mockResolvedValue();
    await openRecentFolder("/ok");
    expect(mockAddFolder).toHaveBeenCalledWith("/ok");
    expect(removeRecentFolder).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it("removes the entry and toasts when opening fails", async () => {
    mockAddFolder.mockRejectedValue(new Error("gone"));
    await openRecentFolder("/gone");
    expect(removeRecentFolder).toHaveBeenCalledWith("/gone");
    expect(showToast).toHaveBeenCalledTimes(1);
  });
});

describe("openRecentFile", () => {
  it("removes the entry and toasts when opening fails", async () => {
    mockOpenFile.mockRejectedValue(new Error("gone"));
    await openRecentFile("/gone.md");
    expect(removeRecentFile).toHaveBeenCalledWith("/gone.md");
    expect(showToast).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/recent-open.test.ts`
Expected: FAIL — cannot find module `../recent-open`.

- [ ] **Step 3: Create `src/utils/recent-open.ts`**

```ts
// §82 Open a recent folder/file. On failure (deleted/moved path) the entry is
// removed from recents and the user is toasted — self-healing the stale list.
import type { Locale } from "../i18n";

import { t } from "../i18n";
import { addFolder } from "../stores/file/file";
import { useSettingsStore } from "../stores/settings/store";
import { useUIStore } from "../stores/ui/ui";
import { basename } from "./path-utils";
import { openFileByPath } from "./open-file";

function toastNotFound(path: string): void {
  const { locale } = useSettingsStore.getState();
  useUIStore
    .getState()
    .showToast(t("recent.notFound", locale as Locale, { name: basename(path) }));
}

export async function openRecentFolder(path: string): Promise<void> {
  try {
    await addFolder(path);
  } catch {
    useSettingsStore.getState().removeRecentFolder(path);
    toastNotFound(path);
  }
}

export async function openRecentFile(path: string): Promise<void> {
  try {
    await openFileByPath(path);
  } catch {
    useSettingsStore.getState().removeRecentFile(path);
    toastNotFound(path);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/__tests__/recent-open.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/recent-open.ts src/utils/__tests__/recent-open.test.ts
git commit -m "feat(§82): recent-open util with stale-path self-healing"
```

---

## Task 6: `ContextAddMenu` UI — recent sections, vault badge, clear

**Files:**
- Modify: `src/components/layout/ContextAddMenu.tsx`
- Modify: `src/styles/context-tab-bar.css`
- Test: `src/components/layout/__tests__/ContextAddMenu.test.tsx` (create)

**Interfaces:**
- Consumes: `recentFolders`, `recentFiles`, `clearRecent` (settings), `contexts` (context store), `openRecentFolder`/`openRecentFile` (Task 5), `openFileByPath` (Task 3), `basename`, `useTranslation`, lucide `Folder`/`FileText`.
- Produces: no exported API change (same `Props`).

- [ ] **Step 1: Write the failing test**

Create `src/components/layout/__tests__/ContextAddMenu.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { useContextStore } from "../../../stores/context/context";
import { useSettingsStore } from "../../../stores/settings/store";
import { openRecentFile, openRecentFolder } from "../../../utils/recent-open";
import { ContextAddMenu } from "../ContextAddMenu";

vi.mock("../../../utils/recent-open", () => ({
  openRecentFolder: vi.fn(),
  openRecentFile: vi.fn(),
}));

function anchor() {
  return { current: document.createElement("button") };
}

let clearRecent: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clearRecent = vi.fn();
  useSettingsStore.setState({
    locale: "en",
    clearRecent,
    recentFolders: [
      { path: "/a/MyVault", lastOpened: 2, isVault: true },
      { path: "/b/Notes", lastOpened: 1 },
    ],
    recentFiles: [{ path: "/a/MyVault/todo.md", lastOpened: 3 }],
  } as never);
  useContextStore.setState({ contexts: [] } as never);
});

afterEach(() => {
  useSettingsStore.setState({ recentFolders: [], recentFiles: [] } as never);
  vi.clearAllMocks();
});

describe("ContextAddMenu — recents", () => {
  it("renders folder/file sections with a vault badge", () => {
    render(<ContextAddMenu anchorRef={anchor()} onClose={() => {}} />);
    expect(screen.getByText("Recent Folders")).toBeInTheDocument();
    expect(screen.getByText("Recent Files")).toBeInTheDocument();
    expect(screen.getByText("MyVault")).toBeInTheDocument();
    expect(screen.getByText("Notes")).toBeInTheDocument();
    expect(screen.getByText("todo.md")).toBeInTheDocument();
    expect(screen.getByText("Vault")).toBeInTheDocument(); // badge on the vault entry
  });

  it("opens a recent folder and closes the menu on click", () => {
    const onClose = vi.fn();
    render(<ContextAddMenu anchorRef={anchor()} onClose={onClose} />);
    fireEvent.click(screen.getByText("MyVault"));
    expect(onClose).toHaveBeenCalled();
    expect(vi.mocked(openRecentFolder)).toHaveBeenCalledWith("/a/MyVault");
  });

  it("opens a recent file on click", () => {
    render(<ContextAddMenu anchorRef={anchor()} onClose={() => {}} />);
    fireEvent.click(screen.getByText("todo.md"));
    expect(vi.mocked(openRecentFile)).toHaveBeenCalledWith("/a/MyVault/todo.md");
  });

  it("clears recents via the clear action", () => {
    render(<ContextAddMenu anchorRef={anchor()} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Clear Recent"));
    expect(clearRecent).toHaveBeenCalled();
  });

  it("hides recent sections when there are none", () => {
    useSettingsStore.setState({ recentFolders: [], recentFiles: [] } as never);
    render(<ContextAddMenu anchorRef={anchor()} onClose={() => {}} />);
    expect(screen.queryByText("Recent Folders")).toBeNull();
    expect(screen.queryByText("Clear Recent")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/layout/__tests__/ContextAddMenu.test.tsx`
Expected: FAIL — "Recent Folders" / badge / clear text not found.

- [ ] **Step 3: Rewrite `ContextAddMenu.tsx`**

Replace the file contents with:

```tsx
// §82 Context add dropdown menu
import { useCallback, useEffect, useRef, useState } from "react";

import { open } from "@tauri-apps/plugin-dialog";
import { FileText, Folder } from "lucide-react";
import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../i18n/useTranslation";
import { initVault } from "../../ipc/context";
import { useContextStore } from "../../stores/context/context";
import { addFolder } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { basename } from "../../utils/path-utils";
import { logger } from "../../utils/logger";
import { openFileByPath } from "../../utils/open-file";
import { openRecentFile, openRecentFolder } from "../../utils/recent-open";

interface Props {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

export function ContextAddMenu({ onClose, anchorRef }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});
  const { t } = useTranslation();

  const { recentFolders, recentFiles, clearRecent } = useSettingsStore(
    useShallow((s) => ({
      recentFolders: s.recentFolders,
      recentFiles: s.recentFiles,
      clearRecent: s.clearRecent,
    })),
  );
  const contexts = useContextStore((s) => s.contexts);
  const isVaultPath = (p: string) =>
    contexts.some((c) => c.contextType === "vault" && c.path === p);

  const hasRecents = recentFolders.length > 0 || recentFiles.length > 0;

  useEffect(() => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setStyle({ left: rect.left, top: rect.bottom + 2 });
    }
  }, [anchorRef]);

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

  const handleOpenFile = useCallback(async () => {
    onClose();
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (selected) {
        await openFileByPath(selected as string);
      }
    } catch (err) {
      logger.error("[ContextAddMenu] openFile failed:", err);
    }
  }, [onClose]);

  const handleInitVault = useCallback(async () => {
    onClose();
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected) {
        const path = selected as string;
        const folderName = basename(path) || "vault";
        await initVault(path, folderName);
        await addFolder(path);
      }
    } catch (err) {
      logger.error("[ContextAddMenu] initVault failed:", err);
    }
  }, [onClose]);

  return (
    <div className="context-add-menu" ref={menuRef} style={style}>
      <button className="context-add-menu__item" onClick={handleOpenFolder}>
        Open Folder…
      </button>
      <button className="context-add-menu__item" onClick={handleOpenFile}>
        Open File…
      </button>
      <div className="context-add-menu__sep" />
      <button className="context-add-menu__item" onClick={handleInitVault}>
        Initialize as Vault…
      </button>

      {hasRecents && <div className="context-add-menu__sep" />}

      {recentFolders.length > 0 && (
        <>
          <div className="context-add-menu__label">{t("recent.folders")}</div>
          {recentFolders.slice(0, 5).map((f) => {
            const vault = f.isVault ?? isVaultPath(f.path);
            return (
              <button
                key={f.path}
                className="context-add-menu__item context-add-menu__item--recent"
                title={f.path}
                onClick={() => {
                  onClose();
                  void openRecentFolder(f.path);
                }}
              >
                <Folder className="context-add-menu__icon" size={14} />
                <span className="context-add-menu__text">{basename(f.path)}</span>
                {vault && (
                  <span className="context-add-menu__badge">
                    {t("recent.vaultBadge")}
                  </span>
                )}
              </button>
            );
          })}
        </>
      )}

      {recentFiles.length > 0 && (
        <>
          <div className="context-add-menu__label">{t("recent.files")}</div>
          {recentFiles.slice(0, 5).map((f) => (
            <button
              key={f.path}
              className="context-add-menu__item context-add-menu__item--recent"
              title={f.path}
              onClick={() => {
                onClose();
                void openRecentFile(f.path);
              }}
            >
              <FileText className="context-add-menu__icon" size={14} />
              <span className="context-add-menu__text">{basename(f.path)}</span>
            </button>
          ))}
        </>
      )}

      {hasRecents && (
        <>
          <div className="context-add-menu__sep" />
          <button
            className="context-add-menu__item context-add-menu__item--muted"
            onClick={() => clearRecent()}
          >
            {t("recent.clear")}
          </button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add CSS**

Append to `src/styles/context-tab-bar.css` (after the `.context-add-menu__sep` block, ~line 176):

```css
/* §82 Recent-items menu: constrain width so long paths ellipsize */
.context-add-menu {
  max-width: 320px;
}

.context-add-menu__label {
  padding: 6px 10px 2px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted, #6b7280);
}

.context-add-menu__item--recent {
  display: flex;
  align-items: center;
  gap: 6px;
}

.context-add-menu__icon {
  flex-shrink: 0;
  color: var(--color-text-muted, #6b7280);
}

.context-add-menu__text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-add-menu__badge {
  flex-shrink: 0;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 600;
  color: var(--color-accent-default, #3b82f6);
  border: 1px solid var(--color-accent-default, #3b82f6);
  border-radius: 4px;
}

.context-add-menu__item--muted {
  font-size: 12px;
  color: var(--color-text-muted, #6b7280);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/layout/__tests__/ContextAddMenu.test.tsx`
Expected: PASS (5 tests).

Run: `npx tsc --noEmit`
Expected: no errors (confirm no unused imports remain in `ContextAddMenu.tsx` — `readFile`, `useEditorStore`, `useFileStore` should be gone).

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/ContextAddMenu.tsx src/styles/context-tab-bar.css src/components/layout/__tests__/ContextAddMenu.test.tsx
git commit -m "feat(§82): recent folders/files sections + vault badge + clear in '+' menu"
```

---

## Task 7: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all suites PASS, including the 5 new files.

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint` (if present in `package.json`; skip if not)
Expected: no new errors.

- [ ] **Step 3: Manual smoke (build the app or dev run)**

Run: `npm run tauri dev` (or the project's dev command)
Verify by hand:
1. Open a folder and a file so recents populate.
2. Open the Vault Tab "+" menu → "Recent Folders" and "Recent Files" sections appear; a vault folder shows the "Vault" badge.
3. Click a recent item → it opens.
4. Delete/move a folder on disk, click its recent entry → toast appears and the entry disappears from the list.
5. Click "Clear Recent" → both sections vanish.

- [ ] **Step 4: Final commit (if any manual fixes were needed)**

```bash
git add -A
git commit -m "test(§82): verify recent-items menu end-to-end"
```

---

## Self-Review

**Spec coverage:**
- "+' 메뉴에 최근 폴더/파일 노출" → Task 6. ✓
- "통합 리스트 + vault 뱃지" → Task 1 (`isVault`), Task 2 (wiring), Task 6 (badge + context-store fallback). ✓
- "유효하지 않은 경로 → 클릭 시 자동 제거 + 토스트" → Task 5. ✓
- "최근 항목 지우기" → Task 1 (`clearRecent`), Task 6 (UI). ✓
- "공유 훅/로직, File 메뉴 후속 재사용" → Task 3 (`openFileByPath`), Task 5 (`recent-open`) are plain reusable modules. ✓
- "네이티브 File 메뉴 / recent vaults 별도 슬라이스" → out of scope, not planned. ✓

**Design deviation (intentional, noted for reviewer):** the design doc named a `useRecentOpen` hook and a vault *icon*. Implemented instead as (a) plain `recent-open.ts` module functions — no React needed, more testable, and reusable from the future native-menu event handler; (b) a text "Vault" **pill badge** rather than a distinct icon, because `Vault` is not an imported lucide icon in this repo (only `Folder`/`FileText` are confirmed), eliminating build risk. Same UX intent.

**Placeholder scan:** none — every code/test step contains full content.

**Type consistency:** `openFileByPath(string): Promise<void>`, `openRecentFolder`/`openRecentFile(string): Promise<void>`, `addRecentFolder(path, isVault?)`, `RecentFolderEntry.isVault?` — names/signatures match across Tasks 1, 3, 5, 6.
