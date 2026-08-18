# Export Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the ExportDialog's flat format-card list into a category-grouped dropdown, and render Mermaid diagrams in exported documents (Pandoc formats embed rasterized PNGs; Notion keeps clean native `mermaid` code blocks).

**Architecture:** Two independent workstreams. (1) **Menu**: a new `ExportFormatDropdown` component replaces the vertical card list inside the existing `ExportDialog`; the File → Export… entry point already exists and is wired. (2) **Mermaid export**: before Pandoc conversion, each ` ```mermaid ` fence is rasterized to a PNG (reusing PR #157's `renderMermaidRasterSvg` + `svgToPngBlob`) and replaced with an `![](baram-asset:NAME)` image reference; the PNG bytes ride along a new `assets` IPC parameter, and Rust writes them into Pandoc's temp dir and rewrites the references to absolute paths. Notion export simply strips the `%% baram-meta` comment so Notion's native code-block Mermaid rendering gets clean source.

**Tech Stack:** React 19 + TypeScript, Tiptap/ProseMirror, Vitest + @testing-library/react (frontend); Rust + Tauri 2, cargo test (backend); Pandoc CLI.

## Global Constraints

- TypeScript strict mode; functional components + hooks only; file names kebab-case; components/Extensions PascalCase.
- Zustand access in components MUST use `useShallow` selectors (no bare `useStore()`).
- Single files ≤ ~300 lines; CSS files ≤ ~1,500 lines.
- Tests: Vitest via `npm test` (never `npx jest`); Rust via `cargo test`. Roundtrip preservation is the top quality bar.
- No new Rust crates (there is no `base64` crate) — transport binary assets as `Vec<u8>` (a JSON number array), matching the existing `export_binary_file` pattern.
- IPC changes MUST update `src-tauri/ipc-registry.json` AND `src/ipc/types.ts` together.
- Commits: Conventional Commits with design section refs (`§5.12` menu/HTML export, `§55` Pandoc, `§53` Notion, `§5.5` Mermaid). Git messages in English.
- Existing File → Export… entry point (`src-tauri/src/menu.rs:48` id `export_doc` → `src/hooks/use-menu-event-handler.ts:67` → `openExportDialog("html")`) is DONE — do not modify, only rely on it.

**Baseline types (already in the codebase — do not redefine):**
- `ExportFormat = "docx" | "epub" | "html" | "latex" | "notion" | "pdf" | "rst"` (`src/stores/ui/ui.ts:35`)
- `PandocFormat = "docx" | "epub" | "latex" | "rst"` (`src/ipc/types.ts:234`)
- Exported helpers: `svgToPngBlob(svgHtml, scale=2): Promise<Blob>` (`src/utils/markdown/svg-utils.ts`), `stripMermaidMeta(code): string` (`src/utils/markdown/mermaid-meta.ts:57`), `replaceOutsideCode(...)` (`src/utils/markdown/markdown-code-regions.ts:54`).

---

## File Structure

**Menu workstream**
- Create `src/components/export/ExportFormatDropdown.tsx` — grouped format dropdown (trigger button + popup). One responsibility: pick a format.
- Modify `src/components/export/ExportDialog.tsx` — swap the `export-format-list` card block for `<ExportFormatDropdown>`.
- Modify `src/styles/dialogs.css` — add `.export-format-dropdown*` styles.
- Create `src/components/export/__tests__/ExportFormatDropdown.test.tsx`.

**Mermaid export workstream**
- Modify `src/utils/markdown/mermaid-utils.ts` — export `renderMermaidRasterSvg`.
- Create `src/utils/export/mermaid-export-assets.ts` — `rewriteMermaidForPandoc` + `PandocAsset` (frontend) helper.
- Create `src/utils/export/__tests__/mermaid-export-assets.test.ts`.
- Modify `src/utils/export/notion-export.ts` — `stripMermaidMetaForNotion` + wire into `convertForNotion`.
- Modify `src/utils/export/__tests__/notion-export.test.ts` (or the existing notion test file) — add cases.
- Modify `src/utils/export/export.ts` — `exportWithPandoc` calls the rewrite and passes assets.
- Modify `src/ipc/export.ts` + `src/ipc/types.ts` — add `assets` param + `PandocAsset` type.
- Modify `src-tauri/src/export/pandoc.rs` — `PandocAsset` struct, `rewrite_asset_refs`, `run_pandoc` writes assets.
- Modify `src-tauri/src/commands/export_cmd.rs` — `export_pandoc` accepts `assets`.
- Modify `src-tauri/ipc-registry.json` — add `assets` to `export_pandoc`.

---

## Task 1: ExportFormatDropdown component

**Files:**
- Create: `src/components/export/ExportFormatDropdown.tsx`
- Test: `src/components/export/__tests__/ExportFormatDropdown.test.tsx`

**Interfaces:**
- Produces:
  - `interface ExportFormatOption { id: ExportFormat; ext: string; name: string; desc: string; pandoc: boolean; }`
  - `interface ExportFormatGroup { label: string; options: ExportFormatOption[]; }`
  - `function ExportFormatDropdown(props: { groups: ExportFormatGroup[]; value: ExportFormat; pandocAvailable: boolean; onChange: (id: ExportFormat) => void; }): JSX.Element`
  - Pandoc options are disabled (not selectable) when `pandocAvailable` is false.
- Consumes: `ExportFormat` from `../../stores/ui/ui` (import type).

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/export/__tests__/ExportFormatDropdown.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExportFormatDropdown } from "../ExportFormatDropdown";
import type { ExportFormatGroup } from "../ExportFormatDropdown";

const groups: ExportFormatGroup[] = [
  {
    label: "웹",
    options: [
      { id: "html", ext: ".html", name: "HTML", desc: "Standalone page", pandoc: false },
      { id: "pdf", ext: ".pdf", name: "PDF", desc: "Print-ready", pandoc: false },
    ],
  },
  {
    label: "문서 (Pandoc)",
    options: [
      { id: "docx", ext: ".docx", name: "Word", desc: "Editable", pandoc: true },
    ],
  },
];

describe("ExportFormatDropdown", () => {
  it("shows the current format on the trigger button", () => {
    render(
      <ExportFormatDropdown groups={groups} value="pdf" pandocAvailable onChange={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /PDF/ })).toBeInTheDocument();
  });

  it("opens the popup and selects a format via onChange", () => {
    const onChange = vi.fn();
    render(
      <ExportFormatDropdown groups={groups} value="html" pandocAvailable onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /HTML/ }));
    fireEvent.click(screen.getByText("Word"));
    expect(onChange).toHaveBeenCalledWith("docx");
  });

  it("disables pandoc options when pandoc is unavailable", () => {
    const onChange = vi.fn();
    render(
      <ExportFormatDropdown groups={groups} value="html" pandocAvailable={false} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /HTML/ }));
    fireEvent.click(screen.getByText("Word"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/export/__tests__/ExportFormatDropdown.test.tsx`
