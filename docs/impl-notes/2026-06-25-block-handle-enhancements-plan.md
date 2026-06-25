# Block Handle Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Notion-style drag-to-reorder, a "Turn into" type-conversion submenu, and Copy-link / Add-block-below helpers to the editor block handle (§4.8).

**Architecture:** Reuse the existing `drop-indicator.ts` (DOM-rect insertion targeting, WKWebView-safe — avoids `posAtCoords`) and the FileTree mouse-event DnD pattern. Drag logic lives in a new `use-block-drag.ts` hook; Turn-into and link builders are pure helpers. `BlockHandle.tsx` only wires them in. No new persisted attributes → Markdown round-trip is untouched.

**Tech Stack:** React 19 + TypeScript (strict), Tiptap v2 / ProseMirror, Vitest, Tauri WKWebView.

## Global Constraints

- TypeScript strict; function components + hooks only; file names kebab-case.
- Single file ≤ ~300 lines; split focused submodules past ~500.
- Zustand access in components via `useShallow` selectors; non-reactive reads use `useXStore.getState()`.
- **WKWebView: HTML5 DnD API is broken** — use mouse events (mousedown → document mousemove/mouseup), never `dragstart`/`drop`.
- **Markdown round-trip is the top quality bar.** This feature adds no persisted attributes; converted blocks must serialize identically to typed equivalents.
- Tests: Vitest only (`npm test` → `vitest run`). NEVER `npx jest`.
- Keep `§4.8` / `§4.2` reference comments in touched code.
- Conventional Commits in English: `feat:`/`fix:`/`refactor:`/`test:`.

## File Structure

- `src/utils/editor/move-block.ts` *(new)* — `moveBlock()` pure-ish helper (dispatches a transaction).
- `src/components/toolbar/use-block-drag.ts` *(new)* — drag state machine hook.
- `src/utils/toolbar/block-turn-into.ts` *(new)* — `buildTurnIntoItems()` builder.
- `src/utils/toolbar/block-link.ts` *(new)* — `buildBlockLink()` + `ensureBlockId()`.
- `src/components/toolbar/BlockHandle.tsx` *(modify)* — wire hook, add submenu + menu items + `+` button.
- `src/styles/toolbar.css` *(modify)* — `+` button + drag-active styles.
- Tests: `src/__tests__/unit/move-block.test.ts`, `block-turn-into.test.ts`, `block-link.test.ts` *(new)*.

---

### Task 1: `moveBlock` node-move helper

**Files:**
- Create: `src/utils/editor/move-block.ts`
- Test: `src/__tests__/unit/move-block.test.ts`

