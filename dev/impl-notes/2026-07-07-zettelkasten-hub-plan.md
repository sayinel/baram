# Zettel Hub Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Zettel hub — a Zettel-space-only sidebar panel (Actions + Inbox queue + MOCs + Recent) plus an enriched shared title/promote dialog — so idea capture, inbox processing, and note creation are discoverable and fast.

**Architecture:** New `SidebarPanel` value `"zettel"` renders a `ZettelHubPanel` component (mirrors how `"calendar"` renders `CalendarPanel` for Journal). Data comes from existing sources: `listDir` (`modifiedAt`, `isDir`), `useZettelIndexStore` (id↔title↔path), and `getFilesByTag(dir, "moc")`. The shared `ZettelTitleDialog` gains per-action context (title/description/confirmLabel) + a Promote smart-default title. All actions reuse the existing `zettelkasten.*` keybinding actions and `openQuickCapture` — single source of truth.

**Tech Stack:** React 19 + TypeScript (strict), Zustand (`useShallow` selectors), Tiptap, lucide-react icons, CSS in `src/styles/`, Vitest + Testing Library.

**Design ref:** `dev/design/part14-zettelkasten-hub-panel.md` (§100–§103). Read it for rationale.

## Global Constraints

- Display name is **"Zettel"**; internal identity stays `zettelkasten` (vaultType, `zettel-*` files, `[[id]]` index, config keys, dir names). Only user-visible strings say "Zettel".
- The hub renders **only in the Zettel space** (never in other spaces / general vaults). Keep Baram lightweight.
- Zustand: components MUST use `useShallow((s) => ({...}))` selectors — no bare `useStore()`.
- Single file ≤ ~300 lines; CSS file ≤ ~1,500 lines. Split if exceeded.
- Reuse existing actions: hub buttons call `getAction("zettelkasten.newNote"|"newMoc"|"promote"|"newFromSelection")` and `useUIStore.getState().openQuickCapture()`. Do NOT re-implement note creation.
- Shared utilities only: `basename`/`dirname` → `src/utils/path-utils.ts`; zettel id/title parsing → `src/utils/zettelkasten/parse-note-title.ts` (`isZettelId`, `extractLeadingId`, `parseNoteTitle`).
- i18n: user-facing strings go through `t(key, locale)` with keys added to `src/i18n/en.json` + `src/i18n/ko.json`.
- Run the full suite (`npm test`) after each task; keep it green (baseline: 2735 passed | 6 skipped). `tsc --noEmit`, `npx eslint`, and (only if touched) `npx stylelint` must be clean.

## Existing Interfaces (verified — consume, don't recreate)

- `SidebarPanel` union — `src/stores/ui/ui.ts` (canonical). `useUIStore` exposes `sidebarPanel`, `setSidebarPanel`, `sidebarOpen`, `toggleSidebar`, `showToast`.
- `Sidebar.tsx` renders `{sidebarPanel === "files" && <FileTree />}` … one line per panel (around lines 74–85).
- `ActivityBar.tsx`: top icons come from `PANEL_ICONS: {id: SidebarPanel; label; icon}[]`, filtered by `activityBarConfig` (settings). `handlePanelClick(id)` toggles/sets the panel.
- `activityBarConfig` — persisted in `useSettingsStore` (settings version currently **14**). Adding a default item needs a version bump + migration to inject it for existing users.
- `listDir(path, recursive?)` → `DirEntry[]` where `DirEntry = { name, path, isDir, modifiedAt: number }` (`src/ipc/types.ts`).
- `getFilesByTag(rootPath, tag)` → `Promise<string[]>` (relative paths) — `src/ipc/tag.ts`.
- `useZettelIndexStore` — `src/stores/zettelkasten/zettel-index.ts`: `{ byId: Record<id,{id,path,title}>, titleForId(id), refreshZettelIndex(dir), removeByPath(path), upsert(...) }`.
- `resolveZettelDir(rootPath, dir)` → absolute dir or null — `src/utils/zettelkasten/zettelkasten.ts`.
- `openFileInTab(path, content)` — `src/services/journal-file-service.ts`.
- Zettel actions live in `src/hooks/use-keybinding-actions.ts` (`zettelkasten.newNote/promote/newFromSelection/newMoc`); the shared dialog is `useUIStore` `zettelTitleDialog` + `openZettelTitleDialog` + `<ZettelTitleDialog/>` (`src/components/journal/ZettelTitleDialog.tsx`).

---

## Task 1: `SidebarPanel "zettel"` + hub stub + routing

