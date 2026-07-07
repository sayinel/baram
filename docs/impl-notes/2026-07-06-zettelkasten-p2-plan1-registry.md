# Zettelkasten P2 — Plan 1: Space Registry + Journal Migration (A1–A3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce an internal data-driven space registry (`SpaceDefinition`), migrate the existing Journal space onto it without changing journal behavior, and register a scaffold Zettelkasten space (navigable vault with `inbox/`+`notes/`, config, settings, preset) — the foundation that Plan 2 (A4 features) builds on.

**Architecture:** A `src/spaces/` registry maps each `VaultType` to a `SpaceDefinition` describing space-level behavior (workspace layout, startup action, new-file flow, config folders, max instances). Journal and Zettelkasten both register through it. This is an **internal** registry, not the P3 plugin API. Journal migration is **behavior-preserving**: the full existing test suite is the regression gate for every seam.

**Tech Stack:** React 19 + TypeScript (strict), Zustand (`useShallow` selectors), Tauri 2 + Rust (serde), Vitest, cargo test.

**Design spec:** `docs/design/part13-zettelkasten-space.md` (§91–§99). This plan implements §92 (A1–A3) + §93/§99 scaffold + §13.11 settings. Plan 2 implements §94–§98 (A4).

## Global Constraints

- TypeScript strict mode; functional components + hooks only; filenames kebab-case; components/Extensions PascalCase, functions/hooks camelCase.
- Zustand: never bare `useStore()` in components — use `useShallow((s) => ({...}))` selectors.
- Single file ≤ ~300 lines (split >500); CSS files ≤ ~1,500 lines.
- Shared utils only — do not re-implement: `basename`/`dirname` (`src/utils/path-utils.ts`), journal date regex (`src/utils/journal/journal.ts`), `fuzzyMatch` (`src/utils/file-search.ts`), `RightPanelMode`/`SidebarPanel` types (`src/stores/ui/ui.ts`).
- Rust IPC returns `Result<T, String>`; custom errors via `thiserror`. Keep existing `#[serde(rename_all = "camelCase")]` on context enums.
- Conventional Commits, subject in lowercase imperative (commitlint `subject-case` rejects a capitalized/sentence-case subject). Keep `§` refs in commit subjects.
- Tests: `npm test` = `vitest run` (never `npx jest`). Rust: `cargo test`. Baseline before starting: **2642 passed | 6 skipped**, cargo green, `tsc --noEmit` clean.
- Data-preserving: never rewrite existing journal `.md` files; settings changes are key-additive with a version bump + migration.

---

## File Structure

**Created:**
- `src/spaces/types.ts` — `SpaceDefinition`, `SpaceLayout`, `SpaceStartupCtx` types.
- `src/spaces/registry.ts` — registry map + `registerSpace`/`getSpace`/`listSpaces`.
- `src/spaces/journal-space.ts` — Journal `SpaceDefinition`.
- `src/spaces/zettelkasten-space.ts` — Zettelkasten `SpaceDefinition`.
- `src/spaces/index.ts` — registers built-in spaces (imported once at app boot).
- `src/spaces/__tests__/registry.test.ts` — registry unit tests.
- `src/stores/settings/zettelkasten-settings.ts` — Zettelkasten settings slice.
- `src/utils/zettelkasten/zettelkasten.ts` — `resolveZettelDir`, `ensureZettelkastenScaffold` (folder init).
- `src/utils/zettelkasten/__tests__/zettelkasten.test.ts`.

**Modified:**
- `src-tauri/src/context/types.rs:17-20` — add `Zettelkasten` variant.
- `src/ipc/types.ts:403` — extend `VaultType` union.
- `src/stores/context/context.ts` — add `ensureSpaceContext`/`spaceContext`; `ensureJournalContext`/`journalContext` become thin wrappers.
- `src/stores/file/workspace.ts:49-166` — journal preset layout + open logic sourced from registry; add zettelkasten preset.
- `src/hooks/use-app-startup.ts:110-138` — journal startup branch delegates to `getSpace(...).startup`.
- `src/stores/settings/store.ts` — add zettelkasten slice to partialize + version bump + migration.
- `src/main.tsx` — import `./spaces` once (registers built-ins at boot).

---

## Task 1: Extend VaultType (Rust + TS)

**Files:**
- Modify: `src-tauri/src/context/types.rs:17-20`
- Modify: `src/ipc/types.ts:403`

**Interfaces:**
- Produces: Rust `VaultType::Zettelkasten` (serde `"zettelkasten"`); TS `VaultType = "general" | "journal" | "zettelkasten"`.

- [ ] **Step 1: Write the failing Rust test**