**Interfaces:**
- Produces: `moveBlock(editor: Editor, sourcePos: number, targetPos: number): boolean` — moves the top-level block starting at `sourcePos` so it sits at `targetPos` (a boundary position from `resolveInsertTarget`). Returns `false` on no-op (drop within the source's own range or invalid). Single transaction (one undo step).

- [ ] **Step 1: Write the failing test**

Follow the existing extension-test pattern (see `src/extensions/__tests__/*` for how editors are built — use the same `createEditor`/`Editor` setup helper the suite already uses). Test the reorder of three paragraphs.

```ts
// src/__tests__/unit/move-block.test.ts
import { describe, expect, it } from "vitest";
import { moveBlock } from "../../utils/editor/move-block";
import { makeTestEditor } from "../helpers/make-test-editor"; // reuse existing helper; if none, build an Editor with paragraph/heading/list extensions

function texts(editor: ReturnType<typeof makeTestEditor>): string[] {
  const out: string[] = [];
  editor.state.doc.forEach((n) => out.push(n.textContent));
  return out;
}

describe("moveBlock", () => {
  it("moves a block down past the next block", () => {
    const editor = makeTestEditor("<p>A</p><p>B</p><p>C</p>");
    // pos 0 = block A. Target = position after C (end of doc).
    const cEnd = editor.state.doc.content.size;
    expect(moveBlock(editor, 0, cEnd)).toBe(true);
    expect(texts(editor)).toEqual(["B", "C", "A"]);
  });

  it("moves a block up", () => {
    const editor = makeTestEditor("<p>A</p><p>B</p><p>C</p>");
    // move C (last block) to the very start (pos 0)
    const cStart = editor.state.doc.content.size - editor.state.doc.lastChild!.nodeSize;
    expect(moveBlock(editor, cStart, 0)).toBe(true);
    expect(texts(editor)).toEqual(["C", "A", "B"]);
  });

  it("is a no-op when dropping within the source's own range", () => {
    const editor = makeTestEditor("<p>A</p><p>B</p>");
    expect(moveBlock(editor, 0, 1)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- move-block`
Expected: FAIL — `moveBlock` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/editor/move-block.ts
import type { Editor } from "@tiptap/core";

/**
 * §4.8 Move the top-level block at `sourcePos` to `targetPos` (a boundary
 * position produced by resolveInsertTarget) in a single transaction.
 * Returns false on no-op: missing node, or a target inside the source's range.
 */
export function moveBlock(
  editor: Editor,
  sourcePos: number,
  targetPos: number,
): boolean {
  const { state } = editor;
  const node = state.doc.nodeAt(sourcePos);
  if (!node) return false;

  const sourceEnd = sourcePos + node.nodeSize;
  // Dropping anywhere inside the block's own span is a no-op.
  if (targetPos >= sourcePos && targetPos <= sourceEnd) return false;

  const tr = state.tr;
  tr.delete(sourcePos, sourceEnd);
  // Map the target across the delete (positions after the cut shift left).
  const insertAt = tr.mapping.map(targetPos);
  tr.insert(insertAt, node);
  editor.view.dispatch(tr);
  return true;
}
```

Note: list-item granularity is handled by `resolveInsertTarget` returning a position that, after the delete, lands between items; `tr.insert` of a block between list items will place it at the parent level. Keep this helper top-level-block focused; list-splitting drops reuse `insertNodeAtPos` in Task 2's drop handler when the target resolves inside a list.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- move-block`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/editor/move-block.ts src/__tests__/unit/move-block.test.ts
git commit -m "feat(§4.8): add moveBlock helper for block reordering"
```

---

### Task 2: `use-block-drag` hook

**Files:**
- Create: `src/components/toolbar/use-block-drag.ts`

**Interfaces:**
- Consumes: `moveBlock` (Task 1); `resolveInsertTarget`, `showDropIndicator`, `hideDropIndicator`, `insertNodeAtPos` from `src/utils/editor/drop-indicator.ts`; `getEditorZoom` from `src/utils/zoom-coords.ts`.
- Produces: `useBlockDrag(editor: Editor): { startDrag: (e: React.MouseEvent, blockPos: number) => void; isDragging: boolean }`. `startDrag` is called from the grip's `onMouseDown`. Drag begins only after the pointer passes `BLOCK_DRAG_THRESHOLD_PX = 5`. The hook owns document-level `mousemove`/`mouseup`, the drop indicator, and `body.classList` cursor state.

- [ ] **Step 1: Write the hook**

Mirror `use-file-tree-dnd.ts` (threshold gate, `dragRef`, document listeners, `preventDefault` on every move). On drop, if the target resolves inside a list use `insertNodeAtPos` after deleting the source; otherwise use `moveBlock`. Because that branch needs the post-delete document, the list path deletes first, then re-resolves by `clientY`.

```ts
// src/components/toolbar/use-block-drag.ts
import { useCallback, useEffect, useRef, useState } from "react";

import type { Editor } from "@tiptap/react";

import {
  hideDropIndicator,
  insertNodeAtPos,
  resolveInsertTarget,
  showDropIndicator,
} from "../../utils/editor/drop-indicator";
import { moveBlock } from "../../utils/editor/move-block";

const BLOCK_DRAG_THRESHOLD_PX = 5;

interface DragState {
  active: boolean;
  blockPos: number;
  startX: number;
  startY: number;
}

export function useBlockDrag(editor: Editor): {
  isDragging: boolean;
  startDrag: (e: React.MouseEvent, blockPos: number) => void;
} {
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const s = dragRef.current;
      if (!s) return;
      if (!s.active) {
        if (
          Math.abs(e.clientX - s.startX) + Math.abs(e.clientY - s.startY) <=
          BLOCK_DRAG_THRESHOLD_PX
        )
          return;
        s.active = true;
        setIsDragging(true);
        document.body.classList.add("block-dragging");
        window.getSelection()?.removeAllRanges();
      }
      e.preventDefault();
      const target = resolveInsertTarget(editor, e.clientX, e.clientY);
      if (target) showDropIndicator(target);
      else hideDropIndicator();
    };

    const onUp = (e: MouseEvent) => {
      const s = dragRef.current;
      dragRef.current = null;
      hideDropIndicator();
      document.body.classList.remove("block-dragging");
      if (!s || !s.active) {
        setIsDragging(false);
        return; // a click, not a drag — menu toggle handles it
      }
      setIsDragging(false);

      const target = resolveInsertTarget(editor, e.clientX, e.clientY);
      if (!target) return;

      const node = editor.state.doc.nodeAt(s.blockPos);
      if (!node) return;
      const sourceEnd = s.blockPos + node.nodeSize;
      // No-op if dropping into the source's own span.
      if (target.pos >= s.blockPos && target.pos <= sourceEnd) return;

      // List target → delete first, then re-resolve & split-insert.
      const $t = editor.state.doc.resolve(Math.min(target.pos, editor.state.doc.content.size));
      const intoList = /^(bulletList|orderedList|taskList)$/.test($t.parent.type.name);
      if (intoList) {
        editor.chain().deleteRange({ from: s.blockPos, to: sourceEnd }).run();
        const after = resolveInsertTarget(editor, e.clientX, e.clientY);
        if (after) insertNodeAtPos(editor, after.pos, node);
      } else {
        moveBlock(editor, s.blockPos, target.pos);
      }
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      hideDropIndicator();
      document.body.classList.remove("block-dragging");
    };
  }, [editor]);

  const startDrag = useCallback((e: React.MouseEvent, blockPos: number) => {
    if (e.button !== 0) return;
    dragRef.current = {
      blockPos,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
    };
  }, []);

  return { isDragging, startDrag };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/toolbar/use-block-drag.ts
