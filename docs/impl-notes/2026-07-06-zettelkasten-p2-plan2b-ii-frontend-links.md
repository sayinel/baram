# Zettelkasten P2 — Plan 2b-ii: Frontend B-scheme links (§95, frontend)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `[[ID]]` links usable in the editor: a frontend id→title index so `WikilinkView` renders the current title (not the raw id), `[[` autocomplete searches by title and inserts `target=id`, manually-typed `[[title]]` normalizes to `[[id]]` (B2), a "New note from selection" command, and export that renders `[[id]]` as the title.

**Architecture:** A new Zustand `zettel-index` store maps `id → {path, title}`, refreshed from the zettel `notes/`+`inbox/` dirs. It is consulted by `WikilinkView` (render title), `wikilink-suggest` (autocomplete), the wikilink `InputRule`/paste (B2), New-from-selection, and the export pipeline. Every consumer is GATED so non-id links and non-zettel vaults behave exactly as before (frontend counterpart of 2b-i's R2 safety). The Rust resolver (Plan 2b-i) already makes `[[id]]` navigation + backlinks + graph work; this plan is purely the editor/authoring/display + export layer.

**Tech Stack:** React 19 + TS strict, Zustand (`useShallow`), Tiptap/ProseMirror, Vitest.

**Design spec:** `docs/design/part13-zettelkasten-space.md` §95 (B-scheme links) + §94 (New-from-selection). Prereqs landed: 2a (`createZettelNote`/`buildPermanentNote`/`ZettelTitleDialog`/settings/`resolveZettelDir`); 2b-i (Rust `[[id]]` resolve + backlinks). Deferred: §98 UI + §97 MOC (Plan 2c); YAML-title quoting M6 folded into Task 1 here (index reads frontmatter title robustly).

## Global Constraints

- TS strict; functional components + hooks only; kebab-case files; Zustand components use `useShallow` selectors.
- Single file ≤ ~300 lines. WKWebView: no window.prompt/alert/confirm.
- **Frontend R2 (critical):** every id-consulting path fires ONLY when the wikilink `target` is a bare id (`/^\d{12,14}$/`) AND the zettel index has it. For any other target, or when the zettel space is disabled, behavior is byte-for-byte unchanged. `WikilinkView` renders for EVERY wikilink in the app — do not regress `[[Architecture]]`, dates, cross-vault `alias::`, or `#heading`/`^blockId` links.
- Zettel id = `/^\d{12,14}$/`; note title source of truth = frontmatter `title:` → else filename title (`{id} {title}` → the part after the id) → else the id itself.
- Tests: `npm test` = `vitest run`. Baseline (branch): full suite currently 2645 passed | 6 skipped; tsc/eslint/knip clean; cargo 274.
- Conventional Commits, lowercase subject ≤100 chars, keep `§` refs.

---

## File Structure

**Created:**
- `src/stores/zettelkasten/zettel-index.ts` — `useZettelIndexStore` (id↔title↔path), `refreshZettelIndex`.
- `src/utils/zettelkasten/parse-note-title.ts` — `parseNoteTitle(filename, content)`; `isZettelId(s)`.
- `src/stores/zettelkasten/__tests__/zettel-index.test.ts`, `src/utils/zettelkasten/__tests__/parse-note-title.test.ts`.

**Modified:**
- `src/extensions/nodes/wikilink-view.tsx` — render index title for bare-id targets (gated).
- `src/extensions/plugins/wikilink-suggest.ts` + `wikilink-suggest-utils.ts` — zettel notes: search by title, insert `target=id`.
- `src/extensions/nodes/wikilink.ts` — B2 normalize in the InputRule handler.
- `src/services/zettelkasten-service.ts` — refresh the index after create/capture/promote; add `createNoteFromSelection` helper.
- `src/keybindings/keybinding-registry.ts` + `use-keybinding-actions.ts` + i18n — New-from-selection command.
- `src/pipeline/transformers/wikilink-transformer.ts` (or the export serializer) — id→title on export.
- refresh trigger wiring: `src/stores/file/workspace.ts` zettel open + `zettelkasten-service` write paths.

---

## Task 1: Note-title parser + id predicate

**Files:**
- Create: `src/utils/zettelkasten/parse-note-title.ts`
- Test: `src/utils/zettelkasten/__tests__/parse-note-title.test.ts`

**Interfaces:**
- Produces:
  - `isZettelId(s: string): boolean` — `/^\d{12,14}$/`.
  - `parseNoteTitle(filename: string, content: string): string` — frontmatter `title:` (first match, trimmed, unquoted if wrapped in matching quotes) → else the filename title (strip `.md`, strip leading `\d{12,14}` + one space) → else the id → else the bare filename stem. Handles M6: a quoted frontmatter title (`title: "a: b"`) unwraps to `a: b`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { isZettelId, parseNoteTitle } from "../parse-note-title";

describe("isZettelId", () => {
  it("matches 12-14 digit ids only", () => {
    expect(isZettelId("202607051530")).toBe(true);
    expect(isZettelId("20260705153012")).toBe(true);
    expect(isZettelId("2026")).toBe(false);
    expect(isZettelId("202607051530 x")).toBe(false);
    expect(isZettelId("architecture")).toBe(false);
  });
});

describe("parseNoteTitle", () => {
  it("prefers frontmatter title", () => {
    expect(
      parseNoteTitle("202607051530 원자적 노트.md", "---\nid: 202607051530\ntitle: 실제 제목\n---\n\n# x"),
    ).toBe("실제 제목");
  });
  it("unwraps a quoted frontmatter title", () => {
    expect(parseNoteTitle("202607051530.md", '---\ntitle: "TCP/IP: 정리"\n---\n')).toBe("TCP/IP: 정리");
  });
  it("falls back to filename title (id prefix stripped)", () => {
    expect(parseNoteTitle("202607051530 원자적 노트.md", "no frontmatter")).toBe("원자적 노트");
  });
  it("falls back to the id when only an id filename + no title", () => {
    expect(parseNoteTitle("202607051530.md", "just body")).toBe("202607051530");
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run src/utils/zettelkasten/__tests__/parse-note-title.test.ts`

- [ ] **Step 3: Implement**

```ts
export function isZettelId(s: string): boolean {
  return /^\d{12,14}$/.test(s);
}

export function parseNoteTitle(filename: string, content: string): string {
  // 1) frontmatter title:
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (fm) {
    const m = fm[1].match(/^title:\s*(.+?)\s*$/m);
    if (m) {
      let v = m[1].trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (v.length > 0) return v;
    }
  }
  // 2) filename title (strip .md, strip leading id + space)
  const stem = filename.replace(/\.(md|markdown)$/, "");
  const stripped = stem.replace(/^\d{12,14}\s+/, "");
  if (stripped.length > 0 && stripped !== stem) return stripped;
  // 3) bare id filename → the id itself; else the stem
  return stem;
}
```

- [ ] **Step 4: Run → PASS.** Same command.

- [ ] **Step 5: Commit**

```bash
git add src/utils/zettelkasten/parse-note-title.ts src/utils/zettelkasten/__tests__/parse-note-title.test.ts
git commit -m "feat(zettelkasten §95): note-title parser + zettel-id predicate"
```

---

## Task 2: Zettel index store (id ↔ title ↔ path)

**Files:**
- Create: `src/stores/zettelkasten/zettel-index.ts`
- Test: `src/stores/zettelkasten/__tests__/zettel-index.test.ts`

**Interfaces:**
- Consumes: `parseNoteTitle` (Task 1); IPC `listDir`/`readFile`; `resolveZettelDir`.
- Produces:
  - `interface ZettelNote { id: string; path: string; title: string }`
  - `useZettelIndexStore` with state `byId: Record<string, ZettelNote>` and actions `setAll(notes: ZettelNote[])`, `upsert(note: ZettelNote)`, `removeByPath(path: string)`, `clear()`.
  - selectors (plain fns, not hooks): `titleForId(id: string): string | undefined`, `idForTitle(title: string): string | null` (returns the id ONLY when exactly one note has that title case-insensitively; null if 0 or >1 — ambiguous).
  - `refreshZettelIndex(zettelDir: string): Promise<void>` — lists `notes/`+`inbox/`, reads each `.md`, builds `ZettelNote[]` via `parseNoteTitle` + the filename id-prefix, calls `setAll`.

- [ ] **Step 1: Write the failing test** (mock IPC)

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const listDir = vi.fn();
const readFile = vi.fn();
vi.mock("../../../ipc/invoke", () => ({ listDir, readFile }));

import {
  idForTitle,
  refreshZettelIndex,
  titleForId,
  useZettelIndexStore,
} from "../zettel-index";

describe("zettel index", () => {
  beforeEach(() => useZettelIndexStore.getState().clear());

  it("builds id→title from notes/ + inbox/ and resolves both directions", async () => {
    listDir.mockImplementation(async (dir: string) =>
      dir.endsWith("/notes")
        ? [{ name: "202607051530 원자적 노트.md", path: `${dir}/202607051530 원자적 노트.md` }]
        : [{ name: "202607051600.md", path: `${dir}/202607051600.md` }],
    );
    readFile.mockResolvedValue("no frontmatter");
    await refreshZettelIndex("/z");
    expect(titleForId("202607051530")).toBe("원자적 노트");
    expect(idForTitle("원자적 노트")).toBe("202607051530");
    expect(titleForId("202607051600")).toBe("202607051600"); // fleeting, no title
  });

  it("idForTitle returns null when ambiguous", () => {
    useZettelIndexStore.getState().setAll([
      { id: "1", path: "a", title: "dup" },
      { id: "2", path: "b", title: "dup" },
    ]);
    expect(idForTitle("dup")).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run src/stores/zettelkasten/__tests__/zettel-index.test.ts`

- [ ] **Step 3: Implement**

```ts
import { create } from "zustand";

import { listDir, readFile } from "../../ipc/invoke";
import { parseNoteTitle } from "../../utils/zettelkasten/parse-note-title";

export interface ZettelNote {
  id: string;
  path: string;
  title: string;
}

interface ZettelIndexState {
  byId: Record<string, ZettelNote>;
  clear: () => void;
  removeByPath: (path: string) => void;
  setAll: (notes: ZettelNote[]) => void;
  upsert: (note: ZettelNote) => void;
}

export const useZettelIndexStore = create<ZettelIndexState>((set) => ({
  byId: {},
  setAll: (notes) =>
    set({ byId: Object.fromEntries(notes.map((n) => [n.id, n])) }),
  upsert: (note) => set((s) => ({ byId: { ...s.byId, [note.id]: note } })),
  removeByPath: (path) =>
    set((s) => ({
      byId: Object.fromEntries(
        Object.entries(s.byId).filter(([, n]) => n.path !== path),
      ),
    })),
  clear: () => set({ byId: {} }),
}));

export function titleForId(id: string): string | undefined {
  return useZettelIndexStore.getState().byId[id]?.title;
}

export function idForTitle(title: string): null | string {
  const q = title.trim().toLowerCase();
  const matches = Object.values(useZettelIndexStore.getState().byId).filter(
    (n) => n.title.toLowerCase() === q,
  );
  return matches.length === 1 ? matches[0].id : null;
}

export async function refreshZettelIndex(zettelDir: string): Promise<void> {
  const notes: ZettelNote[] = [];
  for (const sub of ["notes", "inbox"]) {
    let entries: { name: string; path: string }[];
    try {
      entries = await listDir(`${zettelDir}/${sub}`, false);
    } catch {
      continue;
    }
    for (const e of entries) {
      const m = e.name.match(/^(\d{12,14})\b/);
      if (!m || !/\.(md|markdown)$/.test(e.name)) continue;
      let content = "";
      try {
        content = await readFile(e.path);
      } catch {
        /* keep empty */
      }
      notes.push({ id: m[1], path: e.path, title: parseNoteTitle(e.name, content) });
    }
  }
  useZettelIndexStore.getState().setAll(notes);
}
```

(Verify `listDir`'s real return type against `src/ipc/invoke.ts`; match `.name`/`.path` field names.)

- [ ] **Step 4: Run → PASS.** Same command.

- [ ] **Step 5: Commit**

```bash
git add src/stores/zettelkasten/zettel-index.ts src/stores/zettelkasten/__tests__/zettel-index.test.ts
git commit -m "feat(zettelkasten §95): frontend id↔title↔path index store"
```

---

## Task 3: Refresh the index on space-open + note writes

**Files:**
- Modify: `src/services/zettelkasten-service.ts` (refresh after create/capture/promote)
- Modify: `src/stores/file/workspace.ts` (refresh when the zettel preset opens)
- Test: extend `src/services/__tests__/zettelkasten-service.test.ts`

**Interfaces:**
- Consumes: `refreshZettelIndex`, `useZettelIndexStore.upsert`.
- Behavior: after `createZettelNote`/`captureFleeting`/`promoteFleeting` write a file, `upsert` the new note into the index (cheap, no full rescan). When the zettel workspace preset opens (workspace.ts `id === "zettelkasten"` branch, added in Plan 1), call `refreshZettelIndex(resolvedDir)` (full scan) after `ensureZettelkastenScaffold`.

- [ ] **Step 1: Write the failing test** (extend service test — assert upsert after createZettelNote)

```ts
import { useZettelIndexStore } from "../../stores/zettelkasten/zettel-index";
// with the existing service-test mocks (writeFile/createDir/listDir/openFileInTab)

it("createZettelNote upserts the new note into the zettel index", async () => {
  useZettelIndexStore.getState().clear();
  const res = await createZettelNote("/z", "Fresh Idea");
  const entries = Object.values(useZettelIndexStore.getState().byId);
  expect(entries.some((n) => n.path === res!.path && n.title === "Fresh Idea")).toBe(true);
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run src/services/__tests__/zettelkasten-service.test.ts`

- [ ] **Step 3: Implement**

In `zettelkasten-service.ts`, after each successful write:
- `createZettelNote`: before `return { path }`, add `useZettelIndexStore.getState().upsert({ id, path, title });`
- `captureFleeting`: `useZettelIndexStore.getState().upsert({ id, path, title: id });` (fleeting title = id)
- `promoteFleeting`: `upsert({ id, path, title })` for the new permanent note AND `removeByPath(fleetingPath)` for the deleted inbox file.
Import `useZettelIndexStore`.

In `workspace.ts` `id === "zettelkasten"` branch, after `await ensureZettelkastenScaffold(resolvedDir);` add:
```ts
                await refreshZettelIndex(resolvedDir);
```
Import `refreshZettelIndex` from `../../stores/zettelkasten/zettel-index`.

- [ ] **Step 4: Run → PASS** + `npx vitest run` FULL (>= baseline).

- [ ] **Step 5: Commit**

```bash
git add src/services/zettelkasten-service.ts src/stores/file/workspace.ts src/services/__tests__/zettelkasten-service.test.ts
git commit -m "feat(zettelkasten §95): keep the zettel index fresh on open + note writes"
```

---

## Task 4: WikilinkView renders the index title for `[[id]]`

**Files:**
- Modify: `src/extensions/nodes/wikilink-view.tsx`
- Test: `src/extensions/nodes/__tests__/wikilink-view.test.tsx` (create)

**Interfaces:**
- Consumes: `isZettelId` (Task 1), `titleForId` + `useZettelIndexStore` (Task 2).
- Behavior: compute `baseText`. **Only when** `!display && !heading && !vaultAlias && isZettelId(target)`: look up `titleForId(target)`; if found, use it as the displayed text. Otherwise the existing `display || (heading ? … : target)` logic is untouched. Subscribe to the index so the pill updates live on rename (use a `useZettelIndexStore` selector keyed by target).

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import { useZettelIndexStore } from "../../../stores/zettelkasten/zettel-index";
// Render WikilinkView via a minimal NodeViewProps stub OR a tiptap test editor.
// Assert: node {target:"202607051530", display:null} shows "원자적 노트" when the
// index has it; a node {target:"Architecture"} still shows "Architecture";
// {target:"202607051530"} shows "202607051530" when the index is empty.
```
(Use the project's existing NodeView test pattern — grep `__tests__` for a NodeView render harness, e.g. how `mention-view`/`frontmatter-view` are tested; mirror it. If none exists, mount a tiptap editor with the Wikilink extension and a doc containing the node, then read the rendered `.wikilink` text.)

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement (gated)**

In `wikilink-view.tsx`, replace the `baseText` computation:
```tsx
  const zettelTitle = useZettelIndexStore((s) =>
    !display && !heading && !vaultAlias && isZettelId(target)
      ? s.byId[target]?.title
      : undefined,
  );
  const baseText =
    zettelTitle ?? (display || (heading ? `${target} > ${heading}` : target));
```
Add imports: `isZettelId` from `../../utils/zettelkasten/parse-note-title`, `useZettelIndexStore` from `../../stores/zettelkasten/zettel-index`. Leave the rest of the component (vaultAlias badge, date icon, click handling) unchanged.

- [ ] **Step 4: Run → PASS** + `npx vitest run` FULL (0 failures — no regression to existing wikilink rendering).

- [ ] **Step 5: Commit**

```bash
git add src/extensions/nodes/wikilink-view.tsx src/extensions/nodes/__tests__/wikilink-view.test.tsx
git commit -m "feat(zettelkasten §95): render live note title for [[id]] wikilinks"
```

---

## Task 5: Autocomplete — search by title, insert `target=id`

**Files:**
- Modify: `src/extensions/plugins/wikilink-suggest.ts`, `wikilink-suggest-utils.ts`
- Test: extend `wikilink-suggest` tests (or add one)

**Interfaces:**
- Consumes: the zettel index (Task 2). `getFileItems()` currently maps files to `{ target: fileNameWithoutExtension, label, path }` and `filterFiles` fuzzy-scores `file.target`.
- Behavior: for files that are zettel notes (filename has an id prefix), the suggestion item's `target` becomes the **id** and its `label`/searchable text becomes the **title**; selecting inserts `insertWikilink({ target: id })` (no display). Non-zettel files are unchanged (target = filename). Fuzzy search matches the title for zettel notes, the filename for others.

- [ ] **Step 1: Write the failing test** — assert a zettel-note file yields an item with `target = id` and a title label, and `filterFiles` matches the title.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — in `getFileItems`, detect `const idm = f.name.match(/^(\d{12,14})\b/)`; if present, `target = idm[1]`, `label = <title>` (parse from name/frontmatter — use the zettel index `titleForId(id)` when available, else the filename title via `parseNoteTitle(f.name, "")`), and add a `searchText`/keep `label` as the fuzzy key. Adjust `filterFiles` to fuzzy-score the title/label for zettel items (extend `WikilinkSuggestionItem` with an optional `searchText`, default to `target`). The `command` insert already uses `props.target` → now the id.
- [ ] **Step 4: Run → PASS** + FULL suite.
- [ ] **Step 5: Commit** — `feat(zettelkasten §95): [[ autocomplete searches by title, inserts id`.

---

## Task 6: B2 eager normalization (manual `[[title]]` → `[[id]]`)

**Files:**
- Modify: `src/extensions/nodes/wikilink.ts` (InputRule handler)
- Test: extend `src/extensions/__tests__/wikilink.test.ts` (or the wikilink node test)

**Interfaces:**
- Consumes: `idForTitle` (Task 2), `isZettelId`.
- Behavior: in the wikilink `InputRule` handler, after parsing `target`, if `target` is NOT already an id and `idForTitle(target)` returns a unique id, create the node with `target = <that id>` (and no display — WikilinkView will render the title). If ambiguous/none, keep `target` as typed (current behavior; ghost-link handles dangling). Gated: only applies when the zettel index is non-empty (i.e. a zettel space is active) — otherwise never rewrites, so non-zettel vaults are unaffected.

- [ ] **Step 1: Write the failing test** — seed the zettel index with one `{id:"202607051530", title:"원자적 노트"}`; simulate the InputRule creating a node from `[[원자적 노트]]`; assert the resulting node's `target` is `"202607051530"`. And with an ambiguous/empty index, `[[원자적 노트]]` stays `target="원자적 노트"`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — in the `addInputRules` handler, before `tr.replaceWith`, compute `const normalizedTarget = (!isZettelId(target) && idForTitle(target)) || target;` and use it as the node's `target`. Import `idForTitle`/`isZettelId`.
- [ ] **Step 4: Run → PASS** + FULL suite (existing wikilink InputRule round-trip tests must stay green — non-matching titles are untouched).
- [ ] **Step 5: Commit** — `feat(zettelkasten §95): normalize manually-typed [[title]] to [[id]] (B2)`.

---

## Task 7: New note from selection

**Files:**
- Modify: `src/services/zettelkasten-service.ts` (`createNoteFromSelection` orchestration is thin — the command does the editor work)
- Modify: `src/keybindings/keybinding-registry.ts`, `use-keybinding-actions.ts`, `src/i18n/en.json`, `src/i18n/ko.json`
- Test: service-level test for the note body + a command smoke where feasible

**Interfaces:**
- Consumes: `createZettelNote` (2a), `ZettelTitleDialog`/`openZettelTitleDialog` (2a), the editor (`useEditorStore`/tiptap), `insertWikilink` command (wikilink.ts).
- Behavior: `zettelkasten.newFromSelection` action — read the current editor selection text; if empty, no-op (warn). Open `ZettelTitleDialog` prefilled with the selection's first line (≤60 chars); on submit, `createZettelNote(dir, title)` with the selection text as the note body (extend `createZettelNote` to accept an optional `body`), then replace the editor selection with a wikilink node `insertWikilink({ target: <new id> })`. Default key `Mod+Shift+E` (verify free).

- [ ] **Step 1: Write the failing test** — extend `createZettelNote` to accept `body?: string` and assert the written content contains the body under the H1; test that `buildPermanentNote` body insertion is correct. (The editor-selection→replace wiring is covered by a lightweight action test or manual QA — note which.)
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — extend `createZettelNote(zettelDir, title, body?)` to append `\n\n${body}` after the H1 when body is provided (thread through `buildPermanentNote` or append post-build); return `{ path, id }`. Register the action (resolve dir + selection text → dialog → createZettelNote → `editor.chain().deleteSelection().insertWikilink({ target: id }).run()`), keybinding `Mod+Shift+E`, and en/ko i18n. Gate on `zettelkastenEnabled` + a non-empty selection.
- [ ] **Step 4: Run → PASS** + tsc + FULL suite (keybinding uniqueness green — confirm `Mod+Shift+E` free).
- [ ] **Step 5: Commit** — `feat(zettelkasten §94): new note from selection inserts an [[id]] link`.

---

## Task 8: Export renders `[[id]]` as the title

**Files:**
- Modify: `src/pipeline/transformers/wikilink-transformer.ts` (or the export-specific serializer path)
- Test: extend the wikilink-transformer test

**Interfaces:**
- Consumes: `titleForId` + `isZettelId`.
- Behavior: the EXPORT serialization path (HTML/Pandoc/Notion — find where `serializeWikilink` or wikilink→text runs for export, distinct from the in-app `.md` save which must keep `[[id]]`) resolves a bare-id target to `[[id|title]]` (or just the title, matching how other exporters render wikilinks) using `titleForId`. The on-disk `.md` round-trip serialization MUST stay `[[id]]` (do not rewrite the stored file). Only the export output gets the title.

- [ ] **Step 1: Write the failing test** — seed the index `{id:"202607051530", title:"원자적 노트"}`; call the export wikilink serializer on a `[[202607051530]]` node; assert output contains "원자적 노트". Assert the normal `.md` serializer still emits `[[202607051530]]`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — locate the export wikilink handling (grep the export pipeline for `serializeWikilink`/wikilink node handling in `convertForNotion`/Pandoc/HTML). Add id→title resolution THERE only (not in the round-trip `pm-to-md` serializer used for saving). If export reuses `serializeWikilink`, add an export-only wrapper that maps `{target:id}` → `{target:id, display: titleForId(id) ?? id}` before serialize.
- [ ] **Step 4: Run → PASS** + FULL suite (round-trip tests unaffected).
- [ ] **Step 5: Commit** — `feat(zettelkasten §95): resolve [[id]] to title in export output`.

---

## Task 9: Full verification

- [ ] `npx tsc --noEmit` clean; `npx vitest run` full suite 0 failures (>= baseline + new tests); `npx eslint` (changed dirs) clean; `npx knip` no new unused.
- [ ] Manual GUI (fully relaunch `npm run tauri dev`): with a zettel space set up, type `[[`, search a note by title, insert → pill shows the title; rename a note's title → existing links' pills update; New-from-selection creates a note + link; backlinks panel shows the id-link (2b-i); export shows titles.
- [ ] No commit unless a fix is needed.

---

## Self-Review

- **Spec coverage §95:** live-title render (T4), autocomplete title→id (T5), B2 (T6), New-from-selection §94 (T7), export id→title (T8), backed by the index (T1–T3). 2b-i (Rust) already covers navigation/backlinks/graph.
- **Frontend R2:** every id path is gated on `isZettelId(target)` + index hit (T4 also on `!display && !heading && !vaultAlias`); B2 (T6) only rewrites on a unique index hit and is inert when the index is empty. Existing wikilink render/InputRule/round-trip tests are the regression gate (T4/T6 Step 4).
- **M6 (YAML title):** parse-note-title (T1) unwraps quoted titles, so a `title: "a: b"` reads correctly; a follow-up to WRITE quoted titles when unsafe can ride in 2c if needed (noted, low-risk since ids are the link key, not titles).
- **Placeholder scan:** the two "locate the export path / mirror the NodeView test harness" notes (T8, T4) are discovery steps for existing code, not deferred logic — the required behavior + assertions are concrete.
- **Type consistency:** `ZettelNote {id,path,title}`, `titleForId(id)→string|undefined`, `idForTitle(title)→string|null`, `isZettelId(s)→boolean`, `refreshZettelIndex(dir)`, `createZettelNote(dir,title,body?)` used consistently across tasks.
- **Open item for 2c:** New-from-selection key `Mod+Shift+E` — verify free at implementation (E was free per the 2a keybinding audit).