Append to `src-tauri/src/context/types.rs` (inside a `#[cfg(test)] mod tests` block; create the block if absent):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zettelkasten_serializes_camel_case() {
        let json = serde_json::to_string(&VaultType::Zettelkasten).unwrap();
        assert_eq!(json, "\"zettelkasten\"");
        let parsed: VaultType = serde_json::from_str("\"zettelkasten\"").unwrap();
        assert_eq!(parsed, VaultType::Zettelkasten);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test zettelkasten_serializes_camel_case`
Expected: FAIL — `no variant named Zettelkasten`.

- [ ] **Step 3: Add the variant**

`src-tauri/src/context/types.rs` — change the enum:

```rust
pub enum VaultType {
    General,
    Journal,
    Zettelkasten,
}
```

- [ ] **Step 4: Run Rust test to verify it passes**

Run: `cd src-tauri && cargo test zettelkasten_serializes_camel_case`
Expected: PASS.

- [ ] **Step 5: Extend the TS union**

`src/ipc/types.ts:403`:

```ts
export type VaultType = "general" | "journal" | "zettelkasten";
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (no new errors).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/context/types.rs src/ipc/types.ts
git commit -m "feat(zettelkasten §92): add Zettelkasten vault type (rust + ts)"
```

---

## Task 2: Space registry contract (A1)

**Files:**
- Create: `src/spaces/types.ts`
- Create: `src/spaces/registry.ts`
- Test: `src/spaces/__tests__/registry.test.ts`

**Interfaces:**
- Consumes: `VaultType` from `src/ipc/types.ts`; `RightPanelMode`/`SidebarPanel` from `src/stores/ui/ui.ts`.
- Produces:
  - `interface SpaceLayout { sidebarOpen: boolean; sidebarPanel: SidebarPanel; rightPanelOpen: boolean; rightPanelMode: RightPanelMode }`
  - `interface SpaceDefinition { type: VaultType; label: string; maxInstances: number | null; configFolders: string[]; layout: SpaceLayout; startup?: () => Promise<void>; newFileFlow?: () => Promise<{ path: string; content: string } | null> }`
  - `registerSpace(def: SpaceDefinition): void`
  - `getSpace(type: VaultType | undefined | null): SpaceDefinition | undefined`
  - `listSpaces(): SpaceDefinition[]`

- [ ] **Step 1: Write the failing test**

`src/spaces/__tests__/registry.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";

import { getSpace, listSpaces, registerSpace, __resetSpacesForTest } from "../registry";
import type { SpaceDefinition } from "../types";

const fake: SpaceDefinition = {
  type: "journal",
  label: "Journal",
  maxInstances: 1,
  configFolders: ["daily"],
  layout: { sidebarOpen: true, sidebarPanel: "calendar", rightPanelOpen: true, rightPanelMode: "memories" },
};

describe("space registry", () => {
  beforeEach(() => __resetSpacesForTest());

  it("registers and retrieves a space by type", () => {
    registerSpace(fake);
    expect(getSpace("journal")).toBe(fake);
  });

  it("returns undefined for unregistered or nullish types", () => {
    expect(getSpace("zettelkasten")).toBeUndefined();
    expect(getSpace(undefined)).toBeUndefined();
    expect(getSpace(null)).toBeUndefined();
  });

  it("lists all registered spaces", () => {
    registerSpace(fake);
    expect(listSpaces()).toEqual([fake]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/spaces/__tests__/registry.test.ts`
Expected: FAIL — cannot resolve `../registry`.

- [ ] **Step 3: Write the types**

`src/spaces/types.ts`:

```ts
import type { VaultType } from "../ipc/types";
import type { RightPanelMode, SidebarPanel } from "../stores/ui/ui";

export interface SpaceLayout {
  rightPanelMode: RightPanelMode;
  rightPanelOpen: boolean;
  sidebarOpen: boolean;
  sidebarPanel: SidebarPanel;
}

export interface SpaceDefinition {
  /** Folders to create under the vault root on first init (e.g. ["inbox","notes"]). */
  configFolders: string[];
  label: string;
  /** null = unlimited (general); 1 = at most one instance (journal, zettelkasten). */
  maxInstances: number | null;
  /** Sidebar/right-panel layout applied when this space's preset is opened. */
  layout: SpaceLayout;
  /** Create the space's "new note/file"; returns null if not applicable. */
  newFileFlow?: () => Promise<null | { content: string; path: string }>;
  /** App-startup action when this space is the active/restored context. */
  startup?: () => Promise<void>;
  type: VaultType;
}
```

- [ ] **Step 4: Write the registry**

`src/spaces/registry.ts`:

```ts
import type { VaultType } from "../ipc/types";
import type { SpaceDefinition } from "./types";

const spaces = new Map<VaultType, SpaceDefinition>();

export function registerSpace(def: SpaceDefinition): void {
  spaces.set(def.type, def);
}

export function getSpace(
  type: null | undefined | VaultType,
): SpaceDefinition | undefined {
  if (!type) return undefined;
  return spaces.get(type);
}

export function listSpaces(): SpaceDefinition[] {
  return [...spaces.values()];
}

/** Test-only: clear the registry between tests. */
export function __resetSpacesForTest(): void {
  spaces.clear();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/spaces/__tests__/registry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/spaces/types.ts src/spaces/registry.ts src/spaces/__tests__/registry.test.ts
git commit -m "feat(zettelkasten §92): add internal space registry contract"
```

---

## Task 3: Journal SpaceDefinition + boot registration

**Files:**
- Create: `src/spaces/journal-space.ts`
- Create: `src/spaces/index.ts`
- Modify: `src/main.tsx` (add `import "./spaces";` near other side-effect imports)
- Test: extend `src/spaces/__tests__/registry.test.ts`

**Interfaces:**
- Consumes: `registerSpace`, `SpaceDefinition`; existing `ensureJournalFile` (`src/services/journal-file-service.ts`), `resolveJournalDir` (`src/utils/journal/journal.ts`), `useSettingsStore`, `useFileStore`, `openFileInTab`.
- Produces: `journalSpace: SpaceDefinition` (type `"journal"`). The layout values below are copied verbatim from the current journal preset at `src/stores/file/workspace.ts:54-59` — keep them identical.

- [ ] **Step 1: Write the failing test**

Append to `src/spaces/__tests__/registry.test.ts`:

```ts
import { journalSpace } from "../journal-space";

describe("journal space definition", () => {
  beforeEach(() => __resetSpacesForTest());

  it("matches the existing journal preset layout (behavior-preserving)", () => {
    expect(journalSpace.type).toBe("journal");
    expect(journalSpace.maxInstances).toBe(1);
    expect(journalSpace.configFolders).toEqual(["daily"]);
    expect(journalSpace.layout).toEqual({
      sidebarOpen: true,
      sidebarPanel: "calendar",
      rightPanelOpen: true,
      rightPanelMode: "memories",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/spaces/__tests__/registry.test.ts`
Expected: FAIL — cannot resolve `../journal-space`.

- [ ] **Step 3: Write the journal space definition**

`src/spaces/journal-space.ts` (the `startup`/`newFileFlow` bodies are moved verbatim from `workspace.ts:132-166` and `use-app-startup.ts:110-138` in Tasks 4–5; here define the object with the layout and a `newFileFlow` that wraps `ensureJournalFile`):

```ts
import { openFileInTab } from "../services/journal-file-service";
import { ensureJournalFile } from "../services/journal-file-service";
import { useFileStore } from "../stores/file/file";
import { useSettingsStore } from "../stores/settings/store";
import { resolveJournalDir } from "../utils/journal/journal";
import type { SpaceDefinition } from "./types";

export const journalSpace: SpaceDefinition = {
  type: "journal",
  label: "Journal",
  maxInstances: 1,
  configFolders: ["daily"],
  layout: {
    sidebarOpen: true,
    sidebarPanel: "calendar",
    rightPanelOpen: true,
    rightPanelMode: "memories",
  },
  newFileFlow: async () => {
    const {
      journalDirectory,
      journalFilenameFormat,
      journalTemplatePath,
      journalUseHierarchy,
    } = useSettingsStore.getState();
    const { rootPath } = useFileStore.getState();
    const resolvedDir = resolveJournalDir(rootPath, journalDirectory);
    if (!resolvedDir) return null;
    const result = await ensureJournalFile(new Date(), {
      journalDirectory,
      journalFilenameFormat,
      journalTemplatePath,
      journalUseHierarchy,
      rootPath: resolvedDir,
    });
    if (result) await openFileInTab(result.path, result.content);
    return result;
  },
};
```

- [ ] **Step 4: Write the boot registrar**

`src/spaces/index.ts`:

```ts
import { journalSpace } from "./journal-space";
import { registerSpace } from "./registry";

registerSpace(journalSpace);

export * from "./registry";
export * from "./types";
```

- [ ] **Step 5: Register at app boot**

`src/main.tsx` — add near the top-level imports (side-effect import):

```ts
import "./spaces";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/spaces/__tests__/registry.test.ts`
Expected: PASS.

- [ ] **Step 7: Full regression gate + typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: `tsc` clean; **2645 passed | 6 skipped** (baseline 2642 + 3 new registry tests + this task's test; exact +N may differ — the requirement is 0 failures and no drop below baseline).

- [ ] **Step 8: Commit**

```bash
git add src/spaces/journal-space.ts src/spaces/index.ts src/main.tsx src/spaces/__tests__/registry.test.ts
git commit -m "feat(zettelkasten §92): register journal as a SpaceDefinition"
```

---

## Task 4: Source workspace journal preset from the registry (A2)

**Files:**
- Modify: `src/stores/file/workspace.ts:132-166`
- Test: full suite regression gate (behavior-preserving)

**Interfaces:**
- Consumes: `getSpace` from `src/spaces`.
- Behavior contract: `applyPreset("journal")` must produce the **identical** layout + open-today-journal side effect as before.

- [ ] **Step 1: Replace the journal open logic with the registry newFileFlow**

`src/stores/file/workspace.ts` — inside `applyPreset`, the `if (id === "journal") { ... }` block (currently lines 132-166) becomes:

```ts
        // §85/§92 M2b: Journal preset — activate journal context + open today's file
        if (id === "journal") {
          const { journalEnabled, journalDirectory } =
            useSettingsStore.getState();
          const { rootPath } = useFileStore.getState();
          const resolvedDir = resolveJournalDir(rootPath, journalDirectory);
          if (journalEnabled && resolvedDir) {
            (async () => {
              try {
                await useContextStore
                  .getState()
                  .ensureJournalContext(resolvedDir);
                await getSpace("journal")?.newFileFlow?.();
                // File tree switch handled by contextStore subscription in file.ts
              } catch (err) {
                logger.error("[Workspace] Failed to open journal:", err);
              }
            })();
          }
        }
```

Add `import { getSpace } from "../../spaces";` to the imports.

- [ ] **Step 2: Run the workspace + journal tests**

Run: `npx vitest run src/stores/file src/utils/__tests__/journal.test.ts`
Expected: PASS, no regressions.

- [ ] **Step 3: Full regression gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: `tsc` clean; 0 failures, no drop below baseline.

- [ ] **Step 4: Manual GUI check (behavior-preserving)**

Run: `npm run tauri dev` (fully relaunch — WKWebView HMR is flaky). Verify: Command Palette → "Journal" preset opens the calendar sidebar + memories panel + today's journal file, exactly as before.

- [ ] **Step 5: Commit**

```bash
git add src/stores/file/workspace.ts
git commit -m "refactor(zettelkasten §92): source journal open flow from space registry"
```

---

## Task 5: Delegate app-startup journal branch to the registry (A2)

**Files:**
- Modify: `src/hooks/use-app-startup.ts:110-138`
- Test: full suite regression gate

**Interfaces:**
- Consumes: `getSpace`. Behavior contract: on launch with a restored journal context + `journalStartupBehavior === "openJournal"`, today's journal opens exactly as before.

- [ ] **Step 1: Move journal startup into journalSpace.startup**

Add a `startup` to `journalSpace` (`src/spaces/journal-space.ts`) that reproduces the current `use-app-startup.ts:113-138` guard + `ensureJournalContext`:

```ts
  startup: async () => {
    const existingJournal = useContextStore.getState().journalContext();
    if (!existingJournal) return;
    const { journalEnabled, journalStartupBehavior, journalDirectory } =
      useSettingsStore.getState();
    if (
      !journalEnabled ||
      journalStartupBehavior !== "openJournal" ||
      !journalDirectory
    )
      return;
    const resolvedDir = resolveJournalDir(
      useFileStore.getState().rootPath ?? "",
      journalDirectory,
    );
    if (!resolvedDir) return;
    try {
      await useContextStore.getState().ensureJournalContext(resolvedDir);
    } catch {
      /* non-fatal */
    }
  },
```

Add `import { useContextStore } from "../stores/context/context";` to `journal-space.ts`.

- [ ] **Step 2: Call the registry from use-app-startup**

`src/hooks/use-app-startup.ts` — replace the inline journal block (lines 110-138) with:

```ts
            // §85/§92 M2b: Journal startup behavior (registry-driven)
            await getSpace(
              useContextStore.getState().activeContext()?.vaultType,
            )?.startup?.();
```

Add `import { getSpace } from "../spaces";`. Remove the now-unused local journal imports **only if** nothing else in the file uses them (verify with the editor's unused-import lint).

- [ ] **Step 3: Full regression gate + typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean; 0 failures.

- [ ] **Step 4: Manual GUI check**

Fully relaunch `npm run tauri dev`. With journal enabled and previously active: on launch today's journal opens as before.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-app-startup.ts src/spaces/journal-space.ts
git commit -m "refactor(zettelkasten §92): drive journal startup via space registry"
```

---

## Task 6: Generalize context-ensure to any space (A2)

**Files:**
- Modify: `src/stores/context/context.ts` (`ensureJournalContext` ~152-170, `journalContext` ~123-126)
- Test: `src/stores/context/__tests__/context.test.ts` (create if absent) + regression gate

**Interfaces:**
- Produces:
  - `ensureSpaceContext(vaultType: VaultType, dir: string): Promise<ContextInfo>` — ensures a vault context of the given type exists at `dir` (creates+activates if missing).
  - `spaceContext(vaultType: VaultType): ContextInfo | null` — first context with that `vaultType`.
- Backward-compat: `ensureJournalContext(dir)` = `ensureSpaceContext("journal", dir)`; `journalContext()` = `spaceContext("journal")`. Existing call sites keep working unchanged.

- [ ] **Step 1: Write the failing test**

`src/stores/context/__tests__/context.test.ts` (add to existing describe or create). Test that `ensureJournalContext` delegates to `ensureSpaceContext("journal", …)` and `spaceContext("zettelkasten")` returns null when none exist:

```ts
import { describe, expect, it } from "vitest";
import { useContextStore } from "../context";

describe("space-generic context helpers", () => {
  it("spaceContext returns null when no vault of that type exists", () => {
    expect(useContextStore.getState().spaceContext("zettelkasten")).toBeNull();
  });
  it("journalContext equals spaceContext('journal')", () => {
    const s = useContextStore.getState();
    expect(s.journalContext()).toBe(s.spaceContext("journal"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/context/__tests__/context.test.ts`
Expected: FAIL — `spaceContext is not a function`.

- [ ] **Step 3: Add the generic helpers, keep journal wrappers**

`src/stores/context/context.ts` — add to the store type (near line 65-67) and implementation:

```ts
  // type block
  ensureSpaceContext: (vaultType: VaultType, dir: string) => Promise<ContextInfo>;
  spaceContext: (vaultType: VaultType) => ContextInfo | null;
```

```ts
  // implementation
  spaceContext: (vaultType) => {
    return (
      get().contexts.find(
        (c) => c.contextType === "vault" && c.vaultType === vaultType,
      ) ?? null
    );
  },
  ensureSpaceContext: async (vaultType, dir) => {
    const existing = get().contexts.find(
      (c) => c.contextType === "vault" && c.vaultType === vaultType,
    );
    if (existing) return existing;
    return get().addContext("vault", dir, { vaultType, label: vaultType });
  },
  journalContext: () => get().spaceContext("journal"),
  ensureJournalContext: (journalDir) =>
    get().ensureSpaceContext("journal", journalDir),
```

(Verify `addContext`'s options accept `{ vaultType, label }` — it does, per `context.ts:213`. Keep the journal-specific label/activation behavior identical; if `ensureJournalContext` had extra steps beyond `addContext`, preserve them inside `ensureSpaceContext`.)

- [ ] **Step 4: Run test + regression gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean; the two new tests PASS; 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/stores/context/context.ts src/stores/context/__tests__/context.test.ts
git commit -m "refactor(zettelkasten §92): generalize context-ensure to any vault type"
```

---

## Task 7: Zettelkasten settings slice + scaffold util (A3)

**Files:**
- Create: `src/stores/settings/zettelkasten-settings.ts`
- Create: `src/utils/zettelkasten/zettelkasten.ts`
- Create: `src/utils/zettelkasten/__tests__/zettelkasten.test.ts`
- Modify: `src/stores/settings/store.ts` (compose slice, partialize, version bump, migration)

**Interfaces:**
- Produces:
  - Settings keys: `zettelkastenEnabled: boolean`, `zettelkastenDirectory: string`, `zettelkastenStartupBehavior: "nothing" | "openInbox"`, `zettelkastenHomeNote: string`; plus setters `setZettelkasten*`.
  - `resolveZettelDir(rootPath: string | null, dir: string): string | null` — mirror of `resolveJournalDir`.
  - `ensureZettelkastenScaffold(rootPath: string): Promise<void>` — creates `inbox/` and `notes/` under root (idempotent), using `createDir` from `src/ipc/invoke`.

- [ ] **Step 1: Write the failing test**

`src/utils/zettelkasten/__tests__/zettelkasten.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../ipc/invoke", () => ({
  createDir: vi.fn().mockResolvedValue(undefined),
}));

import { createDir } from "../../../ipc/invoke";
import { ensureZettelkastenScaffold, resolveZettelDir } from "../zettelkasten";

describe("zettelkasten scaffold", () => {
  it("resolves an absolute dir against root", () => {
    expect(resolveZettelDir("/vault", "zettel")).toBe("/vault/zettel");
    expect(resolveZettelDir(null, "")).toBeNull();
  });

  it("creates inbox/ and notes/ under root", async () => {
    await ensureZettelkastenScaffold("/z");
    expect(createDir).toHaveBeenCalledWith("/z/inbox");
    expect(createDir).toHaveBeenCalledWith("/z/notes");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/zettelkasten/__tests__/zettelkasten.test.ts`
Expected: FAIL — cannot resolve `../zettelkasten`.

- [ ] **Step 3: Write the util**

`src/utils/zettelkasten/zettelkasten.ts`:

```ts
import { createDir } from "../../ipc/invoke";

/** Resolve the zettelkasten directory against the workspace root (mirror of resolveJournalDir). */
export function resolveZettelDir(
  rootPath: null | string,
  dir: string,
): null | string {
  if (!dir) return null;
  if (dir.startsWith("/")) return dir;
  if (!rootPath) return null;
  return `${rootPath}/${dir}`;
}

/** Create inbox/ and notes/ under the zettelkasten root (idempotent). */
export async function ensureZettelkastenScaffold(
  rootPath: string,
): Promise<void> {
  await createDir(`${rootPath}/inbox`);
  await createDir(`${rootPath}/notes`);
}
```

(If `resolveJournalDir`'s absolute-path logic differs, match it exactly — read `src/utils/journal/journal.ts` `resolveJournalDir` and mirror its algorithm so behavior is consistent across spaces.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/zettelkasten/__tests__/zettelkasten.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the settings slice**

`src/stores/settings/zettelkasten-settings.ts` (mirror the shape of `journal-settings.ts`):

```ts
import type { StateCreator } from "zustand";

export interface ZettelkastenSettingsSlice {
  zettelkastenDirectory: string;
  zettelkastenEnabled: boolean;
  zettelkastenHomeNote: string;
  zettelkastenStartupBehavior: ZettelStartupBehavior;
  setZettelkastenDirectory: (dir: string) => void;
  setZettelkastenEnabled: (enabled: boolean) => void;
  setZettelkastenHomeNote: (path: string) => void;
  setZettelkastenStartupBehavior: (b: ZettelStartupBehavior) => void;
}

type ZettelStartupBehavior = "nothing" | "openInbox";

export const createZettelkastenSettingsSlice: StateCreator<
  ZettelkastenSettingsSlice,
  [],
  [],
  ZettelkastenSettingsSlice
> = (set) => ({
  zettelkastenEnabled: false,
  zettelkastenDirectory: "",
  zettelkastenStartupBehavior: "openInbox",
  zettelkastenHomeNote: "",
  setZettelkastenEnabled: (zettelkastenEnabled) => set({ zettelkastenEnabled }),
  setZettelkastenDirectory: (zettelkastenDirectory) =>
    set({ zettelkastenDirectory }),
  setZettelkastenStartupBehavior: (zettelkastenStartupBehavior) =>
    set({ zettelkastenStartupBehavior }),
  setZettelkastenHomeNote: (zettelkastenHomeNote) =>
    set({ zettelkastenHomeNote }),
});
```

- [ ] **Step 6: Compose the slice + persist + migrate in store.ts**

`src/stores/settings/store.ts`:
1. Import and spread `createZettelkastenSettingsSlice(set, get, api)` into the store creator (follow how `createJournalSettingsSlice` is composed).
2. Add to `partialize`:
   ```ts
   zettelkastenEnabled: state.zettelkastenEnabled,
   zettelkastenDirectory: state.zettelkastenDirectory,
   zettelkastenStartupBehavior: state.zettelkastenStartupBehavior,
   zettelkastenHomeNote: state.zettelkastenHomeNote,
   ```
3. Bump `version: 13` → `version: 14`.
4. Add migration (key-additive, data-preserving):
   ```ts
   // v13 → v14: Zettelkasten space settings (§92). Additive; disabled by default.
   if (version < 14) {
     if (state.zettelkastenEnabled === undefined) state.zettelkastenEnabled = false;
     if (state.zettelkastenDirectory === undefined) state.zettelkastenDirectory = "";
     if (state.zettelkastenStartupBehavior === undefined)
       state.zettelkastenStartupBehavior = "openInbox";
     if (state.zettelkastenHomeNote === undefined) state.zettelkastenHomeNote = "";
   }
   ```

- [ ] **Step 7: Typecheck + full regression gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean; 0 failures (settings persist/migration tests still green).

- [ ] **Step 8: Commit**

```bash
git add src/stores/settings/zettelkasten-settings.ts src/stores/settings/store.ts src/utils/zettelkasten/
git commit -m "feat(zettelkasten §92): add zettelkasten settings slice + scaffold util"
```

---

## Task 8: Register the Zettelkasten SpaceDefinition (A3)

**Files:**
- Create: `src/spaces/zettelkasten-space.ts`
- Modify: `src/spaces/index.ts` (register it)
- Test: extend `src/spaces/__tests__/registry.test.ts`

**Interfaces:**
- Consumes: `registerSpace`, `resolveZettelDir`, `ensureZettelkastenScaffold`, `useContextStore`, `useSettingsStore`, `useFileStore`.
- Produces: `zettelkastenSpace: SpaceDefinition` (type `"zettelkasten"`, layout = files sidebar + backlinks right panel, `configFolders: ["inbox","notes"]`, `maxInstances: 1`). `startup` opens the home note (or does nothing if unset — inbox navigation is Plan 2). `newFileFlow` is defined in Plan 2 (A4); omit here (optional field).

- [ ] **Step 1: Write the failing test**

Append to `src/spaces/__tests__/registry.test.ts`:

```ts
import { zettelkastenSpace } from "../zettelkasten-space";

describe("zettelkasten space definition", () => {
  it("declares a single global space with inbox/notes folders", () => {
    expect(zettelkastenSpace.type).toBe("zettelkasten");
    expect(zettelkastenSpace.maxInstances).toBe(1);
    expect(zettelkastenSpace.configFolders).toEqual(["inbox", "notes"]);
    expect(zettelkastenSpace.layout.sidebarPanel).toBe("files");
    expect(zettelkastenSpace.layout.rightPanelMode).toBe("backlinks");
  });
});
```

Note: confirm `"backlinks"` is a valid `RightPanelMode` in `src/stores/ui/ui.ts`. Per the current type, `RightPanelMode = "chat" | "help" | "memories" | "none" | "photo-gallery" | "properties"` — **it is NOT**. Backlinks is a `SidebarPanel` (`activity-bar-config.ts` lists `backlinks` as a top/sidebar item). So the zettelkasten right panel cannot be "backlinks". Set `rightPanelMode: "none"` and put `backlinks` in the **sidebar** instead: `sidebarPanel: "backlinks"`. Update the test accordingly:

```ts
    expect(zettelkastenSpace.layout.sidebarPanel).toBe("backlinks");
    expect(zettelkastenSpace.layout.rightPanelMode).toBe("none");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/spaces/__tests__/registry.test.ts`
Expected: FAIL — cannot resolve `../zettelkasten-space`.

- [ ] **Step 3: Write the zettelkasten space definition**

`src/spaces/zettelkasten-space.ts`:

```ts
import { useContextStore } from "../stores/context/context";
import { useFileStore } from "../stores/file/file";
import { useSettingsStore } from "../stores/settings/store";
import { resolveZettelDir } from "../utils/zettelkasten/zettelkasten";
import type { SpaceDefinition } from "./types";

export const zettelkastenSpace: SpaceDefinition = {
  type: "zettelkasten",
  label: "Zettelkasten",
  maxInstances: 1,
  configFolders: ["inbox", "notes"],
  layout: {
    sidebarOpen: true,
    sidebarPanel: "backlinks",
    rightPanelOpen: false,
    rightPanelMode: "none",
  },
  startup: async () => {
    const existing = useContextStore.getState().spaceContext("zettelkasten");
    if (!existing) return;
    const { zettelkastenEnabled, zettelkastenDirectory } =
      useSettingsStore.getState();
    if (!zettelkastenEnabled) return;
    const resolvedDir = resolveZettelDir(
      useFileStore.getState().rootPath ?? "",
      zettelkastenDirectory,
    );
    if (!resolvedDir) return;
    try {
      await useContextStore
        .getState()
        .ensureSpaceContext("zettelkasten", resolvedDir);
    } catch {
      /* non-fatal */
    }
  },
};
```

- [ ] **Step 4: Register it at boot**

`src/spaces/index.ts` — add:

```ts
import { zettelkastenSpace } from "./zettelkasten-space";
registerSpace(zettelkastenSpace);
```

- [ ] **Step 5: Run test + full regression gate + typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean; new test PASS; 0 failures.

- [ ] **Step 6: Commit**

```bash
git add src/spaces/zettelkasten-space.ts src/spaces/index.ts src/spaces/__tests__/registry.test.ts
git commit -m "feat(zettelkasten §93): register zettelkasten space definition"
```

---

## Task 9: Zettelkasten workspace preset + open command (A3)

**Files:**
- Modify: `src/stores/file/workspace.ts` (add zettelkasten preset built-in; source layout from `getSpace`)
- Modify: `src/components/command/CommandPalette.tsx` (add "Open Zettelkasten" command)
- Test: full suite regression gate + workspace test

**Interfaces:**
- Consumes: `getSpace("zettelkasten")`, `ensureSpaceContext`, `ensureZettelkastenScaffold`, `resolveZettelDir`.
- Behavior: `applyPreset("zettelkasten")` applies the zettel layout, ensures the zettel context (creating scaffold folders on first open), and switches to it.

- [ ] **Step 1: Add the built-in zettelkasten preset**

`src/stores/file/workspace.ts` — add to the `BUILTIN_PRESETS` array (after the journal preset, ~line 60), pulling the layout from the registry to avoid drift:

```ts
  {
    id: "zettelkasten",
    name: "Zettelkasten",
    description: "Open the Zettelkasten space (notes + inbox + backlinks).",
    builtIn: true,
    layout: getSpace("zettelkasten")?.layout ?? {
      sidebarOpen: true,
      sidebarPanel: "backlinks",
      rightPanelOpen: false,
      rightPanelMode: "none",
    },
  },
```

- [ ] **Step 2: Handle the zettelkasten open branch in applyPreset**

`src/stores/file/workspace.ts` — after the `if (id === "journal")` block, add:

```ts
        // §93 Zettelkasten preset — activate context + ensure scaffold folders
        if (id === "zettelkasten") {
          const { zettelkastenEnabled, zettelkastenDirectory } =
            useSettingsStore.getState();
          const { rootPath } = useFileStore.getState();
          const resolvedDir = resolveZettelDir(rootPath, zettelkastenDirectory);
          if (zettelkastenEnabled && resolvedDir) {
            (async () => {
              try {
                await ensureZettelkastenScaffold(resolvedDir);
                await useContextStore
                  .getState()
                  .ensureSpaceContext("zettelkasten", resolvedDir);
                await getSpace("zettelkasten")?.startup?.();
              } catch (err) {
                logger.error("[Workspace] Failed to open zettelkasten:", err);
              }
            })();
          }
        }
```

Add imports: `resolveZettelDir`, `ensureZettelkastenScaffold` from `../../utils/zettelkasten/zettelkasten`.

- [ ] **Step 3: Add the Command Palette entry**

`src/components/command/CommandPalette.tsx` — near the existing journal preset command (~line 606), add:

```tsx
    {
      id: "space.zettelkasten",
      label: "Open Zettelkasten",
      action: () => useWorkspaceStore.getState().applyPreset("zettelkasten"),
    },
```

(Match the exact shape of the surrounding command objects — copy the neighboring journal command's fields verbatim and change `id`/`label`/preset arg.)

- [ ] **Step 4: Typecheck + full regression gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean; 0 failures, no drop below baseline.

- [ ] **Step 5: Manual GUI smoke test**

Fully relaunch `npm run tauri dev`. Manually set (via a temp settings edit or the future Vault tab) `zettelkastenEnabled=true` + a `zettelkastenDirectory`. Command Palette → "Open Zettelkasten": verify the space opens, `inbox/` and `notes/` are created on disk, and the layout matches (backlinks sidebar). Verify "Journal" preset still works unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/stores/file/workspace.ts src/components/command/CommandPalette.tsx
git commit -m "feat(zettelkasten §93): add zettelkasten workspace preset + open command"
```

---

## Self-Review

- **Spec coverage (§92 A1–A3, §93 scaffold, §13.11 settings):** registry contract (T2) ✓; VaultType (T1) ✓; journal migrated onto registry — preset (T4), startup (T5), context-ensure (T6) ✓; zettelkasten registered + settings + scaffold + preset + open command (T7–T9) ✓. **A4 features (§94–§98: ID gen, note creation, B-scheme links + resolver, inbox/promote, MOC, capture migration, activity bar/UI) are Plan 2 — intentionally out of scope here.**
- **Behavior-preservation gate:** every journal-migration task (T4–T6) ends with `npx vitest run` (no drop below baseline) + a manual GUI check. R1 (journal regression) mitigated as specified in the spec.
- **Type consistency:** `getSpace`/`registerSpace`/`listSpaces`/`ensureSpaceContext`/`spaceContext`/`SpaceDefinition`/`SpaceLayout` names are used identically across tasks. Corrected `RightPanelMode` misuse in T8 (backlinks is a `SidebarPanel`, not a `RightPanelMode`) — zettel uses `sidebarPanel: "backlinks"`, `rightPanelMode: "none"`.
- **No placeholders:** all steps carry real code/commands. Two explicit "verify against current code" notes (T6 `addContext` options, T7 `resolveJournalDir` algorithm) are correctness checks, not deferred work.

## Open dependencies for Plan 2 (A4)

- Vault tab UI to set `zettelkastenEnabled` + pick `zettelkastenDirectory` + onboarding (spec O3) — Plan 2 or a small follow-up.
- `newFileFlow` for zettelkasten (ID gen + `notes/{id} {title}.md`) — Plan 2 (§94).
- B-scheme links (resolver + autocomplete + B2 + live title) — Plan 2 (§95).