git commit -m "feat(§4.8): add use-block-drag hook (mouse-event reorder)"
```

---

### Task 3: Wire drag into BlockHandle (click vs drag)

**Files:**
- Modify: `src/components/toolbar/BlockHandle.tsx`

**Interfaces:**
- Consumes: `useBlockDrag` (Task 2).

- [ ] **Step 1: Import and instantiate the hook**

Near the other hooks in `BlockHandle`:

```ts
import { useBlockDrag } from "./use-block-drag";
// ...inside the component, after `const handleRef = ...`:
const { startDrag, isDragging } = useBlockDrag(editor);
```

- [ ] **Step 2: Start drag from the grip button; suppress menu after a drag**

On the grip `<button>`: add `onMouseDown` to begin a potential drag, and guard the existing `onClick` so a completed drag doesn't open the menu.

```tsx
<button
  className="block-handle-btn"
  onMouseDown={(e) => handle && startDrag(e, handle.pos)}
  onClick={() => {
    if (isDragging) return; // a drag just ended — don't toggle the menu
    setMenuOpen(!menuOpen);
  }}
  title="Drag to move · click for menu"
>
  <GripVertical size={16} strokeWidth={2} />
</button>
```

- [ ] **Step 3: Type-check + manual verify**

Run: `npx tsc --noEmit` (clean). Then in the running app: hover a block, drag the grip up/down — an indicator bar appears and the block moves on release; a plain click still opens the menu; works on math/mermaid/code blocks and within lists; verify at zoom 100% and ≠100%.

- [ ] **Step 4: Commit**

```bash
git add src/components/toolbar/BlockHandle.tsx
git commit -m "feat(§4.8): drag the block handle to reorder blocks"
```

---

### Task 4: Drag-active styles

**Files:**
- Modify: `src/styles/toolbar.css`

- [ ] **Step 1: Add cursor + indicator emphasis while dragging**

Reuse the existing `.drop-indicator-bar` (already styled for image DnD). Add grab cursors:

```css
.block-handle-btn {
  cursor: grab;
}

body.block-dragging,
body.block-dragging * {
  cursor: grabbing !important;
  user-select: none;
}
```

Place the `body.block-dragging` rule with a leading blank line before it (stylelint `comment-empty-line-before`/`rule-empty-line-before`). No own-line comments mid-declaration.

- [ ] **Step 2: Verify lint + format**

Run: `npx stylelint src/styles/toolbar.css --max-warnings=0` and `npx prettier --check src/styles/toolbar.css`
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add src/styles/toolbar.css
git commit -m "feat(§4.8): add grab cursor styles for block drag"
```

---

### Task 5: `buildTurnIntoItems` builder

**Files:**
- Create: `src/utils/toolbar/block-turn-into.ts`
- Test: `src/__tests__/unit/block-turn-into.test.ts`

**Interfaces:**
- Produces:
  - `interface TurnIntoItem { label: string; isActive: boolean; run: () => void; }`
  - `buildTurnIntoItems(editor: Editor, pos: number): TurnIntoItem[]` — one item per target type; `isActive` marks the current block's type; `run()` selects the block at `pos` then runs the matching command.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/unit/block-turn-into.test.ts