**Files:**
- Modify: `src/stores/ui/ui.ts` (add `"zettel"` to `SidebarPanel`)
- Modify: `src/spaces/zettelkasten-space.ts` (`layout.sidebarPanel: "files"` → `"zettel"`)
- Create: `src/components/zettelkasten/ZettelHubPanel.tsx` (stub for now)
- Modify: `src/components/layout/Sidebar.tsx` (render `<ZettelHubPanel/>` when `sidebarPanel === "zettel"`)
- Modify: `src/components/layout/ActivityBar.tsx` (add `zettel` to `PANEL_ICONS`, `StickyNote` icon)
- Modify: settings store activity-bar config default + migration (find the default `activityBarConfig` and version bump 14→15, inject `{id:"zettel", section:"top", visible:true}` if missing)
- Test: `src/components/zettelkasten/__tests__/ZettelHubPanel.test.tsx`

**Interfaces:**
- Produces: `SidebarPanel` now includes `"zettel"`; `<ZettelHubPanel/>` default export-free named export `export function ZettelHubPanel()`.

- [ ] **Step 1: Write the failing test** — hub stub renders when zettel space is configured.

```tsx
// src/components/zettelkasten/__tests__/ZettelHubPanel.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../ipc/invoke", () => ({
  listDir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(""),
  deleteFile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../ipc/tag", () => ({ getFilesByTag: vi.fn().mockResolvedValue([]) }));

import { useFileStore } from "../../../stores/file/file";
import { useSettingsStore } from "../../../stores/settings/store";
import { ZettelHubPanel } from "../ZettelHubPanel";

describe("ZettelHubPanel", () => {
  it("renders the Actions bar (New / Capture / MOC)", () => {
    useSettingsStore.getState().setZettelkastenEnabled(true);
    useSettingsStore.getState().setZettelkastenDirectory("/vault/zettel");
    useFileStore.getState().setRootPath("/vault");
    render(<ZettelHubPanel />);
    expect(screen.getByRole("button", { name: /new zettel/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /capture/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test → FAIL** (`ZettelHubPanel` not found).
  Run: `npx vitest run src/components/zettelkasten/__tests__/ZettelHubPanel.test.tsx`

- [ ] **Step 3: Add `"zettel"` to `SidebarPanel`** in `src/stores/ui/ui.ts` (the union type). Keep the union sorted if it is.

- [ ] **Step 4: Create the stub `ZettelHubPanel`** with just the Actions bar (Inbox/MOC/Recent added in Task 4):

```tsx
// src/components/zettelkasten/ZettelHubPanel.tsx
import { FileText, Map, Zap } from "lucide-react";

import { getAction } from "../../hooks/use-keybinding-actions"; // or the registry accessor used elsewhere
import { useUIStore } from "../../stores/ui/ui";
import "../../styles/zettelkasten.css";

