---
title: "Tables and table of contents"
---

## Tables

Baram supports GFM (GitHub Flavored Markdown) pipe tables.

**Creating a table:**

- **Pipe input** — Type `| Header 1 | Header 2 |` and press Enter to auto-create a table with headers filled in
- **Grid Picker** — Slash command `/table` or press `Cmd+T` to select dimensions from a 10×10 visual grid
- **TSV Paste** — Paste tab-separated data (e.g. from a spreadsheet) to auto-create a table

**Editing:**

- **Tab** / **Shift+Tab** to navigate between cells
- Column alignment (`:---`, `:---:`, `---:`) is preserved
- **Column resize** — Drag column borders to adjust width (session only, not saved to markdown)
- Hover over the table to see ⊕ buttons for adding rows and columns
- **Right-click** for context menu: alignment, header toggle, copy as Markdown/HTML, delete

**Merging and Splitting Cells:**

- **Merge Cells** — Select multiple cells, then press `Cmd+M` (macOS) / `Ctrl+M` (Windows/Linux), or right-click and select **Merge Table Cells**
- **Split Cell** — Place your cursor in a merged cell, then press `Cmd+M` again, or right-click and select **Split Cell**
- **Persistence** — Cell merges are preserved across source mode toggle (`Cmd+/`) and file reopen. Baram uses `<` and `^` markers inside the pipe table to encode colspan and rowspan information:

```markdown
| Merged Header | <  | Normal |
| ------------- | -- | ------ |
| Tall Cell     | A  | B      |
| ^             | C  | D      |
```

In this example, "Merged Header" spans 2 columns (the `<` marker extends it right), and "Tall Cell" spans 2 rows (the `^` marker extends it down). These markers are compatible with Obsidian Sheets Extended and render as plain text in other markdown viewers.

## Table of Contents

Insert a table of contents that automatically lists all headings in the document:

- Type `[TOC]` in a paragraph, or use the slash command `/toc`
- The TOC updates in real-time as you add, remove, or edit headings
- Click any entry to jump to that heading
- Serialized as `[TOC]` in markdown (compatible with Typora)