import { describe, expect, it } from "vitest";
import { buildTurnIntoItems } from "../../utils/toolbar/block-turn-into";
import { makeTestEditor } from "../helpers/make-test-editor";

describe("buildTurnIntoItems", () => {
  it("converts a paragraph to Heading 1", () => {
    const editor = makeTestEditor("<p>Hello</p>");
    const items = buildTurnIntoItems(editor, 0);
    const h1 = items.find((i) => i.label === "Heading 1")!;
    expect(h1).toBeTruthy();
    h1.run();
    expect(editor.state.doc.firstChild!.type.name).toBe("heading");
    expect(editor.state.doc.firstChild!.attrs.level).toBe(1);
  });

  it("marks the current type active", () => {
    const editor = makeTestEditor("<h2>Title</h2>");
    const items = buildTurnIntoItems(editor, 0);
    expect(items.find((i) => i.label === "Heading 2")!.isActive).toBe(true);
    expect(items.find((i) => i.label === "Text")!.isActive).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- block-turn-into`
Expected: FAIL — builder not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/utils/toolbar/block-turn-into.ts
import type { Editor } from "@tiptap/core";

export interface TurnIntoItem {
  isActive: boolean;
  label: string;
  run: () => void;
}

interface Spec {
  isActive: (typeName: string, attrs: Record<string, unknown>) => boolean;
  label: string;
  run: (editor: Editor) => void;
}

const SPECS: Spec[] = [
  { label: "Text", isActive: (t) => t === "paragraph", run: (e) => e.chain().focus().setParagraph().run() },
  { label: "Heading 1", isActive: (t, a) => t === "heading" && a.level === 1, run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { label: "Heading 2", isActive: (t, a) => t === "heading" && a.level === 2, run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { label: "Heading 3", isActive: (t, a) => t === "heading" && a.level === 3, run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { label: "Bullet List", isActive: (t) => t === "bulletList", run: (e) => e.chain().focus().toggleBulletList().run() },
  { label: "Numbered List", isActive: (t) => t === "orderedList", run: (e) => e.chain().focus().toggleOrderedList().run() },
  { label: "To-do List", isActive: (t) => t === "taskList", run: (e) => e.chain().focus().toggleTaskList().run() },
  { label: "Quote", isActive: (t) => t === "blockquote", run: (e) => e.chain().focus().toggleBlockquote().run() },
  { label: "Code", isActive: (t) => t === "codeBlock", run: (e) => e.chain().focus().toggleCodeBlock().run() },
];

/** §4.8 Build "Turn into" items for the block at `pos`. */
export function buildTurnIntoItems(editor: Editor, pos: number): TurnIntoItem[] {
  const node = editor.state.doc.nodeAt(pos);
  const typeName = node?.type.name ?? "";
  const attrs = (node?.attrs ?? {}) as Record<string, unknown>;
  return SPECS.map((spec) => ({
    label: spec.label,
    isActive: spec.isActive(typeName, attrs),
    run: () => {
      // Put the selection inside the target block, then convert.
      editor.commands.setTextSelection(pos + 1);
      spec.run(editor);
    },
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- block-turn-into`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/toolbar/block-turn-into.ts src/__tests__/unit/block-turn-into.test.ts
git commit -m "feat(§4.8): add Turn-into block-type conversion builder"
```

---

### Task 6: Turn-into submenu in BlockHandle

**Files:**
- Modify: `src/components/toolbar/BlockHandle.tsx`

**Interfaces:**
- Consumes: `buildTurnIntoItems` (Task 5).

- [ ] **Step 1: Add submenu state + items**

Reuse the AI-submenu hover pattern. Add a `turnIntoOpen` state alongside `aiSubOpen`, and build items in the render body (after `currentNode` is computed):

```ts
const [turnIntoOpen, setTurnIntoOpen] = useState(false);
// ...in render body, near aiActions:
const turnIntoItems = buildTurnIntoItems(editor, handle.pos);
```

- [ ] **Step 2: Render the submenu as the first menu entry**

Insert at the top of `.block-handle-menu` (before "Duplicate"), mirroring `.block-handle-ai-trigger`:

```tsx
<div
  className="block-handle-ai-trigger"
  onMouseEnter={() => setTurnIntoOpen(true)}
  onMouseLeave={() => setTurnIntoOpen(false)}
>
  <button className="block-handle-menu-item block-handle-ai-item">
    <span>Turn into</span>
    <span className="block-handle-ai-arrow">{"▸"}</span>
  </button>
  {turnIntoOpen && (
    <div className="block-handle-ai-submenu">
      {turnIntoItems.map((item) => (
        <button
          className="block-handle-menu-item"
          key={item.label}
          onClick={() =>
            handleMenuAction(() => item.run())
          }
        >
          {item.isActive ? `✓ ${item.label}` : item.label}
        </button>
      ))}
    </div>
  )}
</div>
<div className="block-handle-separator" />
```

Reset `turnIntoOpen` wherever `aiSubOpen` is reset (close-on-outside-click, doc change, `handleMenuAction`).

- [ ] **Step 3: Type-check + manual verify**

Run: `npx tsc --noEmit` (clean). In-app: open the handle menu → hover "Turn into" → convert a paragraph to H1/quote/list/code and back; current type shows a check.

- [ ] **Step 4: Commit**

```bash
git add src/components/toolbar/BlockHandle.tsx
git commit -m "feat(§4.8): add Turn-into submenu to block handle"
```

---

### Task 7: `block-link` builder + `ensureBlockId`

**Files:**
- Create: `src/utils/toolbar/block-link.ts`
- Test: `src/__tests__/unit/block-link.test.ts`

**Interfaces:**
- Produces:
  - `blockBasename(filePath: string): string` — last path segment without trailing `.md`.
  - `buildBlockLink(basename: string, blockId: string, form: "wikilink" | "ref"): string` — `wikilink` → `[[basename#^id]]`, `ref` → `((basename#^id))`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/unit/block-link.test.ts
import { describe, expect, it } from "vitest";
import { blockBasename, buildBlockLink } from "../../utils/toolbar/block-link";

describe("block-link", () => {
  it("derives basename without .md", () => {
    expect(blockBasename("notes/ai/prompt.md")).toBe("prompt");
    expect(blockBasename("readme.md")).toBe("readme");
    expect(blockBasename("Untitled")).toBe("Untitled");
  });

  it("builds both link forms", () => {
    expect(buildBlockLink("prompt", "abc123", "wikilink")).toBe("[[prompt#^abc123]]");
    expect(buildBlockLink("prompt", "abc123", "ref")).toBe("((prompt#^abc123))");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- block-link`
Expected: FAIL — functions not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/utils/toolbar/block-link.ts

/** §4.8 Last path segment without a trailing `.md`. */
export function blockBasename(filePath: string): string {
  const last = filePath.split("/").pop() ?? filePath;
  return last.replace(/\.md$/i, "");
}

/** §4.8 Build a block link. `wikilink` → [[base#^id]], `ref` → ((base#^id)). */
export function buildBlockLink(
  basename: string,
  blockId: string,
  form: "ref" | "wikilink",
): string {
  return form === "wikilink"
    ? `[[${basename}#^${blockId}]]`
    : `((${basename}#^${blockId}))`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- block-link`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/toolbar/block-link.ts src/__tests__/unit/block-link.test.ts
git commit -m "feat(§4.8): add block-link builder (wikilink + block ref)"
```

---

### Task 8: Copy-link menu items in BlockHandle

**Files:**
- Modify: `src/components/toolbar/BlockHandle.tsx`

**Interfaces:**
- Consumes: `blockBasename`, `buildBlockLink` (Task 7); `addBlockId` (already imported); `useEditorStore` for the active tab's `filePath`.

- [ ] **Step 1: Add a copy helper inside the component**

`addBlockId(view, pos)` is **synchronous** — it calls `generateBlockId()`, `setNodeMarkup`s the `blockId` attr, and dispatches — so the id is readable from the updated doc immediately after (verified in `block-id-decoration.ts:381`). `blockId` is schema-supported only on `paragraph`/`heading` nodes, so these items are gated to those types (same as the existing `blockIdItem`).

```ts
import { useEditorStore } from "../../stores/editor/editor";
import { blockBasename, buildBlockLink } from "../../utils/toolbar/block-link";

// inside the component:
const copyBlockLink = useCallback(
  (form: "ref" | "wikilink") => {
    if (!handle) return;
    const { activeTabId, tabs } = useEditorStore.getState();
    const filePath = tabs.find((t) => t.id === activeTabId)?.filePath ?? "";
    const base = blockBasename(filePath);

    // addBlockId is synchronous (generateBlockId + setNodeMarkup + dispatch),
    // so the id is readable right after the call — no rAF needed.
    let id = editor.state.doc.nodeAt(handle.pos)?.attrs.blockId as null | string;
    if (!id) {
      addBlockId(editor.view, handle.pos);
      id = editor.state.doc.nodeAt(handle.pos)?.attrs.blockId as null | string;
    }
    if (id) void navigator.clipboard.writeText(buildBlockLink(base, id, form));
  },
  [editor, handle],
);
```

- [ ] **Step 2: Add the two menu items (paragraph/heading only)**

Gate these to `paragraph`/`heading` (blockId is unsupported on other node types). Build them the same way as `blockIdItem`, e.g. extend that IIFE or add a parallel one, and spread into `menuItems`:

```ts
const copyLinkItems: DropdownItem[] = (() => {
  if (!handle) return [];
  const node = editor.state.doc.nodeAt(handle.pos);
  if (!node || (node.type.name !== "paragraph" && node.type.name !== "heading"))
    return [];
  return [
    { label: "Copy link", separator: true, action: () => copyBlockLink("wikilink") },
    { label: "Copy block ref", action: () => copyBlockLink("ref") },
  ];
})();
// then include `...copyLinkItems` in the menuItems array (before blockIdItem).
```

- [ ] **Step 3: Type-check + manual verify**

Run: `npx tsc --noEmit` (clean). In-app: Copy link / Copy block ref on a paragraph → paste shows `[[file#^id]]` / `((file#^id))`; a blockId is created if absent; clicking the resulting wikilink navigates to the block.

- [ ] **Step 4: Commit**

```bash
git add src/components/toolbar/BlockHandle.tsx
git commit -m "feat(§4.8): add Copy link / Copy block ref to block handle"
```

---

### Task 9: "Add block below" `+` button

**Files:**
- Modify: `src/components/toolbar/BlockHandle.tsx`, `src/styles/toolbar.css`

- [ ] **Step 1: Add the `+` button beside the grip**

Import `Plus` from lucide-react. Render it inside `.block-handle`, before the grip button:

```tsx
import { GripVertical, Plus, Sparkles } from "lucide-react";
// ...inside .block-handle, before the grip <button>:
<button
  className="block-handle-add-btn"
  onClick={() => {
    if (!handle) return;
    const node = editor.state.doc.nodeAt(handle.pos);
    if (!node) return;
    const insertAt = handle.pos + node.nodeSize;
    editor
      .chain()
      .focus()
      .insertContentAt(insertAt, { type: "paragraph" })
      .setTextSelection(insertAt + 1)
      .run();
  }}
  title="Add block below"
>
  <Plus size={14} strokeWidth={2} />
</button>
```

- [ ] **Step 2: Style the `+` button**

```css
.block-handle-add-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 24px;
  color: var(--color-text-muted);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 3px;
}

.block-handle-add-btn:hover {
  color: var(--color-text-primary);
  background-color: var(--color-bg-elevated, var(--color-bg-subtle));
}
```

- [ ] **Step 3: Type-check, lint, manual verify**

Run: `npx tsc --noEmit`, `npx stylelint src/styles/toolbar.css --max-warnings=0`, `npx prettier --check src/styles/toolbar.css` (all clean). In-app: `+` inserts an empty paragraph below and places the cursor in it.

- [ ] **Step 4: Commit**

```bash
git add src/components/toolbar/BlockHandle.tsx src/styles/toolbar.css
git commit -m "feat(§4.8): add '+' add-block-below button to block handle"
```

---

## Final verification

- [ ] `npm test` — full suite green (new unit tests included).
- [ ] `npx tsc --noEmit` — clean.
- [ ] `npx eslint src/components/toolbar/ src/utils/toolbar/ src/utils/editor/move-block.ts --max-warnings=0` — clean.
- [ ] Manual WKWebView pass at zoom 1 and ≠1: drag-reorder (incl. lists, atom blocks), Turn into, Copy link/ref, `+` add-below; plain click still opens the menu; handle still hides on zoom/scroll.

## Notes / open verifications for the implementer

- **`makeTestEditor` helper**: the exact name/path may differ — reuse whatever the existing `src/extensions/__tests__` / `src/__tests__` suites use to build an `Editor` with the project's extensions. Don't invent a new harness if one exists.
- **List-item drag** (Task 2): baseline is "move as a top-level block"; deeper list re-nesting is out of scope.
- **Copy link scope** (Task 8): `blockId` is schema-supported only on `paragraph`/`heading`; the menu items are gated to those types. Extending block links to other node types would need schema work and is out of scope.