export function ZettelHubPanel() {
  return (
    <div className="zettel-hub">
      <div className="zettel-hub-actions">
        <button onClick={() => getAction("zettelkasten.newNote")?.()} title="New Zettel (⇧⌘V)">
          <FileText size={14} /> New
        </button>
        <button onClick={() => useUIStore.getState().openQuickCapture()} title="Quick Capture (⇧⌘N)">
          <Zap size={14} /> Capture
        </button>
        <button onClick={() => getAction("zettelkasten.newMoc")?.()} title="New MOC (⇧⌘C)">
          <Map size={14} /> MOC
        </button>
      </div>
      {/* Inbox / MOCs / Recent sections added in Task 4 */}
    </div>
  );
}
```

> Verify the exact accessor for keybinding actions (`getAction`) — check how `CommandPalette.tsx` calls `getAction("zettelkasten.newNote")?.()` and import from the same module.

- [ ] **Step 5: Create `src/styles/zettelkasten.css`** with minimal `.zettel-hub` / `.zettel-hub-actions` styles (flex column; action row) using design tokens (`--color-*`, `.btn-unstyled`/`.icon-btn` where appropriate). Add `@import "./zettelkasten.css";` to `src/styles/index.css`.

- [ ] **Step 6: Render in `Sidebar.tsx`** — add `{sidebarPanel === "zettel" && <ZettelHubPanel />}` alongside the others; import `ZettelHubPanel`.

- [ ] **Step 7: ActivityBar** — add `{ id: "zettel", label: "Zettel", icon: <StickyNote {...ICON_PROPS} /> }` to `PANEL_ICONS` (import `StickyNote`).

- [ ] **Step 8: Default activity-bar config + migration** — locate the default `activityBarConfig` in the settings store; add `{ id: "zettel", section: "top", visible: true }` (place after `calendar`/`tags`). Bump settings version 14→15 with a migration that appends the `zettel` entry to any persisted `activityBarConfig` lacking it. Follow the existing migration pattern in the settings store.

- [ ] **Step 9: Space layout** — in `src/spaces/zettelkasten-space.ts`, change `layout.sidebarPanel` from `"files"` to `"zettel"`.

- [ ] **Step 10: Run tests → PASS**, then `tsc --noEmit`, `eslint`, `stylelint src/styles/zettelkasten.css`, and full `npm test`.

- [ ] **Step 11: Commit** — `feat(zettel §100): add zettel sidebar panel + hub stub + activity-bar item`

---

## Task 2: Enriched shared title/promote dialog (§102)

**Files:**
- Modify: `src/stores/ui/ui.ts` (`zettelTitleDialog` state + `openZettelTitleDialog` signature)
- Modify: `src/components/journal/ZettelTitleDialog.tsx` (render title/description/confirmLabel)
- Modify: `src/hooks/use-keybinding-actions.ts` (4 callers pass context; promote prefill)
- Modify: `src/i18n/en.json`, `src/i18n/ko.json` (dialog strings)
- Test: `src/components/journal/__tests__/ZettelTitleDialog.test.tsx` (new)

**Interfaces:**
- Produces:
```ts
openZettelTitleDialog(opts: {
  onSubmit: (title: string) => void;
  title: string;         // header
  confirmLabel: string;  // confirm button
  initialTitle?: string;
  description?: string;
}): void
```
State shape gains `title: string; description?: string; confirmLabel: string`.

- [ ] **Step 1: Failing test** — dialog shows the action's title + confirm label; Promote prefills the first body line.

```tsx
// asserts: opening with { title: "Promote to Permanent Note", confirmLabel: "Promote", initialTitle: "First line" }
// renders that header, that button text, and the input value "First line".
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Extend state + signature** in `ui.ts`:
```ts
zettelTitleDialog: { open: boolean; onSubmit: ((t: string) => void) | null; initialTitle: string; title: string; description?: string; confirmLabel: string };
// default: { open:false, onSubmit:null, initialTitle:"", title:"", confirmLabel:"Create" }
openZettelTitleDialog: (opts) => set({ zettelTitleDialog: { open:true, onSubmit: opts.onSubmit, initialTitle: opts.initialTitle ?? "", title: opts.title, description: opts.description, confirmLabel: opts.confirmLabel } }),
```

- [ ] **Step 4: Render** in `ZettelTitleDialog.tsx` — a header (`dialog.title`), optional description (`dialog.description`), input, and confirm button labeled `dialog.confirmLabel`. Keep IME guard, Enter/Escape, autoFocus.

- [ ] **Step 5: Update 4 callers** in `use-keybinding-actions.ts` to the new opts object (values per part14 §102 table). For `zettelkasten.promote`, read the fleeting file, `stripFrontmatter`, take the first non-empty line as `initialTitle`.

- [ ] **Step 6: i18n** — add `zettel.dialog.newNote.title`, `.promote.title`, `.fromSelection.title`, `.moc.title` (+ `.desc`, `.confirm`) to en/ko (or inline plain strings if consistent with the file; prefer i18n).

- [ ] **Step 7: Fix existing tests** — the current `ZettelTitleDialog` has no title/description; update any test that renders it. Run affected tests → PASS.

- [ ] **Step 8: Full verify + Commit** — `feat(zettel §102): per-action context + promote smart title in shared dialog`

---

## Task 3: Hub data layer (inbox / recent / MOCs)

**Files:**
- Create: `src/components/zettelkasten/use-zettel-hub-data.ts` (hook) OR `src/utils/zettelkasten/hub-data.ts` (pure derivations) + a small hook
- Modify: `src/utils/zettelkasten/parse-note-title.ts` if a `firstBodyLine` helper belongs there (else keep local)
- Test: `src/utils/zettelkasten/__tests__/hub-data.test.ts`

**Interfaces:**
- Produces:
```ts
interface ZettelHubData {
  inbox: { id: string; path: string; title: string; tags: string[] }[]; // newest first
  mocs: { path: string; title: string }[];
  recent: { path: string; title: string }[]; // by modifiedAt desc, top 7
  loading: boolean;
  refresh: () => Promise<void>;
}
function useZettelHubData(zettelDir: string | null): ZettelHubData;
// pure helpers:
function firstBodyLine(md: string): string; // strip frontmatter, first non-empty line, "" if none
function recentFromEntries(entries: DirEntry[], limit: number): {path:string;title:string}[];
```

- [ ] **Step 1: Failing tests** for pure helpers:
  - `firstBodyLine("---\nid: 1\n---\n\n# Hello\nbody")` → `"# Hello"` (or `"Hello"` — decide: strip leading `#`? Keep raw first line, trimmed).
  - `recentFromEntries` sorts by `modifiedAt` desc, filters `.md`, drops dirs, takes `limit`, derives title from filename via `parseNoteTitle`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the pure helpers + `useZettelHubData` (reads `listDir(dir/inbox)` for inbox, `listDir(dir/notes)` for recent, `getFilesByTag(dir,"moc")` for MOCs; inbox titles via `firstBodyLine(readFile(...))`, fallback to id; MOC/recent titles via index/`parseNoteTitle`). Guard on `zettelDir` null.
