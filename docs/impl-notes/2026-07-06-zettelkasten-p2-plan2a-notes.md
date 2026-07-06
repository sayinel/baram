# Zettelkasten P2 — Plan 2a: Note creation, inbox capture, promote (§94 + §96 + §99)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Zettelkasten space usable for writing: create permanent atomic notes with timestamp IDs, capture fleeting notes into the inbox, and promote fleeting → permanent — and retire the legacy journal `## Captures` machinery.

**Architecture:** New pure utils (`zettel-id`, `zettel-note`) build IDs + note content; a small `ZettelTitleDialog` (QuickCaptureDialog-style, gated by a UI-store flag) collects a title; commands/actions orchestrate file writes via existing IPC (`createDir`/`writeFile`/`openFileInTab`). Quick Capture is retargeted from the journal `## Captures` section to `inbox/{id}.md` fleeting files. This plan is A4 foundation; the `[[ID]]` link scheme + resolver is Plan 2b, so notes here carry IDs but note-to-note linking/backlinks land in 2b.

**Tech Stack:** React 19 + TS strict, Zustand (`useShallow`), Vitest, Tauri IPC (fs).

**Design spec:** `docs/design/part13-zettelkasten-space.md` §94 (identity/creation), §96 (promote), §99 (capture migration). Prereq landed: Plan 1 (registry + zettel scaffold, settings `zettelkastenEnabled`/`zettelkastenDirectory`, `ensureZettelkastenScaffold`, `resolveZettelDir`).

## Global Constraints

- TS strict; functional components + hooks only; filenames kebab-case; components/PascalCase, functions/camelCase.
- Zustand: components use `useShallow((s)=>({...}))` selectors — never bare `useStore()`.
- Single file ≤ ~300 lines; CSS ≤ ~1,500 lines.
- WKWebView: `window.prompt`/`alert`/`confirm` are unavailable — use in-app UI (that is why New Zettel/promote use `ZettelTitleDialog`, not a prompt).
- Timestamp/`Date` is allowed in app runtime code (only workflow scripts forbid it).
- Zettel note ID = `YYYYMMDDHHmm`; permanent filename `{id} {title}.md`; fleeting filename `{id}.md`; frontmatter `id`/`title`/`created`/`tags`/`aliases`; H1 = title. Filename title portion must be sanitized of `/\:*?"<>|#` and control chars.
- Capture destination is the zettel inbox ONLY (decision O1). If zettel is not enabled/configured, capture surfaces a "set up Zettelkasten first" message — no journal fallback. Existing journal `## Captures` data on disk is preserved (never rewritten).
- `resolveZettelDir(rootPath, dir)` (from Plan 1) is absolute-only (relative → null).
- Tests: `npm test` = `vitest run` (never jest). Baseline before Plan 2a: **2654 passed | 6 skipped**, cargo 269, tsc/eslint/knip clean.
- Conventional Commits, lowercase imperative subject (commitlint `subject-case`), keep `§` refs.

---

## File Structure

**Created:**
- `src/utils/zettelkasten/zettel-id.ts` — `generateZettelId(existingIds)`.
- `src/utils/zettelkasten/zettel-note.ts` — `sanitizeZettelTitle`, `buildPermanentNote`, `buildFleetingNote`.
- `src/utils/zettelkasten/__tests__/zettel-id.test.ts`, `.../zettel-note.test.ts`.
- `src/services/zettelkasten-service.ts` — `createZettelNote`, `captureFleeting`, `promoteFleeting` (orchestration over IPC).
- `src/components/journal/ZettelTitleDialog.tsx` — inline title-input dialog (reused by New Zettel + promote).
- `src/stores/ui/ui.ts` addition — a `zettelTitleDialog` open-flag + payload (see Task 3).

**Modified:**
- `src/keybindings/keybinding-registry.ts` — add `zettelkasten.newNote`; remove `journal.promoteCapture`, `journal.jumpToCaptures`.
- `src/hooks/use-keybinding-actions.ts` — add `zettelkasten.newNote` + `zettelkasten.promote` actions; remove `journal.promoteCapture` + `journal.jumpToCaptures` actions + their now-dead imports.
- `src/components/journal/QuickCaptureDialog.tsx` — retarget submit to inbox fleeting file; gate on zettel enabled.
- `src/components/command/CommandPalette.tsx` — add "New Zettel" command.
- `src/i18n/en.json`, `src/i18n/ko.json` — add newNote label; remove promoteCapture/jumpToCaptures labels.
- `src/utils/journal/journal-capture.ts` — remove now-dead helpers (`insertCaptureIntoContent`, `buildNoteFromCapture`, `buildPromotedCaptureLink`, `parseCapturesFromMarkdown`, `extractCapturesSection`) once orphaned; keep whatever survives (knip-verified).

---

## Task 1: Zettel ID generation