Expected: FAIL — cannot resolve `../ExportFormatDropdown`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/export/ExportFormatDropdown.tsx
// §5.12 Export — category-grouped format dropdown (replaces flat card list)
import { useEffect, useRef, useState } from "react";

import type { ExportFormat } from "../../stores/ui/ui";

export interface ExportFormatOption {
  id: ExportFormat;
  ext: string;
  name: string;
  desc: string;
  pandoc: boolean;
}

export interface ExportFormatGroup {
  label: string;
  options: ExportFormatOption[];
}

interface Props {
  groups: ExportFormatGroup[];
  value: ExportFormat;
  pandocAvailable: boolean;
  onChange: (id: ExportFormat) => void;
}

export function ExportFormatDropdown({
  groups,
  value,
  pandocAvailable,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const current = groups
    .flatMap((g) => g.options)
    .find((o) => o.id === value);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  return (
    <div className="export-format-dropdown" ref={rootRef}>
      <button
        aria-haspopup="listbox"
        className="export-format-trigger"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        {current && <span className="export-ext-badge">{current.ext}</span>}
        <span className="export-format-trigger-name">
          {current ? current.name : "Select format"}
        </span>
        <span className="export-format-trigger-caret">▾</span>
      </button>

      {open && (
        <div className="export-format-popup" role="listbox">
          {groups.map((group) => (
            <div className="export-format-group" key={group.label}>
              <div className="export-format-group-label">{group.label}</div>
              {group.options.map((opt) => {
                const disabled = opt.pandoc && !pandocAvailable;
                return (
                  <button
                    className={`export-format-item${
                      opt.id === value ? " export-format-item-selected" : ""
                    }${disabled ? " export-format-item-disabled" : ""}`}
                    disabled={disabled}
                    key={opt.id}
                    onClick={() => {
                      if (disabled) return;
                      onChange(opt.id);
                      setOpen(false);
                    }}
                    role="option"
                    aria-selected={opt.id === value}
                    type="button"
                  >
                    <span className="export-ext-badge">{opt.ext}</span>
                    <span className="export-format-item-info">
                      <span className="export-format-item-name">{opt.name}</span>
                      <span className="export-format-item-desc">{opt.desc}</span>
                    </span>
                    {opt.pandoc && (
                      <span className="export-pandoc-badge">pandoc</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/export/__tests__/ExportFormatDropdown.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/export/ExportFormatDropdown.tsx src/components/export/__tests__/ExportFormatDropdown.test.tsx
git commit -m "feat(§5.12): add ExportFormatDropdown grouped format picker"
```

---

## Task 2: Integrate dropdown into ExportDialog + styles

**Files:**
- Modify: `src/components/export/ExportDialog.tsx` (replace card list block at `211-254`, add groups derived from `FORMAT_OPTIONS`)
- Modify: `src/styles/dialogs.css` (add dropdown styles)

**Interfaces:**
- Consumes: `ExportFormatDropdown`, `ExportFormatGroup` from Task 1; existing `FORMAT_OPTIONS`, `openExportDialog`, `exportFormat` in the dialog.

- [ ] **Step 1: Add a grouped view of FORMAT_OPTIONS in ExportDialog.tsx**

Just below the existing `FORMAT_OPTIONS` / `PANDOC_FORMATS` declarations (`ExportDialog.tsx:25-77`), add:

```tsx
import { ExportFormatDropdown } from "./ExportFormatDropdown";
import type { ExportFormatGroup } from "./ExportFormatDropdown";

const FORMAT_GROUPS: ExportFormatGroup[] = [
  {
    label: "웹",
    options: [
      { id: "html", ext: ".html", name: "HTML", desc: "Standalone page", pandoc: false },
      { id: "pdf", ext: ".pdf", name: "PDF", desc: "Print-ready document", pandoc: false },
    ],
  },
  {
    label: "마크다운",
    options: [
      { id: "notion", ext: ".md", name: "Notion", desc: "Notion-compatible Markdown", pandoc: false },
    ],
  },
  {
    label: "문서 (Pandoc)",
    options: [
      { id: "docx", ext: ".docx", name: "Word", desc: "Editable document", pandoc: true },
      { id: "latex", ext: ".tex", name: "LaTeX", desc: "Typesetting", pandoc: true },
      { id: "epub", ext: ".epub", name: "EPUB", desc: "E-book format", pandoc: true },
      { id: "rst", ext: ".rst", name: "RST", desc: "Sphinx documentation", pandoc: true },
    ],
  },
];
```

(The existing `FORMAT_OPTIONS` array stays — it is still the source of truth referenced elsewhere in the file; `FORMAT_GROUPS` is the grouped presentation. Both list the same 7 formats.)

- [ ] **Step 2: Replace the card list block with the dropdown**

Replace the `Format` field's inner list (`ExportDialog.tsx:210-240`, the `<div className="export-format-list">…</div>` and its `.map`) with:

```tsx
            <ExportFormatDropdown
              groups={FORMAT_GROUPS}
              onChange={(id) => openExportDialog(id)}
              pandocAvailable={pandocAvailable}
              value={exportFormat}
            />
```

Leave the surrounding `export-dialog-field`, the `<label>Format</label>`, and the `!pandocAvailable` warning paragraph (`241-253`) intact.

- [ ] **Step 3: Add dropdown styles**

Append to `src/styles/dialogs.css`:

```css
/* §5.12 Export format dropdown */
.export-format-dropdown {
  position: relative;
  width: 100%;
}
.export-format-trigger {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.5rem 0.75rem;
  background: var(--color-bg-subtle);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md, 6px);
  cursor: pointer;
  font: inherit;
  color: var(--color-text-default);
}
.export-format-trigger-name { flex: 1; text-align: left; }
.export-format-trigger-caret { opacity: 0.6; }
.export-format-popup {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 20;
  max-height: 320px;
  overflow-y: auto;
  background: var(--color-bg-default);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md, 6px);
  box-shadow: var(--shadow-lg);
  padding: 0.25rem;
}
.export-format-group-label {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  padding: 0.35rem 0.5rem 0.15rem;
}
.export-format-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.4rem 0.5rem;
  background: none;
  border: none;
  border-radius: var(--radius-sm, 4px);
  cursor: pointer;
  font: inherit;
  color: var(--color-text-default);
  text-align: left;
}
.export-format-item:hover:not(.export-format-item-disabled) {
  background: var(--color-bg-hover);
}
.export-format-item-selected { background: var(--color-bg-hover); }
.export-format-item-disabled { opacity: 0.45; cursor: not-allowed; }
.export-format-item-info { display: flex; flex-direction: column; flex: 1; }
.export-format-item-desc { font-size: 0.75rem; color: var(--color-text-muted); }
```

Then remove the now-unused `.export-format-list` / `.export-format-card*` rules from `dialogs.css` (search for `export-format-card` and delete those blocks).

- [ ] **Step 4: Typecheck + run the dialog-adjacent tests**

Run: `npx tsc --noEmit && npx vitest run src/components/export`
Expected: no TS errors; ExportFormatDropdown tests PASS. (If a pre-existing ExportDialog test asserts on `.export-format-card`, update it to the dropdown; note any such change in the commit.)

- [ ] **Step 5: Verify in the running app**

Run the app, open File → Export…, confirm the format dropdown opens, groups render, pandoc items disable when pandoc is absent, and selecting a format updates the options below.

- [ ] **Step 6: Commit**

```bash
git add src/components/export/ExportDialog.tsx src/styles/dialogs.css
git commit -m "feat(§5.12): replace export format card list with grouped dropdown"
```

---

## Task 3: Notion — keep clean native Mermaid code blocks

**Files:**
- Modify: `src/utils/export/notion-export.ts` (add `stripMermaidMetaForNotion`, wire into `convertForNotion`)
- Modify: `src/utils/__tests__/notion-export.test.ts` (add cases)

**Interfaces:**
- Produces: `function stripMermaidMetaForNotion(md: string): string` — removes the `%% baram-meta …` line inside every ` ```mermaid ` fence, leaving the fence and diagram source intact.
- Consumes: `stripMermaidMeta` from `../markdown/mermaid-meta`.

- [ ] **Step 1: Write the failing test**

Add to `src/utils/__tests__/notion-export.test.ts`:

```ts
import { convertForNotion, stripMermaidMetaForNotion } from "../export/notion-export";

describe("stripMermaidMetaForNotion", () => {
  it("removes the baram-meta comment but keeps the mermaid fence + code", () => {
    const md = [
      "```mermaid",
      "%% baram-meta: {\"width\":60}",
      "graph TD",
      "  A --> B",
      "```",
    ].join("\n");
    const out = stripMermaidMetaForNotion(md);
    expect(out).toContain("```mermaid");
    expect(out).toContain("graph TD");
    expect(out).toContain("A --> B");
    expect(out).not.toContain("baram-meta");
  });

  it("leaves non-mermaid code fences untouched", () => {
    const md = ["```js", "const x = 1; // baram-meta", "```"].join("\n");
    expect(stripMermaidMetaForNotion(md)).toBe(md);
  });
});

describe("convertForNotion + mermaid", () => {
  it("preserves a mermaid code block", () => {
    const md = ["```mermaid", "graph TD", "  A --> B", "```"].join("\n");
    const out = convertForNotion(md);
    expect(out).toContain("```mermaid");
    expect(out).toContain("A --> B");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/notion-export.test.ts`
Expected: FAIL — `stripMermaidMetaForNotion` is not exported.

- [ ] **Step 3: Implement**

In `src/utils/export/notion-export.ts`, add the import at top:

```ts
import { stripMermaidMeta } from "../markdown/mermaid-meta";
```

Add the function (place near the other converters):

```ts
/** Strip the `%% baram-meta` comment from mermaid fences so Notion imports a
 *  clean `mermaid` code block (Notion renders these natively). */
export function stripMermaidMetaForNotion(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (/^```mermaid\s*$/.test(lines[i])) {
      out.push(lines[i]); // opening fence
      i++;
      const body: string[] = [];
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      const cleaned = stripMermaidMeta(body.join("\n"));
      if (cleaned) out.push(...cleaned.split("\n"));
      if (i < lines.length) {
        out.push(lines[i]); // closing fence
        i++;
      }
      continue;
    }
    out.push(lines[i]);
    i++;
  }
  return out.join("\n");
}
```

Wire it into `convertForNotion` — add as the first block-level conversion (`notion-export.ts:333`, before `convertCalloutsForNotion`):

```ts
  // 1. Block-level conversions first
  result = stripMermaidMetaForNotion(result);
  result = convertCalloutsForNotion(result);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/__tests__/notion-export.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/export/notion-export.ts src/utils/__tests__/notion-export.test.ts
git commit -m "feat(§53): keep clean native mermaid code blocks in Notion export"
```

---

## Task 4: Frontend Mermaid → PNG rewrite helper

**Files:**
- Modify: `src/utils/markdown/mermaid-utils.ts` (export `renderMermaidRasterSvg`)
- Create: `src/utils/export/mermaid-export-assets.ts`
- Modify: `src/ipc/types.ts` (add `PandocAsset`)
- Test: `src/utils/export/__tests__/mermaid-export-assets.test.ts`

**Interfaces:**
- Produces:
  - `interface PandocAsset { name: string; data: number[]; }` (in `src/ipc/types.ts`)
  - `type MermaidPngRenderer = (code: string) => Promise<number[]>`
  - `async function rewriteMermaidForPandoc(markdown: string, render?: MermaidPngRenderer): Promise<{ markdown: string; assets: PandocAsset[] }>` — replaces the Nth ` ```mermaid ` fence with `![](baram-asset:mermaid-N.png)` and returns the PNG bytes as assets; on render failure the original fence is kept and no asset is added.
- Consumes: `stripMermaidMeta` (`../markdown/mermaid-meta`), `renderMermaidRasterSvg` (`../markdown/mermaid-utils`), `svgToPngBlob` (`../markdown/svg-utils`), `PandocAsset` (`../../ipc/types`).

- [ ] **Step 1: Export `renderMermaidRasterSvg`**

In `src/utils/markdown/mermaid-utils.ts:151`, change:

```ts
async function renderMermaidRasterSvg(code: string): Promise<string> {
```
to:
```ts
export async function renderMermaidRasterSvg(code: string): Promise<string> {
```

- [ ] **Step 2: Add `PandocAsset` to types.ts**

In `src/ipc/types.ts`, next to the Pandoc types (after `PandocFormat`, line 234):

```ts
/** A binary asset (e.g. rasterized Mermaid PNG) sent alongside a Pandoc
 *  export. `data` is raw bytes as a number array (no base64 dependency). */
export interface PandocAsset {
  /** File name written next to the Pandoc input, e.g. "mermaid-0.png" */
  name: string;
  /** Raw file bytes */
  data: number[];
}
```

- [ ] **Step 3: Write the failing test**

```ts
// src/utils/export/__tests__/mermaid-export-assets.test.ts
import { describe, expect, it, vi } from "vitest";

import { rewriteMermaidForPandoc } from "../mermaid-export-assets";

const fakeRender = vi.fn(async (_code: string) => [137, 80, 78, 71]); // fake PNG bytes

describe("rewriteMermaidForPandoc", () => {
  it("replaces mermaid fences with image refs and collects assets in order", async () => {
    const md = [
      "# Title",
      "```mermaid",
      "graph TD",
      "  A --> B",
      "```",
      "text",
      "```mermaid",
      "sequenceDiagram",
      "```",
    ].join("\n");

    const { markdown, assets } = await rewriteMermaidForPandoc(md, fakeRender);

    expect(markdown).toContain("![](baram-asset:mermaid-0.png)");
    expect(markdown).toContain("![](baram-asset:mermaid-1.png)");
    expect(markdown).not.toContain("```mermaid");
    expect(assets).toHaveLength(2);
    expect(assets[0]).toEqual({ name: "mermaid-0.png", data: [137, 80, 78, 71] });
  });

  it("strips baram-meta before rendering", async () => {
    const render = vi.fn(async (_code: string) => [1, 2]);
    const md = ["```mermaid", "%% baram-meta: {\"width\":50}", "graph TD", "```"].join("\n");
    await rewriteMermaidForPandoc(md, render);
    expect(render).toHaveBeenCalledWith("graph TD");
  });

  it("keeps the original fence when rendering fails", async () => {
    const render = vi.fn(async () => {
      throw new Error("render failed");
    });
    const md = ["```mermaid", "graph TD", "```"].join("\n");
    const { markdown, assets } = await rewriteMermaidForPandoc(md, render);
    expect(markdown).toContain("```mermaid");
    expect(markdown).toContain("graph TD");
    expect(assets).toHaveLength(0);
  });

  it("leaves non-mermaid content unchanged", async () => {
    const md = ["para", "```js", "code", "```"].join("\n");
    const { markdown, assets } = await rewriteMermaidForPandoc(md, fakeRender);
    expect(markdown).toBe(md);
    expect(assets).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/utils/export/__tests__/mermaid-export-assets.test.ts`
Expected: FAIL — cannot resolve `../mermaid-export-assets`.

- [ ] **Step 5: Implement the helper**

```ts
// src/utils/export/mermaid-export-assets.ts
// §5.5 / §55 — rasterize Mermaid blocks to PNG for Pandoc export embedding.
import type { PandocAsset } from "../../ipc/types";

import { stripMermaidMeta } from "../markdown/mermaid-meta";
import { renderMermaidRasterSvg } from "../markdown/mermaid-utils";
import { svgToPngBlob } from "../markdown/svg-utils";

export type MermaidPngRenderer = (code: string) => Promise<number[]>;

/** Default renderer: Mermaid source → SVG (SVG text labels) → 2x PNG bytes. */
async function defaultRenderer(code: string): Promise<number[]> {
  const svg = await renderMermaidRasterSvg(code);
  const blob = await svgToPngBlob(svg, 2);
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

/**
 * Replace each ` ```mermaid ` fence with an `![](baram-asset:mermaid-N.png)`
 * reference and return the rasterized PNGs as assets (in document order).
 * On a render failure the original fence is preserved and no asset is emitted.
 */
export async function rewriteMermaidForPandoc(
  markdown: string,
  render: MermaidPngRenderer = defaultRenderer,
): Promise<{ markdown: string; assets: PandocAsset[] }> {
  const lines = markdown.split("\n");
  const out: string[] = [];
  const assets: PandocAsset[] = [];
  let i = 0;
  let idx = 0;

  while (i < lines.length) {
    if (!/^```mermaid\s*$/.test(lines[i])) {
      out.push(lines[i]);
      i++;
      continue;
    }
    // Collect fence body (excluding opening/closing ``` lines)
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length && !/^```\s*$/.test(lines[j])) {
      body.push(lines[j]);
      j++;
    }
    const code = stripMermaidMeta(body.join("\n"));
    try {
      const data = await render(code);
      const name = `mermaid-${idx}.png`;
      assets.push({ name, data });
      out.push(`![](baram-asset:${name})`);
      idx++;
    } catch (err) {
      console.error("Mermaid export: render failed, keeping source", err);
      out.push("```mermaid");
      out.push(...body);
      out.push("```");
    }
    i = j < lines.length ? j + 1 : j; // skip the closing fence
  }

  return { markdown: out.join("\n"), assets };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/utils/export/__tests__/mermaid-export-assets.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add src/utils/markdown/mermaid-utils.ts src/utils/export/mermaid-export-assets.ts src/ipc/types.ts src/utils/export/__tests__/mermaid-export-assets.test.ts
git commit -m "feat(§55): add Mermaid→PNG rewrite helper for Pandoc export"
```

---

## Task 5: Rust — write assets + rewrite `baram-asset:` refs

**Files:**
- Modify: `src-tauri/src/export/pandoc.rs` (add `PandocAsset`, `rewrite_asset_refs`, extend `run_pandoc`)
- Modify: `src-tauri/src/commands/export_cmd.rs` (extend `export_pandoc`)

**Interfaces:**
- Produces (pandoc.rs):
  - `pub struct PandocAsset { pub name: String, pub data: Vec<u8> }` (`#[serde(rename_all = "camelCase")]`, `Deserialize`)
  - `fn rewrite_asset_refs(markdown: &str, name_to_path: &HashMap<String, String>) -> String`
  - `run_pandoc(markdown_content, output_path, pandoc_path, options, assets: &[PandocAsset])` — writes each asset into the input temp dir and rewrites `baram-asset:NAME` occurrences to the asset's absolute path before running Pandoc.
- Consumes: `export_pandoc` command passes `assets`.

- [ ] **Step 1: Write failing Rust tests**

Add to the `mod tests` block in `src-tauri/src/export/pandoc.rs`:

```rust
    #[test]
    fn test_rewrite_asset_refs_replaces_placeholder_with_path() {
        let mut map = HashMap::new();
        map.insert("mermaid-0.png".to_string(), "/tmp/x/mermaid-0.png".to_string());
        let md = "before ![](baram-asset:mermaid-0.png) after";
        let out = rewrite_asset_refs(md, &map);
        assert_eq!(out, "before ![](/tmp/x/mermaid-0.png) after");
    }

    #[test]
    fn test_rewrite_asset_refs_no_assets_is_identity() {
        let map = HashMap::new();
        let md = "no assets here";
        assert_eq!(rewrite_asset_refs(md, &map), md);
    }

    #[test]
    fn test_pandoc_asset_deserialize() {
        let json = r#"{ "name": "mermaid-0.png", "data": [137, 80, 78, 71] }"#;
        let asset: PandocAsset = serde_json::from_str(json).unwrap();
        assert_eq!(asset.name, "mermaid-0.png");
        assert_eq!(asset.data, vec![137, 80, 78, 71]);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test rewrite_asset_refs pandoc_asset_deserialize`
Expected: FAIL — `rewrite_asset_refs` / `PandocAsset` not found.

- [ ] **Step 3: Implement the struct + helper**

In `src-tauri/src/export/pandoc.rs`, add near `PandocExportOptions`:

```rust
/// A binary asset (e.g. rasterized Mermaid PNG) written alongside the Pandoc
/// input so Pandoc can embed it. `data` arrives as a JSON number array.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PandocAsset {
    pub name: String,
    pub data: Vec<u8>,
}

/// Replace `baram-asset:NAME` placeholders with the asset's absolute path.
fn rewrite_asset_refs(markdown: &str, name_to_path: &HashMap<String, String>) -> String {
    let mut result = markdown.to_string();
    for (name, path) in name_to_path {
        result = result.replace(&format!("baram-asset:{}", name), path);
    }
    result
}
```

- [ ] **Step 4: Extend `run_pandoc` to write assets + rewrite refs**

Change the signature (`pandoc.rs:139`) and the temp-file section (`pandoc.rs:145-149`):

```rust
pub fn run_pandoc(
    markdown_content: &str,
    output_path: &str,
    pandoc_path: &str,
    options: &PandocExportOptions,
    assets: &[PandocAsset],
) -> Result<(), ExportError> {
    // 1. Write markdown (with assets) to temp dir
    let tmp_dir = tempdir().map_err(|e| ExportError::TempFileError(e.to_string()))?;

    // 1a. Write each asset next to the input and map name -> absolute path
    let mut name_to_path: HashMap<String, String> = HashMap::new();
    for asset in assets {
        let asset_path = tmp_dir.path().join(&asset.name);
        std::fs::write(&asset_path, &asset.data)
            .map_err(|e| ExportError::TempFileError(e.to_string()))?;
        name_to_path.insert(
            asset.name.clone(),
            asset_path.to_string_lossy().to_string(),
        );
    }

    // 1b. Rewrite baram-asset: references to absolute paths
    let markdown_content = rewrite_asset_refs(markdown_content, &name_to_path);

    let input_path = tmp_dir.path().join("baram-pandoc-input.md");
    std::fs::write(&input_path, &markdown_content)
        .map_err(|e| ExportError::TempFileError(e.to_string()))?;
```

(The rest of `run_pandoc` — building the command, extra-args validation, execution — stays unchanged.)

- [ ] **Step 5: Update the `export_pandoc` command**

In `src-tauri/src/commands/export_cmd.rs`, update the import and the command:

```rust
use crate::export::pandoc::{self, PandocAsset, PandocExportOptions};
```

```rust
#[tauri::command]
pub async fn export_pandoc(
    markdown_content: String,
    output_path: String,
    format: String,
    pandoc_path: Option<String>,
    reference_doc: Option<String>,
    extra_args: Option<Vec<String>>,
    assets: Option<Vec<PandocAsset>>,
) -> Result<(), String> {
    let path = pandoc_path.unwrap_or_else(|| "pandoc".to_string());
    let options = PandocExportOptions {
        format,
        reference_doc,
        extra_args: extra_args.unwrap_or_default(),
    };
    let assets = assets.unwrap_or_default();

    tokio::task::spawn_blocking(move || {
        pandoc::run_pandoc(&markdown_content, &output_path, &path, &options, &assets)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
    .map_err(|e| e.to_string())
}
```

- [ ] **Step 6: Run tests + build to verify**

Run: `cd src-tauri && cargo test && cargo build`
Expected: new tests PASS; project builds (no other caller of `run_pandoc` exists).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/export/pandoc.rs src-tauri/src/commands/export_cmd.rs
git commit -m "feat(§55): write Mermaid PNG assets into Pandoc temp dir + rewrite refs"
```

---

## Task 6: Wire the frontend export path end-to-end

**Files:**
- Modify: `src/ipc/export.ts` (add `assets` param to `exportPandoc`)
- Modify: `src/utils/export/export.ts` (`exportWithPandoc` calls rewrite + passes assets)
- Modify: `src-tauri/ipc-registry.json` (add `assets` to `export_pandoc`)

**Interfaces:**
- Consumes: `rewriteMermaidForPandoc` (Task 4), `PandocAsset` (Task 4), updated `run_pandoc`/`export_pandoc` (Task 5).

- [ ] **Step 1: Extend the `exportPandoc` IPC wrapper**

In `src/ipc/export.ts`, update the import and signature:

```ts
import type {
  ExportFormat,
  ExportOptions,
  PandocAsset,
  PandocInfo,
  PdfOptions,
} from "./types";
```

```ts
export async function exportPandoc(
  markdownContent: string,
  outputPath: string,
  format: string,
  pandocPath?: string,
  referenceDoc?: string,
  extraArgs?: string[],
  assets?: PandocAsset[],
): Promise<void> {
  return invoke<void>("export_pandoc", {
    markdownContent,
    outputPath,
    format,
    pandocPath,
    referenceDoc,
    extraArgs,
    assets,
  });
}
```

- [ ] **Step 2: Call the rewrite in `exportWithPandoc`**

In `src/utils/export/export.ts`, add the import:

```ts
import { rewriteMermaidForPandoc } from "./mermaid-export-assets";
```

Change the body of `exportWithPandoc` (`export.ts:81-112`) so conversion is followed by the mermaid rewrite, and the assets are passed through:

```ts
export async function exportWithPandoc(
  editor: Editor,
  title: string,
  format: PandocFormat,
  options?: { pandocPath?: string; referenceDoc?: string },
): Promise<void> {
  const md = prosemirrorToMarkdown(editor.state.doc);
  const pandocMd = convertForPandoc(md);
  const { markdown: finalMd, assets } = await rewriteMermaidForPandoc(pandocMd);

  const extensionMap: Record<PandocFormat, string> = {
    docx: "docx",
    latex: "tex",
    epub: "epub",
    rst: "rst",
  };
  const ext = extensionMap[format];
  const filterName = format.toUpperCase();

  const path = await save({
    filters: [{ name: filterName, extensions: [ext] }],
    defaultPath: `${title}.${ext}`,
  });
  if (!path) return; // user cancelled

  await exportPandoc(
    finalMd,
    path,
    format,
    options?.pandocPath,
    options?.referenceDoc,
    undefined,
    assets,
  );
}
```

- [ ] **Step 3: Update ipc-registry.json**

In `src-tauri/ipc-registry.json`, the `export_pandoc` entry (`line 348-349`), change the `input` to add `assets`:

```json
      "input": { "markdownContent": "string", "outputPath": "string", "format": "string", "pandocPath": "string?", "referenceDoc": "string?", "extraArgs": "string[]?", "assets": "PandocAsset[]?" },
```

- [ ] **Step 4: Typecheck + run the export test suite**

Run: `npx tsc --noEmit && npx vitest run src/utils/export`
Expected: no TS errors; all export tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ipc/export.ts src/utils/export/export.ts src-tauri/ipc-registry.json
git commit -m "feat(§55): pass rasterized Mermaid assets through Pandoc export IPC"
```

---

## Task 7: Full verification + manual QA

**Files:** none (verification only)

- [ ] **Step 1: Full frontend test suite**

Run: `npm test`
Expected: all pass (prior baseline: 2356 passed | 5 skipped, plus the new tests).

- [ ] **Step 2: Full Rust test suite + build**

Run: `cd src-tauri && cargo test && cargo build`
Expected: all pass; clean build.

- [ ] **Step 3: Manual — menu**

Open File → Export…; confirm the grouped dropdown works, pandoc items disable without pandoc, format selection swaps the options panel (PDF paper/scale, Word template).

- [ ] **Step 4: Manual — Mermaid in Word (requires Pandoc)**

Create a doc with a Mermaid diagram + a KaTeX equation. Export to Word (.docx). Open the .docx: the Mermaid diagram appears as an embedded image; the equation is a native Word equation. Repeat quickly for LaTeX/EPUB/RST if tooling is available.

- [ ] **Step 5: Manual — Mermaid in Notion**

Export to Notion (.md). Confirm the ` ```mermaid ` block has no `%% baram-meta` line and imports into Notion as a native Mermaid code block.

- [ ] **Step 6: Dispatch a verifier agent**

Use the `verifier` agent (evidence-based) to confirm: new tests exist and pass, IPC registry/types are in sync, and no regression in existing export/roundtrip tests. Capture the test output as evidence.

- [ ] **Step 7: Final commit / PR prep**

Ensure all task commits are on `feature/export-improvements`. Prepare the PR body (motivation, design, architecture diagram, implementation, tests, checklist) per project PR style.

---

## Self-Review

**Spec coverage:**
- §4 Menu (File entry exists) → Tasks 1–2 (dropdown) ✔; entry point verified in Task 7 Step 3 ✔.
- §5.1 Pandoc Mermaid PNG embed → Tasks 4 (frontend rewrite), 5 (Rust assets), 6 (wiring) ✔.
- §5.2 Notion native code block → Task 3 ✔.
- §5.3 Error handling (render failure keeps source) → Task 4 test + impl ✔.
- §6 Tests → each task is TDD; Task 7 runs full suites + manual QA ✔.

**Placeholder scan:** No TBD/TODO; every code step shows complete code and exact commands. ✔

**Type consistency:** `PandocAsset { name: string; data: number[] }` (TS, Task 4) ↔ `PandocAsset { name: String, data: Vec<u8> }` camelCase (Rust, Task 5) ↔ IPC registry `PandocAsset[]?` (Task 6). `rewriteMermaidForPandoc` returns `{ markdown, assets }` used verbatim in Task 6. `ExportFormatGroup`/`ExportFormatOption` defined in Task 1, consumed in Task 2. `renderMermaidRasterSvg` exported in Task 4 Step 1 before use. ✔