- [ ] **Step 4: Run → PASS**, full verify.
- [ ] **Step 5: Commit** — `feat(zettel §103): hub data hook (inbox/recent/MOCs)`

---

## Task 4: Hub panel sections + interactions

**Files:**
- Modify: `src/components/zettelkasten/ZettelHubPanel.tsx` (Inbox queue + MOCs + Recent; collapsible)
- Optionally split: `src/components/zettelkasten/ZettelInboxList.tsx`, `ZettelSectionList.tsx` if the file nears ~300 lines
- Modify: `src/styles/zettelkasten.css`
- Modify: `src/stores/ui/ui.ts` if persisting collapsed-section state (optional; a local `useState` is acceptable)
- Test: extend `ZettelHubPanel.test.tsx`

**Interfaces:**
- Consumes Task 2 (dialog), Task 3 (`useZettelHubData`).

- [ ] **Step 1: Failing tests** — with mocked data: `INBOX (2)` badge + 2 items render; clicking an item opens it (`openFileInTab` mock); empty inbox shows the capture hint; a MOC and a recent item render.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement sections** per part14 §101: Inbox (badge, first-line title + ≤2 tag pills, hover `↑ Promote` / `✕ Delete`, click = open), MOCs, Recent; collapsible headers. `↑` opens the enriched Promote dialog (Task 2) prefilled with the note's first line, then calls `promoteFleeting`; `✕` confirms then `deleteFile` + `useZettelIndexStore.removeByPath` + `refresh()`. Not-configured state shows a "set up Zettel" hint with a settings link. Use `useShallow` selectors.
- [ ] **Step 4: CSS** — section headers, inbox rows, hover actions, tag pills, empty state; tokens only.
- [ ] **Step 5: Run → PASS**, full verify (tsc/eslint/stylelint).
- [ ] **Step 6: Commit** — `feat(zettel §101): hub inbox queue + MOCs + recent sections`

---

## Task 5: Refresh integration + polish

**Files:**
- Modify: `src/components/zettelkasten/ZettelHubPanel.tsx` and/or the data hook (refresh on relevant events)
- Modify: `src/services/zettelkasten-service.ts` only if a lightweight change signal is needed (prefer NOT to; call `refresh()` from action completions or re-read on panel focus)
- Test: extend hub tests

- [ ] **Step 1: Decide the refresh trigger** — simplest reliable approach: the hub `refresh()`es on mount and when `useZettelIndexStore.byId` changes (subscribe/selector), since capture/promote/new all `upsert`/`removeByPath` the index. Add a test that an index change re-derives the lists. Avoid a new global event bus.
- [ ] **Step 2: Failing test** — after `useZettelIndexStore.upsert(...)`, the hub reflects the change (or after `refresh()`), and delete removes the row.
- [ ] **Step 3: Implement** — drive `refresh()` from an index-version selector (or `refresh()` after each in-panel action). Ensure promote/delete update both disk and index and then refresh.
- [ ] **Step 4: Run → PASS**, full verify.
- [ ] **Step 5: Commit** — `feat(zettel §101): refresh hub on capture/promote/delete`

---

## Final: whole-branch review + finish

- [ ] Dispatch the final code review (superpowers:requesting-code-review) over `main..feature/zettelkasten-hub`.
- [ ] Address Critical/Important findings.
- [ ] Update docs if the hub changes any user-facing shortcut/flow (README + `docs/user-guide.md` "Zettel" section already describe capture/promote/link/MOC; add a short "hub panel" note; part14 §14.5 lists the `components/journal/`→`components/zettelkasten/` move decision — resolve it).
- [ ] Full suite green; open PR with motivation, design (link part14), architecture, tests, checklist.

## Self-Review Notes (author)

- Spec coverage: §100 (Task 1), §101 (Tasks 4–5), §102 (Task 2), §103 (Task 3). ✓
- Open decisions to resolve during execution: (a) `components/journal/` → `components/zettelkasten/` move for `ZettelTitleDialog`/`QuickCaptureDialog` — recommend deferring to keep this branch focused, note it; (b) whether activity-bar `zettel` item is always-present (chosen: yes, like `calendar`/`skills-gallery`) vs space-conditional (rejected: config model is a flat visible list).
- Risk: settings migration (Task 1 Step 8) — must not drop user customizations; append-if-missing only. Verify with a persisted-config test if the settings store has one.