**Files:**
- Create: `src/utils/zettelkasten/zettel-id.ts`
- Test: `src/utils/zettelkasten/__tests__/zettel-id.test.ts`

**Interfaces:**
- Produces: `generateZettelId(existingIds: Set<string>): string` — returns `YYYYMMDDHHmm`; if that collides with a member of `existingIds`, appends two-digit seconds → `YYYYMMDDHHmmss`; if that still collides, increments seconds until free. Uses local time via `new Date()`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { generateZettelId } from "../zettel-id";

describe("generateZettelId", () => {
  it("returns a 12-digit YYYYMMDDHHmm id when no collision", () => {
    const id = generateZettelId(new Set());
    expect(id).toMatch(/^\d{12}$/);
  });

  it("appends seconds (14 digits) when the minute id already exists", () => {
    const minuteId = generateZettelId(new Set());
    const id = generateZettelId(new Set([minuteId]));
    expect(id).toMatch(/^\d{14}$/);
    expect(id).not.toBe(minuteId);
  });

  it("keeps incrementing until an unused id is found", () => {
    const minuteId = generateZettelId(new Set());
    // Pre-fill the minute id + the first ~5 second-slots
    const taken = new Set<string>([minuteId]);
    for (let s = 0; s < 5; s++) {
      taken.add(minuteId + String(s).padStart(2, "0"));
    }
    const id = generateZettelId(taken);
    expect(taken.has(id)).toBe(false);
    expect(id).toMatch(/^\d{14}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/zettelkasten/__tests__/zettel-id.test.ts`
Expected: FAIL — cannot resolve `../zettel-id`.

- [ ] **Step 3: Implement**

```ts
/** §94 Zettelkasten note ID = YYYYMMDDHHmm (local time), seconds appended on collision. */
function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

export function generateZettelId(existingIds: Set<string>): string {
  const d = new Date();
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}` +
    `${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}`;
  if (!existingIds.has(stamp)) return stamp;
  // Collision within the same minute → append/scan seconds.
  for (let s = 0; s < 60; s++) {
    const withSec = stamp + pad(s, 2);
    if (!existingIds.has(withSec)) return withSec;
  }
  // Extremely unlikely: 60 notes in one minute — fall back to a longer suffix.
  let extra = 0;
  let candidate = stamp + "59" + pad(extra, 2);
  while (existingIds.has(candidate)) candidate = stamp + "59" + pad(++extra, 2);
  return candidate;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/zettelkasten/__tests__/zettel-id.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/zettelkasten/zettel-id.ts src/utils/zettelkasten/__tests__/zettel-id.test.ts
git commit -m "feat(zettelkasten §94): timestamp note-id generator with collision fallback"
```

---

## Task 2: Note + frontmatter builders

**Files:**
- Create: `src/utils/zettelkasten/zettel-note.ts`
- Test: `src/utils/zettelkasten/__tests__/zettel-note.test.ts`

**Interfaces:**
- Produces:
  - `sanitizeZettelTitle(title: string): string` — strips `/\:*?"<>|#` and control chars, collapses whitespace, trims; returns `"Untitled"` if the result is empty.
  - `buildPermanentNote(input: { id: string; title: string; created: string }): { filename: string; content: string }` — filename `{id} {sanitized title}.md`; content = frontmatter (`id`, `title`, `created`, `tags: []`, `aliases: []`) + blank line + `# {title}` + trailing blank line.
  - `buildFleetingNote(input: { id: string; body: string; created: string }): { filename: string; content: string }` — filename `{id}.md`; content = frontmatter (`id`, `created`, `tags: []`) + blank line + `body` (verbatim) + trailing newline.
  - `created` is an ISO-ish string the caller passes (so these stay pure/testable — no `Date` inside).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  buildFleetingNote,
  buildPermanentNote,
  sanitizeZettelTitle,
} from "../zettel-note";

describe("sanitizeZettelTitle", () => {
  it("strips filesystem-reserved chars and collapses whitespace", () => {
    expect(sanitizeZettelTitle('a/b:c*?"<>|#  d')).toBe("abc d");
  });
  it("falls back to Untitled when empty", () => {
    expect(sanitizeZettelTitle("  ///  ")).toBe("Untitled");
  });
});

describe("buildPermanentNote", () => {
  it("builds {id title}.md with frontmatter + H1", () => {
    const { filename, content } = buildPermanentNote({
      id: "202607051530",
      title: "원자적 노트",
      created: "2026-07-05T15:30",
    });
    expect(filename).toBe("202607051530 원자적 노트.md");
    expect(content).toContain("id: 202607051530");
    expect(content).toContain("title: 원자적 노트");
    expect(content).toContain("created: 2026-07-05T15:30");
    expect(content).toContain("# 원자적 노트");
    expect(content.startsWith("---\n")).toBe(true);
  });
  it("sanitizes the title in the filename but keeps it raw in frontmatter/H1", () => {
    const { filename, content } = buildPermanentNote({
      id: "202607051530",
      title: "TCP/IP 정리",
      created: "2026-07-05T15:30",
    });
    expect(filename).toBe("202607051530 TCPIP 정리.md");
    expect(content).toContain("title: TCP/IP 정리");
    expect(content).toContain("# TCP/IP 정리");
  });
});

describe("buildFleetingNote", () => {
  it("builds {id}.md with minimal frontmatter + body", () => {
    const { filename, content } = buildFleetingNote({
      id: "202607051530",
      body: "quick thought",
      created: "2026-07-05T15:30",
    });
    expect(filename).toBe("202607051530.md");
    expect(content).toContain("id: 202607051530");
    expect(content).toContain("quick thought");
    expect(content).not.toContain("title:");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/zettelkasten/__tests__/zettel-note.test.ts`
Expected: FAIL — cannot resolve `../zettel-note`.

- [ ] **Step 3: Implement**

```ts
/** §94 Zettelkasten note + frontmatter builders (pure; caller supplies id + created). */

const RESERVED = /[/\\:*?"<>|# -]/g;

export function sanitizeZettelTitle(title: string): string {
  const cleaned = title.replace(RESERVED, "").replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : "Untitled";
}

export function buildPermanentNote(input: {
  created: string;
  id: string;
  title: string;
}): { content: string; filename: string } {
  const { id, title, created } = input;
  const filename = `${id} ${sanitizeZettelTitle(title)}.md`;
  const content =
    `---\n` +
    `id: ${id}\n` +
    `title: ${title}\n` +
    `created: ${created}\n` +
    `tags: []\n` +
    `aliases: []\n` +
    `---\n\n` +
    `# ${title}\n`;
  return { filename, content };
}

export function buildFleetingNote(input: {
  body: string;
  created: string;
  id: string;
}): { content: string; filename: string } {
  const { id, body, created } = input;
  const filename = `${id}.md`;
  const content =
    `---\n` +
    `id: ${id}\n` +
    `created: ${created}\n` +
    `tags: []\n` +
    `---\n\n` +
    `${body}\n`;
  return { filename, content };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/zettelkasten/__tests__/zettel-note.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/zettelkasten/zettel-note.ts src/utils/zettelkasten/__tests__/zettel-note.test.ts
git commit -m "feat(zettelkasten §94): permanent + fleeting note builders"
```

---

## Task 3: ZettelTitleDialog + UI-store flag

**Files:**
- Modify: `src/stores/ui/ui.ts` (add dialog open-flag + payload + setter)
- Create: `src/components/journal/ZettelTitleDialog.tsx`
- Test: `src/components/journal/__tests__/ZettelTitleDialog.test.tsx`

**Interfaces:**
- Produces (ui store): `zettelTitleDialog: { onSubmit: ((title: string) => void) | null; open: boolean }` and `openZettelTitleDialog(onSubmit: (title: string) => void): void` / `closeZettelTitleDialog(): void`. Follow the existing UI-store patterns in `ui.ts` for state + setters.
- Produces (component): `ZettelTitleDialog` — renders when `zettelTitleDialog.open`; a single text input + "Create"/"Cancel"; Enter or Create calls the stored `onSubmit(title)` then closes; Escape/Cancel closes without calling. Empty title is allowed (caller sanitizes → "Untitled").

- [ ] **Step 1: Add the ui-store state (read the current `ui.ts` and mirror an existing modal flag)**

In `src/stores/ui/ui.ts`, add to the `UIState` interface and the `create` body (place near other modal/dialog flags like the quick-capture flag):

```ts
  // interface
  zettelTitleDialog: { onSubmit: ((title: string) => void) | null; open: boolean };
  openZettelTitleDialog: (onSubmit: (title: string) => void) => void;
  closeZettelTitleDialog: () => void;
```
```ts
  // create body
  zettelTitleDialog: { open: false, onSubmit: null },
  openZettelTitleDialog: (onSubmit) =>
    set({ zettelTitleDialog: { open: true, onSubmit } }),
  closeZettelTitleDialog: () =>
    set({ zettelTitleDialog: { open: false, onSubmit: null } }),
```

- [ ] **Step 2: Write the failing component test**

`src/components/journal/__tests__/ZettelTitleDialog.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useUIStore } from "../../../stores/ui/ui";
import { ZettelTitleDialog } from "../ZettelTitleDialog";

describe("ZettelTitleDialog", () => {
  beforeEach(() => useUIStore.getState().closeZettelTitleDialog());

  it("renders nothing when closed", () => {
    const { container } = render(<ZettelTitleDialog />);
    expect(container).toBeEmptyDOMElement();
  });

  it("submits the typed title and closes", () => {
    const onSubmit = vi.fn();
    useUIStore.getState().openZettelTitleDialog(onSubmit);
    render(<ZettelTitleDialog />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "New Idea" },
    });
    fireEvent.click(screen.getByText("Create"));
    expect(onSubmit).toHaveBeenCalledWith("New Idea");
    expect(useUIStore.getState().zettelTitleDialog.open).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/components/journal/__tests__/ZettelTitleDialog.test.tsx`
Expected: FAIL — cannot resolve `../ZettelTitleDialog`.

- [ ] **Step 4: Implement the component**

`src/components/journal/ZettelTitleDialog.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useShallow } from "zustand/shallow";

import { useUIStore } from "../../stores/ui/ui";

export function ZettelTitleDialog() {
  const { dialog, close } = useUIStore(
    useShallow((s) => ({
      dialog: s.zettelTitleDialog,
      close: s.closeZettelTitleDialog,
    })),
  );
  const [title, setTitle] = useState("");

  useEffect(() => {
    if (dialog.open) setTitle("");
  }, [dialog.open]);

  if (!dialog.open) return null;

  const submit = () => {
    dialog.onSubmit?.(title);
    close();
  };

  return (
    <div className="zettel-title-dialog-overlay" onClick={close}>
      <div
        className="zettel-title-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") close();
          }}
          placeholder="노트 제목"
          type="text"
          value={title}
        />
        <div className="zettel-title-dialog-actions">
          <button onClick={close}>Cancel</button>
          <button onClick={submit}>Create</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Mount the dialog once at app root**

In `src/App.tsx`, add `<ZettelTitleDialog />` alongside the other global dialogs/overlays (e.g., near where `QuickCaptureDialog` is rendered — grep for it). Import it.

- [ ] **Step 6: Run test + typecheck**

Run: `npx vitest run src/components/journal/__tests__/ZettelTitleDialog.test.tsx && npx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 7: Commit**

```bash
git add src/stores/ui/ui.ts src/components/journal/ZettelTitleDialog.tsx src/components/journal/__tests__/ZettelTitleDialog.test.tsx src/App.tsx
git commit -m "feat(zettelkasten §94): inline title-input dialog for note creation"
```

(CSS for `.zettel-title-dialog*` is deferred to Plan 2c UI polish; functional without it. If minimal styling is wanted now, add to `src/styles/journal-notes.css` reusing existing dialog tokens — optional, not required for tests.)

---

## Task 4: Zettelkasten service + New Zettel command

**Files:**
- Create: `src/services/zettelkasten-service.ts`
- Modify: `src/keybindings/keybinding-registry.ts` (add `zettelkasten.newNote`)
- Modify: `src/hooks/use-keybinding-actions.ts` (register `zettelkasten.newNote` action)
- Modify: `src/components/command/CommandPalette.tsx` (add "New Zettel" command)
- Modify: `src/i18n/en.json`, `src/i18n/ko.json` (add label)
- Test: `src/services/__tests__/zettelkasten-service.test.ts`

**Interfaces:**
- Consumes: `generateZettelId` (Task 1), `buildPermanentNote` (Task 2), `resolveZettelDir` + `ensureZettelkastenScaffold` (Plan 1), `createDir`/`writeFile`/`listDir` from `src/ipc/invoke`, `openFileInTab` from `src/services/journal-file-service`.
- Produces: `createZettelNote(zettelDir: string, title: string): Promise<{ path: string } | null>` — computes existing note ids from `notes/`, generates an id, writes `notes/{filename}` via `buildPermanentNote`, opens it, returns its path.

- [ ] **Step 1: Write the failing test** (mock IPC + openFileInTab)

```ts
import { describe, expect, it, vi } from "vitest";

const writeFile = vi.fn().mockResolvedValue(undefined);
const createDir = vi.fn().mockResolvedValue(undefined);
const listDir = vi.fn().mockResolvedValue([]);
vi.mock("../../ipc/invoke", () => ({ writeFile, createDir, listDir }));
const openFileInTab = vi.fn().mockResolvedValue(undefined);
vi.mock("../../services/journal-file-service", () => ({ openFileInTab }));

import { createZettelNote } from "../zettelkasten-service";

describe("createZettelNote", () => {
  it("writes notes/{id title}.md and opens it", async () => {
    const res = await createZettelNote("/z", "My Idea");
    expect(res).not.toBeNull();
    expect(createDir).toHaveBeenCalledWith("/z/notes");
    const [path, content] = writeFile.mock.calls.at(-1)!;
    expect(path).toMatch(/^\/z\/notes\/\d{12} My Idea\.md$/);
    expect(content).toContain("# My Idea");
    expect(openFileInTab).toHaveBeenCalledWith(res!.path, expect.any(String));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/zettelkasten-service.test.ts`
Expected: FAIL — cannot resolve `../zettelkasten-service`.

- [ ] **Step 3: Implement the service**

`src/services/zettelkasten-service.ts`:

```ts
import { createDir, listDir, writeFile } from "../ipc/invoke";
import { generateZettelId } from "../utils/zettelkasten/zettel-id";
import { buildPermanentNote } from "../utils/zettelkasten/zettel-note";
import { openFileInTab } from "./journal-file-service";

/** Collect existing note ids (filename prefix) from notes/ + inbox/. */
async function collectExistingIds(zettelDir: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const sub of ["notes", "inbox"]) {
    try {
      const entries = await listDir(`${zettelDir}/${sub}`, false);
      for (const e of entries) {
        const m = e.name.match(/^(\d{12,14})\b/);
        if (m) ids.add(m[1]);
      }
    } catch {
      /* dir may not exist yet */
    }
  }
  return ids;
}

/** §94 Create a permanent atomic note and open it. */
export async function createZettelNote(
  zettelDir: string,
  title: string,
): Promise<null | { path: string }> {
  const notesDir = `${zettelDir}/notes`;
  await createDir(notesDir);
  const existing = await collectExistingIds(zettelDir);
  const id = generateZettelId(existing);
  const created = new Date().toISOString().slice(0, 16);
  const { filename, content } = buildPermanentNote({ id, title, created });
  const path = `${notesDir}/${filename}`;
  await writeFile(path, content);
  await openFileInTab(path, content);
  return { path };
}
```

(Verify `listDir`'s signature/return shape against `src/ipc/invoke.ts` — it returns entries with a `.name`; match the real type. Adjust the destructure if the real shape differs.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/__tests__/zettelkasten-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Register the command + action + palette + i18n**

`src/keybindings/keybinding-registry.ts` — add (in the `journal`/workspace area; pick an unused default key — verify uniqueness against the registry test):
```ts
  {
    id: "zettelkasten.newNote",
    label: "keybindings.zettelkasten.newNote",
    category: "journal",
    defaultKey: "Mod+Shift+O",
    customizable: true,
  },
```
`src/hooks/use-keybinding-actions.ts` — register the action:
```ts
    registerAction("zettelkasten.newNote", () => {
      const { zettelkastenEnabled, zettelkastenDirectory } =
        useSettingsStore.getState();
      const { rootPath } = useFileStore.getState();
      const dir = resolveZettelDir(rootPath, zettelkastenDirectory);
      if (!zettelkastenEnabled || !dir) {
        logger.warn("[Zettel] newNote: space not enabled/configured");
        return;
      }
      useUIStore.getState().openZettelTitleDialog((title) => {
        createZettelNote(dir, title).catch((err) =>
          logger.error("[Zettel] newNote failed:", err),
        );
      });
    });
```
Add imports: `resolveZettelDir` from `../utils/zettelkasten/zettelkasten`, `createZettelNote` from `../services/zettelkasten-service`, and ensure `useUIStore`/`useSettingsStore`/`useFileStore`/`logger` are already imported (they are).
`src/components/command/CommandPalette.tsx` — add a command mirroring the sibling command shape, action `() => useKeybindingStore…` — simplest: dispatch the registered action. Match how other commands trigger actions; if commands call actions by id, use that; otherwise inline the same body. (Check the existing "Open Zettelkasten" command added in Plan 1 for the exact pattern.)
`src/i18n/en.json`: `"keybindings.zettelkasten.newNote": "New Zettel note",`
`src/i18n/ko.json`: `"keybindings.zettelkasten.newNote": "새 제텔 노트",`

- [ ] **Step 6: Typecheck + full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean; 0 failures (keybinding-registry uniqueness test still green — confirm `Mod+Shift+O` is unused).

- [ ] **Step 7: Commit**

```bash
git add src/services/zettelkasten-service.ts src/services/__tests__/zettelkasten-service.test.ts src/keybindings/keybinding-registry.ts src/hooks/use-keybinding-actions.ts src/components/command/CommandPalette.tsx src/i18n/en.json src/i18n/ko.json
git commit -m "feat(zettelkasten §94): New Zettel command creates + opens a permanent note"
```

---

## Task 5: Retarget Quick Capture to the inbox

**Files:**
- Modify: `src/components/journal/QuickCaptureDialog.tsx`
- Modify: `src/services/zettelkasten-service.ts` (add `captureFleeting`)
- Test: extend `src/services/__tests__/zettelkasten-service.test.ts`

**Interfaces:**
- Produces: `captureFleeting(zettelDir: string, body: string): Promise<{ path: string } | null>` — writes `inbox/{id}.md` via `buildFleetingNote` (creates `inbox/` first), returns its path. Does NOT open a tab (fleeting notes accumulate silently).

- [ ] **Step 1: Write the failing test** (extend the service test)

```ts
import { buildFleetingNote } from "../../utils/zettelkasten/zettel-note";
// (reuse the mocks from Task 4's test file)

describe("captureFleeting", () => {
  it("writes inbox/{id}.md and does not open a tab", async () => {
    openFileInTab.mockClear();
    const { captureFleeting } = await import("../zettelkasten-service");
    const res = await captureFleeting("/z", "quick thought");
    expect(createDir).toHaveBeenCalledWith("/z/inbox");
    const [path, content] = writeFile.mock.calls.at(-1)!;
    expect(path).toMatch(/^\/z\/inbox\/\d{12}\.md$/);
    expect(content).toContain("quick thought");
    expect(openFileInTab).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test → fail** (`captureFleeting` not exported)

Run: `npx vitest run src/services/__tests__/zettelkasten-service.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `captureFleeting`** in `zettelkasten-service.ts`

```ts
import { buildFleetingNote } from "../utils/zettelkasten/zettel-note";

export async function captureFleeting(
  zettelDir: string,
  body: string,
): Promise<null | { path: string }> {
  const inboxDir = `${zettelDir}/inbox`;
  await createDir(inboxDir);
  const existing = await collectExistingIds(zettelDir);
  const id = generateZettelId(existing);
  const created = new Date().toISOString().slice(0, 16);
  const { filename, content } = buildFleetingNote({ id, body, created });
  const path = `${inboxDir}/${filename}`;
  await writeFile(path, content);
  return { path };
}
```

- [ ] **Step 4: Run test → pass**

Run: `npx vitest run src/services/__tests__/zettelkasten-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Retarget the dialog submit**

In `src/components/journal/QuickCaptureDialog.tsx` `handleSave` (currently ~lines 118-168): replace the journal-target block (the `resolveCaptureTarget(...)` + `insertCaptureIntoContent` + writeFile-to-journal sequence) with a zettel-inbox capture. Read `zettelkastenEnabled`/`zettelkastenDirectory` (add to the settings selector), resolve the dir, and gate:

```ts
      const { zettelkastenEnabled, zettelkastenDirectory } =
        useSettingsStore.getState();
      const { rootPath } = useFileStore.getState();
      const dir = resolveZettelDir(rootPath, zettelkastenDirectory);
      if (!zettelkastenEnabled || !dir) {
        setSaveError("설정에서 Zettelkasten 공간을 먼저 지정해주세요.");
        return;
      }
      // Compose the fleeting body from the dialog fields (title/body/url/tags)
      const bodyLines: string[] = [];
      if (title) bodyLines.push(`# ${title}`, "");
      if (body) bodyLines.push(body, "");
      if (url) bodyLines.push(`Source: ${url}`, "");
      if (tags) bodyLines.push(tags.split(/\s+/).filter(Boolean).map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" "));
      const result = await captureFleeting(dir, bodyLines.join("\n").trim());
      if (!result) {
        setSaveError("Zettelkasten inbox에 저장하지 못했습니다.");
        return;
      }
      toggleQuickCapture();
```
Remove the now-unused `resolveCaptureTarget` local function and the `insertCaptureIntoContent`/`CaptureItem` usage from this file (they are removed wholesale in Task 6). Remove the journal-file-store reload block (it targeted the journal file). Add imports: `resolveZettelDir` from `../../utils/zettelkasten/zettelkasten`, `captureFleeting` from `../../services/zettelkasten-service`.

- [ ] **Step 6: Typecheck + full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean; 0 failures. (Note: any existing QuickCaptureDialog test that asserted journal-section writes will need updating — update it to assert the inbox capture; do NOT delete assertions, re-point them.)

- [ ] **Step 7: Commit**

```bash
git add src/components/journal/QuickCaptureDialog.tsx src/services/zettelkasten-service.ts src/services/__tests__/zettelkasten-service.test.ts
git commit -m "feat(zettelkasten §99): retarget quick capture to the zettelkasten inbox"
```

---

## Task 6: Promote fleeting → permanent

**Files:**
- Modify: `src/services/zettelkasten-service.ts` (add `promoteFleeting`)
- Modify: `src/keybindings/keybinding-registry.ts` (add `zettelkasten.promote`)
- Modify: `src/hooks/use-keybinding-actions.ts` (register `zettelkasten.promote`)
- Modify: `src/i18n/en.json`, `src/i18n/ko.json`
- Test: extend `src/services/__tests__/zettelkasten-service.test.ts`

**Interfaces:**
- Produces: `promoteFleeting(zettelDir: string, fleetingPath: string, title: string): Promise<{ path: string } | null>` — reads the fleeting file body (strip its frontmatter), reuses its id (from the filename), writes `notes/{id} {title}.md` (permanent frontmatter + `# title` + the fleeting body), deletes the inbox file, opens the new note. Uses `readFile`/`deleteFile` from IPC.

- [ ] **Step 1: Write the failing test**

```ts
describe("promoteFleeting", () => {
  it("moves inbox/{id}.md to notes/{id title}.md and deletes the inbox file", async () => {
    const readFile = vi.fn().mockResolvedValue(
      "---\nid: 202607051530\ncreated: 2026-07-05T15:30\ntags: []\n---\n\nseed body\n",
    );
    const deleteFile = vi.fn().mockResolvedValue(undefined);
    vi.doMock("../../ipc/invoke", () => ({ writeFile, createDir, listDir, readFile, deleteFile }));
    vi.resetModules();
    const { promoteFleeting } = await import("../zettelkasten-service");
    const res = await promoteFleeting("/z", "/z/inbox/202607051530.md", "Real Idea");
    expect(res!.path).toBe("/z/notes/202607051530 Real Idea.md");
    expect(deleteFile).toHaveBeenCalledWith("/z/inbox/202607051530.md");
    const call = (writeFile as any).mock.calls.find((c: any[]) => c[0] === res!.path)!;
    expect(call[1]).toContain("# Real Idea");
    expect(call[1]).toContain("seed body");
  });
});
```

- [ ] **Step 2: Run → fail.** Run: `npx vitest run src/services/__tests__/zettelkasten-service.test.ts` → FAIL.

- [ ] **Step 3: Implement `promoteFleeting`**

```ts
import { deleteFile, readFile } from "../ipc/invoke";
import { sanitizeZettelTitle } from "../utils/zettelkasten/zettel-note";

function stripFrontmatter(md: string): string {
  const m = md.match(/^---\n[\s\S]*?\n---\n?/);
  return m ? md.slice(m[0].length).trimStart() : md.trimStart();
}

export async function promoteFleeting(
  zettelDir: string,
  fleetingPath: string,
  title: string,
): Promise<null | { path: string }> {
  const idMatch = fleetingPath.match(/(\d{12,14})\.md$/);
  if (!idMatch) return null;
  const id = idMatch[1];
  const raw = await readFile(fleetingPath);
  const seedBody = stripFrontmatter(raw);
  const created = new Date().toISOString().slice(0, 16);
  const notesDir = `${zettelDir}/notes`;
  await createDir(notesDir);
  const filename = `${id} ${sanitizeZettelTitle(title)}.md`;
  const path = `${notesDir}/${filename}`;
  const content =
    `---\nid: ${id}\ntitle: ${title}\ncreated: ${created}\ntags: []\naliases: []\n---\n\n` +
    `# ${title}\n\n${seedBody}\n`;
  await writeFile(path, content);
  await deleteFile(fleetingPath);
  await openFileInTab(path, content);
  return { path };
}
```

- [ ] **Step 4: Run → pass.** `npx vitest run src/services/__tests__/zettelkasten-service.test.ts` → PASS.

- [ ] **Step 5: Register the promote action + command + i18n**

`keybinding-registry.ts`:
```ts
  {
    id: "zettelkasten.promote",
    label: "keybindings.zettelkasten.promote",
    category: "journal",
    defaultKey: "Mod+Shift+P",
    customizable: true,
  },
```
(Verify `Mod+Shift+P` is unused in the registry.)
`use-keybinding-actions.ts` — register: get active tab's filePath; if it is under the zettel `inbox/`, open the title dialog then `promoteFleeting(dir, filePath, title)`:
```ts
    registerAction("zettelkasten.promote", () => {
      const { zettelkastenEnabled, zettelkastenDirectory } = useSettingsStore.getState();
      const { rootPath } = useFileStore.getState();
      const dir = resolveZettelDir(rootPath, zettelkastenDirectory);
      const tab = useEditorStore.getState().tabs.find(
        (t) => t.id === useEditorStore.getState().activeTabId,
      );
      if (!zettelkastenEnabled || !dir || !tab?.filePath?.startsWith(`${dir}/inbox/`)) {
        logger.warn("[Zettel] promote: active file is not an inbox note");
        return;
      }
      const fleetingPath = tab.filePath;
      useUIStore.getState().openZettelTitleDialog((title) => {
        promoteFleeting(dir, fleetingPath, title).catch((err) =>
          logger.error("[Zettel] promote failed:", err),
        );
      });
    });
```
Add `promoteFleeting` to the `zettelkasten-service` import.
i18n en: `"keybindings.zettelkasten.promote": "Promote to permanent note",`
i18n ko: `"keybindings.zettelkasten.promote": "영구 노트로 승격",`

- [ ] **Step 6: Typecheck + full suite.** `npx tsc --noEmit && npx vitest run` → clean, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add src/services/zettelkasten-service.ts src/services/__tests__/zettelkasten-service.test.ts src/keybindings/keybinding-registry.ts src/hooks/use-keybinding-actions.ts src/i18n/en.json src/i18n/ko.json
git commit -m "feat(zettelkasten §96): promote a fleeting inbox note to a permanent note"
```

---

## Task 7: Remove legacy journal capture machinery

**Files:**
- Modify: `src/hooks/use-keybinding-actions.ts` (remove `journal.promoteCapture` + `journal.jumpToCaptures` actions + dead imports)
- Modify: `src/keybindings/keybinding-registry.ts` (remove both entries)
- Modify: `src/i18n/en.json`, `src/i18n/ko.json` (remove both labels)
- Modify: `src/utils/journal/journal-capture.ts` (remove orphaned helpers)
- Test: remove/trim `src/utils/__tests__/journal-capture.test.ts` cases for deleted helpers

**Interfaces:**
- After Task 5, `QuickCaptureDialog` no longer imports `insertCaptureIntoContent`/`CaptureItem`. This task removes the remaining legacy consumers and the now-dead exports.

- [ ] **Step 1: Remove the two actions + their imports**

In `src/hooks/use-keybinding-actions.ts`: delete the `registerAction("journal.promoteCapture", …)` block (currently ~377-476) and the `registerAction("journal.jumpToCaptures", …)` block (~506). Remove the imports `buildNoteFromCapture`, `buildPromotedCaptureLink`, `parseCapturesFromMarkdown`, `resolveNotesDir` **iff** no other action in the file still uses them (grep within the file; `resolveJournalDir` is likely still used elsewhere — keep it if so).

- [ ] **Step 2: Remove the registry entries + i18n**

`src/keybindings/keybinding-registry.ts`: delete the `journal.promoteCapture` and `journal.jumpToCaptures` objects.
`src/i18n/en.json` and `src/i18n/ko.json`: delete `keybindings.journal.promoteCapture` and `keybindings.journal.jumpToCaptures`.

- [ ] **Step 3: Remove orphaned helpers from `journal-capture.ts`**

Delete `insertCaptureIntoContent`, `buildNoteFromCapture`, `buildPromotedCaptureLink`, `parseCapturesFromMarkdown`, `extractCapturesSection`, and any now-unused types/consts (`CaptureItem`, `CaptureType`, `CAPTURE_TYPES`, `CAPTURE_ICONS`, `ICON_TO_TYPE`) **that knip reports as unused**. Keep `resolveNotesDir` only if still referenced. Do not delete a symbol that still has a consumer — let `knip` + `tsc` be the arbiter.

- [ ] **Step 4: Trim the capture tests**

In `src/utils/__tests__/journal-capture.test.ts`, remove the `describe`/`it` blocks that test the deleted helpers. Keep tests for any surviving export. If the whole file becomes empty, delete it.

- [ ] **Step 5: Verify removal is clean**

Run: `npx tsc --noEmit` (clean — no dangling refs) then `npx knip` (no new unused exports from journal-capture) then `npx vitest run` (0 failures, >= the post-Task-6 count).
Expected: all clean; the deletions leave no orphans.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-keybinding-actions.ts src/keybindings/keybinding-registry.ts src/i18n/en.json src/i18n/ko.json src/utils/journal/journal-capture.ts src/utils/__tests__/journal-capture.test.ts
git commit -m "refactor(journal): remove legacy in-file capture (superseded by zettelkasten inbox)"
```

---

## Self-Review

- **Spec coverage:** §94 identity/creation → Tasks 1,2,3,4 (id, builders, title dialog, New Zettel). §99 capture → inbox → Task 5. §96 promote → Task 6. Legacy retirement (O1 decision) → Task 7. **Deferred to Plan 2b:** `[[ID]]` links, ID-based resolver, WikilinkView live-title, autocomplete, New-from-selection, backlinks/graph, export ID→title. **Deferred to Plan 2c:** settings UI to enable/pick zettel dir, activity bar, startup home/inbox, filename↔title rename, dialog CSS, MOC.
- **Reachability caveat (logged, not silent):** until Plan 2c adds the settings UI, `zettelkastenEnabled`/`zettelkastenDirectory` must be set via persisted state for the commands to fire; all Task logic is unit-tested independent of that UI. New-from-selection is intentionally absent (needs 2b's link insertion).
- **Placeholder scan:** the "verify against real `listDir` shape" (Task 4) and "let knip/tsc arbitrate deletions" (Task 7) are correctness checks, not deferred work — removal tasks are legitimately compiler-verified.
- **Type consistency:** `generateZettelId(Set<string>)`, `buildPermanentNote/{id,title,created}→{filename,content}`, `buildFleetingNote/{id,body,created}`, `createZettelNote/captureFleeting/promoteFleeting(zettelDir,…)→{path}|null`, `openZettelTitleDialog(onSubmit)` — used identically across tasks.
- **Behavior note:** removing `journal.jumpToCaptures` + `journal.promoteCapture` is intentional per the O1 "지금 제거" decision; existing journal `## Captures` file content is never rewritten (data-preserving).
