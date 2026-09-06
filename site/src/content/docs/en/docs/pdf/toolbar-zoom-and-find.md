---
title: "Reading a PDF"
---


Baram opens `.pdf` files in a built-in reader. You cannot edit the PDF — but you can read it,
search it, and highlight it, and every highlight can become a reference inside your markdown
notes. **The PDF file itself is never written to.** Highlights are stored alongside it in
your vault as plain files (see [Where highlights are stored](/baram/en/docs/pdf/managing-highlights/#where-highlights-are-stored)).

> Highlighting requires a vault, because the highlight has to be stored somewhere. Open a PDF
> outside a vault — through **File > Open File** — and you still get the reader, find, zoom, and
> the page list; the highlight controls are simply not shown.

## The PDF toolbar

| Control | What it does |
| ------- | ------------ |
| **Page & highlight list** | Toggles the side panel (see below) |
| **‹ / ›** and `3 / 40` | Previous/next page, and the current page counter |
| **Find** | Opens the find bar (`Cmd+F` does the same) |
| **Text highlight mode** | Selecting text creates a highlight instead of a plain selection |
| **Area highlight mode** | Drag to draw a rectangle over a figure, table, or equation |

The two highlight modes are mutually exclusive — turning one on turns the other off. Both stay off
by default, so an ordinary drag-select and `Cmd+C` behaves the way it does in any PDF reader.

## Zoom

The PDF renders onto canvases, so it zooms with the same controls as the editor: `Cmd+=` /
`Cmd+-` to step, and a two-finger pinch on a trackpad. Pages re-render sharply at the new scale
once you settle, rather than being scaled as a blurry bitmap.

## Find in a PDF (`Cmd+F`)

`Cmd+F` inside a PDF opens **Find in PDF** instead of the editor's find bar.

- Type to highlight every match across the document
- **↑ / ↓** or `Enter` / `Shift+Enter` step through matches; the counter shows `3 / 17`
- **Match case** narrows the search
- `Escape` closes the bar

Matches are painted onto the PDF's text layer, so they line up with the words on the page even
where the PDF's internal text is broken across lines.

## The side panel

The panel button opens a rail on the left of the PDF with two tabs:

- **Pages** — Thumbnails of every page, rendered lazily as you scroll. Click one to jump there.
- **Highlights** — Every highlight in this PDF, in page order. Click one to jump to it and flash
  it. This tab has **Active** and **Deleted** sub-tabs (see [Deleting](/baram/en/docs/pdf/managing-highlights/#deleting-restoring-and-purging)).

Drag the panel's inner edge to resize it. The width is remembered per install.
