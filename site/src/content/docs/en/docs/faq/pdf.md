---
title: "PDF reading and highlights"
---


## Can I edit a PDF in Baram?

No. Baram reads PDFs and lets you annotate them, but it never writes to the PDF file. Your
highlights are stored beside it in your vault as separate plain-text files.

## How do I highlight text in a PDF?

Turn on **Text highlight mode** in the PDF toolbar, then select text. A popup offers five colours
— yellow, green, blue, pink, purple. The mode is off by default so that an ordinary drag-select
and `Cmd+C` works the way it does in any other PDF reader.

## How do I highlight a figure, table, or equation?

Use an **area highlight**: turn on *Area highlight mode* and drag a rectangle, or just hold
**Alt** and drag anywhere without switching modes. Press `Escape` mid-drag to cancel. Area
highlights capture the region as an image, which is what you want for anything whose meaning is
not in the PDF's text layer.

## How do I quote a PDF highlight in my notes?

Click the highlight, choose **Copy reference**, and paste into any markdown file. You get a block
reference that renders inline as the quoted sentence — or, for an area highlight, as the cropped
region of the page. `Cmd+click` it to jump back to that spot in the PDF.

If you want the plain text with no link, use **Copy text** on the same popup — it is offered for
text highlights, since an area highlight has no text behind it to copy.

## An area reference is too big or too small

Drag its right edge, or write the width into the markdown yourself:
`((highlights/papers/attention#^a1b2c3|w=60))`. `w=` is an integer percentage from 10 to 100 of
the available width. Because it lives in the markdown, the size travels with the file.

## Where are my PDF highlights stored?

Two plain files inside your vault, per PDF:

- `highlights/<path-to-pdf>.md` — a companion markdown note holding the quoted text, one
  block-ID'd paragraph per highlight. It is an ordinary note; open and read it like any other.
- `.baram/pdf-highlights/<path-to-pdf>.json` — the geometry: page, rectangles, colour, kind.

Nothing is kept in a hidden database and nothing is written into the PDF, so highlights diff,
merge, and sync alongside your notes.

## I deleted a highlight by mistake

Deleting is a soft delete. Open the side panel, go to the **Highlights** tab and its **Deleted**
sub-tab, and press **Restore** — the highlight comes back exactly as it was, and so do any
references to it.

Deleting is soft on purpose: the quoted text lives in the companion note and the geometry in the
sidecar, so discarding the record outright would strip every reference back to a bare label, and
an area reference would lose its crop rectangle and become unrecoverable.

**Delete permanently** on that same tab removes it for good. Baram counts the references pointing
at it first and tells you the number, since those references will lose their preview. The quoted
text stays in the companion note either way.

## Can I search inside a PDF?

Yes — `Cmd+F` in a PDF tab opens **Find in PDF**. `Enter` and `Shift+Enter` step through matches,
there is a **Match case** option, and the counter shows your position (`3 / 17`).

## The highlight buttons aren't showing

Highlighting requires a vault, because the highlight has to be written somewhere. A PDF opened
through **File > Open File** from outside a vault gets the reader, find, zoom, and the page list,
but no highlight controls.

---
